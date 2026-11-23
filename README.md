# 💎 Jewellery Inventory

A simple stock app for jewellery that runs in the browser on phone or computer. It is hosted **free** on Cloudflare Pages, and the data is kept in Cloudflare D1, a free database, so everyone sees the same stock.

## Use it as an app on your phone

The site installs like a normal app. It gets an icon on the home screen, opens full screen without the browser bar, and has a bottom bar: **Stock · Scan · ＋ Add · Places · More**.

- **iPhone:** open the link in **Safari** → tap **Share ⬆️** → **Add to Home Screen** → **Add**.
- **Android:** open the link in **Chrome** → **☰ More → 📲 Install as an app** (or Chrome's **⋮** menu → **Install app**).

It's the same app and the same data as on the computer, and updates arrive automatically. Stock is never stored on the phone; it always comes live from the server.

## Staff accounts (username + 6-digit PIN)

Everyone signs in with **their own username and a 6-digit PIN**.

- **First time after this update:** open the app and create the **admin account**. It asks for the **shop password** (the `APP_PASSWORD` secret set in Cloudflare), so only the owner can do this. The app then shows your PIN and asks you to choose your own.
- **Adding staff:** ☰ More → **👥 Staff accounts** → enter name, username and access level → **Create account**. A random 6-digit PIN is shown once: copy or share it with the person. When they first sign in, they're asked to choose their own 6-digit PIN.
- **Access levels:**
  - **Admin**: everything, including deleting items, categories, places and reports, managing accounts and Telegram settings.
  - **Staff**: add and edit items, stock in/out, moves, photos, emergency reports, but **no deleting**.
- **Forgot PIN / account locked:** after 5 wrong PINs an account is locked for 15 minutes. An admin can tap **🔑 New PIN** to give a fresh PIN (this also unlocks it).
- **Someone leaves:** tap **Switch off**. They're signed out at once and can't sign in; their name stays in the history.
- **Change my PIN:** ☰ More → **🔑 Change my PIN** (exactly 6 digits; easy ones like 111111 or 123456 aren't allowed).
- **The PIN is asked every time the app is opened** (the username is remembered), and again if the app was in the background for more than 5 minutes. On the server, a sign-in also ends after 30 minutes without activity.
- **Face ID / fingerprint:** after signing in with the PIN, the app offers to unlock with Face ID (iPhone) or fingerprint / face unlock (Android) next time. It can also be turned on or off in ☰ More. It's per person and per phone, and the PIN always keeps working. The face or fingerprint never leaves the phone: the phone holds a passkey and the server only checks its signature. When an admin gives someone a **New PIN**, their Face ID / fingerprint sign-in is switched off too (e.g. for a lost phone).
- PINs are stored only in scrambled (hashed) form.

## What it does

- **Categories**: you create each one once (Rings, Earrings, Bangles…) and it stays saved. You can add one straight from the "Add item" form, or rename and delete them under **Categories**.
- **Auto product codes**: every item gets a code built from its category, e.g. `RIN-0001` or `EAR-0003`. You don't need your own coding system yet.
- **Stock in / out**: the − and + buttons on each item. Each change records the quantity, a reason (Sale, Purchase, Repair, Return…) and an optional note (customer, invoice no.). Stock can't go below zero.
- **History**: every movement is logged per item, and **Activity** shows recent changes across all items.
- **Photos**: take a picture with the phone camera or pick one from the gallery. It's shrunk automatically to about 100–250 KB and saved in the same free database, so there's nothing extra to set up. Tap a thumbnail to see it full size.
- **Jewellery details**: metal, purity (22K / 18K / 925…), colour (shown with a small colour dot), weight in grams, stone, size, cost and selling price, supplier, notes.
- **Duplicate**: on an item (or in **Edit → ⧉ Duplicate**), it copies *everything*, including colour, notes and photo, into a new item. Change only what's different (size, weight, price…) and save. It gets its own new code; stock starts at 0 unless you enter opening stock.
- **Same design in different colours**: add each colour as its own item (own code, stock, photo and low-stock alert), keeping the **same name** and putting the colour in **Colour**.
  - **+ Colour** on an item (or **➕ Add another colour** in Edit) copies everything, so you just enter the new colour, stock and photo. It warns you if that colour already exists.
  - Items with the same name in the same category show **"Also in: ● Rose gold ×2 · ● White gold ×0"**. Tap one to see all versions of the design together.
  - This works for sizes too: versions without a colour are shown by size.
- **📍 Places (locations)**: keep track of where pieces are (showroom cases, trays, safe, workshop, craftsman, branch…).
  - Places are saved once and reused, like categories.
  - Stock is counted **per place**: each item shows e.g. "📍 Case 1 ×3 · Safe ×2".
  - **Move** pieces between places; every move is recorded in History with who did it.
  - Stock in asks where it's going, and stock out asks where it's taken from.
  - **Filter the list by place**, or open a place to see everything that should be there, with − / + / ⇄ buttons.
  - Stock from before places existed shows as **"Place not set"** until you move it somewhere.
- **📷 QR labels and scanning, no scanner machine needed**:
  - **☰ More → Print QR labels**: big labels for places (stick on trays, drawers, the safe) and small tags for items. Print on sticker paper, or plain paper and tape.
  - **📷 Scan** uses the phone camera: scan a place label to see what should be there, or an item tag to see where its pieces are.
  - The labels also work with the phone's **normal camera app**, which opens the app straight on that place or item.
  - No label? Type the item code in the scan window instead.
- **🏷 Track each piece separately** (optional, per item, for bigger or valuable pieces):
  - Tick it in the item's **Edit** form. Every piece then gets its own number and QR tag (e.g. `NEC-0001-03`), keeping the place it's in now.
  - **Piece moved?** Scan its tag, tap **"Moved? Scan the new place"**, then scan the label of where it is now. That's two scans, recorded with who did it.
  - **Loading a tray or the safe:** open the place, tap **📷 Scan pieces in**, and scan each piece's tag as you put it there.
  - **Selling:** tick exactly which piece was sold, so you always know which pieces are left and where.
  - Each piece has its own history: every move and sale.
  - Tiny items can stay as they are (counted per tray, no tag on the piece).
- **Low-stock notifications**:
  - a 🔔 bell with a red count of items that are low or sold out; tap it to see the list and restock with one tap
  - a warning pop-up the moment a sale makes an item low ("⚠️ RIN-0001 is now low: only 1 left")
  - a reminder when you open the app if anything is low
  - **Telegram messages to your phone** (optional, free), even when the app is closed
  - each item has its own alert level, and there's a "Low stock only" filter
- **Search and filter** by name, code, metal, colour or stone, and by category.
- **📷 Search by photo**: when staff can't find a piece by name, they take a picture of it and the app shows the closest-looking saved items, best match first, with buttons to show the item or do stock in/out straight from the results. If it isn't there, **Add as new item** opens the form with that photo already filled in.
  - It works by comparing photos with a small image-recognition model that runs **inside the phone's browser** (bundled in `public/vendor/`). It's free, has no setup or API keys, and photos don't leave your site.
  - The first time someone uses it, the phone downloads about 15 MB (once, then it's kept). After that a search takes well under a second.
  - It can only find items **that have a photo**. Photos you add are learned automatically.
  - Best results: fill the frame with the piece, use a plain background, and take item photos the same way.
- **Totals**: number of pieces, total weight, and stock value at selling price.
- **Export CSV** opens in Excel or Google Sheets, so you can keep backups.
- **🚨 Emergency reports**: a red button that's always on screen. Staff tap it, take a photo on the spot (or several), choose what happened (theft, suspicious person, damaged or missing piece, customer dispute, fire/medical/safety…), add a note and send.
  - Everyone who has the app open gets a **full-screen red pop-up** within about 20 seconds, with the photo, a beep and a vibration. It stays until they tap "I've seen it".
  - People who open the app later still get the pop-up for any report that's still open.
  - The photo is also sent to **Telegram** (if set up), so the owner sees it even with the app closed.
  - All reports are saved with photos, who sent them, who has seen them, and when and how each was resolved.
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

The app checks for new emergency reports every 20 seconds while it's open on screen (it pauses when the phone is locked or the tab is in the background). That's about 180 requests per hour per open device, so even 5 devices open for 12 hours a day use only about 11,000 of the 100,000 daily requests.

## Low-stock notifications on your phone (Telegram, free, about 5 minutes)

When a sale makes an item reach its alert level, or sell out, a message like this is sent:

```
⚠️ Low stock: RIN-0001 Gold heart ring
Rings · Gold 22K · Rose gold
2 left (alert at 2)
Last change: -1 Sale by Ayesha
```

You get one message when the item reaches its alert level and one when it sells out, not one for every sale, so you won't be spammed.

1. **Create a bot**: in Telegram, search for **@BotFather** → send `/newbot` → pick a name (e.g. "My Shop Stock") and a username ending in `bot`. BotFather replies with a **token** like `123456789:AAH...`.
2. **Give the token to the app**: Pages project → **Settings → Variables and Secrets** → add a **Secret** `TELEGRAM_BOT_TOKEN` = the token → redeploy.
3. **Say hi to your bot**: open your new bot in Telegram and press **Start**.
   *To alert your staff as well:* create a Telegram group, add the bot to it, and send `/start` in the group.
4. **Find the chat ID**: in the app (signed in as owner) tap 🔔 → **Find chat ID**. Copy the number shown (a group's number starts with `-`).
5. **Save it**: add a **Secret** `TELEGRAM_CHAT_ID` = that number. For several chats, separate them with commas, e.g. `5551234,-100777`. Then redeploy.
6. **Test it**: 🔔 → **Send test message**. You should get a ✅ message in Telegram.

Keep the bot token private: anyone who has it can send messages as your bot.

## Run locally

```bash
npx wrangler pages dev
# open http://localhost:8788
```

## Files

```
public/            the web app (HTML, CSS, JS, no build step)
public/vendor/     TensorFlow.js + image model for search by photo (see its README)
functions/api/     the API (Cloudflare Pages Function)
schema.sql         database tables (created automatically)
wrangler.toml      Cloudflare config (put your D1 ID here)
```
