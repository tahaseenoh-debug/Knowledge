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
//   GET    /me                          (who is signed in)
//   GET    /incidents?after=&status=open|all   (emergency reports + open_count)
//   POST   /incidents                   {type, note?, product_id?, photos: [dataUrl...]}
//   POST   /incidents/:id/ack           ("I've seen it")
//   POST   /incidents/:id/resolve       {note?}
//   DELETE /incidents/:id               (owner)
//   GET    /incident-photos/:id         (JPEG bytes)
//   POST   /notify/test                 (send a test Telegram message)
//   GET    /notify/chats                (list chats that messaged the bot, to find the chat ID)
//
// Sign-in: put Cloudflare Access in front of the site and set ACCESS_TEAM_DOMAIN and
// ACCESS_AUD; each request's Access token is then checked here, and the staff
// member's email is saved on every stock change. OWNER_EMAILS limits deleting to owners.

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
    metal TEXT, purity TEXT, colour TEXT, weight_g REAL, stone TEXT, size TEXT,
    cost_price REAL, sell_price REAL, supplier TEXT,
    low_stock INTEGER NOT NULL DEFAULT 1,
    notes TEXT, created_by TEXT,
    qty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    qty_after INTEGER NOT NULL,
    reason TEXT, note TEXT, by_user TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS product_photos (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    note TEXT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    by_user TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT, resolved_note TEXT, resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS incident_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS incident_acks (
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    by_user TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (incident_id, by_user))`,
  `CREATE INDEX IF NOT EXISTS idx_incident_photos ON incident_photos(incident_id)`,
];

// Columns added after the first version: added to existing databases automatically.
const ADDED_COLUMNS = [
  ["products", "colour", "TEXT"],
  ["products", "created_by", "TEXT"],
  ["movements", "by_user", "TEXT"],
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  for (const [table, col, type] of ADDED_COLUMNS) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (!results.some((r) => r.name === col)) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
    }
  }
  schemaReady = true;
}

// ---------- Cloudflare Access sign-in ----------
const b64urlBytes = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

function teamUrl(env) {
  const d = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, "");
  return d.includes("://") ? d : "https://" + d;
}

let certCache = { url: null, at: 0, keys: [] };
async function accessKeys(env, force = false) {
  const url = teamUrl(env) + "/cdn-cgi/access/certs";
  if (!force && certCache.url === url && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(500, "Couldn't load Cloudflare Access keys. Check ACCESS_TEAM_DOMAIN.");
  const { keys } = await res.json();
  certCache = { url, at: Date.now(), keys };
  return keys;
}

async function verifyAccess(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion") || cookie(request, "CF_Authorization");
  const fail = () => { throw new HttpError(401, "You're signed out. Reload the page to sign in again.", { auth: "access" }); };
  if (!token) fail();
  const parts = token.split(".");
  if (parts.length !== 3) fail();
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { fail(); }
  if (header.alg !== "RS256") fail();
  let jwk = (await accessKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(env, true)).find((k) => k.kid === header.kid); // keys rotated
  if (!jwk) fail();
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) fail();
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD.trim())) fail();
  if (payload.iss !== teamUrl(env)) fail();
  if (!payload.exp || payload.exp < now - 30) fail();
  if (!payload.email) fail();
  return String(payload.email).toLowerCase();
}

function displayName(email, env) {
  if (!email) return null;
  // Optional STAFF_NAMES: "ayesha@gmail.com=Ayesha, ali@gmail.com=Ali"
  for (const pair of String(env.STAFF_NAMES || "").split(",")) {
    const [e, n] = pair.split("=").map((x) => x && x.trim());
    if (e && n && e.toLowerCase() === email) return n;
  }
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isOwner(user, env) {
  const owners = String(env.OWNER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return true;         // no owners listed: everyone can do everything
  return !!user && owners.includes(user.email);
}

function requireOwner(user, env, what = "delete") {
  if (!isOwner(user, env)) throw new HttpError(403, `Only the owner can ${what}. Ask the owner to do this.`);
}

const PRODUCT_FIELDS = [
  "name", "category_id", "metal", "purity", "colour", "weight_g", "stone", "size",
  "cost_price", "sell_price", "supplier", "low_stock", "notes",
];

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
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
    metal: clean(body.metal), purity: clean(body.purity), colour: clean(body.colour),
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
const MAX_INCIDENT_PHOTOS = 4;

function parsePhoto(data) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
  if (!m) throw new HttpError(400, "Photo must be a JPEG, PNG or WebP image");
  if (m[2].length > MAX_PHOTO_B64) throw new HttpError(413, "Photo is too large (max about 1 MB)");
  return { mime: m[1], b64: m[2] };
}

function b64Bytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const INCIDENT_TYPES = ["Theft / robbery", "Suspicious person", "Damaged piece", "Missing piece",
  "Customer dispute", "Fire / medical / safety", "Other"];

const INCIDENT_SELECT = `SELECT i.*, p.code AS product_code, p.name AS product_name,
  (SELECT json_group_array(ph.id) FROM incident_photos ph WHERE ph.incident_id = i.id) AS photo_ids,
  (SELECT json_group_array(a.by_user) FROM incident_acks a WHERE a.incident_id = i.id) AS acks
  FROM incidents i LEFT JOIN products p ON p.id = i.product_id`;

const incidentRow = (r) => ({ ...r, photo_ids: JSON.parse(r.photo_ids || "[]"), acks: JSON.parse(r.acks || "[]") });

async function getIncident(db, id) {
  const r = await db.prepare(INCIDENT_SELECT + " WHERE i.id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "Report not found");
  return incidentRow(r);
}

async function getProduct(db, id) {
  const p = await db.prepare(PRODUCT_SELECT + " WHERE p.id = ?").bind(id).first();
  if (!p) throw new HttpError(404, "Item not found");
  return p;
}

async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, "Invalid JSON body"); }
}

// ---------- low-stock notifications (Telegram) ----------
const telegramReady = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
const telegramUrl = (env, method) =>
  `${env.TELEGRAM_API_BASE || "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN.trim()}/${method}`;

async function sendTelegram(env, text) {
  const chats = String(env.TELEGRAM_CHAT_ID).split(",").map((c) => c.trim()).filter(Boolean);
  const results = await Promise.all(chats.map(async (chat_id) => {
    const res = await fetch(telegramUrl(env, "sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    return data.ok ? null : `${chat_id}: ${data.description || res.status}`;
  }));
  const errors = results.filter(Boolean);
  if (errors.length) throw new Error("Telegram said: " + errors.join("; "));
}

// A message is sent only when a stock-out makes an item cross its alert level, not on every sale.
function lowStockMessage(p, oldQty, change, reason, by, siteUrl) {
  const crossedLow = oldQty > p.low_stock && p.qty <= p.low_stock;
  const becameZero = oldQty > 0 && p.qty === 0;
  if (!crossedLow && !becameZero) return null;
  const head = p.qty === 0 ? "🔴 OUT OF STOCK" : "⚠️ Low stock";
  const details = [p.category, [p.metal, p.purity].filter(Boolean).join(" "), p.colour].filter(Boolean).join(" · ");
  return [
    `${head}: ${p.code} ${p.name}`,
    details,
    `${p.qty} left (alert at ${p.low_stock})`,
    `Last change: ${change} ${reason || ""}${by ? " by " + by : ""}`.trim(),
    siteUrl,
  ].filter(Boolean).join("\n");
}

async function sendTelegramPhoto(env, b64, mime, caption) {
  const chats = String(env.TELEGRAM_CHAT_ID).split(",").map((c) => c.trim()).filter(Boolean);
  await Promise.all(chats.map(async (chat_id) => {
    const form = new FormData();
    form.append("chat_id", chat_id);
    form.append("caption", caption.slice(0, 1000));
    form.append("photo", new Blob([b64Bytes(b64)], { type: mime }), "report.jpg");
    const res = await fetch(telegramUrl(env, "sendPhoto"), { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram sendPhoto to ${chat_id}: ${data.description || res.status}`);
  }));
}

async function route(request, env, parts, user, waitUntil) {
  const by = user ? user.name : null;
  const db = env.DB;
  const method = request.method;
  const url = new URL(request.url);
  const [resource, idStr, sub] = parts;
  const id = idStr !== undefined ? Number(idStr) : null;
  if (idStr !== undefined && !Number.isInteger(id) && resource !== "notify") throw new HttpError(404, "Not found");

  // ---------- auth check endpoint ----------
  if (resource === "ping") return json({ ok: true });
  if (resource === "me") {
    return json({
      signed_in: !!user, email: user && user.email, name: user && user.name,
      owner: isOwner(user, env), access: !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
      telegram: telegramReady(env), telegram_token: !!env.TELEGRAM_BOT_TOKEN,
    });
  }

  if (resource === "notify") {
    requireOwner(user, env, "manage notifications");
    if (!env.TELEGRAM_BOT_TOKEN) throw new HttpError(400, "TELEGRAM_BOT_TOKEN isn't set yet (see README).");
    if (idStr === "test" && method === "POST") {
      if (!env.TELEGRAM_CHAT_ID) throw new HttpError(400, "TELEGRAM_CHAT_ID isn't set yet. Use 'Find chat ID' first.");
      try {
        await sendTelegram(env, `✅ Test from Jewellery Inventory${by ? " (sent by " + by + ")" : ""}.\nLow-stock alerts will arrive here.`);
      } catch (e) { throw new HttpError(502, e.message); }
      return json({ ok: true });
    }
    if (idStr === "chats" && method === "GET") {
      const res = await fetch(telegramUrl(env, "getUpdates"));
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new HttpError(502, "Telegram said: " + (data.description || res.status) + ". Check the bot token.");
      const chats = new Map();
      for (const u of data.result || []) {
        const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
        if (c) chats.set(c.id, { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username, type: c.type });
      }
      return json([...chats.values()]);
    }
    throw new HttpError(404, "Not found");
  }

  // ---------- emergency reports ----------
  if (resource === "incident-photos" && method === "GET" && id !== null) {
    const ph = await db.prepare("SELECT mime, data FROM incident_photos WHERE id = ?").bind(id).first();
    if (!ph) throw new HttpError(404, "No photo");
    return new Response(b64Bytes(ph.data), {
      headers: { "content-type": ph.mime, "cache-control": "private, max-age=31536000, immutable" },
    });
  }
  if (resource === "incidents") {
    if (method === "GET" && id === null) {
      const where = [], args = [];
      const after = int(url.searchParams.get("after"));
      if (after !== null) { where.push("i.id > ?"); args.push(after); }
      if (url.searchParams.get("status") !== "all") where.push("i.status = 'open'");
      const limit = Math.min(Math.max(int(url.searchParams.get("limit"), 100), 1), 300);
      const { results } = await db.prepare(INCIDENT_SELECT + (where.length ? " WHERE " + where.join(" AND ") : "") +
        " ORDER BY i.id DESC LIMIT ?").bind(...args, limit).all();
      const counts = await db.prepare(
        "SELECT COUNT(*) AS open_count, MAX(id) AS max_id FROM incidents WHERE status = 'open'").first();
      return json({ incidents: results.map(incidentRow), open_count: counts.open_count, max_open_id: counts.max_id });
    }
    if (method === "POST" && id === null) {
      const body = await readBody(request);
      const type = clean(body.type);
      if (!type) throw new HttpError(400, "Choose what happened");
      const photos = (Array.isArray(body.photos) ? body.photos : []).map(parsePhoto);
      if (photos.length > MAX_INCIDENT_PHOTOS) throw new HttpError(400, `Up to ${MAX_INCIDENT_PHOTOS} photos per report`);
      const note = clean(body.note);
      if (!photos.length && !note) throw new HttpError(400, "Add a photo or a few words about what happened");
      const productId = int(body.product_id);
      const row = await db.prepare(
        "INSERT INTO incidents (type, note, product_id, by_user) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(type, note, productId || null, by).first();
      if (photos.length) {
        await db.batch(photos.map((ph) => db.prepare(
          "INSERT INTO incident_photos (incident_id, mime, data) VALUES (?, ?, ?)").bind(row.id, ph.mime, ph.b64)));
      }
      const inc = await getIncident(db, row.id);
      if (telegramReady(env)) {
        const caption = [
          `🚨 EMERGENCY: ${inc.type}`,
          inc.product_code ? `Item: ${inc.product_code} ${inc.product_name}` : null,
          inc.note,
          `Reported${by ? " by " + by : ""}`,
          photos.length > 1 ? `(${photos.length} photos, see the app)` : null,
          url.origin,
        ].filter(Boolean).join("\n");
        const send = photos.length
          ? sendTelegramPhoto(env, photos[0].b64, photos[0].mime, caption)
          : sendTelegram(env, caption);
        waitUntil(send.catch((e) => console.error("Emergency alert failed:", e.message)));
      }
      return json(inc, 201);
    }
    if (method === "POST" && id !== null && sub === "ack") {
      await getIncident(db, id);
      await db.prepare("INSERT OR IGNORE INTO incident_acks (incident_id, by_user) VALUES (?, ?)")
        .bind(id, by || "Someone").run();
      return json(await getIncident(db, id));
    }
    if (method === "POST" && id !== null && sub === "resolve") {
      const body = await readBody(request);
      const r = await db.prepare(
        `UPDATE incidents SET status = 'resolved', resolved_by = ?, resolved_note = ?, resolved_at = datetime('now')
         WHERE id = ? RETURNING id`).bind(by, clean(body.note), id).first();
      if (!r) throw new HttpError(404, "Report not found");
      return json(await getIncident(db, id));
    }
    if (method === "DELETE" && id !== null && !sub) {
      requireOwner(user, env);
      await db.batch([
        db.prepare("DELETE FROM incident_photos WHERE incident_id = ?").bind(id),
        db.prepare("DELETE FROM incident_acks WHERE incident_id = ?").bind(id),
        db.prepare("DELETE FROM incidents WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

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
      requireOwner(user, env);
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
      requireOwner(user, env);
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
        where.push("(p.name LIKE ? OR p.code LIKE ? OR p.metal LIKE ? OR p.colour LIKE ? OR p.stone LIKE ? OR p.notes LIKE ?)");
        const like = `%${q}%`;
        args.push(like, like, like, like, like, like);
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
        `INSERT INTO products (code, ${PRODUCT_FIELDS.join(", ")}, qty, created_by)
         VALUES (?, ${PRODUCT_FIELDS.map(() => "?").join(", ")}, ?, ?) RETURNING id`)
        .bind(code, ...PRODUCT_FIELDS.map((f) => v[f]), openingQty, by).first();
      if (openingQty > 0) {
        await db.prepare(
          "INSERT INTO movements (product_id, change, qty_after, reason, note, by_user) VALUES (?, ?, ?, 'Opening stock', NULL, ?)")
          .bind(row.id, openingQty, openingQty, by).run();
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
      requireOwner(user, env);
      await db.batch([
        db.prepare("DELETE FROM movements WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM product_photos WHERE product_id = ?").bind(id),
        db.prepare("UPDATE incidents SET product_id = NULL WHERE product_id = ?").bind(id),
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
        "INSERT INTO movements (product_id, change, qty_after, reason, note, by_user) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, change, updated.qty, clean(body.reason), clean(body.note), by).run();
      const product = await getProduct(db, id);
      const oldQty = updated.qty - change;
      const msg = telegramReady(env) && lowStockMessage(product, oldQty, change, clean(body.reason), by, url.origin);
      // Sent in the background so the stock update returns straight away.
      if (msg) waitUntil(sendTelegram(env, msg).catch((e) => console.error("Low-stock alert failed:", e.message)));
      return json(product);
    }
    if (sub === "photo" && id !== null) {
      if (method === "GET") {
        const ph = await db.prepare("SELECT mime, data FROM product_photos WHERE product_id = ?").bind(id).first();
        if (!ph) throw new HttpError(404, "No photo");
        const bytes = b64Bytes(ph.data);
        // URLs carry ?v=<updated_at>, so the browser can cache each version for a long time.
        return new Response(bytes, {
          headers: { "content-type": ph.mime, "cache-control": "private, max-age=31536000, immutable" },
        });
      }
      if (method === "PUT") {
        await getProduct(db, id);
        const body = await readBody(request);
        const photo = parsePhoto(body.data);
        await db.prepare(
          `INSERT INTO product_photos (product_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`)
          .bind(id, photo.mime, photo.b64).run();
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
    const who = clean(url.searchParams.get("user"));
    const { results } = await db.prepare(
      `SELECT m.*, p.code, p.name FROM movements m JOIN products p ON p.id = m.product_id
       ${who ? "WHERE m.by_user = ?" : ""} ORDER BY m.id DESC LIMIT ?`).bind(...(who ? [who, limit] : [limit])).all();
    const staff = await db.prepare(
      "SELECT DISTINCT by_user FROM movements WHERE by_user IS NOT NULL ORDER BY by_user").all();
    return json({ movements: results, staff: staff.results.map((r) => r.by_user) });
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

export async function onRequest({ request, env, params, waitUntil }) {
  try {
    if (!env.DB) throw new HttpError(500, "Database not connected. Add a D1 binding named DB (see README).");
    // Optional shared password: set APP_PASSWORD in the Pages project settings.
    // The password comes in a header (API calls) or a cookie (so <img> tags can load photos).
    if (env.APP_PASSWORD && request.headers.get("x-app-password") !== env.APP_PASSWORD &&
        cookie(request, "inv_pw") !== env.APP_PASSWORD) {
      throw new HttpError(401, "Wrong or missing password");
    }
    let user = null;
    if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
      const email = await verifyAccess(request, env);
      user = { email, name: displayName(email, env) };
    }
    await ensureSchema(env.DB);
    const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
    return await route(request, env, parts, user, waitUntil);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
    if (String(err && err.message).includes("UNIQUE")) return json({ error: "That already exists" }, 409);
    console.error(err);
    return json({ error: "Server error: " + (err && err.message) }, 500);
  }
}
