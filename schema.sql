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
  weight_g    REAL,
  stone       TEXT,
  size        TEXT,
  cost_price  REAL,
  sell_price  REAL,
  supplier    TEXT,
  low_stock   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
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
