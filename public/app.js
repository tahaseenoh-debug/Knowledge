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
function setPassword(p) { try { localStorage.setItem("inv-pw", p); } catch {} }

async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", "x-app-password": getPassword() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { await askPassword(); return api(path, opts); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function askPassword() {
  const dlg = $("#dlg-login"), form = $("#form-login"), err = $("#login-error");
  if (dlg.open) return new Promise(() => {}); // one prompt at a time
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

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2200);
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
      const hay = [p.code, p.name, p.category, p.metal, p.purity, p.stone, p.size, p.supplier, p.notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
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
    p.weight_g != null ? fmtNum(p.weight_g, 3) + " g" : "",
    p.stone, p.size ? "Size " + p.size : "",
    p.sell_price != null ? "Price " + fmtNum(p.sell_price) : "",
  ].filter(Boolean).map(esc).join(" · ");
  const cls = p.qty === 0 ? "zero" : p.qty <= p.low_stock ? "low" : "";
  const badge = p.qty === 0 ? '<span class="badge out">Out of stock</span>' : p.qty <= p.low_stock ? '<span class="badge">Low stock</span>' : "";
  return `<article class="item ${cls}" data-id="${p.id}">
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
      <button class="ghost" data-act="rename">Rename</button>
      <button class="ghost danger" data-act="delete" ${c.items ? "disabled title='Has items'" : ""}>Delete</button>
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
  $("#btn-delete-item").hidden = !product;
  $("#opening-wrap").hidden = !!product;
  renderCategorySelect(product ? product.category_id : state.activeCat || "");
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
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    if (state.editing) {
      await api("products/" + state.editing.id, { method: "PUT", body });
      toast("Saved");
    } else {
      const p = await api("products", { method: "POST", body });
      toast(`Added ${p.code}`);
    }
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
    toast(`${p.code}: ${change > 0 ? "+" : ""}${change} → ${p.qty} in stock`);
    await refresh();
  } catch (e2) { showError(err, e2); }
  finally { btn.disabled = false; }
}

// ---------- history ----------
function movementHtml(m, withItem) {
  const dir = m.change > 0 ? "in" : "out";
  const title = withItem ? `<b>${esc(m.code)}</b> ${esc(m.name)}` : esc(m.reason || (dir === "in" ? "Stock in" : "Stock out"));
  const sub = [withItem ? m.reason : null, m.note, `Balance ${m.qty_after}`].filter(Boolean).map(esc).join(" · ");
  return `<div class="mv"><span class="chg ${dir}">${m.change > 0 ? "+" : ""}${m.change}</span>
    <span class="what">${title}<small>${sub}</small></span><span class="when">${fmtDate(m.created_at)}</span></div>`;
}

async function openHistory(product) {
  $("#history-title").textContent = product ? `${product.code} · ${product.name}` : "Recent activity";
  $("#history-list").innerHTML = '<p class="muted">Loading…</p>';
  $("#dlg-history").showModal();
  try {
    const rows = product ? await api(`products/${product.id}/movements`) : await api("movements?limit=200");
    $("#history-list").innerHTML = rows.map((m) => movementHtml(m, !product)).join("") || '<p class="muted">No stock movements yet.</p>';
  } catch (err) { $("#history-list").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
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
  const cols = ["code", "name", "category", "metal", "purity", "weight_g", "stone", "size", "cost_price", "sell_price", "supplier", "qty", "low_stock", "notes", "created_at", "updated_at"];
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
    else openStock(p, act);
  };
}

wire();
refresh().catch((err) => {
  const empty = $("#empty");
  empty.hidden = false;
  empty.innerHTML = `<span class="error">${esc(err.message)}</span>`;
});
