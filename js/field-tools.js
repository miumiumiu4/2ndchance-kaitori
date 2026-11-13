// 現場の道具（/admin/tools/）の画面。計算と文面は js/field-tools-core.js。
// 店の名札（data/store.json の industry）で業種を選び、その業種の道具だけを出す。
// お客様の名前などはこの画面の中だけで使う。どこにも送らず、ブラウザにも保存しない。
import { industryOf, toolsFor, sheetTotals, sheetText, visitText, dayBeforeText, reviewText, icsEvent } from "./field-tools-core.js";
import { yen } from "./estimate-text.js";

const root = document.querySelector("[data-tools-root]");
const base = "../../";
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const field = (label, input, hint) => el("label", { class: "admin-field" }, el("span", {}, label), input, hint ? el("small", { class: "muted" }, hint) : null);
const input = (attrs) => el("input", { type: "text", ...attrs });
const today = () => {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
};

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "写しました";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    btn.textContent = "写せませんでした（文を長押しして選んでください）";
  }
}
function outBox(getText) {
  const pre = el("textarea", { class: "tools-out", rows: "10", readonly: "" });
  const btn = el("button", { type: "button", class: "btn", onclick: () => copy(pre.value, btn) }, "文を写す（LINE・メールに貼る）");
  const refresh = () => (pre.value = getText());
  return { box: el("div", { class: "tools-outbox" }, pre, btn), refresh };
}

function estimateTool(ctx) {
  const lines = [];
  const list = el("div", { class: "tools-lines" });
  const totalEl = el("p", { class: "price-tag" });
  const customer = input({ placeholder: "例：山田" });
  const travel = input({ inputmode: "numeric", placeholder: "0" });
  const buyback = input({ inputmode: "numeric", placeholder: "0" });
  const terms = el("textarea", { rows: "6" });
  terms.value = (ctx.ind.terms || []).join("\n");
  const cancel = input({ value: ctx.ind.cancel || "" });
  const out = outBox(() => sheetText({ storeName: ctx.storeName, customer: customer.value.trim(), date: today(), totals: totals(), terms: terms.value.split("\n").map((s) => s.trim()), cancel: cancel.value.trim() }));
  const totals = () => sheetTotals({ lines: lines.map((l) => ({ name: l.name.value, qty: l.qty.value, unit: l.unit.value })), travel: travel.value, buyback: buyback.value });
  const update = () => {
    const t = totals();
    totalEl.textContent = "合計（税込） " + (t.total < 0 ? "お受け取り " : "") + yen(t.total);
    out.refresh();
  };
  const addLine = (name = "", qty = "1", unit = "") => {
    const l = { name: input({ value: name, placeholder: "品目・作業（例：軽トラ1台分）" }), qty: input({ value: qty, inputmode: "numeric", class: "tools-qty" }), unit: input({ value: unit, inputmode: "numeric", placeholder: "単価（円）" }) };
    const row = el("div", { class: "tools-line" }, l.name, l.qty, l.unit, el("button", { type: "button", class: "btn btn-ghost", "aria-label": "この行を消す", onclick: () => { lines.splice(lines.indexOf(l), 1); row.remove(); update(); } }, "×"));
    lines.push(l);
    list.append(row);
    update();
  };
  const sec = el("div", { oninput: update },
    field("お客様のお名前（文面にだけ使い、保存しません）", customer),
    el("p", { class: "muted" }, "内訳（品目・作業 ／ 数 ／ 単価）"),
    list,
    el("button", { type: "button", class: "btn btn-ghost", onclick: () => addLine() }, "＋ 行を足す"),
    field("出張費（円）", travel),
    ctx.ind.kobutsu ? field("買取の差し引き（円）", buyback, "買い取れる物の金額。合計から引きます") : null,
    totalEl,
    field("決まり（1行に1つ。直してかまいません）", terms, "追加料金の決まりを先に見せると、比べられたときに強くなります"),
    field("キャンセルの決まり", cancel),
    out.box
  );
  addLine();
  return sec;
}

function visitTool(ctx) {
  const customer = input({ placeholder: "例：山田" });
  const date = el("input", { type: "date", value: today() });
  const time = el("input", { type: "time", value: "10:00" });
  const minutes = input({ value: "60", inputmode: "numeric" });
  const bring = input({ value: ctx.ind.kobutsu ? "本人確認書類（運転免許証など）" : "", placeholder: "例：本人確認書類" });
  const args = () => ({ storeName: ctx.storeName, customer: customer.value.trim(), date: date.value, time: time.value, minutes: Number(minutes.value) || 60, tel: ctx.tel, bring: bring.value.split(/[、,]/).map((s) => s.trim()).filter(Boolean) });
  const a = outBox(() => visitText(args()));
  const b = outBox(() => dayBeforeText(args()));
  const ics = el("button", { type: "button", class: "btn btn-ghost", onclick: () => {
    const text = icsEvent({ title: "訪問（" + ctx.ind.label + "）", date: date.value, time: time.value, minutes: Number(minutes.value) || 60, note: "前日の知らせを送る" });
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
    const link = el("a", { href: url, download: "visit-" + date.value + ".ics" });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } }, "店の予定表に入れる（前日に知らせが鳴る）");
  a.refresh();
  b.refresh();
  return el("div", { oninput: () => { a.refresh(); b.refresh(); } },
    field("お客様のお名前（文面にだけ使い、保存しません）", customer),
    field("日にち", date), field("時刻", time), field("かかる時間（分）", minutes),
    field("ご用意いただく物（、で区切る）", bring),
    el("h3", {}, "確定の連絡"), a.box,
    el("h3", {}, "前日の知らせ"), b.box,
    ics, el("p", { class: "muted" }, "予定表にはお客様の名前を入れません。")
  );
}

function reviewTool(ctx) {
  const customer = input({ placeholder: "例：山田" });
  const url = input({ value: ctx.reviewUrl, placeholder: "Googleの口コミを書くページのURL" });
  const o = outBox(() => reviewText({ storeName: ctx.storeName, customer: customer.value.trim(), url: url.value.trim() }));
  o.refresh();
  return el("div", { oninput: o.refresh },
    field("お客様のお名前（文面にだけ使い、保存しません）", customer), field("口コミのページ", url, "店の名札（data/store.json）の review_url に入れておくと、毎回入ります"),
    o.box, el("p", { class: "muted" }, "お礼の品や値引きと引き換えに口コミを頼むのはやめましょう（Googleの決まりと、広告の決まり）。"));
}

const BUILDERS = { estimate: estimateTool, visit: visitTool, review: reviewTool };

async function main() {
  const [store, industries] = await Promise.all([fetch(base + "data/store.json", { cache: "no-cache" }).then((r) => r.json()), fetch(base + "data/industries.json", { cache: "no-cache" }).then((r) => r.json())]);
  const ind = industryOf(store.industry, industries);
  const ctx = { ind, storeName: store.name || "", tel: store.tel || "", reviewUrl: store.review_url || "" };
  root.textContent = "";
  root.append(el("p", { class: "muted" }, `業種：${ind.label}。お客様とのやりとりで使う文面を作ります。この画面は何も送らず、何も保存しません。`));
  for (const t of toolsFor(ind.key, industries)) {
    const box = el("details", { class: "card tools-card" }, el("summary", {}, el("strong", {}, t.name), el("small", { class: "muted" }, "　" + t.why + (t.ready ? "" : "（準備中）"))));
    if (t.ready && BUILDERS[t.id]) box.append(BUILDERS[t.id](ctx));
    else box.append(el("p", { class: "muted" }, "準備中です。"));
    root.append(box);
  }
}
main().catch(() => { root.textContent = "読み込めませんでした。電波のよい所で、もう一度開いてください。"; });
