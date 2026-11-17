-- Jewellery inventory schema (Cloudflare D1 / SQLite).
-- The API also creates these tables automatically on first use,
-- so running this file by hand is optional.

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  prefix     TEXT NOT NULL UNIQUE,
  next_num   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  metal       TEXT,
  purity      TEXT,
  colour      TEXT,
  weight_g    REAL,
  stone       TEXT,
  size        TEXT,
  cost_price  REAL,
  sell_price  REAL,
  supplier    TEXT,
  low_stock   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_by  TEXT,
  qty         INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change     INTEGER NOT NULL,
  qty_after  INTEGER NOT NULL,
  reason     TEXT,
  note       TEXT,
  by_user    TEXT,              -- staff member who made the change
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_photos (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,          -- base64 image, resized in the browser
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id, created_at);

-- Emergency reports (photo taken on the spot by staff)
CREATE TABLE IF NOT EXISTS incidents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,          -- Theft / robbery, Damaged piece, ...
  note          TEXT,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  by_user       TEXT,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | resolved
  resolved_by   TEXT,
  resolved_note TEXT,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incident_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_acks (       -- who tapped "I've seen it"
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  by_user     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (incident_id, by_user)
);

CREATE INDEX IF NOT EXISTS idx_incident_photos ON incident_photos(incident_id);

-- Photo fingerprints for "search by photo" (made in the browser by the image model)
CREATE TABLE IF NOT EXISTS photo_vectors (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  photo_v    TEXT NOT NULL,   -- which version of the photo this was made from
  vec        TEXT NOT NULL    -- 1280 signed bytes, base64
);
