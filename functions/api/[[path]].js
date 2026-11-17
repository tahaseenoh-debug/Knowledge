// Cloudflare Pages Function: the whole JSON API for the inventory app.
// Routes (all under /api):
//   GET    /categories
//   POST   /categories                 {name, prefix?}
//   PUT    /categories/:id             {name}
//   DELETE /categories/:id             (only when it has no items)
//   GET    /products?q=&category=
//   POST   /products                   {name, category_id, ..., qty?}
//   PUT    /products/:id               {name, category_id, ...}
//   DELETE /products/:id
//   POST   /products/:id/stock         {change, reason?, note?}
//   GET    /products/:id/movements
//   GET    /movements?limit=           (recent activity across all items)
//   GET    /products/:id/photo         (JPEG bytes)
//   PUT    /products/:id/photo         {data: base64 JPEG}
//   DELETE /products/:id/photo

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    prefix TEXT NOT NULL UNIQUE,
    next_num INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    metal TEXT, purity TEXT, weight_g REAL, stone TEXT, size TEXT,
    cost_price REAL, sell_price REAL, supplier TEXT,
    low_stock INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    qty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    qty_after INTEGER NOT NULL,
    reason TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS product_photos (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id, created_at)`,
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

const PRODUCT_FIELDS = [
  "name", "category_id", "metal", "purity", "weight_g", "stone", "size",
  "cost_price", "sell_price", "supplier", "low_stock", "notes",
];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function clean(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") { const t = v.trim(); return t === "" ? null : t; }
  return v;
}
function num(v) {
  v = clean(v);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, "Invalid number: " + v);
  return n;
}
function int(v, fallback = null) {
  const n = num(v);
  if (n === null) return fallback;
  if (!Number.isInteger(n)) throw new HttpError(400, "Must be a whole number: " + v);
  return n;
}

function makePrefix(name) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || "ITM").padEnd(3, "X");
}

async function uniquePrefix(db, wanted) {
  let prefix = wanted, i = 2;
  while (await db.prepare("SELECT 1 FROM categories WHERE prefix = ?").bind(prefix).first()) {
    prefix = wanted + i++;
  }
  return prefix;
}

function productValues(body) {
  const name = clean(body.name);
  if (!name) throw new HttpError(400, "Name is required");
  const category_id = int(body.category_id);
  if (!category_id) throw new HttpError(400, "Category is required");
  return {
    name, category_id,
    metal: clean(body.metal), purity: clean(body.purity),
    weight_g: num(body.weight_g), stone: clean(body.stone), size: clean(body.size),
    cost_price: num(body.cost_price), sell_price: num(body.sell_price),
    supplier: clean(body.supplier),
    low_stock: Math.max(0, int(body.low_stock, 1)),
    notes: clean(body.notes),
  };
}

const PRODUCT_SELECT = `SELECT p.*, c.name AS category,
  (SELECT updated_at FROM product_photos ph WHERE ph.product_id = p.id) AS photo_v
  FROM products p JOIN categories c ON c.id = p.category_id`;

// Photos are resized in the browser (about 1000px JPEG, usually 100-250 KB) and kept in D1,
// so no extra storage service has to be set up.
const MAX_PHOTO_B64 = 1_400_000; // about 1 MB of image data

async function getProduct(db, id) {
  const p = await db.prepare(PRODUCT_SELECT + " WHERE p.id = ?").bind(id).first();
  if (!p) throw new HttpError(404, "Item not found");
  return p;
}

async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, "Invalid JSON body"); }
}

async function route(request, env, parts) {
  const db = env.DB;
  const method = request.method;
  const url = new URL(request.url);
  const [resource, idStr, sub] = parts;
  const id = idStr !== undefined ? Number(idStr) : null;
  if (idStr !== undefined && !Number.isInteger(id)) throw new HttpError(404, "Not found");

  // ---------- auth check endpoint ----------
  if (resource === "ping") return json({ ok: true });

  // ---------- categories ----------
  if (resource === "categories") {
    if (method === "GET" && id === null) {
      const { results } = await db.prepare(
        `SELECT c.id, c.name, c.prefix, COUNT(p.id) AS items, COALESCE(SUM(p.qty),0) AS pieces
         FROM categories c LEFT JOIN products p ON p.category_id = c.id
         GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();
      return json(results);
    }
    if (method === "POST" && id === null) {
      const body = await readBody(request);
      const name = clean(body.name);
      if (!name) throw new HttpError(400, "Category name is required");
      const existing = await db.prepare("SELECT * FROM categories WHERE name = ?").bind(name).first();
      if (existing) return json(existing); // already saved: just reuse it
      const wanted = clean(body.prefix) ? makePrefix(body.prefix) : makePrefix(name);
      const prefix = await uniquePrefix(db, wanted);
      const row = await db.prepare(
        "INSERT INTO categories (name, prefix) VALUES (?, ?) RETURNING *").bind(name, prefix).first();
      return json(row, 201);
    }
    if (method === "PUT" && id !== null) {
      const body = await readBody(request);
      const name = clean(body.name);
      if (!name) throw new HttpError(400, "Category name is required");
      const clash = await db.prepare("SELECT id FROM categories WHERE name = ? AND id != ?").bind(name, id).first();
      if (clash) throw new HttpError(409, "Another category already has that name");
      const row = await db.prepare("UPDATE categories SET name = ? WHERE id = ? RETURNING *").bind(name, id).first();
      if (!row) throw new HttpError(404, "Category not found");
      return json(row);
    }
    if (method === "DELETE" && id !== null) {
      const used = await db.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?").bind(id).first();
      if (used.n > 0) throw new HttpError(409, `This category still has ${used.n} item(s). Move or delete them first.`);
      await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---------- products ----------
  if (resource === "products") {
    if (method === "GET" && id === null) {
      const where = [], args = [];
      const q = clean(url.searchParams.get("q"));
      if (q) {
        where.push("(p.name LIKE ? OR p.code LIKE ? OR p.metal LIKE ? OR p.stone LIKE ? OR p.notes LIKE ?)");
        const like = `%${q}%`;
        args.push(like, like, like, like, like);
      }
      const cat = int(url.searchParams.get("category"));
      if (cat) { where.push("p.category_id = ?"); args.push(cat); }
      if (url.searchParams.get("low") === "1") where.push("p.qty <= p.low_stock");
      const sql = PRODUCT_SELECT + (where.length ? " WHERE " + where.join(" AND ") : "") +
        " ORDER BY p.updated_at DESC, p.id DESC";
      const { results } = await db.prepare(sql).bind(...args).all();
      return json(results);
    }
    if (method === "GET" && id !== null && !sub) return json(await getProduct(db, id));

    if (method === "POST" && id === null) {
      const body = await readBody(request);
      const v = productValues(body);
      const openingQty = Math.max(0, int(body.qty, 0));
      // Atomically take the next number for this category to build the code, e.g. RIN-0007.
      const cat = await db.prepare(
        "UPDATE categories SET next_num = next_num + 1 WHERE id = ? RETURNING prefix, next_num")
        .bind(v.category_id).first();
      if (!cat) throw new HttpError(400, "Category not found");
      const code = `${cat.prefix}-${String(cat.next_num).padStart(4, "0")}`;
      const row = await db.prepare(
        `INSERT INTO products (code, ${PRODUCT_FIELDS.join(", ")}, qty)
         VALUES (?, ${PRODUCT_FIELDS.map(() => "?").join(", ")}, ?) RETURNING id`)
        .bind(code, ...PRODUCT_FIELDS.map((f) => v[f]), openingQty).first();
      if (openingQty > 0) {
        await db.prepare(
          "INSERT INTO movements (product_id, change, qty_after, reason, note) VALUES (?, ?, ?, 'Opening stock', NULL)")
          .bind(row.id, openingQty, openingQty).run();
      }
      return json(await getProduct(db, row.id), 201);
    }
    if (method === "PUT" && id !== null && !sub) {
      const body = await readBody(request);
      const v = productValues(body);
      const current = await getProduct(db, id);
      if (v.category_id !== current.category_id) {
        const exists = await db.prepare("SELECT 1 FROM categories WHERE id = ?").bind(v.category_id).first();
        if (!exists) throw new HttpError(400, "Category not found");
      }
      await db.prepare(
        `UPDATE products SET ${PRODUCT_FIELDS.map((f) => f + " = ?").join(", ")},
         updated_at = datetime('now') WHERE id = ?`)
        .bind(...PRODUCT_FIELDS.map((f) => v[f]), id).run();
      return json(await getProduct(db, id));
    }
    if (method === "DELETE" && id !== null && !sub) {
      await db.batch([
        db.prepare("DELETE FROM movements WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM product_photos WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM products WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
    if (method === "POST" && id !== null && sub === "stock") {
      const body = await readBody(request);
      const change = int(body.change);
      if (!change) throw new HttpError(400, "Quantity must be a non-zero whole number");
      const updated = await db.prepare(
        `UPDATE products SET qty = qty + ?, updated_at = datetime('now')
         WHERE id = ? AND qty + ? >= 0 RETURNING qty`).bind(change, id, change).first();
      if (!updated) {
        const p = await getProduct(db, id); // throws 404 if missing
        throw new HttpError(409, `Not enough stock: only ${p.qty} available`);
      }
      await db.prepare(
        "INSERT INTO movements (product_id, change, qty_after, reason, note) VALUES (?, ?, ?, ?, ?)")
        .bind(id, change, updated.qty, clean(body.reason), clean(body.note)).run();
      return json(await getProduct(db, id));
    }
    if (sub === "photo" && id !== null) {
      if (method === "GET") {
        const ph = await db.prepare("SELECT mime, data FROM product_photos WHERE product_id = ?").bind(id).first();
        if (!ph) throw new HttpError(404, "No photo");
        const bin = atob(ph.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // URLs carry ?v=<updated_at>, so the browser can cache each version for a long time.
        return new Response(bytes, {
          headers: { "content-type": ph.mime, "cache-control": "private, max-age=31536000, immutable" },
        });
      }
      if (method === "PUT") {
        await getProduct(db, id);
        const body = await readBody(request);
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
        if (!m) throw new HttpError(400, "Photo must be a JPEG, PNG or WebP image");
        if (m[2].length > MAX_PHOTO_B64) throw new HttpError(413, "Photo is too large (max about 1 MB)");
        await db.prepare(
          `INSERT INTO product_photos (product_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`)
          .bind(id, m[1], m[2]).run();
        return json(await getProduct(db, id));
      }
      if (method === "DELETE") {
        await db.prepare("DELETE FROM product_photos WHERE product_id = ?").bind(id).run();
        return json(await getProduct(db, id));
      }
    }
    if (method === "GET" && id !== null && sub === "movements") {
      const { results } = await db.prepare(
        "SELECT * FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 500").bind(id).all();
      return json(results);
    }
  }

  // ---------- recent activity ----------
  if (resource === "movements" && method === "GET" && id === null) {
    const limit = Math.min(Math.max(int(url.searchParams.get("limit"), 50), 1), 500);
    const { results } = await db.prepare(
      `SELECT m.*, p.code, p.name FROM movements m JOIN products p ON p.id = m.product_id
       ORDER BY m.id DESC LIMIT ?`).bind(limit).all();
    return json(results);
  }

  throw new HttpError(404, "Not found");
}

function cookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export async function onRequest({ request, env, params }) {
  try {
    if (!env.DB) throw new HttpError(500, "Database not connected. Add a D1 binding named DB (see README).");
    // Optional shared password: set APP_PASSWORD in the Pages project settings.
    // The password comes in a header (API calls) or a cookie (so <img> tags can load photos).
    if (env.APP_PASSWORD && request.headers.get("x-app-password") !== env.APP_PASSWORD &&
        cookie(request, "inv_pw") !== env.APP_PASSWORD) {
      throw new HttpError(401, "Wrong or missing password");
    }
    await ensureSchema(env.DB);
    const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
    return await route(request, env, parts);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (String(err && err.message).includes("UNIQUE")) return json({ error: "That already exists" }, 409);
    console.error(err);
    return json({ error: "Server error: " + (err && err.message) }, 500);
  }
}
