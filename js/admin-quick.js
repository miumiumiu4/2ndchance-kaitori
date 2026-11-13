// かんたん入力（/admin/quick/）：共同代表のスマホ用の1画面。「商品を1点ふやす」と「売切れにする」だけ。
// ログイン（印は /admin/ と同じ sessionStorage の admin-session）・GAS の admin_login／admin_load／admin_save・
// 確かめ（admin-core.js の validateData）・写真の作り直し（admin-photo.js：1200px と 480px の JPEG、EXIF なし）は /admin/ と同じ。
// 送れなかったら、その操作を下書き（sessionStorage）に残して「もう一度送る」。
import { CONFIG } from "./config.js";
import * as A from "./admin-core.js";
import * as Q from "./admin-quick-core.js";
import { makePhotos } from "./admin-photo.js";

const BASE = "../../";
const KEY = "admin-session"; // /admin/ と同じ
const DRAFT = "admin-quick-draft";
const root = document.querySelector("[data-quick-root]");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (n) => (typeof n === "number" ? "¥" + n.toLocaleString("ja-JP") : "確認中");

// S：ログイン・商品表（shop・sha）・画面（add／sold）・撮った写真・入力中の文字・確かめ中の商品・結果
const S = { token: "", who: "", shop: null, sha: "", view: "add", photos: [], form: { name: "", price: "", year: "", free: false }, ask: null, done: null, msg: "", busy: false, previews: {}, memDraft: null };

function loadSession() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (s && s.token) { S.token = s.token; S.who = s.who; } } catch (_) {}
}
function saveSession() {
  try { if (S.token) sessionStorage.setItem(KEY, JSON.stringify({ token: S.token, who: S.who })); else sessionStorage.removeItem(KEY); } catch (_) {}
}
// 下書き：送る前に残し、保存できたら消す（写真が大きくて残せないときは、このタブの中だけで持つ）
function getDraft() {
  try { const d = JSON.parse(sessionStorage.getItem(DRAFT) || "null"); if (d && d.op) return d.op; } catch (_) {}
  return S.memDraft;
}
function putDraft(op) {
  S.memDraft = op;
  try { sessionStorage.setItem(DRAFT, JSON.stringify({ op, at: Date.now() })); return true; } catch (_) { return false; }
}
function dropDraft() {
  S.memDraft = null;
  try { sessionStorage.removeItem(DRAFT); } catch (_) {}
}

class Offline extends Error {}
async function call(kind, extra) {
  let j;
  try {
    const r = await fetch(CONFIG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ kind, token: S.token, ...(extra || {}) }) });
    j = await r.json();
  } catch (_) {
    throw new Offline("offline");
  }
  if (j && j.relogin) { S.token = ""; saveSession(); renderLogin(j.error); throw new Error("relogin"); }
  return j;
}

// ---------- ログイン（/admin/ と同じ受け口） ----------
function renderLogin(msg) {
  const ready = !!CONFIG.GAS_URL;
  root.innerHTML = `<section class="section quick-login" aria-labelledby="q-login-h">
<h1 id="q-login-h">かんたん入力</h1>
<p>商品を1点ふやす・売切れにする、だけの画面です。保存すると1〜2分でサイトに出ます。</p>
<form class="qform" id="q-login" novalidate>
<label class="f" for="q-who">どなたですか</label>
<select id="q-who" name="who">${A.ADMIN_ROLES.map((r) => `<option${r === S.who ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>
<label class="f" for="q-pass">パスコード</label>
<input type="password" id="q-pass" name="passcode" autocomplete="current-password" required>
<p class="err" id="q-login-err" role="alert"${msg ? "" : " hidden"}>${esc(msg || "")}</p>
<button type="submit" class="btn btn-form btn-block quick-big"${ready ? "" : " disabled"}>${ready ? "ログイン" : "準備中<small>（受け口の URL が未設定）</small>"}</button>
<p class="hint">${A.LOCK_MAX}回続けて間違えると${A.LOCK_MINUTES}分使えなくなります。ログインは${A.SESSION_HOURS}時間（「くわしい編集」と共通。このタブを閉じると切れます）。</p>
</form>
<p class="quick-switch"><a href="../">くわしい編集（管理画面）へ</a></p>
</section>`;
  const f = root.querySelector("#q-login");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ready || S.busy) return;
    const err = root.querySelector("#q-login-err");
    const btn = f.querySelector("button");
    S.busy = true; btn.disabled = true; btn.textContent = "確かめています…";
    try {
      const j = await call("admin_login", { passcode: f.passcode.value, who: f.who.value });
      if (!j.ok) { err.hidden = false; err.textContent = j.error || "ログインできませんでした"; return; }
      S.token = j.token; S.who = j.who; saveSession();
      S.busy = false;
      await loadShop();
    } catch (x) {
      if (x.message !== "relogin") { err.hidden = false; err.textContent = "つながりませんでした。電波の良い所でもう一度お試しください"; }
    } finally {
      S.busy = false; if (btn.isConnected) { btn.disabled = false; btn.textContent = "ログイン"; }
    }
  });
}

async function loadShop() {
  root.innerHTML = '<p class="muted">読み込み中…</p>';
  try {
    const j = await call("admin_load");
    if (!j.ok || !j.files || !j.files.shop) throw new Error(j.error || "読み込めませんでした");
    S.who = j.who || S.who;
    S.shop = j.files.shop.data;
    S.sha = j.files.shop.sha;
    render();
  } catch (x) {
    if (x.message === "relogin") return;
    root.innerHTML = `<div class="err-summary" role="alert">${x instanceof Offline ? "つながりませんでした。電波の良い所で「もう一度」を押してください" : esc(x.message)}</div><p><button type="button" class="btn btn-ghost btn-block quick-big" id="q-reload">もう一度</button></p>`;
    root.querySelector("#q-reload").onclick = () => loadShop();
  }
}

// ---------- 骨組み ----------
function render() {
  const draft = getDraft();
  root.innerHTML = `<div class="admin-bar quick-bar"><span>ログイン中：<b>${esc(S.who)}</b></span><span class="quick-bar-links"><a href="../" class="quick-link">くわしい編集</a><button type="button" class="btn btn-ghost admin-small" data-act="logout">ログアウト</button></span></div>
${draft && !S.busy ? `<div class="callout-warn quick-draft" role="alert" id="q-draft"><p style="margin:0 0 8px">まだ送れていない下書きがあります：${esc(Q.describeOp(draft))}</p>
<div class="btn-row"><button type="button" class="btn btn-form btn-block quick-big" data-act="retry">もう一度送る</button><button type="button" class="btn btn-ghost btn-block" data-act="drop">下書きを捨てる</button></div></div>` : ""}
<div class="tabs quick-tabs" role="tablist" aria-label="すること">
<button type="button" role="tab" id="q-tab-add" aria-selected="${S.view === "add"}" data-view="add">商品を1点ふやす</button>
<button type="button" role="tab" id="q-tab-sold" aria-selected="${S.view === "sold"}" data-view="sold">売切れにする</button>
</div>
<div id="q-panel" role="tabpanel" aria-labelledby="q-tab-${S.view}"></div>`;
  root.querySelector('[data-act="logout"]').onclick = async () => {
    try { await call("admin_logout"); } catch (_) {}
    S.token = ""; saveSession(); renderLogin("ログアウトしました");
  };
  root.querySelectorAll("[data-view]").forEach((b) => { b.onclick = () => { S.view = b.dataset.view; S.done = null; S.ask = null; S.msg = ""; render(); }; });
  const retry = root.querySelector('[data-act="retry"]');
  if (retry) retry.onclick = () => send(getDraft());
  const drop = root.querySelector('[data-act="drop"]');
  if (drop) drop.onclick = () => { if (confirm("送れていない下書きを捨てます。よろしいですか？")) { dropDraft(); render(); } };
  const p = root.querySelector("#q-panel");
  if (S.view === "add") { p.innerHTML = addPanel(); bindAdd(p); } else { p.innerHTML = soldPanel(); bindSold(p); }
}

// ---------- 商品を1点ふやす ----------
function addPanel() {
  if (S.done && S.done.type === "add") {
    const d = S.done;
    return `<section class="section" aria-labelledby="q-done-h">
<div class="done quick-done" role="status" id="q-done"><p id="q-done-h" style="margin:0">保存しました。1〜2分で反映されます。</p>
<p class="quick-done-name">${esc(d.name)}　${esc(yen(d.price))}</p>
<p style="margin:0"><a href="${BASE}shop/${esc(d.id)}/" target="_blank" rel="noopener" id="q-done-link">商品ページを開く</a>（1〜2分たってから）</p></div>
<div class="btn-row"><button type="button" class="btn btn-form btn-block quick-big" data-act="again">続けてもう1点</button><button type="button" class="btn btn-ghost btn-block" data-act="to-sold">売切れにする画面へ</button></div>
</section>`;
  }
  const F = S.form;
  return `<section class="section" aria-labelledby="q-add-h">
<h1 id="q-add-h" class="quick-h">商品を1点ふやす</h1>
<form class="qform quick-form" id="q-add" novalidate>
<div class="quick-photos" id="q-photos">${photosHtml()}</div>
<p class="hint">写真は1〜3枚。値札・人の顔・住所が写らないように。この画面で小さくして、位置情報などの記録は消してから送ります。</p>
<label class="f" for="q-price">金額（税込・円）<span class="req">必須</span></label>
<input type="text" id="q-price" name="price" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(F.price)}" placeholder="例：12000">
<label class="f" for="q-name">商品名<span class="req">必須</span></label>
<input type="text" id="q-name" name="name" maxlength="80" autocomplete="off" value="${esc(F.name)}" placeholder="例：冷蔵庫 2ドア">
<div class="quick-chips" aria-label="商品名の候補（押すと入ります）">${Q.QUICK_NAMES.map((q) => `<button type="button" class="quick-chip" data-name="${esc(q.name)}">${esc(q.name)}</button>`).join("")}</div>
<label class="f" for="q-year">年式（西暦）<span class="opt">任意</span></label>
<input type="text" id="q-year" name="year" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${esc(F.year)}" placeholder="例：2021" style="max-width:9em">
<label class="choice quick-free" for="q-free"><input type="checkbox" id="q-free" name="free_shipping"${F.free ? " checked" : ""}><div><b>送料無料にする</b><span>店から50km以内</span></div></label>
<div class="err-summary" id="q-errs" role="alert" hidden></div>
<button type="submit" class="btn btn-form btn-block quick-big quick-save"${S.busy ? " disabled" : ""}>${S.busy ? "保存しています…" : "保存して公開"}</button>
<p class="hint">押すと、すぐサイトに出ます（1〜2分）。値段や説明をくわしく直すときは<a href="../">くわしい編集</a>で。</p>
</form>
</section>`;
}
function photosHtml() {
  const n = S.photos.length;
  const pics = S.photos.map((ph, i) => `<div class="quick-photo"><img src="${ph.thumb.url}" alt="写真${i + 1}枚目"><button type="button" class="quick-photo-del" data-del="${i}" aria-label="写真${i + 1}枚目を外す">×</button></div>`).join("");
  const more = n < Q.QUICK_MAX_PHOTOS
    ? `<label class="btn btn-form quick-camera" for="q-cam">${n ? "もう1枚撮る" : "写真を撮る"}<small>${n}／${Q.QUICK_MAX_PHOTOS}枚</small></label>
<input type="file" id="q-cam" class="visually-hidden" accept="image/*" capture="environment">
<label class="btn btn-ghost quick-album" for="q-album">アルバムから選ぶ</label>
<input type="file" id="q-album" class="visually-hidden" accept="image/*" multiple>`
    : `<p class="hint" style="margin:0">写真は${Q.QUICK_MAX_PHOTOS}枚まで（外すと撮り直せます）</p>`;
  return `${pics ? `<div class="quick-photo-list">${pics}</div>` : ""}${more}<p class="quick-photo-status" id="q-photo-status" aria-live="polite"></p>`;
}
function keepForm(f) {
  if (!f) return;
  S.form = { name: f.elements.name.value, price: f.elements.price.value, year: f.elements.year.value, free: f.elements.free_shipping.checked };
}
function bindPhotos(f) {
  const box = f.querySelector("#q-photos");
  const add = async (e) => {
    const files = Array.from((e.target.files) || []).slice(0, Q.QUICK_MAX_PHOTOS - S.photos.length);
    if (!files.length) return;
    box.querySelector("#q-photo-status").textContent = "写真を整えています…";
    let bad = 0;
    for (const file of files) {
      try { S.photos.push(await makePhotos(file)); } catch (_) { bad++; }
    }
    box.innerHTML = photosHtml();
    bindPhotos(f);
    if (bad) box.querySelector("#q-photo-status").textContent = "読めない写真がありました（JPEG・PNG で撮り直してください）";
  };
  const cam = box.querySelector("#q-cam"), alb = box.querySelector("#q-album");
  if (cam) cam.addEventListener("change", add);
  if (alb) alb.addEventListener("change", add);
  box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => { S.photos.splice(Number(b.dataset.del), 1); box.innerHTML = photosHtml(); bindPhotos(f); }; });
}
function bindAdd(p) {
  if (S.done) {
    p.querySelector('[data-act="again"]').onclick = () => { S.done = null; render(); window.scrollTo(0, 0); };
    p.querySelector('[data-act="to-sold"]').onclick = () => { S.done = null; S.view = "sold"; render(); window.scrollTo(0, 0); };
    return;
  }
  const f = p.querySelector("#q-add");
  bindPhotos(f);
  // 直し始めたら、前の「直してください」は消す
  const clearErrors = (el) => { if (el && el.removeAttribute) el.removeAttribute("aria-invalid"); const b = f.querySelector("#q-errs"); if (b) b.hidden = true; };
  f.addEventListener("input", (e) => { keepForm(f); if (e.target.type !== "file") clearErrors(e.target); });
  f.addEventListener("change", (e) => { if (e.target.type === "file") clearErrors(null); });
  f.querySelectorAll("[data-name]").forEach((b) => {
    b.onclick = () => {
      const name = f.elements.name;
      name.value = b.dataset.name === "その他" ? "" : b.dataset.name;
      keepForm(f);
      name.focus();
    };
  });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.busy) return;
    keepForm(f);
    const errBox = f.querySelector("#q-errs");
    const r = Q.readQuickForm({ name: S.form.name, price: S.form.price, year: S.form.year, free_shipping: S.form.free, photoCount: S.photos.length });
    const mark = (el, bad) => (bad ? el.setAttribute("aria-invalid", "true") : el.removeAttribute("aria-invalid"));
    mark(f.elements.price, r.errors.some((x) => x.startsWith("金額")));
    mark(f.elements.name, r.errors.some((x) => x.startsWith("商品名")));
    mark(f.elements.year, r.errors.some((x) => x.startsWith("年式")));
    if (r.errors.length) { showErrors(errBox, r.errors); return; }
    if (getDraft()) { showErrors(errBox, ["先に、上の「まだ送れていない下書き」を送るか捨ててください"]); window.scrollTo(0, 0); return; }
    const op = Q.addOp(r.fields, S.photos.map((ph) => ({ big: ph.big.base64, thumb: ph.thumb.base64 })), S.shop, A.todayJST());
    send(op);
  });
}
function showErrors(box, errs) {
  box.hidden = false;
  box.innerHTML = "直してください：<ul>" + errs.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>";
  box.scrollIntoView({ block: "center" });
}

// ---------- 売切れにする ----------
const thumbOf = (it) => S.previews[it.id] || BASE + A.photoThumbPath((it.photos || [])[0] || "");
function soldPanel() {
  const items = (S.shop && S.shop.items) || [];
  const selling = items.filter((it) => it.status !== "sold");
  const sold = items.filter((it) => it.status === "sold");
  const ask = S.ask && items.find((x) => x.id === S.ask.id);
  return `<section class="section" aria-labelledby="q-sold-h">
<h1 id="q-sold-h" class="quick-h">売切れにする</h1>
${S.msg ? `<p class="done quick-done" role="status" id="q-msg">${esc(S.msg)}</p>` : ""}
<p class="hint">売れた商品を押してください（${selling.length}点）。</p>
<ul class="quick-grid" id="q-selling">${selling.map((it) => `<li><button type="button" class="quick-tile" data-sell="${esc(it.id)}">
<img src="${esc(thumbOf(it))}" alt="" loading="lazy"><b>${esc(it.name)}</b><span>${esc(yen(it.price))}${it.status === "reserved" ? '　<span class="admin-chip admin-chip-reserved">取り置き中</span>' : ""}</span></button></li>`).join("")}</ul>
${sold.length ? `<h2 class="quick-h2">売切れの商品（${sold.length}点）</h2>
<ul class="admin-list" id="q-sold">${sold.map((it) => `<li class="admin-row">
<img src="${esc(thumbOf(it))}" alt="" width="64" height="64" loading="lazy">
<div class="admin-row-main"><b>${esc(it.name)}</b><span class="admin-chip admin-chip-sold">売切れ</span></div>
<button type="button" class="btn btn-ghost admin-small" data-back="${esc(it.id)}">販売中に戻す</button>
</li>`).join("")}</ul>` : ""}
</section>
${ask ? `<div class="quick-sheet" role="dialog" aria-modal="true" aria-labelledby="q-ask-h" id="q-ask"><div class="wrap">
<p id="q-ask-h" class="quick-ask">「${esc(ask.name)}」を${S.ask.status === "sold" ? "売切れにしますか" : "販売中に戻しますか"}</p>
<div class="err-summary" id="q-ask-err" role="alert" hidden></div>
<div class="btn-row"><button type="button" class="btn btn-form btn-block quick-big" data-act="yes"${S.busy ? " disabled" : ""}>${S.busy ? "保存しています…" : S.ask.status === "sold" ? "売切れにする" : "販売中に戻す"}</button>
<button type="button" class="btn btn-ghost btn-block" data-act="no">やめる</button></div>
</div></div>` : ""}`;
}
function bindSold(p) {
  p.querySelectorAll("[data-sell]").forEach((b) => { b.onclick = () => { S.ask = { id: b.dataset.sell, status: "sold" }; S.msg = ""; render(); }; });
  p.querySelectorAll("[data-back]").forEach((b) => { b.onclick = () => { S.ask = { id: b.dataset.back, status: "available" }; S.msg = ""; render(); }; });
  const yes = p.querySelector('[data-act="yes"]');
  if (!yes) return;
  p.querySelector('[data-act="no"]').onclick = () => { S.ask = null; render(); };
  yes.onclick = () => {
    if (S.busy) return;
    if (getDraft()) { const e = p.querySelector("#q-ask-err"); e.hidden = false; e.textContent = "先に、上の「まだ送れていない下書き」を送るか捨ててください"; return; }
    const it = S.shop.items.find((x) => x.id === S.ask.id);
    send(Q.statusOp(it, S.ask.status));
  };
  yes.focus();
}

// ---------- 送る（下書きを残してから。重なったら読み直して1回だけやり直す） ----------
async function saveOnce(op) {
  const ap = Q.applyQuickOp(S.shop, op);
  if (ap.errors && ap.errors.length) return { ok: false, errors: ap.errors };
  if (ap.already) return { ok: true, id: ap.id, data: S.shop, sha: S.sha };
  const j = await call("admin_save", Q.savePayload(ap, S.sha));
  if (j.ok && j.unchanged) return { ok: true, id: ap.id, data: j.data || S.shop, sha: j.sha || S.sha };
  return { ...j, id: ap.id };
}
async function send(op) {
  if (!op || S.busy) return;
  const kept = putDraft(op);
  S.busy = true;
  render();
  try {
    let j = await saveOnce(op);
    if (!j.ok && j.conflict) {
      const L = await call("admin_load");
      if (L.ok && L.files && L.files.shop) { S.shop = L.files.shop.data; S.sha = L.files.shop.sha; j = await saveOnce(op); }
    }
    S.busy = false;
    if (!j.ok) {
      // 確かめで止まった：直せば通るので、下書きは捨てて画面に理由を出す（写真と入力はそのまま）
      dropDraft();
      render();
      const box = root.querySelector(S.view === "add" ? "#q-errs" : "#q-ask-err") || root.querySelector("#q-panel");
      showErrors(box, (j.errors && j.errors.length ? j.errors : [j.error || "保存できませんでした"]));
      return;
    }
    dropDraft();
    S.shop = j.data; S.sha = j.sha;
    if (op.type === "add") {
      // 公開されるまでの1〜2分、一覧の写真は送った小さい写真で見せる
      if (op.photos[0]) S.previews[j.id] = "data:image/jpeg;base64," + op.photos[0].thumb;
      S.done = { type: "add", id: j.id, name: op.name, price: op.price };
      S.photos = []; S.form = { name: "", price: "", year: "", free: false };
      S.view = "add";
    } else {
      S.ask = null;
      S.msg = `「${op.name}」を${op.status === "sold" ? "売切れにしました" : "販売中に戻しました"}。1〜2分で反映されます。`;
    }
    render();
    const d = root.querySelector("#q-done, #q-msg");
    if (d) d.scrollIntoView({ block: "center" });
  } catch (x) {
    S.busy = false;
    if (x.message === "relogin") return; // 下書きは残る。ログインし直すと「もう一度送る」が出る
    S.ask = null;
    render();
    const bar = root.querySelector("#q-draft");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<p style="margin:0 0 6px"><b>電波が届かず、送れませんでした。</b>${kept ? "下書きを残しました。" : "下書きはこのタブを閉じると消えます。"}電波の良い所で「もう一度送る」を押してください（二重には保存されません）。</p>`);
    window.scrollTo(0, 0);
  }
}

// ---------- はじめ ----------
if (root) {
  loadSession();
  if (S.token && CONFIG.GAS_URL) loadShop();
  else renderLogin();
}
