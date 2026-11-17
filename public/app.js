"use strict";

// ---------- state ----------
const state = {
  categories: [],
  products: [],
  activeCat: null, // category id or null for All
  search: "",
  lowOnly: false,
  editing: null,   // product being edited
  stockItem: null, // product in stock dialog
  me: { owner: true },
  report: { photos: [] }, // emergency report being written
  alarmQueue: [],         // incoming reports waiting to be shown
  openIncidents: 0,
  photo: null,     // pending photo in the item form: {dataUrl} to upload, "remove", or null for no change
};

const REASONS = {
  in: ["Purchase", "New stock made", "Customer return", "Back from repair", "Correction"],
  out: ["Sale", "Sent for repair", "Damaged / lost", "Given on approval", "Correction"],
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n, d = 2) => (n == null ? "" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z"); // D1 stores UTC
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

// ---------- API ----------
function getPassword() { try { return localStorage.getItem("inv-pw") || ""; } catch { return ""; } }
function setPasswordCookie(p) {
  // Lets <img> tags load photos when a password is set (they can't send headers).
  document.cookie = `inv_pw=${encodeURIComponent(p)}; path=/; max-age=31536000; SameSite=Strict` +
    (location.protocol === "https:" ? "; Secure" : "");
}
function setPassword(p) { try { localStorage.setItem("inv-pw", p); } catch {} setPasswordCookie(p); }
if (getPassword()) setPasswordCookie(getPassword());
const photoUrl = (p) => `/api/products/${p.id}/photo?v=${encodeURIComponent(p.photo_v)}`;

function signedOut() {
  const b = $("#banner");
  b.innerHTML = 'You\'ve been signed out. <button type="button">Sign in again</button>';
  b.querySelector("button").onclick = () => location.reload();
  b.hidden = false;
  return new Error("You've been signed out, so this wasn't saved. Reload the page to sign in again.");
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch("/api/" + path, {
      method: opts.method || "GET",
      headers: { "content-type": "application/json", "x-app-password": getPassword() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: "manual",
    });
  } catch {
    throw new Error("Couldn't reach the server. Check the internet connection.");
  }
  // An expired Cloudflare Access login answers with a redirect to the sign-in page.
  if (res.type === "opaqueredirect") throw signedOut();
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && data && data.auth === "access") throw signedOut();
  if (res.status === 401) { await askPassword(); return api(path, opts); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

let passwordPrompt = null; // shared, so parallel requests wait for the same prompt
function askPassword() {
  if (!passwordPrompt) passwordPrompt = showPasswordPrompt().finally(() => { passwordPrompt = null; });
  return passwordPrompt;
}

function showPasswordPrompt() {
  const dlg = $("#dlg-login"), form = $("#form-login"), err = $("#login-error");
  return new Promise((resolve) => {
    if (getPassword()) { err.textContent = "That password didn't work."; err.hidden = false; }
    form.onsubmit = async (e) => {
      e.preventDefault();
      setPassword(form.password.value);
      const ok = await fetch("/api/ping", { headers: { "x-app-password": getPassword() } }).then((r) => r.ok).catch(() => false);
      if (!ok) { err.textContent = "Wrong password."; err.hidden = false; return; }
      err.hidden = true; form.reset(); dlg.close(); resolve();
    };
    dlg.addEventListener("cancel", (e) => e.preventDefault()); // can't dismiss
    dlg.showModal();
  });
}

function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), ms);
}

function showError(el, err) { el.textContent = err.message || String(err); el.hidden = false; }

// ---------- loading ----------
async function loadCategories() {
  state.categories = await api("categories");
  renderChips();
  renderCategorySelect();
  renderCatList();
}

async function loadProducts() {
  state.products = await api("products");
  renderSuppliers();
  renderChips();
  render();
}

async function refresh() {
  await Promise.all([loadCategories(), loadProducts()]);
}

// ---------- rendering ----------
function visibleProducts() {
  const q = state.search.toLowerCase();
  return state.products.filter((p) => {
    if (state.activeCat && p.category_id !== state.activeCat) return false;
    if (state.lowOnly && p.qty > p.low_stock) return false;
    if (q) {
      const hay = [p.code, p.name, p.category, p.metal, p.purity, p.colour, p.stone, p.size, p.supplier, p.notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const lowItems = () => state.products.filter((p) => p.qty <= p.low_stock)
  .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));

function updateBell() {
  const n = lowItems().length, badge = $("#bell-n");
  badge.textContent = n > 99 ? "99+" : n;
  badge.hidden = n === 0;
  $("#btn-alerts").title = n ? `${n} item(s) low on stock` : "No low-stock items";
}

function render() {
  updateBell();
  renderStats();
  const list = $("#list"), empty = $("#empty");
  const items = visibleProducts();
  list.innerHTML = items.map(itemHtml).join("");
  empty.hidden = items.length > 0;
  if (!state.products.length) {
    empty.innerHTML = state.categories.length
      ? "No items yet. Tap <b>+ Add item</b> to add your first piece."
      : "Welcome! Start by tapping <b>+ Add item</b>. You can create categories (Rings, Necklaces…) right from there.";
  } else {
    empty.textContent = "No items match.";
  }
}

function itemHtml(p) {
  const meta = [
    p.category,
    [p.metal, p.purity].filter(Boolean).join(" "),
    p.colour ? "COLOUR:" + p.colour : "",
    p.weight_g != null ? fmtNum(p.weight_g, 3) + " g" : "",
    p.stone, p.size ? "Size " + p.size : "",
    p.sell_price != null ? "Price " + fmtNum(p.sell_price) : "",
  ].filter(Boolean).map((x) => x.startsWith("COLOUR:") ? colourHtml(x.slice(7)) : esc(x)).join(" · ");
  const cls = p.qty === 0 ? "zero" : p.qty <= p.low_stock ? "low" : "";
  const badge = p.qty === 0 ? '<span class="badge out">Out of stock</span>' : p.qty <= p.low_stock ? '<span class="badge">Low stock</span>' : "";
  const thumb = p.photo_v
    ? `<button class="thumb" data-act="photo" aria-label="View photo"><img src="${photoUrl(p)}" alt="" loading="lazy"></button>`
    : `<div class="thumb" aria-hidden="true">💍</div>`;
  return `<article class="item ${cls}" data-id="${p.id}">
    ${thumb}
    <div>
      <div class="head"><span class="code">${esc(p.code)}</span><span class="name">${esc(p.name)}</span>${badge}</div>
      <div class="meta">${meta}</div>
      <div class="links">
        <button class="linkbtn" data-act="edit">Edit</button>
        <button class="linkbtn" data-act="history">History</button>
      </div>
    </div>
    <div class="qty">
      <button class="minus" data-act="out" aria-label="Stock out" ${p.qty === 0 ? "disabled" : ""}>−</button>
      <div class="n">${p.qty}<small>in stock</small></div>
      <button class="plus" data-act="in" aria-label="Stock in">+</button>
    </div>
  </article>`;
}

// A small colour dot next to the colour name, when the colour is recognised.
const COLOUR_HINTS = { "yellow gold": "#d4a72c", "rose gold": "#c98b7a", "white gold": "#e6e6e6", gold: "#d4a72c",
  silver: "#c0c0c0", "pearl white": "#f4efe6", "two-tone": "linear-gradient(90deg,#d4a72c 50%,#c0c0c0 50%)",
  multicolour: "conic-gradient(red,orange,yellow,green,blue,purple,red)" };
function colourHtml(c) {
  const key = c.trim().toLowerCase();
  let bg = COLOUR_HINTS[key];
  if (!bg && CSS.supports("color", key.replace(/\s+/g, ""))) bg = key.replace(/\s+/g, "");
  return (bg ? `<span class="swatch" style="background:${esc(bg)}"></span>` : "") + esc(c);
}

function renderStats() {
  const ps = state.products;
  const pieces = ps.reduce((s, p) => s + p.qty, 0);
  const low = ps.filter((p) => p.qty <= p.low_stock).length;
  const weight = ps.reduce((s, p) => s + (p.weight_g || 0) * p.qty, 0);
  const value = ps.reduce((s, p) => s + (p.sell_price || 0) * p.qty, 0);
  $("#stats").innerHTML = [
    ["Items", ps.length],
    ["Pieces in stock", pieces],
    ["Low / out of stock", low, low ? "warn" : ""],
    ["Total weight (g)", fmtNum(weight, 2)],
    ["Stock value (selling)", fmtNum(value, 0)],
  ].map(([k, v, c]) => `<div class="stat ${c || ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
}

function renderChips() {
  const total = state.products.length;
  const chips = [{ id: null, name: "All", items: total }, ...state.categories];
  $("#chips").innerHTML = chips.map((c) =>
    `<button class="chip" data-cat="${c.id ?? ""}" aria-pressed="${state.activeCat === c.id}">${esc(c.name)}<span class="n">${c.items}</span></button>`
  ).join("");
}

function renderCategorySelect(selectedId) {
  const sel = $("#item-category");
  const keep = selectedId ?? sel.value;
  sel.innerHTML = `<option value="">Choose…</option>` +
    state.categories.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.prefix)})</option>`).join("");
  if (keep) sel.value = String(keep);
}

function renderCatList() {
  $("#cat-list").innerHTML = state.categories.map((c) => `
    <li data-id="${c.id}">
      <span class="pfx">${esc(c.prefix)}</span>
      <span class="nm">${esc(c.name)}</span>
      <span class="ct">${c.items} items · ${c.pieces} pcs</span>
      ${state.me.owner ? `<button class="ghost" data-act="rename">Rename</button>
      <button class="ghost danger" data-act="delete" ${c.items ? "disabled title='Has items'" : ""}>Delete</button>` : ""}
    </li>`).join("") || `<li class="muted">No categories yet.</li>`;
}

function renderSuppliers() {
  const names = [...new Set(state.products.map((p) => p.supplier).filter(Boolean))].sort();
  $("#suppliers").innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join("");
}

// ---------- add / edit item ----------
function openItem(product = null) {
  state.editing = product;
  const form = $("#form-item");
  form.reset();
  $("#item-error").hidden = true;
  $("#item-title").textContent = product ? "Edit item" : "Add item";
  $("#item-code").hidden = !product;
  $("#item-code").textContent = product ? "Code: " + product.code : "";
  $("#btn-delete-item").hidden = !product || !state.me.owner;
  $("#opening-wrap").hidden = !!product;
  renderCategorySelect(product ? product.category_id : state.activeCat || "");
  state.photo = null;
  $("#photo-input").value = "";
  showPhotoPreview(product && product.photo_v ? photoUrl(product) : null);
  if (product) {
    for (const el of form.elements) {
      if (el.name && el.name in product && el.name !== "qty") el.value = product[el.name] ?? "";
    }
  }
  $("#dlg-item").showModal();
  if (!product) form.name.focus();
}

async function newCategoryInline() {
  const name = prompt("New category name (e.g. Rings, Bangles, Earrings):");
  if (!name || !name.trim()) return;
  try {
    const cat = await api("categories", { method: "POST", body: { name } });
    await loadCategories();
    renderCategorySelect(cat.id);
    toast(`Category "${cat.name}" saved`);
  } catch (err) { showError($("#item-error"), err); }
}

async function saveItem(e) {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  body._isNew = !state.editing;
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    let p;
    if (state.editing) {
      p = await api("products/" + state.editing.id, { method: "PUT", body });
    } else {
      p = await api("products", { method: "POST", body });
      state.editing = p; // if the photo upload fails, a retry updates instead of adding a duplicate
    }
    if (state.photo === "remove") {
      await api(`products/${p.id}/photo`, { method: "DELETE" });
    } else if (state.photo) {
      await api(`products/${p.id}/photo`, { method: "PUT", body: { data: state.photo.dataUrl } });
    }
    state.photo = null;
    toast(body._isNew ? `Added ${p.code}` : `Saved ${p.code}`);
    $("#dlg-item").close();
    await refresh();
  } catch (err) { showError($("#item-error"), err); }
  finally { btn.disabled = false; }
}

async function deleteItem() {
  const p = state.editing;
  if (!p || !confirm(`Delete ${p.code} "${p.name}" and all its history? This can't be undone.`)) return;
  try {
    await api("products/" + p.id, { method: "DELETE" });
    $("#dlg-item").close();
    toast("Deleted");
    await refresh();
  } catch (err) { showError($("#item-error"), err); }
}

// ---------- photos ----------
function showPhotoPreview(src) {
  $("#photo-preview").innerHTML = src ? `<img src="${esc(src)}" alt="">` : "<span>No photo</span>";
  $("#btn-remove-photo").hidden = !src;
  $("#photo-label").textContent = src ? "Change photo" : "Add photo";
}

// Shrink to at most 1000px on the long side and re-encode as JPEG, so phone photos
// (often 3-8 MB) become roughly 100-250 KB.
async function resizeImage(file, maxSide = 1000, quality = 0.82) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't read that image. Try a JPEG or PNG."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height, scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function pickPhoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  $("#item-error").hidden = true;
  try {
    const dataUrl = await resizeImage(file);
    state.photo = { dataUrl };
    showPhotoPreview(dataUrl);
  } catch (err) { showError($("#item-error"), err); }
}

function removePhoto() {
  state.photo = "remove";
  $("#photo-input").value = "";
  showPhotoPreview(null);
}

function openImage(src, caption) {
  $("#photo-big").src = src;
  $("#photo-big").alt = caption;
  $("#photo-caption").textContent = caption;
  $("#dlg-photo").showModal();
}
const openPhoto = (p) => openImage(photoUrl(p), `${p.code} · ${p.name}`);

// ---------- stock in / out ----------
function setStockDir(dir) {
  const form = $("#form-stock");
  form.dir.value = dir;
  $("#stock-reason").innerHTML = REASONS[dir].map((r) => `<option>${r}</option>`).join("");
}

function openStock(product, dir) {
  state.stockItem = product;
  const form = $("#form-stock");
  form.reset();
  $("#stock-error").hidden = true;
  $("#stock-title").textContent = product.name;
  $("#stock-sub").textContent = `${product.code} · currently ${product.qty} in stock`;
  setStockDir(dir);
  $("#dlg-stock").showModal();
  form.amount.select();
}

async function saveStock(e) {
  e.preventDefault();
  const form = e.target;
  const amount = parseInt(form.amount.value, 10);
  const err = $("#stock-error");
  if (!(amount > 0)) return showError(err, new Error("Enter a quantity of 1 or more"));
  const dir = form.dir.value;
  const change = dir === "out" ? -amount : amount;
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const p = await api(`products/${state.stockItem.id}/stock`, {
      method: "POST", body: { change, reason: form.reason.value, note: form.note.value },
    });
    $("#dlg-stock").close();
    const old = p.qty - change;
    if (change < 0 && p.qty === 0) toast(`🔴 ${p.code} ${p.name} is now OUT OF STOCK`, 5000);
    else if (change < 0 && p.qty <= p.low_stock && old > p.low_stock) toast(`⚠️ ${p.code} ${p.name} is now low: only ${p.qty} left`, 5000);
    else toast(`${p.code}: ${change > 0 ? "+" : ""}${change} → ${p.qty} in stock`);
    await refresh();
  } catch (e2) { showError(err, e2); }
  finally { btn.disabled = false; }
}

// ---------- history ----------
function movementHtml(m, withItem) {
  const dir = m.change > 0 ? "in" : "out";
  const title = withItem ? `<b>${esc(m.code)}</b> ${esc(m.name)}` : esc(m.reason || (dir === "in" ? "Stock in" : "Stock out"));
  const sub = [m.by_user ? `<span class="by">by ${esc(m.by_user)}</span>` : "",
    ...[withItem ? m.reason : null, m.note, `Balance ${m.qty_after}`].filter(Boolean).map(esc)].filter(Boolean).join(" · ");
  return `<div class="mv"><span class="chg ${dir}">${m.change > 0 ? "+" : ""}${m.change}</span>
    <span class="what">${title}<small>${sub}</small></span><span class="when">${fmtDate(m.created_at)}</span></div>`;
}

async function openHistory(product, user = "") {
  $("#history-title").textContent = product ? `${product.code} · ${product.name}` : "Recent activity";
  $("#history-list").innerHTML = '<p class="muted">Loading…</p>';
  if (!$("#dlg-history").open) $("#dlg-history").showModal();
  $("#history-filter").hidden = true;
  try {
    let rows;
    if (product) {
      rows = await api(`products/${product.id}/movements`);
    } else {
      const res = await api("movements?limit=200" + (user ? "&user=" + encodeURIComponent(user) : ""));
      rows = res.movements;
      if (res.staff.length) {
        $("#history-user").innerHTML = '<option value="">Everyone</option>' +
          res.staff.map((n) => `<option ${n === user ? "selected" : ""}>${esc(n)}</option>`).join("");
        $("#history-filter").hidden = false;
      }
    }
    $("#history-list").innerHTML = rows.map((m) => movementHtml(m, !product)).join("") || '<p class="muted">No stock movements yet.</p>';
  } catch (err) { $("#history-list").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

// ---------- low stock alerts ----------
function openAlerts() {
  const items = lowItems();
  $("#alerts-list").innerHTML = items.map((p) => `
    <div class="alert-row ${p.qty === 0 ? "zero" : ""}" data-id="${p.id}">
      <span class="nm"><b>${esc(p.code)}</b> ${esc(p.name)}<small>${esc(p.category)}${p.colour ? " · " + esc(p.colour) : ""}</small></span>
      <span class="q">${p.qty === 0 ? "Out" : p.qty + " left"}<small>alert at ${p.low_stock}</small></span>
      <button type="button" data-act="restock" aria-label="Add stock">+</button>
    </div>`).join("") || '<p class="ok-msg">All good. Nothing is low on stock. 🎉</p>';
  renderNotifyBox();
  $("#dlg-alerts").showModal();
}

function renderNotifyBox() {
  const me = state.me, box = $("#notify-box");
  box.hidden = !me.owner;
  $("#notify-result").innerHTML = "";
  $("#btn-find-chat").hidden = !me.telegram_token;
  $("#btn-test-notify").hidden = !me.telegram;
  $("#notify-status").innerHTML = me.telegram
    ? "✅ On. A Telegram message is sent when an item drops to its alert level or sells out."
    : me.telegram_token
      ? "Almost done: send any message to your bot in Telegram, tap <b>Find chat ID</b>, then save it as <code>TELEGRAM_CHAT_ID</code> in Cloudflare."
      : "Off. To get alerts on your phone even when the app is closed, follow <b>Low-stock notifications</b> in the README (about 5 minutes).";
}

async function testNotify() {
  const out = $("#notify-result");
  try {
    await api("notify/test", { method: "POST", body: {} });
    out.innerHTML = '<p class="ok-msg">Sent! Check Telegram.</p>';
  } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

async function findChats() {
  const out = $("#notify-result");
  out.innerHTML = '<p class="muted">Checking…</p>';
  try {
    const chats = await api("notify/chats");
    out.innerHTML = chats.length
      ? '<p class="muted">Copy the number for the chat you want and save it as <code>TELEGRAM_CHAT_ID</code> (comma-separate several):</p>' +
        chats.map((c) => `<div class="chat-opt"><span>${esc(c.name || "Chat")} <small class="muted">(${esc(c.type)})</small></span><code>${esc(c.id)}</code></div>`).join("")
      : '<p class="error">No chats found. Open your bot in Telegram, press Start or send it "hi", then try again. For a group, add the bot to the group and send a message there.</p>';
  } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

function remindLowOnce() {
  try { if (sessionStorage.getItem("low-reminded")) return; sessionStorage.setItem("low-reminded", "1"); } catch {}
  const n = lowItems().length;
  if (n) toast(`⚠️ ${n} item${n > 1 ? "s are" : " is"} low on stock. Tap 🔔 to see.`, 4500);
}

// ---------- emergency reports ----------
const INCIDENT_TYPES = ["Theft / robbery", "Suspicious person", "Damaged piece", "Missing piece",
  "Customer dispute", "Fire / medical / safety", "Other"];
const incPhotoUrl = (id) => `/api/incident-photos/${id}`;

function getSeen() { try { return Number(localStorage.getItem("inc-seen")) || 0; } catch { return 0; } }
function setSeen(id) { try { if (id > getSeen()) localStorage.setItem("inc-seen", String(id)); } catch {} }

function timeAgo(s) {
  const mins = Math.round((Date.now() - new Date(s.replace(" ", "T") + "Z")) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return fmtDate(s);
}

function updateSosBadge(n) {
  state.openIncidents = n;
  const b = $("#sos-n");
  b.textContent = n;
  b.hidden = !n;
  $("#btn-all-reports").textContent = n ? `View all reports (${n} open)` : "View all reports";
}

function openReport() {
  const form = $("#form-report");
  form.reset();
  state.report = { photos: [] };
  renderReportPhotos();
  $("#report-error").hidden = true;
  $("#report-types").innerHTML = '<legend>What happened? *</legend>' + INCIDENT_TYPES.map((t) =>
    `<label><input type="radio" name="type" value="${esc(t)}" required><span>${esc(t)}</span></label>`).join("");
  $("#report-product").innerHTML = '<option value="">None</option>' + [...state.products]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  $("#dlg-report").showModal();
}

function renderReportPhotos() {
  $("#report-photos").innerHTML = state.report.photos.map((src, i) =>
    `<div class="rp"><img src="${src}" alt="Photo ${i + 1}"><button type="button" data-i="${i}" aria-label="Remove photo">✕</button></div>`).join("");
}

async function addReportPhotos(e) {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  const err = $("#report-error");
  err.hidden = true;
  for (const f of files) {
    if (state.report.photos.length >= 4) { showError(err, new Error("Up to 4 photos per report")); break; }
    try { state.report.photos.push(await resizeImage(f)); } catch (e2) { showError(err, e2); }
  }
  renderReportPhotos();
}

async function sendReport(e) {
  e.preventDefault();
  const form = e.target, err = $("#report-error"), btn = form.querySelector("[type=submit]");
  err.hidden = true;
  if (!state.report.photos.length && !form.note.value.trim()) {
    return showError(err, new Error("Take a photo or write a few words about what happened"));
  }
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const inc = await api("incidents", { method: "POST", body: {
      type: form.type.value, note: form.note.value, product_id: form.product_id.value, photos: state.report.photos,
    } });
    setSeen(inc.id); // don't pop up our own report on this device
    $("#dlg-report").close();
    toast("🚨 Alert sent. Everyone using the app will see it.", 4000);
    pollIncidents();
  } catch (e2) {
    showError(err, new Error(e2.message + ". Your report is still here; tap Send alert to try again."));
  } finally {
    btn.disabled = false;
    btn.textContent = "Send alert";
  }
}

// Check for new reports every 20 seconds while the app is on screen.
let polling = false;
async function pollIncidents() {
  if (polling) return;
  polling = true;
  try {
    const seen = getSeen();
    const res = await api(`incidents?status=open${seen ? "&after=" + seen : ""}`);
    updateSosBadge(res.open_count);
    const recentCutoff = Date.now() - 12 * 3600 * 1000;
    const fresh = res.incidents
      .filter((i) => !(state.me.signed_in && i.by_user === state.me.name))
      .filter((i) => seen || new Date(i.created_at.replace(" ", "T") + "Z") > recentCutoff) // first visit: last 12 h only
      .filter((i) => !state.alarmQueue.some((q) => q.id === i.id));
    if (fresh.length) {
      state.alarmQueue.push(...fresh.reverse()); // oldest first
      if (!$("#dlg-alarm").open) showNextAlarm(true);
      else renderAlarm();
    }
    if (!seen && res.max_open_id && !fresh.length) setSeen(res.max_open_id);
  } catch (err) {
    if (/signed out/i.test(err.message)) clearInterval(pollTimer);
  } finally { polling = false; }
}
let pollTimer = null;
function startPolling() {
  pollIncidents();
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") pollIncidents(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollIncidents(); });
}

function alarmSound() {
  try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

function renderAlarm() {
  const inc = state.alarmQueue[0];
  if (!inc) return;
  const photos = inc.photo_ids.map((id) =>
    `<button type="button" data-src="${incPhotoUrl(id)}"><img src="${incPhotoUrl(id)}" alt="Report photo"></button>`).join("");
  const more = state.alarmQueue.length - 1;
  $("#alarm-body").innerHTML = `
    <p class="alarm-type">${esc(inc.type)}</p>
    <p class="alarm-meta">${inc.by_user ? "Reported by <b>" + esc(inc.by_user) + "</b> · " : ""}${esc(timeAgo(inc.created_at))}
      ${inc.product_code ? " · Item " + esc(inc.product_code) + " " + esc(inc.product_name) : ""}</p>
    ${inc.note ? `<p class="alarm-note">${esc(inc.note)}</p>` : ""}
    ${photos ? `<div class="alarm-photos ${inc.photo_ids.length === 1 ? "one" : ""}">${photos}</div>` : ""}
    ${more > 0 ? `<p class="alarm-more">+ ${more} more report${more > 1 ? "s" : ""} waiting</p>` : ""}`;
}

function showNextAlarm(sound) {
  if (!state.alarmQueue.length) { $("#dlg-alarm").open && $("#dlg-alarm").close(); return; }
  renderAlarm();
  // Shown on top of anything else that's open, so nobody loses a half-filled form.
  if (!$("#dlg-alarm").open) $("#dlg-alarm").showModal();
  if (sound) alarmSound();
}

async function ackAlarm() {
  const inc = state.alarmQueue.shift();
  if (inc) {
    setSeen(inc.id);
    api(`incidents/${inc.id}/ack`, { method: "POST", body: {} }).catch(() => {});
  }
  showNextAlarm(false);
}

function reportHtml(inc) {
  const thumbs = inc.photo_ids.map((id) =>
    `<button type="button" data-src="${incPhotoUrl(id)}"><img src="${incPhotoUrl(id)}" alt="" loading="lazy"></button>`).join("");
  const resolved = inc.status === "resolved";
  return `<article class="report ${resolved ? "resolved" : ""}" data-id="${inc.id}">
    <div class="top"><span class="ty">${esc(inc.type)}</span><span class="st">${resolved ? "Resolved" : "OPEN"}</span></div>
    <div class="meta">${inc.by_user ? "By " + esc(inc.by_user) + " · " : ""}${esc(fmtDate(inc.created_at))}
      ${inc.product_code ? " · " + esc(inc.product_code) + " " + esc(inc.product_name) : ""}</div>
    ${inc.note ? `<div>${esc(inc.note)}</div>` : ""}
    ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ""}
    <div class="meta">${inc.acks.length ? "👀 Seen by " + inc.acks.map(esc).join(", ") : "Not seen by anyone yet"}</div>
    ${resolved ? `<div class="meta">✅ Resolved${inc.resolved_by ? " by " + esc(inc.resolved_by) : ""} · ${esc(fmtDate(inc.resolved_at))}${inc.resolved_note ? " · " + esc(inc.resolved_note) : ""}</div>` : ""}
    <div class="acts">
      ${resolved ? "" : '<button type="button" class="ghost" data-act="resolve">✓ Mark resolved</button>'}
      ${state.me.owner ? '<button type="button" class="ghost danger" data-act="delete">Delete</button>' : ""}
    </div>
  </article>`;
}

async function openReports() {
  document.querySelectorAll("dialog[open]").forEach((d) => d.id !== "dlg-reports" && d.close());
  if (!$("#dlg-reports").open) $("#dlg-reports").showModal();
  const list = $("#reports-list");
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const openOnly = $("#reports-open-only").checked;
    const res = await api(`incidents?status=${openOnly ? "open" : "all"}`);
    updateSosBadge(res.open_count);
    list.innerHTML = res.incidents.map(reportHtml).join("") ||
      `<p class="ok-msg">${openOnly ? "No open emergencies. 👍" : "No reports yet."}</p>`;
  } catch (err) { list.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

async function reportAction(e) {
  const img = e.target.closest("[data-src]");
  if (img) return openImage(img.dataset.src, "Emergency report photo");
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".report").dataset.id;
  try {
    if (btn.dataset.act === "resolve") {
      const note = prompt("What was done? (optional)", "");
      if (note === null) return;
      await api(`incidents/${id}/resolve`, { method: "POST", body: { note } });
    } else if (btn.dataset.act === "delete") {
      if (!confirm("Delete this report and its photos?")) return;
      await api(`incidents/${id}`, { method: "DELETE" });
    }
    openReports();
  } catch (err) { toast(err.message, 4000); }
}

async function loadMe() {
  try { state.me = await api("me"); } catch (err) { if (err.message.includes("signed out")) throw err; return; }
  const box = $("#me");
  if (state.me.signed_in) {
    box.innerHTML = `<span>👤 <b>${esc(state.me.name)}</b></span>` +
      (state.me.owner ? '<span class="role">Owner</span>' : '<span class="role">Staff</span>') +
      '<a href="/cdn-cgi/access/logout">Sign out</a>';
    box.title = state.me.email;
    box.hidden = false;
  }
}

// ---------- categories dialog ----------
async function addCategory(e) {
  e.preventDefault();
  const form = e.target, err = $("#cat-error");
  err.hidden = true;
  try {
    const before = state.categories.length;
    const cat = await api("categories", { method: "POST", body: { name: form.name.value } });
    form.reset();
    await loadCategories();
    toast(state.categories.length > before ? `Saved "${cat.name}" (${cat.prefix})` : `"${cat.name}" already exists`);
  } catch (e2) { showError(err, e2); }
}

async function catAction(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = Number(btn.closest("li").dataset.id);
  const cat = state.categories.find((c) => c.id === id);
  const err = $("#cat-error");
  err.hidden = true;
  try {
    if (btn.dataset.act === "rename") {
      const name = prompt("Rename category:", cat.name);
      if (!name || name.trim() === cat.name) return;
      await api("categories/" + id, { method: "PUT", body: { name } });
    } else if (btn.dataset.act === "delete") {
      if (!confirm(`Delete category "${cat.name}"?`)) return;
      await api("categories/" + id, { method: "DELETE" });
      if (state.activeCat === id) state.activeCat = null;
    }
    await refresh();
  } catch (e2) { showError(err, e2); }
}

// ---------- CSV export ----------
function exportCsv() {
  const cols = ["code", "name", "category", "metal", "purity", "colour", "weight_g", "stone", "size", "cost_price", "sell_price", "supplier", "qty", "low_stock", "notes", "created_by", "created_at", "updated_at"];
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(","), ...state.products.map((p) => cols.map((c) => cell(p[c])).join(","))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `jewellery-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wiring ----------
function wire() {
  $("#btn-add").onclick = () => openItem();
  $("#btn-categories").onclick = () => { $("#cat-error").hidden = true; $("#dlg-cats").showModal(); };
  $("#btn-activity").onclick = () => openHistory(null);
  $("#btn-export").onclick = exportCsv;
  $("#btn-new-cat").onclick = newCategoryInline;
  $("#btn-delete-item").onclick = deleteItem;
  $("#photo-input").onchange = pickPhoto;
  $("#btn-alerts").onclick = openAlerts;
  $("#btn-sos").onclick = openReport;
  $("#report-camera").onchange = addReportPhotos;
  $("#report-gallery").onchange = addReportPhotos;
  $("#report-photos").onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) { state.report.photos.splice(Number(b.dataset.i), 1); renderReportPhotos(); }
  };
  $("#form-report").onsubmit = sendReport;
  $("#btn-all-reports").onclick = openReports;
  $("#btn-new-report").onclick = () => { $("#dlg-reports").close(); openReport(); };
  $("#reports-open-only").onchange = openReports;
  $("#reports-list").onclick = reportAction;
  $("#btn-alarm-ack").onclick = ackAlarm;
  $("#btn-alarm-list").onclick = () => { for (const i of state.alarmQueue) setSeen(i.id); state.alarmQueue = []; openReports(); };
  $("#dlg-alarm").addEventListener("cancel", (e) => e.preventDefault()); // must be acknowledged
  $("#alarm-body").onclick = (e) => {
    const b = e.target.closest("[data-src]");
    if (b) openImage(b.dataset.src, "Emergency report photo");
  };
  $("#btn-test-notify").onclick = testNotify;
  $("#btn-find-chat").onclick = findChats;
  $("#alerts-list").onclick = (e) => {
    const b = e.target.closest("[data-act=restock]");
    if (!b) return;
    const p = state.products.find((x) => x.id === Number(b.closest(".alert-row").dataset.id));
    $("#dlg-alerts").close();
    openStock(p, "in");
  };
  $("#history-user").onchange = (e) => openHistory(null, e.target.value);
  $("#btn-remove-photo").onclick = removePhoto;
  $("#form-item").onsubmit = saveItem;
  $("#form-stock").onsubmit = saveStock;
  $("#form-cat").onsubmit = addCategory;
  $("#cat-list").onclick = catAction;

  $("#form-stock").addEventListener("change", (e) => { if (e.target.name === "dir") setStockDir(e.target.value); });
  $("#form-stock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const input = $("#form-stock").amount;
    input.value = Math.max(1, (parseInt(input.value, 10) || 0) + Number(b.dataset.step));
  });

  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

  $("#search").addEventListener("input", (e) => { state.search = e.target.value.trim(); render(); });
  $("#low-only").addEventListener("change", (e) => { state.lowOnly = e.target.checked; render(); });

  $("#chips").onclick = (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.activeCat = chip.dataset.cat ? Number(chip.dataset.cat) : null;
    renderChips();
    render();
  };

  $("#list").onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.closest(".item").dataset.id);
    const p = state.products.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "edit") openItem(p);
    else if (act === "history") openHistory(p);
    else if (act === "photo") openPhoto(p);
    else openStock(p, act);
  };
}

wire();
loadMe().then(refresh).then(() => { remindLowOnce(); startPolling(); }).catch((err) => {
  const empty = $("#empty");
  empty.hidden = false;
  empty.innerHTML = `<span class="error">${esc(err.message)}</span>`;
});
