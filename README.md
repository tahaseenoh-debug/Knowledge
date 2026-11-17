# 💎 Jewellery Inventory

A simple stock app for jewellery that runs in the browser on phone or computer. It is hosted **free** on Cloudflare Pages, and the data is kept in Cloudflare D1, a free database, so everyone sees the same stock.

## What it does

- **Categories**: you create each one once (Rings, Earrings, Bangles…) and it stays saved. You can add one straight from the "Add item" form, or rename and delete them under **Categories**.
- **Auto product codes**: every item gets a code built from its category, e.g. `RIN-0001` or `EAR-0003`. You don't need your own coding system yet.
- **Stock in / out**: the − and + buttons on each item. Each change records the quantity, a reason (Sale, Purchase, Repair, Return…) and an optional note (customer, invoice no.). Stock can't go below zero.
- **History**: every movement is logged per item, and **Activity** shows recent changes across all items.
- **Photos**: take a picture with the phone camera or pick one from the gallery. It's shrunk automatically to about 100–250 KB and saved in the same free database, so there's nothing extra to set up. Tap a thumbnail to see it full size.
- **Jewellery details**: metal, purity (22K / 18K / 925…), colour (shown with a small colour dot), weight in grams, stone, size, cost and selling price, supplier, notes.
- **Low-stock alerts**: each item has its own threshold, with a "Low stock only" filter.
- **Search and filter** by name, code, metal or stone, and by category.
- **Totals**: number of pieces, total weight, and stock value at selling price.
- **Export CSV** opens in Excel or Google Sheets, so you can keep backups.
- **Staff logins** (Cloudflare Access): each person signs in with their own email, and every stock change shows who did it, e.g. "−1 Sale · by Ayesha". Activity can be filtered by staff member. Only owners can delete items or categories.
- Or a simpler **shared password**, if you don't want separate logins.

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

   (Skip this step if you set up staff logins below.)

## Staff logins (recommended, free for up to 50 people)

Cloudflare Access sits in front of your site. Staff type their email, receive a one-time code, and they're in. You don't manage any passwords.

1. **Turn on Zero Trust**
   Cloudflare dashboard → **Zero Trust**. The first time, choose a *team name* (e.g. `myshop`, which gives you `myshop.cloudflareaccess.com`) and pick the **Free** plan. It may ask for a card, but the Free plan costs $0.

2. **Protect the site**
   Zero Trust → **Access → Applications → Add an application → Self-hosted**.
   - Application name: `Jewellery Inventory`
   - Session duration: how long people stay signed in, e.g. **1 week**
   - Domain: `jewellery-inventory.pages.dev` (your Pages address)
     Add a second domain `*.jewellery-inventory.pages.dev` too, so the preview links are protected as well.

3. **Choose who can sign in**
   Add a policy → Action **Allow** → Include → **Emails** → type each staff member's email, including your own.
   Login method: **One-time PIN** (it's on by default).

4. **Copy the Audience (AUD) tag**
   Open the application you just made → **Overview / Basic information** → copy **Application Audience (AUD) Tag**.

5. **Tell the app about it**
   Pages project → **Settings → Variables and Secrets** → add these as **Secrets**:

   | Name | Value |
   |---|---|
   | `ACCESS_TEAM_DOMAIN` | `myshop.cloudflareaccess.com` (your team name) |
   | `ACCESS_AUD` | the AUD tag from step 4 |
   | `OWNER_EMAILS` | your email (comma-separate if there's more than one owner) |
   | `STAFF_NAMES` | *(optional)* nicer names, e.g. `ayesha.k@gmail.com=Ayesha, ali123@gmail.com=Ali` |

   Then **redeploy** (Deployments → ⋯ → Retry deployment). You can delete `APP_PASSWORD` now.

**Adding or removing staff later:** edit the email list in the Access policy (step 3). It takes effect straight away, with no redeploy.

**What staff can and can't do:** everyone can add and edit items and do stock in/out. Only the emails in `OWNER_EMAILS` can delete items, and rename or delete categories. If `OWNER_EMAILS` is empty, everyone can.

Without a staff name in `STAFF_NAMES`, the name is taken from the email (`ayesha.khan@…` → "Ayesha Khan").

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
