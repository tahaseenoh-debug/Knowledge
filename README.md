# 💎 Jewellery Inventory

A simple stock app for jewellery that runs in the browser on phone or computer. It is hosted **free** on Cloudflare Pages, and the data is kept in Cloudflare D1, a free database, so everyone sees the same stock.

## What it does

- **Categories**: you create each one once (Rings, Earrings, Bangles…) and it stays saved. You can add one straight from the "Add item" form, or rename and delete them under **Categories**.
- **Auto product codes**: every item gets a code built from its category, e.g. `RIN-0001` or `EAR-0003`. You don't need your own coding system yet.
- **Stock in / out**: the − and + buttons on each item. Each change records the quantity, a reason (Sale, Purchase, Repair, Return…) and an optional note (customer, invoice no.). Stock can't go below zero.
- **History**: every movement is logged per item, and **Activity** shows recent changes across all items.
- **Photos**: take a picture with the phone camera or pick one from the gallery. It's shrunk automatically to about 100–250 KB and saved in the same free database, so there's nothing extra to set up. Tap a thumbnail to see it full size.
- **Jewellery details**: metal, purity (22K / 18K / 925…), weight in grams, stone, size, cost and selling price, supplier, notes.
- **Low-stock alerts**: each item has its own threshold, with a "Low stock only" filter.
- **Search and filter** by name, code, metal or stone, and by category.
- **Totals**: number of pieces, total weight, and stock value at selling price.
- **Export CSV** opens in Excel or Google Sheets, so you can keep backups.
- **Optional password**, so only your staff can use it.

## Deploy to Cloudflare (free, about 10 minutes)

1. **Create the database**
   Cloudflare dashboard → **Storage & Databases → D1** → **Create** → name it `jewellery-inventory`.
   Copy its **Database ID**.

2. **Put the ID in this repo**
   Open `wrangler.toml`, replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID, and commit.
   (The tables are created automatically on first use. `schema.sql` is there for reference.)

3. **Create the Pages site**
   Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose this repository and branch.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `public`

   Deploy. You'll get a URL like `https://jewellery-inventory.pages.dev`.

4. **Set a password (recommended)**
   Pages project → **Settings → Variables and Secrets** → add a **Secret** named `APP_PASSWORD` with your password → redeploy.
   Each phone or computer asks for it once and remembers it.

> For stronger security (separate logins per person), use **Cloudflare Zero Trust → Access**, which is free for up to 50 users, instead of or as well as the password.

### Free-tier limits (more than enough for a shop)
Pages: unlimited static requests. Functions: 100,000 requests/day. D1: 5 GB storage, 5 million reads per day.

## Run locally

```bash
npx wrangler pages dev
# open http://localhost:8788
```

## Files

```
public/            the web app (HTML, CSS, JS, no build step)
functions/api/     the API (Cloudflare Pages Function)
schema.sql         database tables (created automatically)
wrangler.toml      Cloudflare config (put your D1 ID here)
```
