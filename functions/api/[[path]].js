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
//   GET    /auth/status                 (sign-in mode, whether first setup is needed)
//   POST   /auth/setup                  {shop_password?, name, username}  -> first admin + PIN
//   POST   /auth/login                  {username, pin}
//   POST   /auth/logout
//   POST   /auth/pin                    {current_pin, new_pin}   (change own 6-digit PIN)
//   POST   /auth/bio/register-options   (signed in) -> options to turn on Face ID / fingerprint on this phone
//   POST   /auth/bio/register           {id, clientDataJSON, authenticatorData, publicKey, alg}
//   POST   /auth/bio/login-options      {username}
//   POST   /auth/bio/login              {id, clientDataJSON, authenticatorData, signature}
//   POST   /auth/bio/remove             {id}  (signed in: turn it off for this phone)
//   GET    /users                       (admin)
//   POST   /users                       {name, username, role}  -> new account + generated PIN (admin)
//   PUT    /users/:id                   {name?, role?, active?} (admin)
//   POST   /users/:id/reset-pin         -> new generated PIN (admin)
//   GET    /locations                   (places + piece counts)
//   POST   /locations                   {name}
//   PUT    /locations/:id               {name}         (owner)
//   DELETE /locations/:id               (owner, only when empty)
//   POST   /products/:id/move           {from_location_id, to_location_id, qty, note?}
//   PUT    /products/:id/track          {on}   (track each piece separately)
//   GET    /products/:id/pieces         (pieces of a tracked item)
//   GET    /pieces/:serial              (one piece + its history, e.g. NEC-0001-03)
//   GET    /photo-index                 (photo fingerprints for search by photo)
//   PUT    /products/:id/photo-vec      {vec, v}  (fingerprint for the current photo)
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
  `CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS product_locations (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id),
    qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, location_id))`,
  `CREATE INDEX IF NOT EXISTS idx_product_locations_loc ON product_locations(location_id)`,
  `CREATE TABLE IF NOT EXISTS pieces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    serial TEXT NOT NULL UNIQUE,
    location_id INTEGER REFERENCES locations(id),
    status TEXT NOT NULL DEFAULT 'in',
    out_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_pieces_product ON pieces(product_id, status)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'staff',
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    must_change_pin INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    alg INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    device TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT)`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    challenge TEXT PRIMARY KEY,
    user_id INTEGER,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS photo_vectors (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    photo_v TEXT NOT NULL,
    vec TEXT NOT NULL)`,
];

// Columns added after the first version: added to existing databases automatically.
const ADDED_COLUMNS = [
  ["products", "colour", "TEXT"],
  ["products", "created_by", "TEXT"],
  ["movements", "by_user", "TEXT"],
  ["movements", "location", "TEXT"],     // place the pieces went into / out of
  ["movements", "to_location", "TEXT"],  // for moves: where they went
  ["movements", "moved", "INTEGER"],     // for moves: how many pieces
  ["movements", "pieces", "TEXT"],       // for tracked items: which pieces (serials, comma-separated)
  ["products", "track_pieces", "INTEGER NOT NULL DEFAULT 0"],
  ["products", "next_piece", "INTEGER NOT NULL DEFAULT 0"],
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

// ---------- staff accounts with 6-digit PINs ----------
// Roles: "admin" can do everything; "staff" can add, edit and do stock changes but can't delete
// or manage accounts. PINs are stored only as salted PBKDF2 hashes. After 5 wrong PINs an account
// is locked for 15 minutes. A sign-in lasts 24 hours (also when the app is closed and reopened);
// after that the PIN (or Face ID / fingerprint) is needed again.
const SESSION_HOURS = 24, MAX_TRIES = 5, LOCK_MINUTES = 15, PBKDF2_ROUNDS = 10000;
const ROLES = ["admin", "staff"];
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS }, key, 256));
}

function sameText(a, b) { // compare without leaking where they differ
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function weakPin(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true;                       // 111111
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  return steps.every((x) => x === 1) || steps.every((x) => x === -1); // 123456, 654321
}

function newPin() {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n >= 4_294_000_000) continue; // keep the 6 digits evenly random
    const pin = String(n % 1_000_000).padStart(6, "0");
    if (!weakPin(pin)) return pin;
  }
}

function checkNewPin(pin) {
  pin = String(pin || "");
  if (!/^\d{6}$/.test(pin)) throw new HttpError(400, "The PIN must be exactly 6 digits (numbers only)");
  if (weakPin(pin)) throw new HttpError(400, "That PIN is too easy to guess (like 111111 or 123456). Choose another.");
  return pin;
}

async function pinFields(pin) {
  const salt = randomHex(16);
  return { pin_salt: salt, pin_hash: await hashPin(pin, salt) };
}

function cleanUsername(v) {
  const u = String(v || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(u)) throw new HttpError(400, "Username: 2–30 letters or numbers, no spaces (e.g. ayesha)");
  return u;
}

const userCount = async (db) => (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1").first()).n;

async function sessionUser(db, request) {
  const token = cookie(request, "inv_session");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const th = await sha256(token);
  const u = await db.prepare(
    `SELECT u.id, u.name, u.username, u.role, u.must_change_pin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`).bind(th).first();
  return u || null;
}

async function startSession(db, userId, request) {
  const token = randomHex(32);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`)
      .bind(await sha256(token), userId),
    db.prepare("UPDATE users SET last_login = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = ?").bind(userId),
  ]);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `inv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active,
  must_change_pin: !!u.must_change_pin, locked: !!(u.locked_until && u.locked_until > new Date().toISOString().replace("T", " ").slice(0, 19)),
  last_login: u.last_login, created_at: u.created_at });

const withCookie = (res, c) => { res.headers.append("set-cookie", c); return res; };

// ---------- Face ID / fingerprint (WebAuthn passkeys) ----------
// The phone keeps a private key that only unlocks with the owner's face, finger or phone code;
// the server stores the matching public key and checks a signature over a one-time challenge.
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (str) => {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
};
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const sha256Bytes = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const bytesEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function newChallenge(db, purpose, userId) {
  const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now')"),
    db.prepare("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', '+5 minutes'))")
      .bind(challenge, userId ?? null, purpose),
  ]);
  return challenge;
}

// Checks the browser's signed "client data": right purpose, our one-time challenge, our website.
async function checkClientData(db, request, cdBytes, type, purpose) {
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(cdBytes)); } catch { throw new HttpError(400, "Face ID / fingerprint check failed"); }
  if (cd.type !== type) throw new HttpError(400, "Face ID / fingerprint check failed");
  if (cd.origin !== new URL(request.url).origin) throw new HttpError(400, "Face ID / fingerprint: wrong website");
  const ch = await db.prepare("DELETE FROM webauthn_challenges WHERE challenge = ? AND purpose = ? AND expires_at > datetime('now') RETURNING user_id")
    .bind(String(cd.challenge || ""), purpose).first();
  if (!ch) throw new HttpError(400, "That took too long. Please try again.");
  return ch;
}

// Authenticator data: made for this website, and the person was verified (face / finger / phone code).
async function checkAuthData(request, ad) {
  if (ad.length < 37) throw new HttpError(400, "Face ID / fingerprint check failed");
  const rpHash = await sha256Bytes(new TextEncoder().encode(new URL(request.url).hostname));
  if (!bytesEqual(ad.slice(0, 32), rpHash)) throw new HttpError(400, "Face ID / fingerprint: wrong website");
  const flags = ad[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new HttpError(400, "Face ID / fingerprint wasn't confirmed");
  return new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0);
}

// ECDSA signatures arrive DER-encoded; WebCrypto wants the plain 64-byte r|s form.
function derToRaw(der) {
  if (der[0] !== 0x30) return der;
  let i = 2;
  const part = () => {
    if (der[i++] !== 0x02) throw new Error("bad signature");
    const len = der[i++];
    let v = der.slice(i, i + len); i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  return concat(part(), part());
}

async function verifySignature(alg, spkiB64, data, sig) {
  const spki = unb64u(spkiB64);
  if (alg === -7) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  }
  return false;
}

async function bioRoute(request, env, step, user) {
  const db = env.DB;
  const host = new URL(request.url).hostname;
  if (request.method !== "POST") throw new HttpError(404, "Not found");
  const body = await readBody(request);

  if (step === "register-options") {
    if (!user) throw new HttpError(401, "Please sign in", { auth: "login" });
    const { results } = await db.prepare("SELECT id FROM webauthn_credentials WHERE user_id = ?").bind(user.id).all();
    return json({
      challenge: await newChallenge(db, "register", user.id),
      rp: { name: "Jewellery Inventory", id: host },
      user: { id: b64u(new TextEncoder().encode("u" + user.id)), name: user.username, displayName: user.name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      excludeCredentials: results.map((r) => ({ type: "public-key", id: r.id })),
      attestation: "none", timeout: 60000,
    });
  }
  if (step === "register") {
    if (!user) throw new HttpError(401, "Please sign in", { auth: "login" });
    const ch = await checkClientData(db, request, unb64u(body.clientDataJSON), "webauthn.create", "register");
    if (ch.user_id !== user.id) throw new HttpError(400, "Face ID / fingerprint check failed");
    const signCount = await checkAuthData(request, unb64u(body.authenticatorData));
    const alg = Number(body.alg);
    if (![-7, -257].includes(alg) || !body.publicKey || !body.id) throw new HttpError(400, "This phone's Face ID / fingerprint type isn't supported");
    await db.prepare(
      "INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, alg, sign_count, device) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(String(body.id), user.id, String(body.publicKey), alg, signCount, String(body.device || "").slice(0, 60)).run();
    return json({ ok: true });
  }
  if (step === "login-options") {
    let username;
    try { username = cleanUsername(body.username); } catch { username = ""; }
    const u = username && await db.prepare("SELECT id FROM users WHERE username = ? AND active = 1").bind(username).first();
    const { results } = u ? await db.prepare("SELECT id FROM webauthn_credentials WHERE user_id = ?").bind(u.id).all() : { results: [] };
    if (!results.length) throw new HttpError(404, "Face ID / fingerprint isn't turned on for this account on this phone. Use your PIN.");
    return json({ challenge: await newChallenge(db, "login", u.id), rpId: host, userVerification: "required", timeout: 60000,
      allowCredentials: results.map((r) => ({ type: "public-key", id: r.id })) });
  }
  if (step === "login") {
    const cred = await db.prepare(
      `SELECT c.*, u.name, u.role, u.must_change_pin, u.active FROM webauthn_credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
      .bind(String(body.id || "")).first();
    if (!cred || !cred.active) throw new HttpError(401, "Face ID / fingerprint isn't set up for this account any more. Use your PIN.", { auth: "login" });
    const cdBytes = unb64u(body.clientDataJSON);
    const ch = await checkClientData(db, request, cdBytes, "webauthn.get", "login");
    if (ch.user_id !== cred.user_id) throw new HttpError(401, "Face ID / fingerprint check failed", { auth: "login" });
    const ad = unb64u(body.authenticatorData);
    const signCount = await checkAuthData(request, ad);
    const ok = await verifySignature(cred.alg, cred.public_key, concat(ad, await sha256Bytes(cdBytes)), unb64u(body.signature));
    if (!ok) throw new HttpError(401, "Face ID / fingerprint check failed", { auth: "login" });
    if (signCount && cred.sign_count && signCount <= cred.sign_count) {
      throw new HttpError(401, "This Face ID / fingerprint key looks copied. Use your PIN, and ask an admin to check.", { auth: "login" });
    }
    await db.prepare("UPDATE webauthn_credentials SET sign_count = ?, last_used = datetime('now') WHERE id = ?").bind(signCount, cred.id).run();
    return withCookie(json({ ok: true, name: cred.name, role: cred.role, must_change_pin: !!cred.must_change_pin }),
      await startSession(db, cred.user_id, request));
  }
  if (step === "remove") {
    if (!user) throw new HttpError(401, "Please sign in", { auth: "login" });
    await db.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?").bind(String(body.id || ""), user.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found");
}

// Sign-in routes: these work without being signed in.
async function authRoute(request, env, sub, user, step) {
  const db = env.DB;
  const method = request.method;
  if (sub === "bio") return bioRoute(request, env, step, user);
  if (sub === "status" && method === "GET") {
    if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return json({ mode: "access", setup_needed: false, signed_in: true });
    const n = await userCount(db);
    return json({ mode: "accounts", setup_needed: n === 0, needs_shop_password: n === 0 && !!env.APP_PASSWORD,
      signed_in: !!user, user: user && { name: user.name, username: user.username, role: user.role, must_change_pin: !!user.must_change_pin } });
  }
  if (sub === "setup" && method === "POST") {
    const body = await readBody(request);
    if (await userCount(db)) throw new HttpError(409, "Setup is already done. Sign in instead.");
    if (env.APP_PASSWORD && body.shop_password !== env.APP_PASSWORD) throw new HttpError(403, "Wrong shop password");
    const name = titleCase(body.name);
    if (!name) throw new HttpError(400, "Enter your name");
    const pin = newPin();
    const f = await pinFields(pin);
    const row = await db.prepare(
      "INSERT INTO users (name, username, role, pin_hash, pin_salt, must_change_pin) VALUES (?, ?, 'admin', ?, ?, 1) RETURNING id")
      .bind(name, cleanUsername(body.username), f.pin_hash, f.pin_salt).first();
    return withCookie(json({ ok: true, pin, name }), await startSession(db, row.id, request));
  }
  if (sub === "login" && method === "POST") {
    const body = await readBody(request);
    const wrong = () => new HttpError(401, "Wrong username or PIN", { auth: "login" });
    let username;
    try { username = cleanUsername(body.username); } catch { throw wrong(); }
    const u = await db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").bind(username).first();
    if (!u) throw wrong();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    if (u.locked_until && u.locked_until > now) {
      const mins = Math.max(1, Math.ceil((new Date(u.locked_until.replace(" ", "T") + "Z") - Date.now()) / 60000));
      throw new HttpError(429, `Too many wrong PINs. Try again in ${mins} minute${mins > 1 ? "s" : ""}, or ask an admin to reset your PIN.`, { auth: "login" });
    }
    if (!sameText(await hashPin(String(body.pin || ""), u.pin_salt), u.pin_hash)) {
      const tries = u.failed_attempts + 1;
      if (tries >= MAX_TRIES) {
        await db.prepare(`UPDATE users SET failed_attempts = 0, locked_until = datetime('now', '+${LOCK_MINUTES} minutes') WHERE id = ?`).bind(u.id).run();
        throw new HttpError(429, `Too many wrong PINs. This account is locked for ${LOCK_MINUTES} minutes.`, { auth: "login" });
      }
      await db.prepare("UPDATE users SET failed_attempts = ? WHERE id = ?").bind(tries, u.id).run();
      throw wrong();
    }
    return withCookie(json({ ok: true, name: u.name, role: u.role, must_change_pin: !!u.must_change_pin }),
      await startSession(db, u.id, request));
  }
  if (sub === "logout" && method === "POST") {
    const token = cookie(request, "inv_session");
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return withCookie(json({ ok: true }), "inv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  }
  if (sub === "pin" && method === "POST") {
    if (!user) throw new HttpError(401, "Please sign in", { auth: "login" });
    const body = await readBody(request);
    const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    if (!sameText(await hashPin(String(body.current_pin || ""), u.pin_salt), u.pin_hash)) throw new HttpError(400, "Your current PIN is not right");
    const pin = checkNewPin(body.new_pin);
    const f = await pinFields(pin);
    await db.prepare("UPDATE users SET pin_hash = ?, pin_salt = ?, must_change_pin = 0 WHERE id = ?").bind(f.pin_hash, f.pin_salt, u.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found");
}

// Account management (admins only).
async function usersRoute(request, env, id, sub, user) {
  const db = env.DB;
  const method = request.method;
  requireOwner(user, env, "manage staff accounts");
  const adminsLeft = async (exceptId) => (await db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").bind(exceptId).first()).n;
  if (method === "GET" && id === null) {
    const { results } = await db.prepare("SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE").all();
    return json(results.map(publicUser));
  }
  if (method === "POST" && id === null) {
    const body = await readBody(request);
    const name = titleCase(body.name);
    if (!name) throw new HttpError(400, "Enter the person's name");
    const role = ROLES.includes(body.role) ? body.role : "staff";
    const username = cleanUsername(body.username);
    if (await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) {
      throw new HttpError(409, `The username "${username}" is already taken. Choose another.`);
    }
    const pin = newPin();
    const f = await pinFields(pin);
    const row = await db.prepare(
      "INSERT INTO users (name, username, role, pin_hash, pin_salt, must_change_pin) VALUES (?, ?, ?, ?, ?, 1) RETURNING *")
      .bind(name, username, role, f.pin_hash, f.pin_salt).first();
    return json({ user: publicUser(row), pin }, 201);
  }
  const target = id !== null && await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!target) throw new HttpError(404, "Account not found");
  if (method === "PUT" && !sub) {
    const body = await readBody(request);
    const name = body.name !== undefined ? titleCase(body.name) : target.name;
    if (!name) throw new HttpError(400, "Enter the person's name");
    const role = body.role !== undefined ? (ROLES.includes(body.role) ? body.role : target.role) : target.role;
    const active = body.active !== undefined ? (body.active ? 1 : 0) : target.active;
    const losingAdmin = target.role === "admin" && target.active && (role !== "admin" || !active);
    if (losingAdmin && !(await adminsLeft(target.id))) throw new HttpError(409, "There must always be at least one active admin.");
    await db.prepare("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?").bind(name, role, active, id).run();
    if (!active) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run(); // signed out everywhere
    return json(publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first()));
  }
  if (method === "POST" && sub === "reset-pin") {
    const pin = newPin();
    const f = await pinFields(pin);
    await db.batch([
      db.prepare("UPDATE users SET pin_hash = ?, pin_salt = ?, must_change_pin = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?")
        .bind(f.pin_hash, f.pin_salt, id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(id), // e.g. lost phone
    ]);
    return json({ pin, user: publicUser(await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first()) });
  }
  throw new HttpError(404, "Not found");
}

function isOwner(user, env) {
  if (user && user.role) return user.role === "admin";   // built-in accounts
  const owners = String(env.OWNER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return true;         // no owners listed: everyone can do everything
  return !!user && owners.includes(user.email);
}

function requireOwner(user, env, what = "delete") {
  if (!isOwner(user, env)) throw new HttpError(403, `Only an admin can ${what}. Ask an admin to do this.`);
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
// Names: first letter of every word in capitals ("rose gold ring" -> "Rose Gold Ring").
// Letters already typed in capitals are kept ("AD stone" -> "AD Stone").
function titleCase(v) {
  v = clean(v);
  return v === null ? null : String(v).replace(/(^|[\s(\/])(\p{Ll})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
// Notes: only the first letter in capitals, like a sentence.
function sentenceCase(v) {
  v = clean(v);
  return v === null ? null : String(v).replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
}
// Purity: all capitals ("22k" -> "22K").
function upper(v) {
  v = clean(v);
  return v === null ? null : String(v).toUpperCase();
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
  const name = titleCase(body.name);
  if (!name) throw new HttpError(400, "Name is required");
  const category_id = int(body.category_id);
  if (!category_id) throw new HttpError(400, "Category is required");
  return {
    name, category_id,
    metal: titleCase(body.metal), purity: upper(body.purity), colour: titleCase(body.colour),
    weight_g: num(body.weight_g), stone: titleCase(body.stone), size: clean(body.size),
    cost_price: num(body.cost_price), sell_price: num(body.sell_price),
    supplier: titleCase(body.supplier),
    low_stock: Math.max(0, int(body.low_stock, 1)),
    notes: sentenceCase(body.notes),
  };
}

const PRODUCT_SELECT = `SELECT p.*, c.name AS category,
  (SELECT updated_at FROM product_photos ph WHERE ph.product_id = p.id) AS photo_v,
  (SELECT photo_v FROM photo_vectors pv WHERE pv.product_id = p.id) AS vec_v,
  (SELECT json_group_array(json_object('id', l.id, 'name', l.name, 'qty', pl.qty))
     FROM product_locations pl JOIN locations l ON l.id = pl.location_id
     WHERE pl.product_id = p.id AND pl.qty > 0) AS locs
  FROM products p JOIN categories c ON c.id = p.category_id`;

// Stock is counted per place. Pieces not in any place are "place not set"
// (all stock from before places existed starts there).
function productRow(p) {
  const locations = JSON.parse(p.locs || "[]").sort((a, b) => a.name.localeCompare(b.name));
  const placed = locations.reduce((n, l) => n + l.qty, 0);
  const { locs, ...rest } = p;
  return { ...rest, locations, unassigned: Math.max(0, p.qty - placed) };
}

// ---------- items tracked piece by piece ----------
// Each piece has its own serial (NEC-0001-03) and place. The item's total and per-place
// counts are worked out from its pieces, so the rest of the app keeps working unchanged.

async function syncFromPieces(db, productId) {
  await db.batch([
    db.prepare("DELETE FROM product_locations WHERE product_id = ?").bind(productId),
    db.prepare(`INSERT INTO product_locations (product_id, location_id, qty)
      SELECT product_id, location_id, COUNT(*) FROM pieces
      WHERE product_id = ? AND status = 'in' AND location_id IS NOT NULL GROUP BY location_id`).bind(productId),
    db.prepare(`UPDATE products SET qty = (SELECT COUNT(*) FROM pieces WHERE product_id = ? AND status = 'in'),
      updated_at = datetime('now') WHERE id = ?`).bind(productId, productId),
  ]);
}

async function newPieces(db, p, n, locationId) {
  if (n < 1) return [];
  if (n > 500) throw new HttpError(400, "Add at most 500 pieces at a time");
  const r = await db.prepare("UPDATE products SET next_piece = next_piece + ? WHERE id = ? RETURNING next_piece")
    .bind(n, p.id).first();
  const serials = [];
  for (let k = r.next_piece - n + 1; k <= r.next_piece; k++) serials.push(`${p.code}-${String(k).padStart(2, "0")}`);
  await db.batch(serials.map((s) => db.prepare(
    "INSERT INTO pieces (product_id, serial, location_id) VALUES (?, ?, ?)").bind(p.id, s, locationId || null)));
  return serials;
}

// The chosen pieces, all of which must be in stock for this item.
async function inStockPieces(db, productId, serials) {
  const want = [...new Set((Array.isArray(serials) ? serials : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  if (!want.length) throw new HttpError(400, "Choose which pieces");
  if (want.length > 500) throw new HttpError(400, "Too many pieces at once");
  const { results } = await db.prepare(
    `SELECT pc.id, pc.serial, pc.location_id, l.name AS location FROM pieces pc LEFT JOIN locations l ON l.id = pc.location_id
     WHERE pc.product_id = ? AND pc.status = 'in' AND pc.serial IN (${want.map(() => "?").join(",")})`)
    .bind(productId, ...want).all();
  if (results.length !== want.length) {
    const found = new Set(results.map((r) => r.serial));
    throw new HttpError(409, "Not in stock: " + want.filter((x) => !found.has(x)).join(", "));
  }
  return results;
}

const placeNames = (rows) => [...new Set(rows.map((r) => r.location || "Place not set"))].join(", ");

async function getLocation(db, id) {
  if (!id) return null;
  const l = await db.prepare("SELECT id, name FROM locations WHERE id = ?").bind(id).first();
  if (!l) throw new HttpError(400, "That place doesn't exist any more. Reload the page.");
  return l;
}

const addToPlace = (db, productId, locationId, n) => db.prepare(
  `INSERT INTO product_locations (product_id, location_id, qty) VALUES (?, ?, ?)
   ON CONFLICT(product_id, location_id) DO UPDATE SET qty = qty + excluded.qty`).bind(productId, locationId, n);

// Takes n pieces out of a place; returns false if there aren't enough there.
async function takeFromPlace(db, productId, locationId, n) {
  const r = await db.prepare(
    `UPDATE product_locations SET qty = qty - ? WHERE product_id = ? AND location_id = ? AND qty >= ? RETURNING qty`)
    .bind(n, productId, locationId, n).first();
  if (r && r.qty === 0) {
    await db.prepare("DELETE FROM product_locations WHERE product_id = ? AND location_id = ? AND qty = 0")
      .bind(productId, locationId).run();
  }
  return !!r;
}

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

// Photo fingerprint: 1280 numbers from the image model, made in the browser and stored as
// base64 signed bytes. Used only for "search by photo".
const VEC_LEN = 1280;
function parseVec(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9+/=]+$/.test(v)) throw new HttpError(400, "Invalid photo fingerprint");
  let len;
  try { len = atob(v).length; } catch { throw new HttpError(400, "Invalid photo fingerprint"); }
  if (len !== VEC_LEN) throw new HttpError(400, "Invalid photo fingerprint size");
  return v;
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
  return productRow(p);
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
  if (idStr !== undefined && !Number.isInteger(id) && resource !== "notify" && resource !== "pieces") throw new HttpError(404, "Not found");
  if (resource === "auth") return authRoute(request, env, idStr, user);

  // ---------- auth check endpoint ----------
  if (resource === "ping") return json({ ok: true });
  if (resource === "users") return usersRoute(request, env, id, sub, user);
  if (resource === "me") {
    return json({
      signed_in: !!user, email: user && user.email, name: user && user.name,
      username: user && user.username, role: user && user.role, must_change_pin: !!(user && user.must_change_pin),
      owner: isOwner(user, env), access: !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
      accounts: !(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
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

  // ---------- search by photo ----------
  if (resource === "photo-index" && method === "GET" && id === null) {
    const { results } = await db.prepare(
      `SELECT pv.product_id AS id, pv.vec FROM photo_vectors pv
       JOIN product_photos ph ON ph.product_id = pv.product_id AND ph.updated_at = pv.photo_v`).all();
    return json(results);
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
      const note = sentenceCase(body.note);
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
         WHERE id = ? RETURNING id`).bind(by, sentenceCase(body.note), id).first();
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

  // ---------- one piece ----------
  if (resource === "pieces" && method === "GET" && idStr) {
    const serial = String(idStr).toUpperCase();
    const pc = await db.prepare(
      `SELECT pc.serial, pc.status, pc.out_reason, pc.product_id, pc.location_id, l.name AS location, pc.created_at, pc.updated_at
       FROM pieces pc LEFT JOIN locations l ON l.id = pc.location_id WHERE pc.serial = ?`).bind(serial).first();
    if (!pc) throw new HttpError(404, `No piece ${serial}`);
    const { results } = await db.prepare(
      `SELECT * FROM movements WHERE product_id = ? AND (',' || pieces || ',') LIKE ? ORDER BY id DESC LIMIT 100`)
      .bind(pc.product_id, `%,${serial},%`).all();
    return json({ ...pc, history: results });
  }

  // ---------- places (locations) ----------
  if (resource === "locations") {
    if (method === "GET" && id === null) {
      const { results } = await db.prepare(
        `SELECT l.id, l.name, COUNT(pl.product_id) AS items, COALESCE(SUM(pl.qty), 0) AS pieces
         FROM locations l LEFT JOIN product_locations pl ON pl.location_id = l.id AND pl.qty > 0
         GROUP BY l.id ORDER BY l.name COLLATE NOCASE`).all();
      const t = await db.prepare(
        `SELECT (SELECT COALESCE(SUM(qty), 0) FROM products) - (SELECT COALESCE(SUM(qty), 0) FROM product_locations) AS n`).first();
      return json({ locations: results, unassigned_pieces: t.n });
    }
    if (method === "POST" && id === null) {
      const body = await readBody(request);
      const name = titleCase(body.name);
      if (!name) throw new HttpError(400, "Place name is required");
      const existing = await db.prepare("SELECT id, name FROM locations WHERE name = ?").bind(name).first();
      if (existing) return json(existing);
      return json(await db.prepare("INSERT INTO locations (name) VALUES (?) RETURNING id, name").bind(name).first(), 201);
    }
    if (method === "PUT" && id !== null) {
      requireOwner(user, env, "rename places");
      const name = titleCase((await readBody(request)).name);
      if (!name) throw new HttpError(400, "Place name is required");
      const clash = await db.prepare("SELECT id FROM locations WHERE name = ? AND id != ?").bind(name, id).first();
      if (clash) throw new HttpError(409, "Another place already has that name");
      const row = await db.prepare("UPDATE locations SET name = ? WHERE id = ? RETURNING id, name").bind(name, id).first();
      if (!row) throw new HttpError(404, "Place not found");
      return json(row);
    }
    if (method === "DELETE" && id !== null) {
      requireOwner(user, env, "delete places");
      const used = await db.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM product_locations WHERE location_id = ?").bind(id).first();
      if (used.n > 0) throw new HttpError(409, `${used.n} piece(s) are still there. Move them first.`);
      await db.batch([
        db.prepare("DELETE FROM product_locations WHERE location_id = ?").bind(id),
        db.prepare("UPDATE pieces SET location_id = NULL WHERE location_id = ?").bind(id),
        db.prepare("DELETE FROM locations WHERE id = ?").bind(id),
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
      const name = titleCase(body.name);
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
      const name = titleCase(body.name);
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
      return json(results.map(productRow));
    }
    if (method === "GET" && id !== null && !sub) return json(await getProduct(db, id));

    if (method === "POST" && id === null) {
      const body = await readBody(request);
      const v = productValues(body);
      const openingQty = Math.max(0, int(body.qty, 0));
      const openingPlace = openingQty > 0 ? await getLocation(db, int(body.location_id)) : null;
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
          "INSERT INTO movements (product_id, change, qty_after, reason, note, by_user, location) VALUES (?, ?, ?, 'Opening stock', NULL, ?, ?)")
          .bind(row.id, openingQty, openingQty, by, openingPlace && openingPlace.name).run();
        if (openingPlace) await addToPlace(db, row.id, openingPlace.id, openingQty).run();
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
        db.prepare("DELETE FROM photo_vectors WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM product_locations WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM pieces WHERE product_id = ?").bind(id),
        db.prepare("UPDATE incidents SET product_id = NULL WHERE product_id = ?").bind(id),
        db.prepare("DELETE FROM products WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
    if (method === "POST" && id !== null && sub === "stock") {
      const body = await readBody(request);
      const change = int(body.change);
      if (!change) throw new HttpError(400, "Quantity must be a non-zero whole number");
      const before = await getProduct(db, id); // 404 if missing
      const place = await getLocation(db, int(body.location_id));
      if (before.track_pieces) {
        let serials, rows = [];
        if (change > 0) {
          serials = await newPieces(db, before, change, place && place.id);
        } else {
          rows = await inStockPieces(db, id, body.pieces);
          if (rows.length !== -change) throw new HttpError(400, `Choose exactly ${-change} piece(s)`);
          serials = rows.map((r) => r.serial);
          await db.prepare(
            `UPDATE pieces SET status = 'out', out_reason = ?, updated_at = datetime('now')
             WHERE id IN (${rows.map(() => "?").join(",")})`).bind(clean(body.reason), ...rows.map((r) => r.id)).run();
        }
        await syncFromPieces(db, id);
        const product = await getProduct(db, id);
        await db.prepare(
          "INSERT INTO movements (product_id, change, qty_after, reason, note, by_user, location, pieces) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, change, product.qty, clean(body.reason), sentenceCase(body.note), by,
            change > 0 ? (place && place.name) : placeNames(rows), serials.join(",")).run();
        const msg = telegramReady(env) && lowStockMessage(product, before.qty, change, clean(body.reason), by, url.origin);
        if (msg) waitUntil(sendTelegram(env, msg).catch((e) => console.error("Low-stock alert failed:", e.message)));
        return json({ ...product, new_pieces: change > 0 ? serials : [] });
      }
      let updated;
      if (change > 0) {
        updated = await db.prepare(
          "UPDATE products SET qty = qty + ?, updated_at = datetime('now') WHERE id = ? RETURNING qty")
          .bind(change, id).first();
        if (place) await addToPlace(db, id, place.id, change).run();
      } else if (place) {
        if (!(await takeFromPlace(db, id, place.id, -change))) {
          const have = (before.locations.find((l) => l.id === place.id) || { qty: 0 }).qty;
          throw new HttpError(409, `Only ${have} at ${place.name}. Choose the place it's taken from.`);
        }
        updated = await db.prepare(
          "UPDATE products SET qty = qty + ?, updated_at = datetime('now') WHERE id = ? RETURNING qty")
          .bind(change, id).first();
      } else {
        // Taking from "place not set": only the pieces that aren't in any place.
        updated = await db.prepare(
          `UPDATE products SET qty = qty + ?, updated_at = datetime('now')
           WHERE id = ? AND qty - (SELECT COALESCE(SUM(qty), 0) FROM product_locations WHERE product_id = ?) + ? >= 0
           RETURNING qty`).bind(change, id, id, change).first();
        if (!updated) {
          throw new HttpError(409, before.locations.length
            ? `Only ${before.unassigned} without a place. Choose the place it's taken from.`
            : `Not enough stock: only ${before.qty} available`);
        }
      }
      await db.prepare(
        "INSERT INTO movements (product_id, change, qty_after, reason, note, by_user, location) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, change, updated.qty, clean(body.reason), sentenceCase(body.note), by, place && place.name).run();
      const product = await getProduct(db, id);
      const oldQty = updated.qty - change;
      const msg = telegramReady(env) && lowStockMessage(product, oldQty, change, clean(body.reason), by, url.origin);
      // Sent in the background so the stock update returns straight away.
      if (msg) waitUntil(sendTelegram(env, msg).catch((e) => console.error("Low-stock alert failed:", e.message)));
      return json(product);
    }
    if (method === "POST" && id !== null && sub === "move") {
      const body = await readBody(request);
      const tp = await getProduct(db, id);
      if (tp.track_pieces) {
        const to = await getLocation(db, int(body.to_location_id));
        const rows = (await inStockPieces(db, id, body.pieces))
          .filter((r) => (r.location_id || null) !== (to ? to.id : null)); // skip pieces already there
        if (!rows.length) return json({ ...tp, moved: 0 });
        await db.prepare(
          `UPDATE pieces SET location_id = ?, updated_at = datetime('now') WHERE id IN (${rows.map(() => "?").join(",")})`)
          .bind(to ? to.id : null, ...rows.map((r) => r.id)).run();
        await syncFromPieces(db, id);
        await db.prepare(
          `INSERT INTO movements (product_id, change, qty_after, reason, note, by_user, location, to_location, moved, pieces)
           VALUES (?, 0, ?, 'Moved', ?, ?, ?, ?, ?, ?)`)
          .bind(id, tp.qty, sentenceCase(body.note), by, placeNames(rows), to ? to.name : "Place not set", rows.length,
            rows.map((r) => r.serial).join(",")).run();
        return json({ ...(await getProduct(db, id)), moved: rows.length });
      }
      const n = int(body.qty);
      if (!n || n < 1) throw new HttpError(400, "Quantity must be 1 or more");
      const p = await getProduct(db, id);
      const from = await getLocation(db, int(body.from_location_id));
      const to = await getLocation(db, int(body.to_location_id));
      if ((from && from.id) === (to && to.id)) throw new HttpError(400, "Choose a different place to move to");
      if (from) {
        if (!(await takeFromPlace(db, id, from.id, n))) {
          const have = (p.locations.find((l) => l.id === from.id) || { qty: 0 }).qty;
          throw new HttpError(409, `Only ${have} at ${from.name}`);
        }
      } else if (p.unassigned < n) {
        throw new HttpError(409, `Only ${p.unassigned} without a place`);
      }
      if (to) await addToPlace(db, id, to.id, n).run();
      await db.prepare(
        `INSERT INTO movements (product_id, change, qty_after, reason, note, by_user, location, to_location, moved)
         VALUES (?, 0, ?, 'Moved', ?, ?, ?, ?, ?)`)
        .bind(id, p.qty, sentenceCase(body.note), by, from ? from.name : "Place not set", to ? to.name : "Place not set", n).run();
      return json(await getProduct(db, id));
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
        const p = await getProduct(db, id);
        if (body.vec) {
          await db.prepare("INSERT OR REPLACE INTO photo_vectors (product_id, photo_v, vec) VALUES (?, ?, ?)")
            .bind(id, p.photo_v, parseVec(body.vec)).run();
        } else {
          await db.prepare("DELETE FROM photo_vectors WHERE product_id = ?").bind(id).run();
        }
        return json(await getProduct(db, id));
      }
      if (method === "DELETE") {
        await db.batch([
          db.prepare("DELETE FROM product_photos WHERE product_id = ?").bind(id),
          db.prepare("DELETE FROM photo_vectors WHERE product_id = ?").bind(id),
        ]);
        return json(await getProduct(db, id));
      }
    }
    if (method === "PUT" && id !== null && sub === "track") {
      const on = !!(await readBody(request)).on;
      const p = await getProduct(db, id);
      if (on && !p.track_pieces) {
        // Give every piece in stock its own serial, keeping the places they're in now.
        for (const l of p.locations) await newPieces(db, p, l.qty, l.id);
        await newPieces(db, p, p.unassigned, null);
        await db.prepare("UPDATE products SET track_pieces = 1 WHERE id = ?").bind(id).run();
        await syncFromPieces(db, id);
      } else if (!on && p.track_pieces) {
        await db.batch([
          db.prepare("UPDATE pieces SET status = 'untracked', updated_at = datetime('now') WHERE product_id = ? AND status = 'in'").bind(id),
          db.prepare("UPDATE products SET track_pieces = 0 WHERE id = ?").bind(id),
        ]);
      }
      return json(await getProduct(db, id));
    }
    if (method === "GET" && id !== null && sub === "pieces") {
      const { results } = await db.prepare(
        `SELECT pc.serial, pc.status, pc.out_reason, pc.location_id, l.name AS location, pc.created_at, pc.updated_at
         FROM pieces pc LEFT JOIN locations l ON l.id = pc.location_id
         WHERE pc.product_id = ? AND pc.status IN ('in', 'out') ORDER BY pc.status, pc.id LIMIT 2000`).bind(id).all();
      return json(results);
    }
    if (method === "PUT" && id !== null && sub === "photo-vec") {
      const body = await readBody(request);
      const vec = parseVec(body.vec);
      // Only store it if it was made from the photo that's there now.
      const r = await db.prepare(
        `INSERT OR REPLACE INTO photo_vectors (product_id, photo_v, vec)
         SELECT product_id, updated_at, ? FROM product_photos WHERE product_id = ? AND updated_at = ?
         RETURNING product_id`).bind(vec, id, String(body.v || "")).first();
      if (!r) throw new HttpError(409, "The photo changed. Reload and try again.");
      return json({ ok: true });
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
    await ensureSchema(env.DB);
    const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
    let user = null;
    if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
      // Sign-in handled by Cloudflare Access (see README).
      const email = await verifyAccess(request, env);
      user = { email, name: displayName(email, env) };
    } else {
      // Built-in staff accounts with 6-digit PINs.
      user = await sessionUser(env.DB, request);
      if (parts[0] === "auth") return await authRoute(request, env, parts[1], user, parts[2]);
      if (!user) {
        const setup = (await userCount(env.DB)) === 0;
        throw new HttpError(401, setup ? "First-time setup needed" : "Please sign in", { auth: setup ? "setup" : "login" });
      }
    }
    return await route(request, env, parts, user, waitUntil);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
    if (String(err && err.message).includes("UNIQUE")) return json({ error: "That already exists" }, 409);
    console.error(err);
    return json({ error: "Server error: " + (err && err.message) }, 500);
  }
}
