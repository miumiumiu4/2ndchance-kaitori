// 管理画面（/admin/）の画面側。チラシの「原稿を直す机」：ここで直して保存すると、GAS が GitHub に積み、
// GitHub Actions が 1〜2分でサイトを刷り直す（README「管理画面の設定」）。
// 計算・確かめ・変更点の要約は admin-core.js（GAS も同じ式）。写真は端末の中で縮めて JPEG にし直す（EXIF・位置情報は残らない）。
import { CONFIG } from "./config.js";
import { CLEANUP_KINDS } from "./quote-core.js";
import * as A from "./admin-core.js";
import { makePhotos } from "./admin-photo.js";

const BASE = "../";
const KEY = "admin-session";
const TABS = [["shop", "商品"], ["prices", "金額表"], ["site", "お店の情報"], ["results", "買取実績"]];
const PUBLIC = { shop: "shop/", prices: "price/", site: "", results: "price/#results" };
const root = document.querySelector("[data-admin-root]");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const yen = (n) => (typeof n === "number" ? "¥" + n.toLocaleString("ja-JP") : "確認中");
const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? "" : String(v));

// S：ログイン・読み込んだ中身（base）・直している中身（work）・上げる写真・保存の結果
const S = { token: "", who: "", tab: "shop", base: {}, sha: {}, work: {}, items: [], photos: {}, previews: {}, edit: null, pending: null, last: {}, busy: false };

function loadSession() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (s && s.token) { S.token = s.token; S.who = s.who; } } catch (_) {}
}
function saveSession() {
  try { if (S.token) sessionStorage.setItem(KEY, JSON.stringify({ token: S.token, who: S.who })); else sessionStorage.removeItem(KEY); } catch (_) {}
}

async function call(kind, extra) {
  const r = await fetch(CONFIG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ kind, token: S.token, ...(extra || {}) }) });
  const j = await r.json();
  if (j && j.relogin) { S.token = ""; saveSession(); renderLogin(j.error); throw new Error("relogin"); }
  return j;
}

// ---------- ログイン ----------
function renderLogin(msg) {
  const ready = !!CONFIG.GAS_URL;
  root.innerHTML = `<section class="section admin-login" aria-labelledby="adm-h">
<h1 id="adm-h">管理画面</h1>
<p>商品・金額表・お店の情報・買取実績を直す所です。保存すると、1〜2分で公開ページに反映されます。</p>
<form class="qform" id="adm-login" novalidate>
<label class="f" for="adm-who">どなたですか</label>
<select id="adm-who" name="who">${A.ADMIN_ROLES.map((r) => `<option${r === S.who ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>
<label class="f" for="adm-pass">パスコード</label>
<input type="password" id="adm-pass" name="passcode" autocomplete="current-password" required>
<p class="err" id="adm-login-err" role="alert"${msg ? "" : " hidden"}>${esc(msg || "")}</p>
<button type="submit" class="btn btn-form btn-block" style="margin-top:16px"${ready ? "" : " disabled"}>${ready ? "ログイン" : "準備中<small>（受け口の URL が未設定）</small>"}</button>
<p class="hint">${A.LOCK_MAX}回続けて間違えると${A.LOCK_MINUTES}分使えなくなり、オーナーにメールが届きます。ログインは${A.SESSION_HOURS}時間（このタブを閉じると切れます）。</p>
</form>
<p class="quick-switch"><a href="quick/">かんたん入力（商品を1点ふやす・売切れにする）へ</a></p>
</section>`;
  const f = root.querySelector("#adm-login");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ready || S.busy) return;
    const err = root.querySelector("#adm-login-err");
    const btn = f.querySelector("button");
    S.busy = true; btn.disabled = true; btn.textContent = "確かめています…";
    try {
      const j = await call("admin_login", { passcode: f.passcode.value, who: f.who.value });
      if (!j.ok) { err.hidden = false; err.textContent = j.error || "ログインできませんでした"; return; }
      S.token = j.token; S.who = j.who; saveSession();
      await loadAll();
    } catch (x) {
      if (x.message !== "relogin") { err.hidden = false; err.textContent = "つながりませんでした。電波の良い所でもう一度お試しください"; }
    } finally {
      S.busy = false; if (btn.isConnected) { btn.disabled = false; btn.textContent = "ログイン"; }
    }
  });
}

async function loadAll(msg) {
  root.innerHTML = '<p class="muted">読み込み中…</p>';
  const j = await call("admin_load");
  if (!j.ok) { root.innerHTML = `<p class="err-summary">${esc(j.error || "読み込めませんでした")}</p><p><button class="btn btn-ghost" id="adm-retry">もう一度</button></p>`; root.querySelector("#adm-retry").onclick = () => loadAll(); return; }
  S.who = j.who || S.who;
  S.actions = j.actions_url;
  for (const t of Object.keys(A.ADMIN_FILES)) {
    const f = j.files[t];
    S.base[t] = f ? f.data : null;
    S.sha[t] = f ? f.sha : "";
    S.work[t] = f ? clone(f.data) : null;
    S.photos[t] = {};
  }
  S.items = (j.files.items && j.files.items.data.items) || [];
  S.edit = null; S.pending = null;
  renderMain(msg);
}

// ---------- 骨組み ----------
function renderMain(msg) {
  root.innerHTML = `<div class="admin-bar"><span>ログイン中：<b>${esc(S.who)}</b></span><span class="quick-bar-links"><a href="quick/" class="quick-link">かんたん入力</a><button type="button" class="btn btn-ghost admin-small" data-act="logout">ログアウト</button></span></div>
${msg ? `<p class="callout">${esc(msg)}</p>` : ""}
<div class="tabs admin-tabs" role="tablist" aria-label="直すもの">${TABS.map(([k, n]) => `<button type="button" role="tab" id="adm-tab-${k}" aria-selected="${S.tab === k}" data-tab="${k}">${esc(n)}${dirty(k) ? '<small class="admin-dot">未保存</small>' : ""}</button>`).join("")}</div>
<div id="adm-panel" role="tabpanel" aria-labelledby="adm-tab-${S.tab}"></div>`;
  root.querySelector('[data-act="logout"]').onclick = async () => {
    try { await call("admin_logout"); } catch (_) {}
    S.token = ""; saveSession(); renderLogin("ログアウトしました");
  };
  root.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; S.edit = null; renderMain(); }; });
  renderPanel();
}
function dirty(t) {
  return !!S.work[t] && (A.diffSummary(t, S.base[t], S.work[t]).length > 0 || usedPhotos(t).length > 0);
}
function renderPanel() {
  const p = root.querySelector("#adm-panel");
  if (!S.work[S.tab]) { p.innerHTML = '<p class="err-summary">このファイルが見つかりません</p>'; return; }
  p.innerHTML = ({ shop: shopPanel, prices: pricesPanel, site: sitePanel, results: resultsPanel }[S.tab])() + saveArea(S.tab);
  ({ shop: bindShop, prices: bindFields, site: bindFields, results: bindResults }[S.tab])(p);
  bindSave(p, S.tab);
}
function refreshTabs() {
  TABS.forEach(([k, n]) => { const b = root.querySelector("#adm-tab-" + k); if (b) b.innerHTML = esc(n) + (dirty(k) ? '<small class="admin-dot">未保存</small>' : ""); });
}

// ---------- 写真：端末の中で縮めて JPEG に（js/admin-photo.js。EXIF・位置情報は落ちる） ----------
// 今の中身から使われている写真だけ上げる（消した商品の写真は上げない）
function usedPhotos(t) {
  const w = S.work[t];
  if (!w) return [];
  const used = new Set();
  if (t === "shop") w.items.forEach((it) => (it.photos || []).forEach((p) => { used.add(p); used.add(A.photoThumbPath(p)); }));
  if (t === "results") w.results.forEach((r) => r.photo && used.add(r.photo));
  return Object.keys(S.photos[t] || {}).filter((p) => used.has(p)).map((p) => ({ path: p, base64: S.photos[t][p] }));
}
const photoSrc = (p) => S.previews[p] || BASE + p;

// ---------- 商品 ----------
function shopPanel() {
  const items = S.work.shop.items;
  if (S.edit) return shopEditor();
  return `<section class="section" aria-labelledby="adm-shop-h">
<h2 id="adm-shop-h">商品（${items.length}点）</h2>
<p class="hint">「直す」で値段・売切れなどを変えられます。最後に下の「保存する」を押すと公開されます。</p>
<button type="button" class="btn btn-form btn-block" data-act="new">＋ 新しい商品を追加（写真を撮る）</button>
<ul class="admin-list">${items.map((it) => `<li class="admin-row">
<img src="${esc(photoSrc(A.photoThumbPath(it.photos[0] || "")))}" alt="" width="64" height="64" loading="lazy">
<div class="admin-row-main"><b>${esc(it.name)}</b><span>${esc(yen(it.price))}${it.sale ? `（${Math.round(it.sale * 100)}% OFF）` : ""}</span><span class="admin-chip admin-chip-${esc(it.status)}">${esc(A.SHOP_STATUS_NAMES[it.status] || it.status)}</span></div>
<button type="button" class="btn btn-ghost admin-small" data-edit="${esc(it.id)}">直す</button>
</li>`).join("")}</ul>
</section>`;
}
function opts(list, cur) {
  const all = list.indexOf(cur) >= 0 || !cur ? list : [cur].concat(list);
  return all.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`).join("");
}
function shopEditor() {
  const isNew = S.edit === "__new";
  const it = isNew ? { name: "", category: "家電", price: null, year: null, condition: "中古", size: "", free_shipping: false, status: "available", photos: [], note: "", payment_link: "" } : S.work.shop.items.find((x) => x.id === S.edit);
  const pic = S.pending ? S.pending.thumb.url : it.photos[0] ? photoSrc(A.photoThumbPath(it.photos[0])) : "";
  return `<section class="section" aria-labelledby="adm-ed-h">
<h2 id="adm-ed-h">${isNew ? "新しい商品" : "商品を直す"}</h2>
<form class="qform admin-form" id="adm-item" novalidate>
<label class="f" for="e-photo">写真${isNew ? '<span class="req">必須</span>' : '<span class="opt">差し替えるときだけ</span>'}</label>
<div class="admin-photo">${pic ? `<img src="${esc(pic)}" alt="" id="e-preview">` : '<span class="admin-nophoto" id="e-preview">写真なし</span>'}</div>
<input type="file" id="e-photo" accept="image/*">
<p class="hint">スマホで撮った写真をそのまま選べます。この画面で小さく（長辺 ${A.PHOTO_MAX}px）して、位置情報などの記録は消してから送ります。値札・人の顔・住所が写らないように。</p>
<label class="f" for="e-name">名前<span class="req">必須</span></label>
<input type="text" id="e-name" name="name" maxlength="80" value="${esc(it.name)}">
<label class="f" for="e-price">価格（税込・円）<span class="opt">空欄＝確認中</span></label>
<input type="text" id="e-price" name="price" inputmode="numeric" value="${esc(val(it.price))}" placeholder="例：12000">
<label class="f" for="e-sale">割引（%）<span class="opt">任意</span></label>
<input type="text" id="e-sale" name="sale" inputmode="numeric" value="${it.sale ? Math.round(it.sale * 100) : ""}" placeholder="例：10" style="max-width:8em">
<fieldset style="margin-top:14px"><legend>状態</legend><div class="choices">${Object.entries(A.SHOP_STATUS_NAMES).map(([k, n]) => `<label class="choice"><input type="radio" name="status" value="${k}"${it.status === k ? " checked" : ""}><div><b>${esc(n)}</b></div></label>`).join("")}</div></fieldset>
<div class="grid-2">
<div><label class="f" for="e-cat">種類</label><select id="e-cat" name="category">${opts(A.SHOP_CATEGORIES, it.category)}</select></div>
<div><label class="f" for="e-cond">品物の状態</label><select id="e-cond" name="condition">${opts(A.SHOP_CONDITIONS, it.condition)}</select></div>
</div>
<div class="grid-2">
<div><label class="f" for="e-year">年式（西暦）<span class="opt">任意</span></label><input type="text" id="e-year" name="year" inputmode="numeric" maxlength="4" value="${esc(val(it.year))}"></div>
<div><label class="f" for="e-size">大きさ<span class="opt">任意</span></label><input type="text" id="e-size" name="size" maxlength="60" value="${esc(it.size)}"></div>
</div>
<label class="choice" style="margin-top:14px" for="e-free"><input type="checkbox" id="e-free" name="free_shipping"${it.free_shipping ? " checked" : ""}><div><b>送料無料（店から50km以内）</b></div></label>
<label class="f" for="e-note">ひとこと<span class="opt">任意</span></label>
<textarea id="e-note" name="note" maxlength="300">${esc(it.note)}</textarea>
<label class="f" for="e-pay">カード払いのページ（https://〜）<span class="opt">任意</span></label>
<input type="text" id="e-pay" name="payment_link" inputmode="url" value="${esc(it.payment_link)}">
<div class="err-summary" id="e-errs" role="alert" hidden></div>
<div class="btn-row">
<button type="submit" class="btn btn-form btn-block">この内容にする</button>
<button type="button" class="btn btn-ghost btn-block" data-act="cancel">やめる（一覧へ）</button>
${isNew ? "" : '<button type="button" class="btn btn-ghost btn-block admin-danger" data-act="delete">この商品を消す</button>'}
</div>
<p class="hint">「この内容にする」のあと、一覧の下の「保存する」で公開されます。</p>
</form>
</section>`;
}
function bindShop(p) {
  if (!S.edit) {
    p.querySelector('[data-act="new"]').onclick = () => { S.edit = "__new"; S.pending = null; renderPanel(); window.scrollTo(0, 0); };
    p.querySelectorAll("[data-edit]").forEach((b) => { b.onclick = () => { S.edit = b.dataset.edit; S.pending = null; renderPanel(); window.scrollTo(0, 0); }; });
    return;
  }
  const f = p.querySelector("#adm-item");
  const errBox = f.querySelector("#e-errs");
  f.querySelector("#e-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const prev = f.querySelector("#e-preview");
    prev.outerHTML = '<span class="admin-nophoto" id="e-preview">写真を整えています…</span>';
    try {
      S.pending = await makePhotos(file);
      f.querySelector("#e-preview").outerHTML = `<img src="${S.pending.thumb.url}" alt="" id="e-preview">`;
    } catch (x) {
      S.pending = null;
      f.querySelector("#e-preview").outerHTML = '<span class="admin-nophoto" id="e-preview">この写真は読めませんでした（JPEG・PNG で撮り直してください）</span>';
    }
  });
  f.querySelector('[data-act="cancel"]').onclick = () => { S.edit = null; S.pending = null; renderPanel(); };
  const del = f.querySelector('[data-act="delete"]');
  if (del) del.onclick = () => {
    const it = S.work.shop.items.find((x) => x.id === S.edit);
    if (!confirm(`「${it.name}」を一覧から消します（写真のファイルは残ります）。よろしいですか？`)) return;
    S.work.shop.items = S.work.shop.items.filter((x) => x.id !== S.edit);
    S.edit = null; renderPanel(); refreshTabs();
  };
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const el = f.elements;
    const isNew = S.edit === "__new";
    const old = isNew ? null : S.work.shop.items.find((x) => x.id === S.edit);
    const id = isNew ? A.newProductId(S.work.shop.items.map((x) => x.id), A.todayJST()) : old.id;
    const price = A.parseAmount(el.price.value);
    const salePct = A.parseAmount(el.sale.value);
    const year = A.parseAmount(el.year.value);
    const it = {
      ...(old || {}),
      id,
      name: el.name.value.trim(),
      category: el.category.value,
      price,
      year,
      condition: el.condition.value,
      size: el.size.value.trim(),
      free_shipping: el.free_shipping.checked,
      status: el.status.value,
      photos: old ? old.photos.slice() : [],
      note: el.note.value.trim(),
      payment_link: el.payment_link.value.trim()
    };
    if (salePct === null) { if (old && "sale" in old) it.sale = 0; else delete it.sale; } else it.sale = Number.isNaN(salePct) ? NaN : salePct / 100;
    if (it.sale === 0 && !(old && old.sale)) delete it.sale;
    // 項目の並びを今の表と同じに（差分を小さく）
    const order = A.SHOP_ITEM_KEYS.filter((k) => k in it);
    const item = {};
    order.forEach((k) => { item[k] = it[k]; });
    const errs = [];
    if (S.pending) {
      const path = A.shopPhotoPath(id);
      S.photos.shop[path] = S.pending.big.base64;
      S.photos.shop[A.photoThumbPath(path)] = S.pending.thumb.base64;
      S.previews[path] = S.pending.big.url;
      S.previews[A.photoThumbPath(path)] = S.pending.thumb.url;
      item.photos = [path];
    } else if (isNew) errs.push("写真を選んでください");
    if (Number.isNaN(price)) errs.push("価格は数字で（例：12000）。空欄なら「確認中」");
    if (Number.isNaN(year)) errs.push("年式は西暦4桁の数字か空欄");
    const test = { ...S.work.shop, items: [item] };
    A.validateShop(test).forEach((x) => errs.push(x.replace(/^商品「[^」]*」：/, "")));
    if (errs.length) { errBox.hidden = false; errBox.innerHTML = "直してください：<ul>" + errs.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; return; }
    if (isNew) S.work.shop.items.unshift(item);
    else S.work.shop.items = S.work.shop.items.map((x) => (x.id === id ? item : x));
    S.edit = null; S.pending = null;
    renderPanel(); refreshTabs();
    const save = root.querySelector("[data-save]");
    if (save) save.scrollIntoView({ block: "center" });
  });
}

// ---------- 金額表・お店の情報：入力欄 → work の場所（data-path） ----------
function field(t, path, label, v, kind, extra) {
  const id = "p-" + path.join("-").replace(/[^a-zA-Z0-9_-]/g, "_");
  const attrs = `id="${id}" data-target="${t}" data-path='${esc(JSON.stringify(path))}' data-kind="${kind}"`;
  if (kind === "bool") return `<label class="choice" for="${id}"><input type="checkbox" ${attrs}${v ? " checked" : ""}><div><b>${esc(label)}</b>${extra ? `<span>${esc(extra)}</span>` : ""}</div></label>`;
  const shown = kind === "percent" ? (typeof v === "number" ? String(Math.round(v * 100)) : "") : val(v);
  const input = kind === "textarea"
    ? `<textarea ${attrs} maxlength="${(extra && extra.max) || 300}">${esc(shown)}</textarea>`
    : `<input type="text" ${attrs}${kind === "text" ? "" : ' inputmode="numeric"'} value="${esc(shown)}"${kind === "fixed" ? " readonly" : ""}>`;
  return `<label class="admin-field" for="${id}"><span>${esc(label)}</span>${input}</label>`;
}
function readField(el) {
  const kind = el.dataset.kind;
  if (kind === "bool") return el.checked;
  if (kind === "text" || kind === "textarea") return el.value.trim();
  if (kind === "hours") { const v = el.value.trim(); return v === "" ? null : /^\d+$/.test(v) ? Number(v) : v; }
  const n = A.parseAmount(el.value);
  if (kind === "percent") return n === null || Number.isNaN(n) ? (n === null ? 0 : NaN) : n / 100;
  return n;
}
function setPath(obj, path, v) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = v;
}
function bindFields(p) {
  p.querySelectorAll("[data-path]").forEach((el) => {
    el.addEventListener(el.dataset.kind === "bool" ? "change" : "input", () => {
      const v = readField(el);
      setPath(S.work[el.dataset.target], JSON.parse(el.dataset.path), v);
      if (typeof v === "number" && Number.isNaN(v)) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
      refreshTabs();
    });
  });
}
function table(title, rows, note) {
  return `<details class="admin-group"${note === "open" ? " open" : ""}><summary>${esc(title)}</summary><div class="admin-rows">${rows.join("")}</div></details>`;
}
function pricesPanel() {
  const w = S.work.prices;
  const T = "prices";
  const groups = [];
  groups.push(table("仮の金額の表示", [field(T, ["provisional"], "仮の金額（チェックの間は「仮の目安」の帯が出る）", w.provisional, "bool"), field(T, ["provisional_note"], "仮の説明（「仮」の字を入れる）", w.provisional_note, "textarea")], "open"));
  groups.push(table("不用品回収（量の区分）", w.collection_tiers.map((t, i) => `<div class="admin-line"><b>${esc(t.name)}</b>${field(T, ["collection_tiers", i, "price_from"], "料金（円〜）", t.price_from, "amount")}</div>`)));
  Object.keys(w.cleanup_by_kind).forEach((k) => {
    groups.push(table("片付け：" + (CLEANUP_KINDS[k] || k), w.cleanup_by_kind[k].map((r, i) => `<div class="admin-line"><b>${esc(r.layout)}</b>${field(T, ["cleanup_by_kind", k, i, "price_from"], "料金（円〜）", r.price_from, "amount")}${field(T, ["cleanup_by_kind", k, i, "hours"], "作業時間（例 1〜2時間）", r.hours, "hours")}</div>`)));
  });
  groups.push(table("その他の片付け（坪数）", w.other_cleanup.map((o, i) => `<div class="admin-line"><b>${esc(o.name)}（${esc(o.per_tsubo)}坪あたり）</b>${field(T, ["other_cleanup", i, "price_from"], "料金（円〜）", o.price_from, "amount")}</div>`)));
  groups.push(table("買取の目安", w.buyback_items.map((b, i) => `<div class="admin-line"><b>${esc(b.name)}</b>${field(T, ["buyback_items", i, "min_price"], "最低額（円）", b.min_price, "amount")}${field(T, ["buyback_items", i, "max_price"], "上限（円）", b.max_price, "amount")}${field(T, ["buyback_items", i, "year_limit"], "年式の目安（年以内）", b.year_limit, "amount")}</div>`)));
  groups.push(table("オプション", w.options.map((o, i) => `<div class="admin-line"><b>${esc(o.name)}（1${esc(o.unit)}）</b>${field(T, ["options", i, "price"], "料金（円・0＝無料）", o.price, "amount")}${o.price_by_form ? Object.keys(o.price_by_form).map((f) => field(T, ["options", i, "price_by_form", f], f === "C" ? "片付け（お任せ）の場合（円）" : f + " の場合（円）", o.price_by_form[f], "amount")).join("") : ""}</div>`)));
  const pk = w.perks || {};
  const perk = [];
  if (pk.quo_card) perk.push(`<div class="admin-line"><b>${esc(pk.quo_card.name)}</b>${field(T, ["perks", "quo_card", "threshold"], "買取の合計がこの金額以上（円）", pk.quo_card.threshold, "amount")}${field(T, ["perks", "quo_card", "value"], "クオカードの金額（円）", pk.quo_card.value, "amount")}${field(T, ["perks", "quo_card", "desc"], "説明の文（金額を変えたらここも）", pk.quo_card.desc, "textarea")}</div>`);
  if (pk.same_day_up) perk.push(`<div class="admin-line"><b>${esc(pk.same_day_up.name)}</b>${field(T, ["perks", "same_day_up", "rate"], "上乗せ（%）", pk.same_day_up.rate, "percent")}${field(T, ["perks", "same_day_up", "desc"], "説明の文（%を変えたらここも）", pk.same_day_up.desc, "textarea")}</div>`);
  groups.push(table("買取の特典", perk));
  const deliv = (key, title) => (w[key] ? groups.push(table(title, w[key].map((d, i, list) => `<div class="admin-line">${field(T, [key, i, "label"], "表示", d.label, "text")}${i < list.length - 1 ? field(T, [key, i, "max_km"], "距離（km まで）", d.max_km, "amount") : '<p class="hint">（それより遠い）</p>'}${field(T, [key, i, "fee"], "配送料（円・0＝無料・空欄＝要相談）", d.fee, "amount")}</div>`))) : null);
  deliv("delivery_tiers", "配送料（ネット注文・郵便番号の計算に使う）");
  deliv("delivery_tiers_store", "配送料（店頭でご購入の場合・表示だけ）");
  return `<section class="section" aria-labelledby="adm-pr-h"><h2 id="adm-pr-h">金額表</h2>
<p class="hint">金額は半角・全角どちらでも（カンマ可）。空欄は「要相談」。品目や区分の追加・削除はここではできません（開発担当へ）。見出しを押すと開きます。</p>
${groups.join("")}</section>`;
}
function sitePanel() {
  const w = S.work.site;
  const T = "site";
  const c = w.referral_campaign;
  return `<section class="section" aria-labelledby="adm-site-h"><h2 id="adm-site-h">お店の情報</h2>
<div class="admin-rows">${A.SITE_FIELDS.map((f) => `${field(T, [f.key], f.label, w[f.key], f.multiline ? "textarea" : "text", { max: f.max })}<p class="hint">${esc(f.hint)}</p>`).join("")}</div>
${c ? `<h3 style="margin-top:18px">${esc(c.title)}</h3><div class="admin-rows">${A.CAMPAIGN_FIELDS.map((f) => field(T, ["referral_campaign", f.key], f.label, c[f.key], f.type === "bool" ? "bool" : f.type === "amount" ? "amount" : f.max > 60 ? "textarea" : "text", f.type === "bool" ? "チェックを外すと、トップ・遺品整理などのページの帯とフォームの欄が消えます" : { max: f.max })).join("")}</div>` : ""}
<p class="hint">電話番号・メールアドレス・お客様のお名前は書かないでください（保存のときに止まります）。</p>
</section>`;
}

// ---------- 買取実績 ----------
function resultsPanel() {
  const list = S.work.results.results;
  const cats = ["家電", "家具", "その他"];
  return `<section class="section" aria-labelledby="adm-res-h"><h2 id="adm-res-h">買取実績（${list.length}件）</h2>
<p class="hint">過去の買取の例。お客様の名前・住所・顔が写った写真は載せません。地域は市町村まで、日付は月まで。</p>
<button type="button" class="btn btn-form btn-block" data-act="add-result">＋ 実績を追加</button>
${list.map((r, i) => `<fieldset class="card admin-result-row" data-row="${i}"><legend>${esc(r.id)}</legend>
${r.photo ? `<img src="${esc(photoSrc(r.photo))}" alt="" class="admin-result-img">` : ""}
<label class="admin-field"><span>写真（任意）</span><input type="file" accept="image/*" data-photo="${i}"></label>
<label class="admin-field"><span>品目</span><select data-r="item_id">${S.items.map((it) => `<option value="${esc(it.id)}"${it.id === r.item_id ? " selected" : ""}>${esc(it.name)}</option>`).join("")}</select></label>
<label class="admin-field"><span>品名</span><input type="text" data-r="name" maxlength="60" value="${esc(r.name)}" placeholder="例：冷蔵庫 2ドア"></label>
<label class="admin-field"><span>種類</span><select data-r="category">${opts(cats, r.category)}</select></label>
<label class="admin-field"><span>買取価格（円）</span><input type="text" data-r="price" inputmode="numeric" value="${esc(val(r.price))}"></label>
<label class="admin-field"><span>買取した月</span><input type="month" data-r="date" value="${esc(r.date || "")}"></label>
<label class="admin-field"><span>地域（市町村）</span><input type="text" data-r="area" maxlength="20" value="${esc(r.area || "")}" placeholder="例：合志市"></label>
<label class="admin-field"><span>一言（任意）</span><input type="text" data-r="comment" maxlength="200" value="${esc(r.comment || "")}"></label>
<button type="button" class="btn btn-ghost admin-small admin-danger" data-del="${i}">この実績を消す</button>
</fieldset>`).join("")}
</section>`;
}
function bindResults(p) {
  p.querySelector('[data-act="add-result"]').onclick = () => {
    const list = S.work.results.results;
    const first = S.items[0] ? S.items[0].id : "";
    list.unshift({ id: A.newResultId(list.map((r) => r.id)), item_id: first, name: "", category: "家電", price: null, date: A.todayJST().slice(0, 7), area: "合志市", photo: "", comment: "" });
    renderPanel(); refreshTabs();
  };
  p.querySelectorAll("[data-row]").forEach((box) => {
    const r = S.work.results.results[Number(box.dataset.row)];
    box.querySelectorAll("[data-r]").forEach((el) => {
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
        const k = el.dataset.r;
        r[k] = k === "price" ? A.parseAmount(el.value) : el.value.trim();
        if (k === "price" && Number.isNaN(r[k])) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
        refreshTabs();
      });
    });
    box.querySelector("[data-photo]").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const ph = await makePhotos(file);
      const path = A.resultPhotoPath(r.id);
      S.photos.results[path] = ph.big.base64;
      S.previews[path] = ph.big.url;
      r.photo = path;
      renderPanel(); refreshTabs();
    });
  });
  p.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      if (!confirm("この実績を消します。よろしいですか？")) return;
      S.work.results.results.splice(Number(b.dataset.del), 1);
      renderPanel(); refreshTabs();
    };
  });
}

// ---------- 保存 ----------
function saveArea(t) {
  if (t === "shop" && S.edit) return "";
  const last = S.last[t];
  return `<div class="admin-save">
<div id="adm-preview" aria-live="polite"></div>
<button type="button" class="btn btn-form btn-block" data-save="${t}">${esc(A.ADMIN_KIND_NAMES[t])}を保存する</button>
<button type="button" class="btn btn-ghost btn-block admin-small" data-act="reload" style="margin-top:8px">保存しないで元に戻す（読み直す）</button>
${last ? resultBox(t, last) : ""}
</div>`;
}
function resultBox(t, last) {
  return `<div class="done admin-done" role="status" id="adm-done">
<p style="margin:0">保存しました。1〜2分で反映されます。</p>
<p class="admin-links"><a href="${esc(last.actions_url || S.actions || "#")}" target="_blank" rel="noopener">反映の様子（GitHub）</a>　<a href="${BASE}${PUBLIC[t]}" target="_blank" rel="noopener">公開ページを開く</a></p>
<button type="button" class="btn btn-ghost btn-block" data-act="check">反映を確認</button>
<p id="adm-check" class="admin-check" aria-live="polite"></p>
</div>`;
}
function bindSave(p, t) {
  const btn = p.querySelector("[data-save]");
  if (!btn) return;
  const box = p.querySelector("#adm-preview");
  p.querySelector('[data-act="reload"]').onclick = async () => {
    if (dirty(t) && !confirm("まだ保存していない変更を捨てて、公開中の中身を読み直します。よろしいですか？")) return;
    await loadAll();
  };
  btn.onclick = () => {
    const w = S.work[t];
    const errs = A.validateData(t, w, S.base[t], t === "results" ? { itemIds: S.items.map((x) => x.id) } : {});
    if (errs.length) { box.innerHTML = `<div class="err-summary" role="alert">保存できません。直してください：<ul>${errs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`; return; }
    const photos = usedPhotos(t);
    const lines = A.diffSummary(t, S.base[t], w).concat(photos.filter((x) => !/-480\.jpg$/.test(x.path)).map((x) => "写真：" + x.path));
    if (!lines.length) { box.innerHTML = '<p class="callout">変更はありません。</p>'; return; }
    box.innerHTML = `<div class="card admin-confirm"><p><b>この内容で保存して、公開します（${lines.length}件）</b></p><ul class="admin-changes">${lines.slice(0, 60).map((l) => `<li>${esc(l)}</li>`).join("")}${lines.length > 60 ? `<li>…ほか${lines.length - 60}件</li>` : ""}</ul>
<div class="btn-row"><button type="button" class="btn btn-form btn-block" data-act="send">保存する（公開）</button><button type="button" class="btn btn-ghost btn-block" data-act="back">戻って直す</button></div></div>`;
    box.querySelector('[data-act="back"]').onclick = () => { box.innerHTML = ""; };
    const send = box.querySelector('[data-act="send"]');
    send.onclick = async () => {
      if (S.busy) return;
      S.busy = true; send.disabled = true; send.textContent = "保存しています…";
      try {
        const j = await call("admin_save", { target: t, data: w, base_sha: S.sha[t], photos });
        if (!j.ok) {
          box.innerHTML = `<div class="err-summary" role="alert">${esc(j.error || "保存できませんでした")}${j.errors ? "<ul>" + j.errors.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>" : ""}</div>`;
          return;
        }
        if (j.unchanged) { box.innerHTML = '<p class="callout">変更はありません。</p>'; return; }
        S.base[t] = j.data; S.work[t] = clone(j.data); S.sha[t] = j.sha; S.photos[t] = {};
        S.last[t] = { data: j.data, actions_url: j.actions_url, commit_url: j.commit_url };
        renderMain();
        const done = root.querySelector("#adm-done");
        if (done) done.scrollIntoView({ block: "center" });
      } catch (x) {
        if (x.message !== "relogin") box.innerHTML = '<div class="err-summary" role="alert">つながりませんでした。少し待ってもう一度「保存する」を押してください（二重には保存されません）。</div>';
      } finally {
        S.busy = false;
        if (send.isConnected) { send.disabled = false; send.textContent = "保存する（公開）"; }
      }
    };
  };
  const check = p.querySelector('[data-act="check"]');
  if (check) check.onclick = async () => {
    const out = p.querySelector("#adm-check");
    out.textContent = "確かめています…";
    try {
      const r = await fetch(BASE + A.ADMIN_FILES[t] + "?t=" + Date.now(), { cache: "no-store" });
      const live = await r.json();
      const ok = A.sameData(live, S.last[t].data);
      out.textContent = ok ? "反映されました。公開ページに出ています（古い表示のときは、ページを再読み込みしてください）。" : "まだ反映されていません" + (live.updated ? "（公開中の版：" + live.updated + "）" : "") + "。1分ほど待って、もう一度押してください。";
      out.className = "admin-check " + (ok ? "is-ok" : "is-wait");
    } catch (_) {
      out.textContent = "確かめられませんでした。少し待ってもう一度押してください。";
    }
  };
}

// ---------- はじめ ----------
if (root) {
  loadSession();
  if (S.token && CONFIG.GAS_URL) loadAll().catch((x) => { if (x.message !== "relogin") renderLogin("読み込めませんでした。もう一度ログインしてください"); });
  else renderLogin();
}
