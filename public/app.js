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
  locations: [],          // places
  unassignedPieces: 0,
  placeFilter: "",        // "" = all, "none" = place not set, or a place id
  move: null,             // {product} for the move dialog
  openPlaceId: null,      // place shown in the place dialog (id or "none")
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

async function loadLocations() {
  const res = await api("locations");
  state.locations = res.locations;
  state.unassignedPieces = res.unassigned_pieces;
  renderPlaceFilter();
  renderPlaceList();
}

async function refresh() {
  await Promise.all([loadCategories(), loadLocations(), loadProducts()]);
  render(); // places line needs both lists
  if ($("#dlg-place").open) renderPlace();
}

// ---------- rendering ----------
function visibleProducts() {
  const q = state.search.toLowerCase();
  return state.products.filter((p) => {
    if (state.activeCat && p.category_id !== state.activeCat) return false;
    if (state.lowOnly && p.qty > p.low_stock) return false;
    if (state.placeFilter === "none" && !p.unassigned) return false;
    if (state.placeFilter && state.placeFilter !== "none" &&
        !(p.locations || []).some((l) => l.id === Number(state.placeFilter))) return false;
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

// ---------- versions of the same design (colours, sizes) ----------
// Items with the same name in the same category are treated as one design.
const designKey = (p) => p.category_id + "|" + p.name.trim().toLowerCase().replace(/\s+/g, " ");
function designGroups() {
  const groups = new Map();
  for (const p of state.products) {
    const k = designKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return groups;
}
// What tells this version apart from its siblings: colour, else size, else code.
const versionLabel = (v) => v.colour || (v.size ? "Size " + v.size : v.code);

function variantsHtml(p, groups) {
  const others = (groups.get(designKey(p)) || []).filter((v) => v.id !== p.id)
    .sort((a, b) => versionLabel(a).localeCompare(versionLabel(b)));
  if (!others.length) return "";
  return `<div class="variants">Also in:${others.map((v) => `
    <button type="button" data-act="variant" data-vid="${v.id}" class="${v.qty === 0 ? "zero" : ""}"
      title="${esc(v.code)}">${v.colour ? colourHtml(v.colour) : esc(versionLabel(v))} ×<b>${v.qty}</b></button>`).join("")}</div>`;
}

function render() {
  updateBell();
  renderStats();
  const list = $("#list"), empty = $("#empty");
  const items = visibleProducts();
  const groups = designGroups();
  list.innerHTML = items.map((p) => itemHtml(p, groups)).join("");
  empty.hidden = items.length > 0;
  if (!state.products.length) {
    empty.innerHTML = state.categories.length
      ? "No items yet. Tap <b>+ Add item</b> to add your first piece."
      : "Welcome! Start by tapping <b>+ Add item</b>. You can create categories (Rings, Necklaces…) right from there.";
  } else {
    empty.textContent = "No items match.";
  }
}

function itemHtml(p, groups = designGroups()) {
  const meta = [
    p.category,
    [p.metal, p.purity].filter(Boolean).join(" "),
    p.colour ? "COLOUR:" + p.colour : "",
    p.weight_g != null ? fmtNum(p.weight_g, 3) + " g" : "",
    p.stone, p.size ? "Size " + p.size : "",
    p.sell_price != null ? "Price " + fmtNum(p.sell_price) : "",
  ].filter(Boolean).map((x) => x.startsWith("COLOUR:") ? colourHtml(x.slice(7)) : esc(x)).join(" · ");
  const cls = p.qty === 0 ? "zero" : p.qty <= p.low_stock ? "low" : "";
  const badge = (p.qty === 0 ? '<span class="badge out">Out of stock</span>' : p.qty <= p.low_stock ? '<span class="badge">Low stock</span>' : "") +
    (p.track_pieces ? '<span class="badge track">🏷 Each piece tracked</span>' : "");
  const thumb = p.photo_v
    ? `<button class="thumb" data-act="photo" aria-label="View photo"><img src="${photoUrl(p)}" alt="" loading="lazy"></button>`
    : `<div class="thumb" aria-hidden="true">💍</div>`;
  return `<article class="item ${cls}" data-id="${p.id}">
    ${thumb}
    <div>
      <div class="head"><span class="code">${esc(p.code)}</span><span class="name">${esc(p.name)}</span>${badge}</div>
      <div class="meta">${meta}</div>
      ${placesHtml(p)}
      ${variantsHtml(p, groups)}
      <div class="links">
        <button class="linkbtn" data-act="edit">Edit</button>
        <button class="linkbtn" data-act="history">History</button>
        ${p.qty > 0 && state.locations.length ? '<button class="linkbtn" data-act="move">Move</button>' : ""}
        <button class="linkbtn" data-act="colour">+ Colour</button>
        <button class="linkbtn" data-act="duplicate">Duplicate</button>
        ${p.track_pieces ? '<button class="linkbtn" data-act="pieces">Pieces</button>' : '<button class="linkbtn" data-act="label">QR tag</button>'}
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
  $("#item-copy-row").hidden = !product;
  state.copyMode = null;
  $("#item-code").classList.remove("copy-note");
  $("#form-item").colour.placeholder = "Yellow Gold, Rose Gold, Green…";
  $("#opening-wrap").hidden = !!product;
  $("#opening-place-wrap").hidden = !!product || !state.locations.length;
  $("#item-track").checked = !!(product && product.track_pieces);
  if (!product) fillPlaceSelect($("#item-place"), { mode: "in", selected: lastPlace() });
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

// Opens "Add item" pre-filled from an existing item.
//  mode "colour":    everything except colour, notes and photo; asks for the new colour
//  mode "duplicate": everything, including colour, notes and the photo; change what's different
function openCopy(src, mode) {
  if ($("#dlg-item").open) $("#dlg-item").close();
  openItem();
  state.copyMode = mode;
  const form = $("#form-item");
  const fields = ["name", "metal", "purity", "weight_g", "stone", "size", "cost_price", "sell_price", "supplier", "low_stock"];
  if (mode === "duplicate") fields.push("colour", "notes");
  for (const f of fields) form[f].value = src[f] ?? "";
  renderCategorySelect(src.category_id);
  $("#item-track").checked = !!src.track_pieces;
  $("#item-code").hidden = false;
  $("#item-code").classList.add("copy-note");
  if (mode === "duplicate") {
    $("#item-title").textContent = `Duplicate ${src.code}`;
    $("#item-code").textContent = `Copied from ${src.code} · ${src.name}. Change what's different, then Save. It gets its own new code.`;
    if (src.photo_v) copyPhoto(src);
    return;
  }
  openAnotherColourFinish(src, form);
}

// Copies the original's photo into the form (it can still be changed or removed).
async function copyPhoto(src) {
  try {
    const blob = await (await fetch(photoUrl(src))).blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    if (state.copyMode !== "duplicate" || !$("#dlg-item").open || state.photo) return; // form changed meanwhile
    state.photo = { dataUrl };
    showPhotoPreview(dataUrl);
  } catch {}
}

const openAnotherColour = (src) => openCopy(src, "colour");

function openAnotherColourFinish(src, form) {
  const taken = (designGroups().get(designKey(src)) || []).map((v) => v.colour).filter(Boolean);
  $("#item-title").textContent = `Add another colour of ${src.name}`;
  $("#item-code").hidden = false;
  $("#item-code").textContent = taken.length ? `Already have: ${taken.join(", ")}` : `Copied from ${src.code}`;
  form.colour.value = "";
  form.colour.placeholder = "New colour, e.g. Rose Gold";
  form.colour.focus();
}

// Show every version of a design in the list (and highlight the one tapped).
function showDesign(v) {
  state.activeCat = null;
  state.lowOnly = false;
  state.placeFilter = "";
  $("#low-only").checked = false;
  $("#place-filter").value = "";
  $("#search").value = v.name;
  state.search = v.name;
  renderChips();
  render();
  const el = document.querySelector(`.item[data-id="${v.id}"]`);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); }
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
  if (body._isNew && state.copyMode === "colour" && body.colour && body.colour.trim()) {
    const twin = state.products.find((v) => designKey(v) === designKey({ name: body.name, category_id: Number(body.category_id) }) &&
      (v.colour || "").trim().toLowerCase() === body.colour.trim().toLowerCase());
    if (twin && !confirm(`${twin.code} is already "${twin.name}" in ${twin.colour}. Add a second item anyway?\n\n(To add more pieces of it, use + on ${twin.code} instead.)`)) return;
  }
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
    const wantTrack = $("#item-track").checked;
    let newPieces = [];
    if (wantTrack !== !!p.track_pieces) {
      if (!wantTrack && !confirm(`Stop tracking ${p.code} piece by piece? The individual piece numbers won't be used any more (the counts stay).`)) {
        $("#item-track").checked = true;
      } else {
        const t = await api(`products/${p.id}/track`, { method: "PUT", body: { on: wantTrack } });
        if (wantTrack) newPieces = (await api(`products/${p.id}/pieces`)).filter((x) => x.status === "in").map((x) => x.serial);
        p = t;
      }
    }
    const photoChanged = !!state.photo;
    state.photo = null;
    toast(body._isNew ? `Added ${p.code}` : `Saved ${p.code}`);
    $("#dlg-item").close();
    await refresh();
    if (photoChanged) indexSoon();
    if (newPieces.length && confirm(`${p.code} now has ${newPieces.length} numbered piece(s): ${newPieces.slice(0, 6).join(", ")}${newPieces.length > 6 ? "…" : ""}\n\nPrint their QR tags now?`)) {
      printLabels("pieces", newPieces.map((serial) => ({ serial, p })));
    }
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
  const p = state.stockItem;
  $("#stock-place-wrap").hidden = !state.locations.length && !(p && p.locations.length);
  $("#stock-place-label").textContent = dir === "in" ? "Put it in" : "Taken from";
  const pref = state.stockPlace != null ? state.stockPlace : dir === "in" ? (biggestPlace(p) ?? lastPlace()) : biggestPlace(p);
  fillPlaceSelect($("#stock-place"), { mode: dir, product: p, selected: pref });
  renderStockPieces();
}

// For items tracked piece by piece, stock out means ticking exactly which pieces.
function renderStockPieces() {
  const p = state.stockItem, form = $("#form-stock");
  const picking = !!(p && p.track_pieces && form.dir.value === "out");
  $("#stock-qty-wrap").hidden = picking;
  $("#stock-pieces").hidden = !picking;
  if (!picking) { $("#stock-pieces").innerHTML = ""; return; }
  const place = $("#stock-place").value;
  const list = (state.stockPieces || []).filter((x) => x.status === "in" && String(x.location_id ?? "") === place);
  $("#stock-pieces").innerHTML = '<p class="hint">Tick the piece(s) taken out:</p>' + (list.map((x) => `
    <label class="pp"><input type="checkbox" value="${esc(x.serial)}" ${(state.stockPick || []).includes(x.serial) ? "checked" : ""}>
      <span class="sr">${esc(x.serial)}</span><span class="where">📍 ${esc(x.location || "Place not set")}</span></label>`).join("")
    || '<p class="hint">No pieces here.</p>');
}

const pickedSerials = (box) => [...box.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);

// placeId: the place the dialog was opened from (if any), so it's pre-selected.
// pick: piece serials to pre-tick (items tracked piece by piece).
async function openStock(product, dir, placeId = null, pick = []) {
  state.stockItem = product;
  state.stockPlace = placeId;
  state.stockPick = pick;
  state.stockPieces = [];
  if (product.track_pieces) {
    try { state.stockPieces = await api(`products/${product.id}/pieces`); } catch (err) { return toast(err.message, 4000); }
  }
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
  const err = $("#stock-error");
  const dir = form.dir.value;
  const tracked = state.stockItem.track_pieces && dir === "out";
  const pieces = tracked ? pickedSerials($("#stock-pieces")) : undefined;
  const amount = tracked ? pieces.length : parseInt(form.amount.value, 10);
  if (tracked && !amount) return showError(err, new Error("Tick the piece(s) taken out"));
  if (!(amount > 0)) return showError(err, new Error("Enter a quantity of 1 or more"));
  const change = dir === "out" ? -amount : amount;
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const p = await api(`products/${state.stockItem.id}/stock`, {
      method: "POST", body: { change, reason: form.reason.value, note: form.note.value, location_id: form.location_id.value, pieces },
    });
    if (dir === "in") rememberPlace(form.location_id.value);
    $("#dlg-stock").close();
    const old = p.qty - change;
    if (change < 0 && p.qty === 0) toast(`🔴 ${p.code} ${p.name} is now OUT OF STOCK`, 5000);
    else if (change < 0 && p.qty <= p.low_stock && old > p.low_stock) toast(`⚠️ ${p.code} ${p.name} is now low: only ${p.qty} left`, 5000);
    else toast(`${p.code}: ${change > 0 ? "+" : ""}${change} → ${p.qty} in stock`);
    await refresh();
    if (p.new_pieces && p.new_pieces.length &&
        confirm(`New pieces: ${p.new_pieces.join(", ")}\n\nPrint their QR tags now?`)) {
      printLabels("pieces", p.new_pieces.map((serial) => ({ serial, p })));
    }
  } catch (e2) { showError(err, e2); }
  finally { btn.disabled = false; }
}

// ---------- history ----------
function movementHtml(m, withItem) {
  const isMove = m.moved > 0;
  const dir = isMove ? "move" : m.change > 0 ? "in" : "out";
  const title = withItem ? `<b>${esc(m.code)}</b> ${esc(m.name)}` : esc(m.reason || (dir === "in" ? "Stock in" : "Stock out"));
  const where = isMove ? `📍 ${m.location} → ${m.to_location}` : m.location ? `📍 ${m.location}` : null;
  const sub = [m.by_user ? `<span class="by">by ${esc(m.by_user)}</span>` : "",
    ...[withItem ? m.reason : null, where, m.pieces ? "🏷 " + m.pieces.split(",").join(", ") : null, m.note,
      isMove ? null : `Balance ${m.qty_after}`].filter(Boolean).map(esc)].filter(Boolean).join(" · ");
  const badge = isMove ? `⇄${m.moved}` : `${m.change > 0 ? "+" : ""}${m.change}`;
  return `<div class="mv"><span class="chg ${dir}">${badge}</span>
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

// ---------- capital letters ----------
// Same rules as the server: names get a capital at the start of every word, purity is all capitals,
// notes start with a capital. Applied as soon as you leave a field, so you see it straight away.
const titleCase = (v) => v.replace(/(^|[\s(\/])(\p{Ll})/gu, (m, sep, ch) => sep + ch.toUpperCase());
const sentenceCase = (v) => v.replace(/^(\s*)(\p{Ll})/u, (m, sp, ch) => sp + ch.toUpperCase());
const CASE_FIELDS = {
  title: ["#form-item [name=name]", "#form-item [name=metal]", "#form-item [name=colour]", "#form-item [name=stone]",
    "#form-item [name=supplier]", "#form-place [name=name]", "#form-cat [name=name]"],
  upper: ["#form-item [name=purity]"],
  sentence: ["#form-item [name=notes]", "#form-stock [name=note]", "#form-move [name=note]", "#form-report [name=note]"],
};
function setupCapitals() {
  const keyboard = { title: "words", upper: "characters", sentence: "sentences" };
  const fix = { title: titleCase, upper: (v) => v.toUpperCase(), sentence: sentenceCase };
  for (const [kind, sels] of Object.entries(CASE_FIELDS)) {
    for (const el of document.querySelectorAll(sels.join(","))) {
      el.setAttribute("autocapitalize", keyboard[kind]); // phone keyboards start with capitals
      el.addEventListener("change", () => { el.value = fix[kind](el.value); });
    }
  }
}

// ---------- phone app: bottom bar, install ----------
// "Stock" tab: clear filters and go back to the top of the list.
function goHome() {
  state.search = ""; state.activeCat = null; state.lowOnly = false; state.placeFilter = "";
  $("#search").value = ""; $("#low-only").checked = false; $("#place-filter").value = "";
  renderChips();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;

function updateInstallItem() {
  $("#menu-install").hidden = isInstalled() || !(installPrompt || isIOS() || /android/i.test(navigator.userAgent));
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    updateInstallItem();
    if (choice && choice.outcome === "accepted") toast("📲 Installed! Open it from your home screen.", 4000);
    return;
  }
  $("#install-steps").innerHTML = isIOS()
    ? `<ol><li>Open this page in <b>Safari</b> (not Chrome or another app).</li>
        <li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom of the screen.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. The 💎 <b>Jewellery</b> app appears on your home screen.</li></ol>`
    : `<ol><li>Open this page in <b>Chrome</b>.</li>
        <li>Tap the <b>⋮</b> menu at the top right.</li>
        <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li>
        <li>Tap <b>Install</b>. The 💎 <b>Jewellery</b> app appears on your home screen.</li></ol>`;
  $("#dlg-install").showModal();
}

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; updateInstallItem(); });
window.addEventListener("appinstalled", () => { installPrompt = null; updateInstallItem(); });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// On a phone that hasn't installed it yet, mention it once.
function suggestInstallOnce() {
  if (isInstalled() || innerWidth > 700) return;
  try { if (localStorage.getItem("install-hint")) return; localStorage.setItem("install-hint", "1"); } catch { return; }
  setTimeout(() => toast("📲 Tip: install this as an app. Tap ☰ More → Install.", 6000), 5000);
}

// ---------- places ----------
const placeName = (id) => id === "none" || id === "" || id == null
  ? "Place not set" : (state.locations.find((l) => l.id === Number(id)) || {}).name || "?";
function lastPlace() { try { return localStorage.getItem("last-place") || ""; } catch { return ""; } }
function rememberPlace(id) { try { localStorage.setItem("last-place", id || ""); } catch {} }
// The place that holds most of this item (or "" for place not set).
function biggestPlace(p) {
  if (!p) return null;
  const best = [...p.locations].sort((a, b) => b.qty - a.qty)[0];
  if (!best) return p.unassigned ? "" : null;
  return best.qty >= p.unassigned ? String(best.id) : "";
}

function placesHtml(p) {
  if (!state.locations.length && !p.locations.length) return "";
  const parts = p.locations.map((l) => `<span class="pl">${esc(l.name)} ×<b>${l.qty}</b></span>`);
  if (p.unassigned) parts.push(`<span class="pl unset">Place not set ×<b>${p.unassigned}</b></span>`);
  if (!parts.length) return "";
  return `<div class="places">📍 ${parts.join(" · ")}</div>`;
}

// Fills a place <select>.
//  mode "in":   every place + "Place not set" + "New place…"
//  mode "out":  only places holding this product, with counts
//  mode "to":   every place except `exclude`, + "Place not set" + "New place…"
function fillPlaceSelect(sel, { mode, product, selected, exclude }) {
  const opts = [];
  if (mode === "out") {
    for (const l of product.locations) opts.push([String(l.id), `${l.name} (${l.qty})`]);
    if (product.unassigned) opts.push(["", `Place not set (${product.unassigned})`]);
    if (!opts.length) opts.push(["", "Place not set"]);
  } else {
    for (const l of state.locations) if (String(l.id) !== String(exclude)) opts.push([String(l.id), l.name]);
    if (exclude !== "") opts.push(["", "Place not set"]);
    opts.push(["__new", "➕ New place…"]);
  }
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  const want = selected == null ? null : String(selected);
  if (want !== null && opts.some(([v]) => v === want)) sel.value = want;
  sel.dataset.prev = sel.value;
}

// Choosing "➕ New place…" in any place <select> creates the place and selects it.
async function onPlaceSelectChange(e) {
  const sel = e.target;
  if (sel.value !== "__new") { sel.dataset.prev = sel.value; return; }
  const name = prompt("New place name (e.g. Showroom Case 2, Safe, Workshop):");
  if (!name || !name.trim()) { sel.value = sel.dataset.prev || ""; return; }
  try {
    const loc = await api("locations", { method: "POST", body: { name } });
    await loadLocations();
    const mode = sel.id === "move-to" && !(state.move && state.move.product.track_pieces) ? "to" : "in";
    fillPlaceSelect(sel, { mode, product: state.move && state.move.product, selected: loc.id,
      exclude: mode === "to" ? $("#move-from").value : undefined });
    toast(`Place "${loc.name}" saved`);
  } catch (err) { toast(err.message, 4000); sel.value = sel.dataset.prev || ""; }
}

function renderPlaceFilter() {
  const sel = $("#place-filter");
  const opts = [["", "📍 All places"], ...state.locations.map((l) => [String(l.id), `${l.name} (${l.pieces})`])];
  if (state.locations.length && state.unassignedPieces) opts.push(["none", `Place not set (${state.unassignedPieces})`]);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  if (!opts.some(([v]) => v === state.placeFilter)) state.placeFilter = "";
  sel.value = state.placeFilter;
  sel.hidden = !state.locations.length;
}

function renderPlaceList() {
  const rows = state.locations.map((l) => `
    <li data-id="${l.id}">
      <button type="button" class="nm" data-act="open">${esc(l.name)}<small>${l.items} item${l.items === 1 ? "" : "s"} · ${l.pieces} piece${l.pieces === 1 ? "" : "s"}</small></button>
      <button type="button" class="ghost" data-act="open">Open</button>
      <button type="button" class="ghost" data-act="label">🖨 Label</button>
      ${state.me.owner ? `<button type="button" class="ghost" data-act="rename">Rename</button>
        <button type="button" class="ghost danger" data-act="delete" ${l.pieces ? "disabled title='Move the pieces out first'" : ""}>Delete</button>` : ""}
    </li>`);
  if (state.unassignedPieces > 0) {
    rows.push(`<li class="unset" data-id="none"><button type="button" class="nm" data-act="open">Place not set<small>${state.unassignedPieces} piece${state.unassignedPieces === 1 ? "" : "s"} without a place yet</small></button>
      <button type="button" class="ghost" data-act="open">Open</button></li>`);
  }
  $("#place-list").innerHTML = rows.join("") || '<li class="muted">No places yet. Add your first one above.</li>';
}

async function addPlace(e) {
  e.preventDefault();
  const form = e.target, err = $("#place-error");
  err.hidden = true;
  try {
    const loc = await api("locations", { method: "POST", body: { name: form.name.value } });
    form.reset();
    await refresh();
    toast(`Place "${loc.name}" saved`);
  } catch (e2) { showError(err, e2); }
}

async function placeListAction(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const li = btn.closest("li");
  const id = li.dataset.id === "none" ? "none" : Number(li.dataset.id);
  const loc = state.locations.find((l) => l.id === id);
  const err = $("#place-error");
  err.hidden = true;
  try {
    if (btn.dataset.act === "open") openPlace(id);
    else if (btn.dataset.act === "label") printLabels("places", [loc]);
    else if (btn.dataset.act === "rename") {
      const name = prompt("Rename place:", loc.name);
      if (!name || name.trim() === loc.name) return;
      await api("locations/" + id, { method: "PUT", body: { name } });
      await refresh();
    } else if (btn.dataset.act === "delete") {
      if (!confirm(`Delete the place "${loc.name}"?`)) return;
      await api("locations/" + id, { method: "DELETE" });
      if (String(state.placeFilter) === String(id)) state.placeFilter = "";
      await refresh();
    }
  } catch (e2) { showError(err, e2); }
}

// ----- one place: what's here -----
function openPlace(id) {
  state.openPlaceId = id;
  if (!$("#dlg-place").open) $("#dlg-place").showModal();
  renderPlace();
}

function renderPlace() {
  const id = state.openPlaceId;
  const none = id === "none";
  const loc = none ? null : state.locations.find((l) => l.id === Number(id));
  if (!none && !loc) { $("#dlg-place").close(); toast("That place doesn't exist any more", 4000); return; }
  const here = (p) => none ? p.unassigned : ((p.locations.find((l) => l.id === loc.id) || {}).qty || 0);
  const items = state.products.filter((p) => here(p) > 0).sort((a, b) => a.code.localeCompare(b.code));
  const pieces = items.reduce((n, p) => n + here(p), 0);
  $("#place-title").textContent = "📍 " + (none ? "Place not set" : loc.name);
  $("#place-sub").textContent = none
    ? `${pieces} piece${pieces === 1 ? "" : "s"} not in any place yet. Use ⇄ to put them where they really are.`
    : `${items.length} item${items.length === 1 ? "" : "s"} · ${pieces} piece${pieces === 1 ? "" : "s"} here. Check them against what you see.`;
  $("#place-items").innerHTML = items.map((p) => `
    <div class="pi-row" data-id="${p.id}">
      <div class="th">${p.photo_v ? `<img src="${photoUrl(p)}" alt="" loading="lazy">` : "💍"}</div>
      <div class="nm"><b>${esc(p.code)}</b> ${esc(p.name)}<small>${p.qty} in stock in total</small></div>
      <div class="btns">
        <button type="button" class="minus" data-act="out" aria-label="Stock out from here">−</button>
        <span class="here" title="Pieces here">${here(p)}</span>
        <button type="button" class="plus" data-act="in" aria-label="Stock in here">+</button>
        <button type="button" class="ghost" data-act="move" aria-label="Move from here">⇄</button>
      </div>
    </div>`).join("") || '<p class="muted">Nothing here yet.</p>';
  $("#put-here").hidden = none;
  $("#btn-place-label").hidden = none;
  if (!none) {
    $("#put-item").innerHTML = '<option value="">Put an item here…</option>' + [...state.products]
      .filter((p) => p.qty > here(p))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("");
  }
}

function placeItemAction(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const p = state.products.find((x) => x.id === Number(btn.closest(".pi-row").dataset.id));
  const placeVal = state.openPlaceId === "none" ? "" : String(state.openPlaceId);
  if (btn.dataset.act === "move") openMove(p, placeVal);
  else openStock(p, btn.dataset.act, placeVal);
}

function putHere() {
  const p = state.products.find((x) => x.id === Number($("#put-item").value));
  if (!p) return toast("Choose an item first");
  openMove(p, null, String(state.openPlaceId));
}

// ----- move -----
// pick: piece serials to pre-tick (items tracked piece by piece).
async function openMove(product, fromId = null, toId = null, pick = []) {
  state.move = { product, pieces: [] };
  if (product.track_pieces) {
    try { state.move.pieces = (await api(`products/${product.id}/pieces`)).filter((x) => x.status === "in"); }
    catch (err) { return toast(err.message, 4000); }
  }
  const tracked = !!product.track_pieces;
  $("#move-from-wrap").hidden = tracked;
  $("#move-qty-wrap").hidden = tracked;
  $("#move-pieces").hidden = !tracked;
  if (tracked) {
    // Pieces at the place it was opened from come first.
    const list = [...state.move.pieces].sort((a, b) =>
      (String(b.location_id ?? "") === String(fromId ?? "x")) - (String(a.location_id ?? "") === String(fromId ?? "x")) || a.serial.localeCompare(b.serial));
    $("#move-pieces").innerHTML = '<p class="hint">Tick the piece(s) to move:</p>' + list.map((x) => `
      <label class="pp"><input type="checkbox" value="${esc(x.serial)}" ${pick.includes(x.serial) ? "checked" : ""}>
        <span class="sr">${esc(x.serial)}</span><span class="where">📍 ${esc(x.location || "Place not set")}</span></label>`).join("");
  } else $("#move-pieces").innerHTML = "";
  const form = $("#form-move");
  form.reset();
  $("#move-error").hidden = true;
  $("#move-title").textContent = "⇄ Move " + product.name;
  $("#move-sub").textContent = `${product.code} · ${product.qty} in stock`;
  let from = fromId != null ? fromId : biggestPlace(product);
  if (toId != null && String(from) === String(toId)) {
    from = [...product.locations.map((l) => String(l.id)), ...(product.unassigned ? [""] : [])].find((v) => v !== String(toId)) ?? from;
  }
  fillPlaceSelect($("#move-from"), { mode: "out", product, selected: from });
  fillMoveTo(toId);
  if (tracked) fillPlaceSelect($("#move-to"), { mode: "in", selected: toId ?? "" });
  $("#dlg-move").showModal();
}

function fillMoveTo(selected) {
  if (state.move.product.track_pieces) return;
  const from = $("#move-from").value;
  fillPlaceSelect($("#move-to"), { mode: "to", product: state.move.product, exclude: from,
    selected: selected != null ? selected : $("#move-to").value });
  const p = state.move.product;
  const max = from === "" ? p.unassigned : ((p.locations.find((l) => String(l.id) === from) || {}).qty || 0);
  $("#form-move").qty.max = max;
  $("#form-move").qty.value = Math.min(Math.max(1, parseInt($("#form-move").qty.value, 10) || 1), max || 1);
}

async function saveMove(e) {
  e.preventDefault();
  const form = e.target, err = $("#move-error"), btn = form.querySelector("[type=submit]");
  err.hidden = true;
  if (form.to.value === "__new") return showError(err, new Error("Choose where to move it"));
  btn.disabled = true;
  try {
    if (state.move.product.track_pieces) {
      const pieces = pickedSerials($("#move-pieces"));
      if (!pieces.length) throw new Error("Tick the piece(s) to move");
      const p = await api(`products/${state.move.product.id}/move`, { method: "POST", body: {
        to_location_id: form.to.value, pieces, note: form.note.value } });
      $("#dlg-move").close();
      toast(p.moved ? `Moved ${pieces.join(", ")} → ${placeName(form.to.value)}` : "Already there", 3500);
      await refresh();
      return;
    }
    const p = await api(`products/${state.move.product.id}/move`, { method: "POST", body: {
      from_location_id: form.from.value, to_location_id: form.to.value, qty: form.qty.value, note: form.note.value,
    } });
    $("#dlg-move").close();
    toast(`Moved ${form.qty.value} × ${p.code}: ${placeName(form.from.value)} → ${placeName(form.to.value)}`, 3500);
    await refresh();
  } catch (e2) { showError(err, e2); }
  finally { btn.disabled = false; }
}

// ----- items tracked piece by piece -----
async function openPieces(p) {
  state.piecesOf = p;
  $("#pieces-title").textContent = `🏷 ${p.code} · ${p.name}`;
  $("#pieces-list").innerHTML = '<p class="hint">Loading…</p>';
  if (!$("#dlg-pieces").open) $("#dlg-pieces").showModal();
  try {
    const all = await api(`products/${p.id}/pieces`);
    const inStock = all.filter((x) => x.status === "in"), out = all.filter((x) => x.status === "out");
    $("#pieces-sub").textContent = `${inStock.length} piece${inStock.length === 1 ? "" : "s"} in stock. Tick pieces to move them or print their tags.`;
    $("#pieces-list").innerHTML = inStock.map((x) => `
      <label class="pp"><input type="checkbox" value="${esc(x.serial)}"><span class="sr">${esc(x.serial)}</span>
        <span class="where">📍 ${esc(x.location || "Place not set")}</span>
        <button type="button" class="ghost open" data-serial="${esc(x.serial)}">Open</button></label>`).join("")
      || '<p class="hint">No pieces in stock.</p>';
    $("#pieces-out-wrap").hidden = !out.length;
    $("#pieces-out-sum").textContent = `Sold / taken out (${out.length})`;
    $("#pieces-out").innerHTML = out.map((x) =>
      `<div>${esc(x.serial)} · ${esc(x.out_reason || "Out")} · ${esc(fmtDate(x.updated_at))}</div>`).join("");
  } catch (err) { $("#pieces-list").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

async function openPiece(serial) {
  let pc;
  try { pc = await api("pieces/" + encodeURIComponent(serial)); } catch (err) { return toast(err.message, 4000); }
  const p = state.products.find((x) => x.id === pc.product_id);
  if (!p) return toast("Item not found. Reload the page.", 4000);
  state.piece = { ...pc, p };
  $("#piece-photo").innerHTML = p.photo_v ? `<img src="${photoUrl(p)}" alt="">` : "💍";
  $("#piece-serial").textContent = pc.serial;
  $("#piece-name").textContent = `${p.name} · ${p.category}`;
  const inStock = pc.status === "in";
  $("#piece-status").textContent = inStock ? `In stock · ${p.qty} piece${p.qty === 1 ? "" : "s"} of this design` : "";
  const where = $("#piece-where");
  where.className = "piece-where" + (inStock ? "" : " out");
  where.textContent = inStock ? `📍 ${pc.location || "Place not set"}`
    : pc.status === "out" ? `Taken out: ${pc.out_reason || "out of stock"} (${fmtDate(pc.updated_at)})` : "No longer tracked";
  $("#piece-actions").hidden = !inStock;
  if (inStock) fillPlaceSelect($("#piece-to"), { mode: "to", exclude: pc.location_id ?? "", selected: null });
  $("#piece-history").innerHTML = pc.history.map((m) => movementHtml(m, false)).join("") || '<p class="muted">No history yet.</p>';
  if (!$("#dlg-piece").open) $("#dlg-piece").showModal();
}

async function movePiece(serial, productId, toId) {
  const p = await api(`products/${productId}/move`, { method: "POST", body: { to_location_id: toId, pieces: [serial] } });
  toast(p.moved ? `🏷 ${serial} → 📍 ${placeName(toId)}` : `${serial} is already at ${placeName(toId)}`, 3500);
  await refresh();
  return p.moved;
}

// ----- QR codes -----
const itemLink = (p) => `${location.origin}/#item=${encodeURIComponent(p.code)}`;
const placeLink = (l) => `${location.origin}/#place=${l.id}`;
const pieceLink = (serial) => `${location.origin}/#piece=${encodeURIComponent(serial)}`;

let qrLibPromise = null;
const loadQrLib = () => qrLibPromise || (qrLibPromise = loadScript("/vendor/qrcode.js").catch((e) => { qrLibPromise = null; throw e; }));

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// kind "places": list of places; "items": list of products; "pieces": list of {serial, p}
async function printLabels(kind, list) {
  if (!list.length) return toast("Nothing to print", 3000);
  try { await loadQrLib(); } catch (err) { return toast(err.message, 4000); }
  const html = list.map((x) => kind === "pieces"
    ? `<div class="lbl piece">${qrSvg(pieceLink(x.serial))}<div class="t"><span class="c">${esc(x.serial)}</span><span class="n">${esc(x.p.name)}</span></div></div>`
    : kind === "places"
    ? `<div class="lbl place">${qrSvg(placeLink(x))}<div class="t">${esc(x.name)}<small>📍 Scan to see what should be here</small></div></div>`
    : `<div class="lbl tag">${qrSvg(itemLink(x))}<div class="t"><span class="c">${esc(x.code)}</span><span class="n">${esc(x.name)}</span><span class="k">${esc([x.category, [x.metal, x.purity].filter(Boolean).join(" "), x.weight_g != null ? fmtNum(x.weight_g, 3) + " g" : ""].filter(Boolean).join(" · "))}</span></div></div>`
  ).join("");
  $("#print-area").innerHTML = `<div class="lbl-sheet">${html}</div>`;
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  setTimeout(() => window.print(), 100);
}

function openLabels() {
  updateLabelsForm();
  $("#dlg-labels").showModal();
}

const trackedProducts = () => state.products.filter((p) => p.track_pieces).sort((a, b) => a.code.localeCompare(b.code));

function labelsSelection() {
  const form = $("#form-labels");
  if (form.kind.value === "places") return state.locations;
  if (form.kind.value === "pieces") {
    const w = form.which.value;
    return trackedProducts().filter((p) => w === "all" || w === "item:" + p.id);
  }
  const w = form.which.value;
  return state.products.filter((p) => w === "all" ? true
    : w.startsWith("cat:") ? p.category_id === Number(w.slice(4))
    : p.locations.some((l) => l.id === Number(w.slice(6))))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function updateLabelsForm(e) {
  const form = $("#form-labels");
  const kind = form.kind.value;
  if (!e || e.target.name === "kind") {
    const sel = $("#labels-which");
    const opts = kind === "pieces"
      ? [["all", `All tracked items (${trackedProducts().length})`], ...trackedProducts().map((p) => ["item:" + p.id, `${p.code} · ${p.name} (${p.qty} pieces)`])]
      : [["all", `All items (${state.products.length})`],
        ...state.categories.map((c) => ["cat:" + c.id, `Category: ${c.name} (${c.items})`]),
        ...state.locations.map((l) => ["place:" + l.id, `Place: ${l.name} (${l.items})`])];
    sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  }
  $("#labels-which-wrap").hidden = kind === "places";
  if (kind === "pieces") {
    const n = labelsSelection().reduce((t, p) => t + p.qty, 0);
    $("#labels-count").textContent = trackedProducts().length
      ? `${n} piece tag${n === 1 ? "" : "s"} (3 × 2 cm QR, about 48 per A4 page).`
      : "No items are tracked piece by piece yet. Turn it on in an item's Edit form.";
    return;
  }
  const n = labelsSelection().length;
  $("#labels-count").textContent = form.kind.value === "places"
    ? (n ? `${n} place label${n === 1 ? "" : "s"} (about 8 per A4 page).` : "No places yet. Add them under 📍 Places first.")
    : `${n} item tag${n === 1 ? "" : "s"} (about 30 per A4 page).`;
}

// ----- scanner -----
let scanStream = null, scanTimer = null, jsqrPromise = null;

// mode: null (open whatever is scanned), {type: "pickPlace", onPlace(id)}, or {type: "collect", placeId}
async function openScan(mode = null) {
  state.scanMode = mode;
  state.scanBusy = false;
  state.scanSeen = {};
  $("#scan-log").innerHTML = "";
  $("#scan-title").textContent = !mode ? "📷 Scan a QR label"
    : mode.type === "pickPlace" ? "📷 Scan the new place's label"
    : `📷 Scan pieces into ${placeName(mode.placeId)}`;
  $("#form-code").hidden = !!mode;
  $("#scan-status").textContent = "Starting camera…";
  $(".scan-view").classList.remove("found");
  $("#form-code").reset();
  $("#dlg-scan").showModal();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser can't use the camera here. Use your phone's camera app to scan the label instead, or type the code below.");
    jsqrPromise = jsqrPromise || loadScript("/vendor/jsQR.js").catch((e) => { jsqrPromise = null; throw e; });
    [scanStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
      jsqrPromise,
    ]);
    if (!$("#dlg-scan").open) return stopScan();
    const video = $("#scan-video");
    video.srcObject = scanStream;
    await video.play();
    $("#scan-status").textContent = !state.scanMode ? "Point the camera at a QR label."
      : state.scanMode.type === "pickPlace" ? "Point the camera at the label on the tray, case, safe… where the piece is now."
      : "Scan each piece's tag as you put it here. Tap Close when done.";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    scanTimer = setInterval(() => {
      if (!video.videoWidth) return;
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
      if (hit && hit.data) onScanned(hit.data);
    }, 200);
  } catch (err) {
    $("#scan-status").textContent = err.name === "NotAllowedError"
      ? "Camera permission was refused. Allow camera access for this site in your browser settings, or type the code below."
      : err.message;
  }
}

function stopScan() {
  clearInterval(scanTimer);
  scanTimer = null;
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
}

async function onScanned(text) {
  const target = parseTarget(text);
  if (!target) { $("#scan-status").textContent = "That QR code isn't one of this app's labels."; return; }
  const mode = state.scanMode;
  if (mode && mode.type === "pickPlace") {
    if (target.type !== "place") { $("#scan-status").textContent = "That's not a place label. Scan the label on the tray, case or safe."; return; }
    stopScan();
    $("#dlg-scan").close();
    return mode.onPlace(Number(target.value));
  }
  if (mode && mode.type === "collect") {
    // Keep scanning: every piece tag scanned is moved into this place.
    if (target.type !== "piece") { $("#scan-status").textContent = "That's not a piece tag. Scan the tags of pieces tracked piece by piece."; return; }
    const serial = target.value.toUpperCase();
    if (state.scanBusy || Date.now() - (state.scanSeen[serial] || 0) < 4000) return;
    state.scanBusy = true;
    state.scanSeen[serial] = Date.now();
    const log = (msg, bad) => $("#scan-log").insertAdjacentHTML("afterbegin", `<li class="${bad ? "bad" : ""}">${esc(msg)}</li>`);
    try {
      const pc = await api("pieces/" + encodeURIComponent(serial));
      if (pc.status !== "in") log(`✗ ${serial} is not in stock`, true);
      else {
        const res = await api(`products/${pc.product_id}/move`, { method: "POST", body: { to_location_id: mode.placeId, pieces: [serial] } });
        log(res.moved ? `✓ ${serial} → ${placeName(mode.placeId)}` : `✓ ${serial} already here`);
        try { navigator.vibrate && navigator.vibrate(60); } catch {}
      }
    } catch (err) { log(`✗ ${serial}: ${err.message}`, true); }
    finally { state.scanBusy = false; }
    return;
  }
  $(".scan-view").classList.add("found");
  try { navigator.vibrate && navigator.vibrate(80); } catch {}
  stopScan();
  $("#dlg-scan").close();
  goTo(target);
}

// Understands this app's label links (…/#item=RIN-0001, …/#place=3) or a bare item code.
function parseTarget(text) {
  const t = String(text || "").trim();
  const m = /#(item|place|piece)=([^&\s]+)/.exec(t);
  if (m) return { type: m[1], value: decodeURIComponent(m[2]) };
  if (/^[A-Za-z]{2,}\d*-\d{4,}-\d{2,}$/.test(t)) return { type: "piece", value: t.toUpperCase() };
  if (/^[A-Za-z]{2,}\d*-\d{1,}$/.test(t)) return { type: "item", value: t.toUpperCase() };
  return null;
}

function goTo(target) {
  if (target.type === "piece") return openPiece(target.value);
  if (target.type === "place") {
    const id = Number(target.value);
    if (!state.locations.some((l) => l.id === id)) return toast("That place doesn't exist any more", 4000);
    openPlace(id);
  } else {
    const p = state.products.find((x) => x.code.toUpperCase() === target.value.toUpperCase());
    if (!p) return toast(`No item with code ${target.value}`, 4000);
    showItem(p);
    const where = [...p.locations.map((l) => `${l.name} ×${l.qty}`), ...(p.unassigned ? [`place not set ×${p.unassigned}`] : [])];
    toast(`${p.code}: ${where.length ? "📍 " + where.join(", ") : "none in stock"}`, 5000);
  }
}

// Labels scanned with the phone's own camera open the app at /#item=… or /#place=…
function handleHash() {
  const target = parseTarget(location.hash);
  if (!target) return;
  history.replaceState(null, "", location.pathname + location.search);
  goTo(target);
}

// ---------- search by photo ----------
// A small image model (MobileNet V2, bundled under /vendor) turns each photo into 1280 numbers
// (a "fingerprint"). Photos of the same piece give similar fingerprints, so we compare them.
const EMB_NODE = "module_apply_default/MobilenetV2/Logits/AvgPool";
let visionPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load photo search. Check the internet connection."));
    document.head.appendChild(s);
  });
}

function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      if (!window.tf) await loadScript("/vendor/tf.min.js");
      const model = await tf.loadGraphModel("/vendor/mobilenet_v2/model.json");
      tf.tidy(() => { model.execute(tf.zeros([1, 224, 224, 3]), EMB_NODE); }); // warm up
      return model;
    })().catch((err) => { visionPromise = null; throw err; });
  }
  return visionPromise;
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read photo"));
    img.src = src;
  });
}

// Returns a unit-length Float32Array fingerprint for an image URL or data URL.
async function fingerprint(src) {
  const model = await loadVision();
  const img = await loadImg(src);
  const side = Math.min(img.naturalWidth, img.naturalHeight); // centre square crop
  const c = document.createElement("canvas");
  c.width = c.height = 224;
  c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 224, 224);
  const out = tf.tidy(() => {
    const x = tf.browser.fromPixels(c).toFloat().div(255).expandDims(0);
    return model.execute(x, EMB_NODE).reshape([-1]);
  });
  const v = await out.data();
  out.dispose();
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

function packVec(v) {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const q = Int8Array.from(v, (x) => Math.round((x / (max || 1)) * 127));
  return btoa(String.fromCharCode(...new Uint8Array(q.buffer)));
}

function cosine(query, b64) {
  const bin = atob(b64);
  let dot = 0, nn = 0;
  for (let i = 0; i < bin.length; i++) {
    const b = (bin.charCodeAt(i) << 24) >> 24; // to signed byte
    dot += query[i] * b; nn += b * b;
  }
  return nn ? dot / Math.sqrt(nn) : 0;
}

// Make fingerprints for item photos that don't have one yet (e.g. photos added before this feature).
let indexing = null;
function ensureIndexed(onProgress) {
  if (!indexing) {
    indexing = (async () => {
      const todo = state.products.filter((p) => p.photo_v && p.vec_v !== p.photo_v);
      let done = 0;
      for (const p of todo) {
        onProgress && onProgress(done, todo.length);
        try {
          const vec = packVec(await fingerprint(photoUrl(p)));
          await api(`products/${p.id}/photo-vec`, { method: "PUT", body: { vec, v: p.photo_v } });
          p.vec_v = p.photo_v;
        } catch (err) { console.warn("Couldn't index", p.code, err.message); }
        done++;
      }
      onProgress && onProgress(done, todo.length);
    })().finally(() => { indexing = null; });
  }
  return indexing;
}

const psStatus = (msg) => { $("#ps-status").textContent = msg; };

async function openPhotoSearch() {
  $("#ps-query").hidden = true;
  $("#ps-results").innerHTML = "";
  $("#ps-add").hidden = true;
  state.psQuery = null;
  $("#dlg-psearch").showModal();
  await preparePhotoSearch();
}

async function preparePhotoSearch() {
  const withPhoto = state.products.filter((p) => p.photo_v).length;
  if (!withPhoto) {
    psStatus("No items have photos yet. Add photos to your items (Edit → Add photo) so they can be found by photo.");
    return false;
  }
  try {
    psStatus(window.tf ? "Getting ready…" : "Getting photo search ready… (the first time downloads about 15 MB)");
    await loadVision();
    await ensureIndexed((done, total) => {
      if (total) psStatus(`Learning your item photos: ${done} of ${total}…`);
    });
    const missing = state.products.length - withPhoto;
    psStatus(`Ready. Searching ${withPhoto} item${withPhoto > 1 ? "s" : ""} with photos` +
      (missing ? ` (${missing} without a photo can't be found this way).` : "."));
    return true;
  } catch (err) {
    psStatus(err.message);
    return false;
  }
}

async function runPhotoSearch(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("#ps-results").innerHTML = ""; // clear old results straight away
  $("#ps-add").hidden = true;
  psStatus("Reading photo…");
  try {
    const dataUrl = await resizeImage(file);
    state.psQuery = dataUrl;
    $("#ps-query").innerHTML = `<img src="${dataUrl}" alt="Your photo"><span class="muted">Your photo</span>`;
    $("#ps-query").hidden = false;
    $("#ps-results").innerHTML = "";
    if (!(await preparePhotoSearch())) { $("#ps-add").hidden = false; return; }
    psStatus("Comparing…");
    const [query, index] = await Promise.all([fingerprint(dataUrl), api("photo-index")]);
    const byId = new Map(state.products.map((p) => [p.id, p]));
    const matches = index
      .map((r) => ({ p: byId.get(r.id), s: cosine(query, r.vec) }))
      .filter((m) => m.p)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    renderPhotoMatches(matches);
    $("#ps-add").hidden = false;
  } catch (err) { psStatus(err.message); }
}

// Scores depend on lighting and background, so the top result is judged against the runner-up too.
function matchLabel(s, i, matches) {
  const next = matches[1] ? matches[1].s : 0;
  if (i === 0 && (s >= 0.8 || (s >= 0.55 && s - next >= 0.05))) return ["hi", "Best match"];
  if (s >= 0.6) return ["mid", "Possible"];
  return ["lo", "Unlikely"];
}

function renderPhotoMatches(matches) {
  const best = matches.length && matchLabel(matches[0].s, 0, matches)[0] === "hi";
  psStatus(best ? "Found it? Check the best match below:" : matches.some((m) => m.s >= 0.6)
    ? "A few possible matches. Check them below:"
    : "No close match. Check the items below, or add it as a new item.");
  $("#ps-results").innerHTML = matches.map(({ p, s }, i) => {
    const [cls, label] = matchLabel(s, i, matches);
    return `<div class="ps-row ${cls === "lo" ? "weak" : ""}" data-id="${p.id}">
      <img src="${photoUrl(p)}" alt="">
      <div class="nm"><b>${esc(p.code)}</b> ${esc(p.name)}
        <small>${esc(p.category)}${p.colour ? " · " + esc(p.colour) : ""} · ${p.qty} in stock</small>
        <span class="score ${cls}">${label} · ${Math.round(Math.max(0, s) * 100)}%</span></div>
      <div class="btns">
        <button type="button" class="ghost" data-act="show">Show</button>
        <button type="button" class="minus" data-act="out" aria-label="Stock out" ${p.qty === 0 ? "disabled" : ""}>−</button>
        <button type="button" class="plus" data-act="in" aria-label="Stock in">+</button>
      </div>
    </div>`;
  }).join("");
}

function photoMatchAction(e) {
  const btn = e.target.closest("button[data-act]");
  const row = e.target.closest(".ps-row");
  if (!row) return;
  const p = state.products.find((x) => x.id === Number(row.dataset.id));
  const act = btn ? btn.dataset.act : "show";
  $("#dlg-psearch").close();
  if (act === "show") showItem(p);
  else openStock(p, act);
}

// Filter the list to one item and highlight it.
function showItem(p) {
  state.activeCat = null;
  state.lowOnly = false;
  $("#low-only").checked = false;
  $("#search").value = p.code;
  state.search = p.code;
  renderChips();
  render();
  const el = document.querySelector(`.item[data-id="${p.id}"]`);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); }
}

function addFromPhotoSearch() {
  const dataUrl = state.psQuery;
  $("#dlg-psearch").close();
  openItem();
  if (dataUrl) { state.photo = { dataUrl }; showPhotoPreview(dataUrl); }
}

// After a photo is saved, make its fingerprint straight away if the model is already loaded.
function indexSoon() {
  if (visionPromise) ensureIndexed().catch(() => {});
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
  const cols = ["code", "name", "category", "metal", "purity", "colour", "weight_g", "stone", "size", "cost_price", "sell_price", "supplier", "qty", "places", "low_stock", "notes", "created_by", "created_at", "updated_at"];
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const placesText = (p) => [...p.locations.map((l) => `${l.name} x${l.qty}`),
    ...(p.unassigned ? [`Place not set x${p.unassigned}`] : [])].join("; ");
  const lines = [cols.join(","), ...state.products.map((p) => cols.map((c) => cell(c === "places" ? placesText(p) : p[c])).join(","))];
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
  $("#btn-new-cat").onclick = newCategoryInline;
  $("#btn-delete-item").onclick = deleteItem;
  $("#btn-another-colour").onclick = () => openAnotherColour(state.editing);
  $("#btn-duplicate").onclick = () => openCopy(state.editing, "duplicate");
  $("#photo-input").onchange = pickPhoto;
  $("#btn-alerts").onclick = openAlerts;
  $("#btn-photo-search").onclick = openPhotoSearch;
  $("#btn-places").onclick = () => { $("#place-error").hidden = true; renderPlaceList(); $("#dlg-places").showModal(); };
  $("#form-place").onsubmit = addPlace;
  $("#place-list").onclick = placeListAction;
  $("#place-items").onclick = placeItemAction;
  $("#btn-put-here").onclick = putHere;
  $("#btn-place-label").onclick = () => printLabels("places", state.locations.filter((l) => l.id === Number(state.openPlaceId)));
  $("#btn-print-places").onclick = () => printLabels("places", state.locations);
  $("#form-move").onsubmit = saveMove;
  $("#move-from").addEventListener("change", () => fillMoveTo(null));
  $("#form-move").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const input = $("#form-move").qty;
    input.value = Math.min(Number(input.max) || Infinity, Math.max(1, (parseInt(input.value, 10) || 0) + Number(b.dataset.step)));
  });
  for (const id of ["#stock-place", "#item-place", "#move-to"]) $(id).addEventListener("change", onPlaceSelectChange);
  $("#place-filter").onchange = (e) => { state.placeFilter = e.target.value; render(); };
  $("#btn-scan").onclick = openScan;
  $("#dlg-scan").addEventListener("close", () => {
    stopScan();
    const mode = state.scanMode;
    state.scanMode = null;
    if (mode && mode.type === "collect") refresh();
  });
  $("#stock-place").addEventListener("change", renderStockPieces);
  $("#btn-scan-in").onclick = () => openScan({ type: "collect", placeId: state.openPlaceId });
  $("#pieces-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-serial]");
    if (b) { e.preventDefault(); openPiece(b.dataset.serial); }
  });
  $("#btn-pieces-all").onclick = () => {
    const boxes = [...$("#pieces-list").querySelectorAll("input[type=checkbox]")];
    const on = !boxes.every((c) => c.checked);
    boxes.forEach((c) => { c.checked = on; });
  };
  $("#btn-pieces-move").onclick = () => {
    const pick = pickedSerials($("#pieces-list"));
    if (!pick.length) return toast("Tick the pieces to move first");
    openMove(state.piecesOf, null, null, pick);
  };
  $("#btn-pieces-print").onclick = () => {
    const pick = pickedSerials($("#pieces-list"));
    const all = [...$("#pieces-list").querySelectorAll("input[type=checkbox]")].map((c) => c.value);
    printLabels("pieces", (pick.length ? pick : all).map((serial) => ({ serial, p: state.piecesOf })));
  };
  $("#btn-piece-scan-place").onclick = () => {
    const pc = state.piece;
    $("#dlg-piece").close();
    openScan({ type: "pickPlace", onPlace: async (id) => {
      try { await movePiece(pc.serial, pc.product_id, id); } catch (err) { toast(err.message, 4000); }
      openPiece(pc.serial);
    } });
  };
  $("#btn-piece-move").onclick = async () => {
    const pc = state.piece, to = $("#piece-to").value;
    if (to === "__new") return;
    try { await movePiece(pc.serial, pc.product_id, to); openPiece(pc.serial); } catch (err) { toast(err.message, 4000); }
  };
  $("#piece-to").addEventListener("change", onPlaceSelectChange);
  $("#btn-piece-out").onclick = () => {
    const pc = state.piece;
    $("#dlg-piece").close();
    openStock(pc.p, "out", pc.location_id == null ? "" : String(pc.location_id), [pc.serial]);
  };
  $("#btn-piece-tag").onclick = () => printLabels("pieces", [{ serial: state.piece.serial, p: state.piece.p }]);
  $("#form-code").onsubmit = (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (!code) return;
    stopScan();
    $("#dlg-scan").close();
    goTo(parseTarget(code) || { type: "item", value: code });
  };
  $("#btn-menu").onclick = () => $("#dlg-menu").showModal();
  $("#dlg-menu").onclick = (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b) return;
    $("#dlg-menu").close();
    const m = b.dataset.menu;
    if (m === "activity") openHistory(null);
    else if (m === "categories") { $("#cat-error").hidden = true; $("#dlg-cats").showModal(); }
    else if (m === "labels") openLabels();
    else if (m === "export") exportCsv();
    else if (m === "install") installApp();
  };
  $("#form-labels").addEventListener("change", updateLabelsForm);
  $("#form-labels").onsubmit = async (e) => {
    e.preventDefault();
    const kind = $("#form-labels").kind.value;
    if (kind !== "pieces") return printLabels(kind, labelsSelection());
    try {
      const all = [];
      for (const p of labelsSelection()) {
        for (const x of await api(`products/${p.id}/pieces`)) if (x.status === "in") all.push({ serial: x.serial, p });
      }
      printLabels("pieces", all);
    } catch (err) { toast(err.message, 4000); }
  };
  window.addEventListener("hashchange", handleHash);
  $("#tabbar").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    const t = b.dataset.tab;
    document.querySelectorAll("dialog[open]").forEach((d) => d.id !== "dlg-alarm" && d.id !== "dlg-login" && d.close());
    if (t === "home") goHome();
    else if (t === "scan") openScan();
    else if (t === "add") openItem();
    else if (t === "places") $("#btn-places").click();
    else if (t === "more") $("#btn-menu").click();
  };
  $("#ps-camera").onchange = runPhotoSearch;
  $("#ps-gallery").onchange = runPhotoSearch;
  $("#ps-results").onclick = photoMatchAction;
  $("#ps-add").onclick = addFromPhotoSearch;
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
    else if (act === "move") openMove(p);
    else if (act === "label") printLabels("items", [p]);
    else if (act === "pieces") openPieces(p);
    else if (act === "colour") openAnotherColour(p);
    else if (act === "duplicate") openCopy(p, "duplicate");
    else if (act === "variant") {
      const v = state.products.find((x) => x.id === Number(btn.dataset.vid));
      if (v) showDesign(v);
    }
    else openStock(p, act);
  };
}

wire();
updateInstallItem();
setupCapitals();
loadMe().then(refresh).then(() => { handleHash(); remindLowOnce(); startPolling(); suggestInstallOnce(); }).catch((err) => {
  const empty = $("#empty");
  empty.hidden = false;
  empty.innerHTML = `<span class="error">${esc(err.message)}</span>`;
});
