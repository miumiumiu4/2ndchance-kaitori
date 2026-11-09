#!/usr/bin/env node
// 組み立て：config と data/*.json を各ページの <!--build:名前--> 〜 <!--/build:名前--> に差し込み、
// sitemap.xml・robots.txt・llms.txt・gas/QuoteCore.gs・gas/Prices.gs を生成する。
//   node tools/build.mjs           … リポジトリの中をその場で更新（config.js の値だけを使う）
//   node tools/build.mjs --check   … 書き換えずに、生成物が最新かだけを確かめる（古ければ終了コード 1）
//   node tools/build.mjs --out _site … 公開用の写しを作る。環境変数 CFG_* の値をこの写しにだけ差し込む
//   --today=YYYY-MM-DD                … ブログの「今日」を差し替える（テスト用。既定は日本時間の今日）
//   --posts <dir>                     … 記事の倉庫を差し替える（テスト用。既定は content/posts）
// ブログ（content/posts → blog/）は日付で中身が変わるので、blog/ はコミットせず（.gitignore）毎回作る。
// トップ・sitemap.xml・llms.txt の記事の部分は <!--live-->〜<!--/live--> で囲み、--check はそこを比べない。
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mdToHtml } from "./md.mjs";
import { loadPosts, publishedPosts, todayJST, isValidDate } from "./blog.mjs";
import { airconItem, airconLink } from "./aircon.mjs";

// CSS の版番号（中身のハッシュ先頭8桁）。更新のたびに変わり、ブラウザが古い CSS を使い続けない。
const CSS_VER = createHash("sha256").update(fs.readFileSync(new URL("../css/site.css", import.meta.url))).digest("hex").slice(0, 8);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? path.resolve(ROOT, args[outIdx + 1] || "_site") : null;
const argVal = (name) => {
  const eq = args.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const TODAY = argVal("--today") || todayJST();
if (!isValidDate(TODAY)) { console.error("--today は YYYY-MM-DD（今は「" + TODAY + "」）"); process.exit(2); }
const POSTS_DIR = path.resolve(ROOT, argVal("--posts") || "content/posts");

const { CONFIG: BASE_CONFIG } = await import(pathToFileURL(path.join(ROOT, "js/config.js")).href);
const QC = await import(pathToFileURL(path.join(ROOT, "js/quote-core.js")).href);
const SC = await import(pathToFileURL(path.join(ROOT, "js/shop-core.js")).href);

// 公開用の写しにだけ、環境変数（GitHub の Actions Variables）で値を差し込む
const OVERRIDABLE = ["SITE_URL", "LINE_URL", "TEL", "GAS_URL", "HOURS", "OPENING_HOURS_SPEC", "OPENING_NOTE", "AIRCON_REF_PARAM", "AIRCON_REF_CODE", "MAIL_PERK_TEXT"];
const CONFIG = { ...BASE_CONFIG };
if (OUT) {
  for (const k of OVERRIDABLE) {
    const v = process.env["CFG_" + k];
    if (v !== undefined && v !== "") CONFIG[k] = v;
  }
}
if (CONFIG.SITE_URL && !CONFIG.SITE_URL.endsWith("/")) CONFIG.SITE_URL += "/";

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const PRICES = readJSON("data/prices.json");
const ITEMS = readJSON("data/items.json");
const AREAS = readJSON("data/areas.json");
const FAQ = readJSON("data/faq.json");
const RESULTS = readJSON("data/results.json");
const SHOP = readJSON("data/shop.json");
const POSTS = publishedPosts(loadPosts(POSTS_DIR, ROOT), TODAY);

// 特典（prices.perks）の1文。JSON-LD・llms.txt の説明に使う
function perksSentence() {
  const pk = PRICES.perks || {};
  const out = [];
  if (pk.quo_card && pk.quo_card.desc) out.push(pk.quo_card.desc);
  if (pk.same_day_up && pk.same_day_up.desc) out.push(pk.same_day_up.desc);
  return out.join("");
}

// ページ表（設計書 4-1 の6ページ＋個人情報）
const PAGES = [
  { file: "index.html", path: "", nav: "トップ", title: "出張買取・不用品回収・片付け", desc: "熊本県合志市のリサイクル店。冷蔵庫・洗濯機・家具の出張買取と、不用品回収・片付け・遺品整理。", form: "kaitori/#form-a", services: ["buyback", "collection", "cleanup"] },
  { file: "kaitori/index.html", path: "kaitori/", nav: "買取", title: "出張買取（生活家電・家具）", desc: "冷蔵庫・洗濯機・電子レンジ・ガスコンロ・ソファ・ダイニングテーブル・食器棚・カーペット・カーテンの出張買取。合志市から30km圏。", form: "kaitori/#form-a", services: ["buyback"] },
  { file: "kataduke/index.html", path: "kataduke/", nav: "不用品回収・片付け", title: "不用品回収・片付け", desc: "量の4区分と間取り別の目安で、不用品回収と片付けの概算が出せます。買い取れる物は差し引きます。", form: "kataduke/#form-b", services: ["collection", "cleanup"] },
  { file: "seiri/index.html", path: "seiri/", nav: "遺品整理など", title: "遺品整理・生前整理・ゴミ屋敷・空き家片付け", desc: "遺品整理・生前整理・ゴミ屋敷片付け・空き家片付け。買取できる物は費用から差し引きます。", form: "kataduke/#form-c", services: ["ihin", "seizen", "gomiyashiki", "akiya"] },
  { file: "flow/index.html", path: "flow/", nav: "流れ・FAQ", title: "買取の流れ・必要なもの・よくある質問", desc: "申込から訪問査定までの3ステップ、本人確認書類、お金の受け取り方、よくある質問。", form: "kaitori/#form-a", services: ["buyback"], faq: true },
  { file: "shop/index.html", path: "shop/", nav: "販売中の商品", title: "販売中の商品", desc: "店頭で販売中の家電・家具・インテリア。店頭受け取りか配送（郵便番号で配送料の目安）。お支払いは受け取り時に現金・クレジットカード・PayPay。", form: "shop/#order", services: [], shop: true },
  { file: "price/index.html", path: "price/", nav: "料金・実績", title: "料金目安・買取実績", desc: "不用品回収・片付けの料金目安、買取の上限目安、買取実績。", form: "kaitori/#form-a", services: ["buyback", "collection", "cleanup"], catalog: true },
  { file: "privacy/index.html", path: "privacy/", nav: null, title: "個人情報の取扱い", desc: "個人情報の取扱いについて。", form: "kaitori/#form-a", services: [] }
];

const SERVICES = {
  buyback: { name: "出張買取（生活家電・家具）", type: "買取", desc: "冷蔵庫・洗濯機・電子レンジ・ガスコンロ・ソファ・ダイニングテーブル・食器棚・カーペット・カーテンなどを訪問して査定し、買い取ります。家電の年式の目安は5年以内。" + perksSentence(), page: "kaitori/" },
  collection: { name: "不用品回収", type: "不用品回収", desc: "量の区分（少量〜トラック）で回収します。買い取れる物は費用から差し引きます。", page: "kataduke/" },
  cleanup: { name: "片付け", type: "片付け", desc: "種類（遺品整理・生前整理・ゴミ屋敷・空き家）ごとの間取り別の目安で、分別・運び出し・処分・清掃までまとめて行います。倉庫の片付け・草刈りは坪数で目安を出します。", page: "kataduke/" },
  ihin: { name: "遺品整理", type: "遺品整理", desc: "ご遺族と相談しながら、残す物・譲る物・手放す物を分けて片付けます。", page: "seiri/" },
  seizen: { name: "生前整理", type: "生前整理", desc: "住み替えや将来に備えて、ご本人と一緒に持ち物を整理します。", page: "seiri/" },
  gomiyashiki: { name: "ゴミ屋敷片付け", type: "片付け", desc: "物があふれた部屋を、近所に配慮しながら片付けます。", page: "seiri/" },
  akiya: { name: "空き家片付け", type: "空き家片付け", desc: "空き家になった実家などの家財を片付けます。売却や管理の相談先への橋渡しも行います。", page: "seiri/" }
};

// ---------- 小道具 ----------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (n) => "¥" + Number(n).toLocaleString("ja-JP");
const isNum = (v) => typeof v === "number" && isFinite(v);
const PENDING = '<span class="tag-pending">準備中</span>';
const telHref = (t) => "tel:" + String(t).replace(/[^0-9+]/g, "");
const pageUrl = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : null);
function storeAddress() {
  const a = CONFIG.STORE_ADDRESS || {};
  return a.street ? (a.region || "") + (a.locality || "") + a.street : CONFIG.AREA_CENTER;
}
function centerParts() {
  const m = /^(.+?[都道府県])(.+)$/.exec(CONFIG.AREA_CENTER || "");
  return m ? { region: m[1], locality: m[2] } : { region: "", locality: CONFIG.AREA_CENTER || "" };
}

// ---------- 共通の部品 ----------
function header(page, rel) {
  const nav = PAGES.filter((p) => p.nav)
    .map((p) => `<li><a href="${rel}${p.path}"${p === page ? ' aria-current="page"' : ""}>${esc(p.nav)}</a></li>`)
    .join("");
  // お知らせ帯は LINE・電話がそろうまでだけ出す
  const note = CONFIG.OPENING_NOTE && !(CONFIG.LINE_URL && CONFIG.TEL) ? `\n<div class="notice" role="note"><div class="wrap">${esc(CONFIG.OPENING_NOTE)}</div></div>` : "";
  return `<header class="site-header"><div class="wrap">
<a class="brand" href="${rel}">${esc(CONFIG.SITE_NAME)}<small>買取・片付け｜${esc(CONFIG.AREA_CENTER)}</small></a>
<nav class="gnav" aria-label="ページ一覧"><ul>${nav}</ul></nav>
</div></header>${note}`;
}

function lineBtn(cls) {
  return CONFIG.LINE_URL
    ? `<a class="btn btn-line ${cls}" href="${esc(CONFIG.LINE_URL)}" target="_blank" rel="noopener">LINEで相談</a>`
    : `<span class="btn btn-line is-disabled ${cls}" aria-disabled="true">LINEで相談<small>準備中</small></span>`;
}
function telBtn(cls) {
  return CONFIG.TEL
    ? `<a class="btn btn-tel ${cls}" href="${esc(telHref(CONFIG.TEL))}">電話する</a>`
    : `<span class="btn btn-tel is-disabled ${cls}" aria-disabled="true">電話する<small>準備中</small></span>`;
}

function cta(page, rel) {
  const target = page.form.startsWith(page.path) && page.path ? page.form.slice(page.path.length) : rel + page.form;
  return `<nav class="cta-bar" aria-label="お問い合わせ"><ul>
<li>${lineBtn("")}</li>
<li>${telBtn("")}</li>
<li><a class="btn btn-form" href="${target}">フォーム</a></li>
</ul></nav>`;
}

function contact(page, rel) {
  return `<div class="btn-row">
${lineBtn("btn-block")}
${telBtn("btn-block")}
<a class="btn btn-form btn-block" href="${rel}kaitori/#form-a">買取の概算フォーム</a>
</div>
<p class="muted" style="margin-top:8px">LINEは写真を送ると目安をお伝えできます（主な窓口）。電話はタップで発信します。${CONFIG.HOURS ? "営業時間：" + esc(CONFIG.HOURS) : "営業時間：" + PENDING}</p>`;
}

function footer(page, rel) {
  // フッターのリンク一覧はオーナー指示（2026-11-08）で出さない。上部ナビとフォームの導線で足りる。
  // 個人情報の取扱いへの入口はフォームの同意欄に残る。
  return `<footer class="site-footer"><div class="wrap">
<p><a href="${rel}privacy/">個人情報の取扱い</a></p>
<p>${esc(CONFIG.SITE_NAME)}｜${esc(storeAddress())}｜営業時間：${CONFIG.HOURS ? esc(CONFIG.HOURS) : "準備中"}｜電話：${CONFIG.TEL ? esc(CONFIG.TEL) : "準備中"}</p>
<p class="muted">表示している金額は目安です。最終額は訪問査定で確定します。金・貴金属の買取は準備中です。</p>
</div></footer>`;
}

// ---------- データから作る部品 ----------
// 仮の金額（prices.provisional）のあいだ、料金の近くに出す帯
const PROVISIONAL_LABEL = "仮の目安（調整中）";
function provisionalBand() {
  if (!PRICES.provisional) return "";
  return `<div class="provisional-band" role="note"><b>${PROVISIONAL_LABEL}</b><span>${esc(PRICES.provisional_note || "現在の金額は仮の目安です。")}</span></div>`;
}
const minPrice = (list, key) => {
  const v = (list || []).map((x) => x[key]).filter(isNum);
  return v.length ? Math.min(...v) : null;
};
function priceSummary(page, rel) {
  const fromText = (v) => (isNum(v) ? yen(v) + "〜" : '<span class="consult">要相談</span>');
  const firstLayout = allLayoutRows().filter((r) => isNum(r.price_from)).sort((a, b) => a.price_from - b.price_from)[0];
  const maxBuy = (PRICES.buyback_items || []).filter((b) => isNum(b.max_price)).sort((a, b) => b.max_price - a.max_price)[0];
  return `${provisionalBand()}<ul class="price-summary">
<li><span>不用品回収（量の区分）</span><b>${fromText(minPrice(PRICES.collection_tiers, "price_from"))}</b></li>
<li><span>片付け（間取り別${firstLayout ? "・" + esc(QC.CLEANUP_KINDS[firstLayout.kind]) + " " + esc(firstLayout.layout) + "の場合" : ""}）</span><b>${fromText(firstLayout ? firstLayout.price_from : null)}</b></li>
<li><span>買取の上限目安（例：${maxBuy ? esc(maxBuy.name) : "冷蔵庫"}）</span><b>${maxBuy ? "最大 " + yen(maxBuy.max_price) : '<span class="consult">要相談</span>'}</b></li>
</ul>
${perksBox()}
<p class="callout">金額はすべて目安です。最終額は訪問査定で確定します。</p>`;
}
// 種類ごとの間取り表をひとつの並びに（kind を付ける）
const LAYOUT_KINDS = () => Object.keys(PRICES.cleanup_by_kind || {});
function allLayoutRows() {
  return LAYOUT_KINDS().flatMap((k) => (PRICES.cleanup_by_kind[k] || []).map((r) => ({ ...r, kind: k })));
}
// 特典の箱（料金ページ・トップ・買取ページ）
function perksBox() {
  const pk = PRICES.perks || {};
  const li = [];
  if (pk.quo_card) li.push(`<li><b>${esc(pk.quo_card.name)}</b><br>${esc(pk.quo_card.desc)}</li>`);
  if (pk.same_day_up) li.push(`<li><b>${esc(pk.same_day_up.name)}</b><br>${esc(pk.same_day_up.desc)}</li>`);
  return li.length ? `<div class="perks"><p class="perks-h">買取の特典</p><ul class="check">${li.join("")}</ul></div>` : "";
}
const buybackDef = (id) => (PRICES.buyback_items || []).find((b) => b.id === id) || {};
const yearText = (d) => (isNum(d.year_limit) ? `製造からおおむね${d.year_limit}年以内` : "年式の目安は確認中");
const maxText = (d) => (isNum(d.max_price) ? `最大 ${yen(d.max_price)}` : '<span class="consult">要相談</span>');
const rangeText = (d) => (isNum(d.max_price) ? (isNum(d.min_price) ? `${yen(d.min_price)}〜${yen(d.max_price)}` : `最大 ${yen(d.max_price)}`) : '<span class="consult">要相談</span>');
const fromYen = (v) => (isNum(v) ? yen(v) + "〜" : '<span class="consult">要相談</span>');
const optText = (o) => {
  if (!isNum(o.price)) return '<span class="consult">要相談</span>';
  const base = o.price === 0 ? "無料" : yen(o.price) + "／" + esc(o.unit);
  const c = o.price_by_form && Object.prototype.hasOwnProperty.call(o.price_by_form, "C") ? o.price_by_form.C : undefined;
  if (c === undefined || c === o.price) return base;
  return `不用品回収 ${base}／片付け ${isNum(c) ? (c === 0 ? "無料" : yen(c) + "／" + esc(o.unit)) : "要相談"}`;
};

function itemsTiles(page, rel) {
  return `<ul class="grid-items" style="list-style:none;padding:0;margin:0">${ITEMS.items
    .map((it) => `<li class="item-tile"><img src="${rel}assets/icons/${esc(it.icon)}" alt="" width="52" height="52">${esc(it.name)}</li>`)
    .join("")}</ul>`;
}

function itemsDetail(page, rel) {
  const cards = ITEMS.items
    .map((it) => {
      const d = buybackDef(it.id);
      return `<li class="card item-card"><img src="${rel}assets/icons/${esc(it.icon)}" alt="" width="64" height="64"><div>
<h3>${esc(it.name)}</h3>
<p style="margin:0"><b>${esc(it.accept)}</b>｜${rangeText(d)}｜${esc(yearText(d))}</p>
<dl><dt>見るところ</dt><dd>${it.check.map(esc).join("、")}</dd><dt>減額になりやすいこと</dt><dd>${it.reduce.map(esc).join("、")}</dd></dl>
</div></li>`;
    })
    .join("\n");
  const ng = ITEMS.not_accepted_examples.map((s) => `<li>${esc(s)}</li>`).join("");
  return `<p><span class="tag-pending">${esc(ITEMS.status)}</span></p>
<ul class="grid" style="list-style:none;padding:0;margin:0">
${cards}
</ul>
<h3 style="margin-top:18px">買取できない物の例</h3>
<ul class="plain">${ng}</ul>
<p class="muted">${esc(ITEMS.gold_note)}</p>`;
}

function areas(page, rel) {
  const list = AREAS.areas
    .map((a) => `<li>${esc(a.name)}${a.needs_confirm ? '<span class="tag-confirm">要確認</span>' : ""}</li>`)
    .join("");
  return `<p><b>${esc(AREAS.center)}から${AREAS.radius_km}km圏</b>に伺います。<b>${esc(AREAS.fee_note)}</b></p>
<ul class="areas">${list}</ul>
<p class="muted">「要確認」は地区によって圏外になる場合があります。お申し込みのときに確認します。宅配買取は行っていません。</p>`;
}

function faqList() {
  return FAQ.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><div>${esc(f.a)}</div></details>`).join("\n");
}

function priceTables(page, rel) {
  const tiers = PRICES.collection_tiers
    .map((t) => `<tr><td><img src="${rel}assets/icons/truck-${esc(t.id)}.svg" alt="" width="40" height="40" style="vertical-align:middle;margin-right:6px">${esc(QC.tierName(t))}<br><small class="muted">${esc(t.note || "")}</small></td><td class="num">${fromYen(t.price_from)}</td></tr>`)
    .join("");
  const kinds = LAYOUT_KINDS();
  const first = PRICES.cleanup_by_kind[kinds[0]] || [];
  const layouts = first
    .map((r0) => `<tr><td>${esc(r0.layout)}<br><small class="muted">${esc(QC.hoursText(r0.hours) || "確認中")}</small></td>${kinds
      .map((k) => { const r = (PRICES.cleanup_by_kind[k] || []).find((x) => x.layout === r0.layout) || {}; return `<td class="num">${fromYen(r.price_from)}</td>`; })
      .join("")}</tr>`)
    .join("");
  const others = (PRICES.other_cleanup || [])
    .map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${isNum(o.price_from) ? esc(o.per_tsubo + "坪あたり ") + yen(o.price_from) + "〜" : '<span class="consult">要相談</span>'}</td></tr>`)
    .join("");
  const items = PRICES.buyback_items
    .map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(yearText(b))}</td><td class="num">${rangeText(b)}</td></tr>`)
    .join("");
  const options = PRICES.options
    .map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${optText(o)}</td></tr>`)
    .join("");
  const delivery = (PRICES.delivery_tiers || [])
    .map((d) => `<tr><td>${esc(d.label)}</td><td class="num">${isNum(d.fee) ? (d.fee === 0 ? "無料" : yen(d.fee)) : '<span class="consult">要相談</span>'}</td></tr>`)
    .join("");
  const inc = PRICES.cleanup_includes.map((s) => `<li>${esc(s)}</li>`).join("");
  return `${provisionalBand()}<p class="callout"><b>${esc(PRICES.disclaimer)}</b><br>価格表の更新日：${PRICES.updated ? esc(PRICES.updated) + (PRICES.provisional ? "（仮の金額）" : "") : "未定（金額は共同代表の確認待ち）"}／税：${PRICES.tax === "included" ? "税込" : esc(PRICES.tax)}</p>
<h3 id="collection">不用品回収（量の区分）</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">区分</th><th scope="col">料金の目安</th></tr></thead><tbody>${tiers}</tbody></table></div>
<h3 id="cleanup" style="margin-top:18px">片付け（種類・間取り別）</h3>
<div class="table-wrap"><table class="price price-kinds"><thead><tr><th scope="col">間取り<br><small>作業時間</small></th>${kinds.map((k) => `<th scope="col">${esc(QC.CLEANUP_KINDS[k])}</th>`).join("")}</tr></thead><tbody>${layouts}</tbody></table></div>
<p class="muted">「要相談」は金額を確認中です（生前整理は 1R・1K だけ決まっています）。表が横に長いときは横にずらして見られます。</p>
<p style="margin-top:10px"><b>料金に含まれるもの</b></p>
<ul class="check">${inc}</ul>
<h3 id="other-cleanup" style="margin-top:18px">その他の片付け（坪数）</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">内容</th><th scope="col">料金の目安</th></tr></thead><tbody>${others}</tbody></table></div>
<p class="muted">坪数は10坪単位で切り上げて計算します（例：25坪 → 30坪分）。</p>
<h3 id="options">オプション</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">内容</th><th scope="col">料金</th></tr></thead><tbody>${options}</tbody></table></div>
<p class="muted">大きな家具の2階からの運び出しは無料です。供養（お焚き上げ等）・ハウスクリーニング（提携先・準備中）・不動産のご相談は、担当者から別途ご案内します。</p>
<h3 id="buyback" style="margin-top:18px">買取の目安</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">品目</th><th scope="col">年式の目安</th><th scope="col">買取の目安</th></tr></thead><tbody>${items}</tbody></table></div>
<p class="muted">状態による目安${PRICES.provisional ? "（仮）" : ""}：良い＝${Math.round((PRICES.condition_factor.good || 0) * 100)}%／普通＝${Math.round((PRICES.condition_factor.normal || 0) * 100)}%／難あり＝${Math.round((PRICES.condition_factor.damaged || 0) * 100)}%（上限に対して。確認中）。他で値段がつかない物でも、年式の目安以内なら左の最低額はお付けします。年式の目安を超えた家電は回収扱いです。</p>
<h3 id="perks" style="margin-top:18px">買取の特典</h3>
${perksBox()}
<h3 id="delivery" style="margin-top:18px">購入商品の配送料（店からの距離）</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">店からの距離</th><th scope="col">配送料</th></tr></thead><tbody>${delivery}</tbody></table></div>
<p class="muted">距離は道のりの目安です。送料無料の商品は50km以内なら無料です。郵便番号を入れると<a href="${rel}shop/#order">販売ページの注文フォーム</a>で目安が出ます。</p>`;
}

function resultsCards(page, rel, limit) {
  const list = (RESULTS.results || []).slice(0, limit || undefined);
  if (!list.length) return `<p class="empty">買取実績は準備中です。<br>写真と金額がそろいしだい掲載します。</p>`;
  return `<ul class="grid grid-3" style="list-style:none;padding:0;margin:0">${list
    .map((r) => {
      const it = ITEMS.items.find((i) => i.id === r.item_id);
      const img = r.photo ? `<img src="${rel}${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy">` : it ? `<img src="${rel}assets/icons/${esc(it.icon)}" alt="" width="64" height="64">` : "";
      return `<li class="card result-card">${img}<h3>${esc(r.name)}</h3><p class="price-tag">${isNum(r.price) ? yen(r.price) : "—"}</p><p class="muted">${esc(r.date || "")}　${esc(r.area || "")}</p>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</li>`;
    })
    .join("")}</ul>
<p class="muted">買取実績は過去の例です。同じ品物でも状態や時期で金額は変わります。</p>`;
}

// ---------- 販売ページ ----------
// JPEG の幅と高さ（img の width・height に入れて、読み込み中のずれを防ぐ）
function jpegSize(rel) {
  try {
    const b = fs.readFileSync(path.join(ROOT, rel));
    let i = 2;
    while (i < b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch (_) {}
  return null;
}
const thumbOf = (p) => p.replace(/\.jpg$/, "-480.jpg");
const shopItemPath = (it) => `shop/${it.id}/`;
function imgTag(src, rel, alt, extra = "") {
  const sz = jpegSize(src);
  return `<img src="${rel}${esc(src)}" alt="${esc(alt)}"${sz ? ` width="${sz.w}" height="${sz.h}"` : ""}${extra}>`;
}
function shopPriceHTML(it) {
  const p = SC.shopPrice(it);
  if (p.undetermined) return '<span class="consult">価格は確認中</span>';
  return p.sale ? `<s class="muted">${yen(p.list)}</s> ${yen(p.price)}<small>（${Math.round(p.sale * 100)}% OFF・税込）</small>` : `${yen(p.price)}<small>（税込）</small>`;
}
function shopMeta(it) {
  return [it.condition, isNum(it.year) ? it.year + "年" : "", it.size, it.free_shipping ? "送料無料（50km以内）" : ""].filter(Boolean).map(esc).join("・");
}
function shopList(page, rel) {
  return `<ul class="shop-grid" style="list-style:none;padding:0;margin:0">${SHOP.items
    .map((it) => {
      const st = it.status !== "available" ? `<span class="shop-band shop-band-${esc(it.status)}">${esc(SC.SHOP_STATUS[it.status] || it.status)}</span>` : "";
      return `<li class="card shop-card${it.status === "sold" ? " is-sold" : ""}"><a class="shop-img" href="${rel}${shopItemPath(it)}">${imgTag(thumbOf(it.photos[0]), rel, it.name, ' loading="lazy"')}${st}</a>
<h3><a href="${rel}${shopItemPath(it)}">${esc(it.name)}</a></h3>
<p class="price-tag">${shopPriceHTML(it)}</p>
<p class="muted">${shopMeta(it)}</p></li>`;
    })
    .join("\n")}</ul>`;
}
function shopNote() {
  return `<p class="callout">${esc(SHOP.payment_note)}<br>${esc(SHOP.hold_note)}価格は税込です。配送料は<a href="#order">注文フォーム</a>で郵便番号から目安が出ます（<a href="../price/#delivery">配送料の表</a>）。</p>`;
}
function shopExtras(page, rel) {
  return `<ul class="grid" style="list-style:none;padding:0;margin:0">${(SHOP.extras || [])
    .map((x) => `<li class="card result-card">${imgTag(thumbOf(x.photo), rel, x.title, ' loading="lazy"')}<h3>${esc(x.title)}</h3><p>${esc(x.note)}</p></li>`)
    .join("")}</ul>`;
}
function productLd(it) {
  const p = SC.shopPrice(it);
  const avail = { available: "https://schema.org/InStock", reserved: "https://schema.org/LimitedAvailability", sold: "https://schema.org/SoldOut" }[it.status];
  const offer = { "@type": "Offer", priceCurrency: "JPY", availability: avail, itemCondition: it.condition === "新品" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition", seller: { "@id": (CONFIG.SITE_URL || "") + "#business" } };
  if (!p.undetermined) offer.price = p.price;
  else offer.description = "価格は確認中";
  if (pageUrl(shopItemPath(it))) offer.url = pageUrl(shopItemPath(it));
  return {
    "@type": "Product",
    name: it.name,
    category: it.category,
    ...(it.note ? { description: it.note } : {}),
    ...(CONFIG.SITE_URL ? { image: CONFIG.SITE_URL + it.photos[0] } : {}),
    offers: offer
  };
}

// ---------- JSON-LD ----------
function business() {
  const c = centerParts();
  const o = {
    "@type": "LocalBusiness",
    "@id": (CONFIG.SITE_URL || "") + "#business",
    name: CONFIG.SITE_NAME,
    description: "生活家電・家具の出張買取と、不用品回収・片付け・遺品整理のリサイクル店。",
    address: { "@type": "PostalAddress", addressRegion: (CONFIG.STORE_ADDRESS && CONFIG.STORE_ADDRESS.region) || c.region, addressLocality: (CONFIG.STORE_ADDRESS && CONFIG.STORE_ADDRESS.locality) || c.locality, ...(CONFIG.STORE_ADDRESS && CONFIG.STORE_ADDRESS.street ? { streetAddress: CONFIG.STORE_ADDRESS.street } : {}), addressCountry: "JP" },
    ...(CONFIG.STORE_LATLNG ? { geo: { "@type": "GeoCoordinates", latitude: CONFIG.STORE_LATLNG[0], longitude: CONFIG.STORE_LATLNG[1] } } : {}),
    areaServed: AREAS.areas.map((a) => ({ "@type": "City", name: a.pref + a.name }))
  };
  if (CONFIG.SITE_URL) o.url = CONFIG.SITE_URL;
  if (CONFIG.TEL) o.telephone = CONFIG.TEL;
  if (CONFIG.OPENING_HOURS_SPEC) o.openingHours = CONFIG.OPENING_HOURS_SPEC;
  if (CONFIG.LINE_URL) o.sameAs = [CONFIG.LINE_URL];
  return o;
}
function service(id) {
  const s = SERVICES[id];
  const o = {
    "@type": "Service",
    name: s.name,
    serviceType: s.type,
    description: s.desc,
    provider: { "@id": (CONFIG.SITE_URL || "") + "#business" },
    areaServed: { "@type": "GeoCircle", geoMidpoint: { "@type": "Place", name: CONFIG.AREA_CENTER }, geoRadius: AREAS.radius_km * 1000 }
  };
  if (pageUrl(s.page)) o.url = pageUrl(s.page);
  return o;
}
const PROVISIONAL_LD = () => (PRICES.provisional ? PROVISIONAL_LABEL + "。" + (PRICES.provisional_note || "") : "");
function offer(name, price, unitText, desc) {
  const o = { "@type": "Offer", itemOffered: { "@type": "Service", name } };
  if (isNum(price)) {
    o.priceSpecification = { "@type": "PriceSpecification", minPrice: price, priceCurrency: "JPY", ...(unitText ? { unitText } : {}) };
    if (PRICES.provisional) o.description = PROVISIONAL_LD();
  } else o.description = "要相談";
  if (desc) o.itemOffered.description = desc;
  return o;
}
function catalog() {
  return {
    "@type": "OfferCatalog",
    name: "料金目安（目安。最終額は訪問査定で確定）",
    description: [PROVISIONAL_LD(), perksSentence()].filter(Boolean).join(" "),
    itemListElement: [
      { "@type": "OfferCatalog", name: "不用品回収", itemListElement: PRICES.collection_tiers.map((t) => offer("不用品回収 " + QC.tierName(t), t.price_from, null, t.note)) },
      ...LAYOUT_KINDS().map((k) => ({ "@type": "OfferCatalog", name: QC.CLEANUP_KINDS[k] + "（間取り別）", itemListElement: PRICES.cleanup_by_kind[k].map((r) => offer(QC.CLEANUP_KINDS[k] + " " + r.layout, r.price_from, null, QC.hoursText(r.hours) ? "作業時間の目安 " + QC.hoursText(r.hours) : null)) })),
      { "@type": "OfferCatalog", name: "その他の片付け（坪数）", itemListElement: (PRICES.other_cleanup || []).map((o) => offer(o.name, o.price_from, o.per_tsubo + "坪あたり", o.note)) },
      { "@type": "OfferCatalog", name: "オプション", itemListElement: PRICES.options.map((o) => offer(o.name, o.price, o.unit, o.note)) },
      { "@type": "OfferCatalog", name: "購入商品の配送料", itemListElement: (PRICES.delivery_tiers || []).map((d) => offer("配送 " + d.label, d.fee, null)) }
    ]
  };
}
function jsonld(page) {
  const graph = [business()];
  page.services.forEach((id) => graph.push(service(id)));
  if (page.shop) graph.push({ "@type": "ItemList", name: "販売中の商品", itemListElement: SHOP.items.map((it, i) => ({ "@type": "ListItem", position: i + 1, ...(pageUrl(shopItemPath(it)) ? { url: pageUrl(shopItemPath(it)) } : {}), item: productLd(it) })) });
  if (page.faq) graph.push({ "@type": "FAQPage", mainEntity: FAQ.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  if (page.catalog) {
    graph.push(catalog());
    if ((RESULTS.results || []).length) {
      graph.push({ "@type": "ItemList", name: "買取実績", itemListElement: RESULTS.results.map((r, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "Product", name: r.name, category: r.category, ...(r.photo && CONFIG.SITE_URL ? { image: CONFIG.SITE_URL + r.photo } : {}), description: `買取価格 ${isNum(r.price) ? yen(r.price) : "—"}（${r.date || ""}・過去の例）` } })) });
    }
  }
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 1).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

// ---------- 差し込み ----------
const FRAGMENTS = {
  jsonld: (p) => jsonld(p),
  header: (p, rel) => header(p, rel),
  footer: (p, rel) => footer(p, rel),
  cta: (p, rel) => cta(p, rel),
  contact: (p, rel) => contact(p, rel),
  "items-tiles": (p, rel) => itemsTiles(p, rel),
  "items-detail": (p, rel) => itemsDetail(p, rel),
  areas: (p, rel) => areas(p, rel),
  faq: () => faqList(),
  prices: (p, rel) => priceTables(p, rel),
  "price-summary": (p, rel) => priceSummary(p, rel),
  perks: () => provisionalBand() + perksBox(),
  results: (p, rel) => resultsCards(p, rel),
  "results-top": (p, rel) => resultsCards(p, rel, 3),
  "shop-list": (p, rel) => shopList(p, rel),
  "shop-note": () => shopNote(),
  "shop-extras": (p, rel) => shopExtras(p, rel),
  "shop-top": (p, rel) => shopTop(rel),
  hours: () => (CONFIG.HOURS ? esc(CONFIG.HOURS) : PENDING),
  "latest-posts": (p, rel) => latestPosts(rel),
  // ありがとうエアコンへの送客（リンクは config の AIRCON_* から tools/aircon.mjs が作る）
  "aircon-item": () => airconItem(CONFIG),
  "aircon-card": () => airconItem(CONFIG, "エアコンのクリーニング・取付取外し", "ありがとうエアコンの予約（提携店のページが開きます）"),
  "aircon-link": () => airconLink(CONFIG),
  "canonical": (p) => (pageUrl(p.path) ? `<link rel="canonical" href="${esc(pageUrl(p.path))}">` : "")
};

function fill(html, page) {
  const rel = page.path ? "../".repeat(page.path.split("/").filter(Boolean).length) : "./";
  // CSS の版番号を付け直す（ブラウザの古いキャッシュ対策）
  html = html.replace(/href="([./]*)css\/site\.css(\?v=[0-9a-f]*)?"/g, `href="$1css/site.css?v=${CSS_VER}"`);
  return html.replace(/<!--build:([a-z0-9-]+)-->[\s\S]*?<!--\/build:\1-->/g, (m, name) => {
    const fn = FRAGMENTS[name];
    if (!fn) throw new Error(`${page.file}: 知らない差し込み口 ${name}`);
    return `<!--build:${name}-->\n${fn(page, rel)}\n<!--/build:${name}-->`;
  });
}

// トップの「販売中の商品」（販売中の先頭3つ）
function shopTop(rel) {
  const list = SHOP.items.filter((it) => it.status === "available").slice(0, 3);
  return `<ul class="shop-grid" style="list-style:none;padding:0;margin:0">${list
    .map((it) => `<li class="card shop-card"><a class="shop-img" href="${rel}${shopItemPath(it)}">${imgTag(thumbOf(it.photos[0]), rel, it.name, ' loading="lazy"')}</a><h3><a href="${rel}${shopItemPath(it)}">${esc(it.name)}</a></h3><p class="price-tag">${shopPriceHTML(it)}</p></li>`)
    .join("")}</ul>
<p style="margin-top:12px"><a href="${rel}shop/">販売中の商品をすべて見る</a></p>`;
}

// ---------- 生成ファイル ----------
function sitemap() {
  const loc = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : p || "./");
  const head = CONFIG.SITE_URL ? "" : "<!-- SITE_URL が未設定のため相対パス。公開URLを決めたら CFG_SITE_URL（または config.js）に入れて build する -->\n";
  const urls = PAGES.map((p) => `  <url><loc>${esc(loc(p.path))}</loc></url>`).concat(SHOP.items.map((it) => `  <url><loc>${esc(loc(shopItemPath(it)))}</loc></url>`)).join("\n");
  const blog = [`  <url><loc>${esc(loc("blog/"))}</loc></url>`]
    .concat(blogPagePaths().slice(1).map((p) => `  <url><loc>${esc(loc(p))}</loc></url>`))
    .concat(POSTS.map((p) => `  <url><loc>${esc(loc(postPath(p)))}</loc><lastmod>${p.date}</lastmod></url>`))
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${head}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n${LIVE_OPEN}\n${blog}\n${LIVE_CLOSE}\n</urlset>\n`;
}
function robots() {
  return `User-agent: *\nAllow: /\n` + (CONFIG.SITE_URL ? `\nSitemap: ${CONFIG.SITE_URL}sitemap.xml\n` : "");
}
function llms() {
  const u = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : "/" + p);
  const pages = PAGES.map((p) => `- [${p.title}](${u(p.path)}): ${p.desc}`).join("\n");
  const items = PRICES.buyback_items.map((b) => `${b.id}（${b.name}）`).join("、");
  const tiers = PRICES.collection_tiers.map((t) => `${t.id}（${QC.tierName(t)}・${t.note}）`).join("、");
  const layouts = (PRICES.cleanup_by_kind[LAYOUT_KINDS()[0]] || []).map((r) => r.layout).join("、");
  const others = (PRICES.other_cleanup || []).map((o) => `${o.id}（${o.name}・${o.per_tsubo}坪あたり ${isNum(o.price_from) ? o.price_from + "円〜" : "要相談"}）`).join("、");
  const deliv = (PRICES.delivery_tiers || []).map((d) => `${d.label}：${isNum(d.fee) ? (d.fee === 0 ? "無料" : d.fee + "円") : "要相談"}`).join("／");
  const opts = PRICES.options.map((o) => `${o.id}（${o.name}）`).concat(Object.entries(QC.CONSULT_OPTIONS).map(([k, v]) => `${k}（${v}・相談のみ）`)).join("、");
  const kinds = Object.entries(QC.CLEANUP_KINDS).map(([k, v]) => `${k}（${v}）`).join("、");
  const api = CONFIG.GAS_URL || "（準備中：URL は公開後に入ります）";
  return `# ${CONFIG.SITE_NAME}（${CONFIG.AREA_CENTER}）買取・片付け

> ${CONFIG.AREA_CENTER}のリサイクル店。生活家電・家具の出張買取（${AREAS.center}から${AREAS.radius_km}km圏・出張費と査定料は無料）と、不用品回収・片付け・遺品整理・生前整理・ゴミ屋敷片付け・空き家片付けを行う。宅配買取は行っていない。

この文書は AI エージェント向けの目次です。人が読む画面と同じ情報を、機械が読める形でも置いています。

${PRICES.provisional ? `## 金額は${PROVISIONAL_LABEL}
- ${PRICES.provisional_note || "現在の金額は仮の目安です。"}
- 価格表の更新日：${PRICES.updated || "未定"}。data/prices.json の provisional が true のあいだ、すべての金額は仮。概算 API の返り値にも provisional: true が付く。
- お客様に伝えるときは「仮の目安で、正式な金額に調整中。最終額は訪問査定で確定」と添えること。

` : ""}## ページ
${pages}

## 機械可読データ（個人情報は含まない）
- [料金目安](${u("data/prices.json")}): 不用品回収の量の区分・片付けの種類ごとの間取り別（cleanup_by_kind）・倉庫と草刈り（other_cleanup）・オプション・買取の最低額と上限目安と年式の目安・状態係数・特典（perks）・配送料（delivery_tiers）。null は「要相談」。provisional: true のあいだは仮の金額。
- [取扱品目](${u("data/items.json")}): 買取の可否、見るところ、減額になりやすいこと、買取できない物の例。
- [出張エリア](${u("data/areas.json")}): 市町村名と要確認フラグ、出張費・査定料。
- [よくある質問](${u("data/faq.json")})
- [買取実績](${u("data/results.json")}): 過去の例。最初は空。
- [販売中の商品](${u("data/shop.json")}): 店頭で販売中の商品（id・名前・税込価格 price（null は確認中）・割引 sale・状態 status・送料無料 free_shipping・写真）。
- [郵便番号の座標](${u("data/postal/index.json")}): 郵便番号（7桁）→ 緯度経度（上3桁ごとのファイル）。配送料の距離計算用。出典：日本郵便 郵便番号データ／Geolonia japanese-addresses（CC BY 4.0）。

## 記事一覧
${LIVE_OPEN}
${POSTS.length ? POSTS.map((p) => `- [${p.title}](${u(postPath(p))})（${p.date}）: ${p.summary}`).join("\n") : "- まだ記事はありません。"}
- 一覧：${u("blog/")}　RSS：${u("blog/feed.xml")}
${LIVE_CLOSE}

## 概算の式（画面・受付の再計算・下の API が同じ式を使う）
- 買取見込み（フォームA）＝ Σ（品目の上限目安 max_price × 年式係数 × 状態係数 condition_factor）× 台数。10円未満切り捨て。
  - 年式係数：目安年数以内＝1.0、超えている＝0（買取見込み 0円・回収扱い）。年式不明は 1.0 で計算し訪問時に確認。
  - 下限は 0円（査定で買い取れない場合があるため）。上限目安が null の品目があれば「要相談」。
- 不用品回収（フォームB）：お会計 ＝ 回収費用（区分の price_from ＋ オプション）− 買取見込み。幅（最小〜最大）で返す。マイナスはお客様の受け取り。
- 片付け（フォームC）：お会計 ＝ 種類ごとの間取り表 cleanup_by_kind[kind] の基本料 price_from ＋ オプション − 買取見込み。作業時間の目安 hours つき。生前整理は 1R・1K 以外が null（要相談）。
- 倉庫の片付け・草刈り（kind=souko・kusakari）：other_cleanup の「10坪あたり price_from」× 坪数 tsubo（10坪単位で切り上げ）。
- オプションの料金は price（price_by_form にフォーム別の値があればそちら。解体は片付け C では 0 円）。階段での運び出しは 0 円（無料）。
- 買取の1台あたりは最低額 min_price を下回らない（年式の目安以内のとき。下限 min はその合計）。家電の年式の目安は5年以内。
- 同日査定（same_day=1。エアコンクリーニング・ハウスクリーニングと同じ日）：買取見込みを perks.same_day_up.rate（20%）上乗せ。
- 特典：${perksSentence()}
- 価格表のどこかが null なら undetermined: true（要相談）。
- 作業時間の目安 hours は「1〜2時間」のような文字列（または数値）。
- 品目 id：${items}
- 量の区分 tier：${tiers}
- 間取り layout：${layouts}
- 片付けの種別 kind：${kinds}
- 坪数で出す片付け：${others}
- オプション options：${opts}

## 概算 API（読み取り専用）
- URL：${api}
- 概算：\`?action=quote&form=A&items=fridge:2:within:good,washer:1:over:normal\`
  - items は「品目id:台数:年式(within|over|unknown):状態(good|normal|damaged)」をカンマ区切り。
  - \`?action=quote&form=B&tier=mini&options=stairs:1&items=sofa:1:within:normal\`
  - \`?action=quote&form=C&layout=2DK・2LDK&kind=ihin&options=kuyou\`
  - \`?action=quote&form=C&kind=souko&tsubo=25\`　\`?action=quote&form=A&items=fridge:1:within:good&same_day=1\`
- 価格表：\`?action=prices\`
- 返り値は JSON（min・max・undetermined・provisional・lines・offset_note）。

## 販売中の商品（段階1：注文受付のみ）
- 一覧：${u("shop/")}　商品ごと：${u("shop/<id>/")}（JSON-LD の Product・Offer つき）
${SHOP.items.map((it) => { const p = SC.shopPrice(it); return `- ${it.id}：${it.name}／${p.undetermined ? "価格は確認中" : p.price + "円（税込）"}／${SC.SHOP_STATUS[it.status]}${it.free_shipping ? "／送料無料（50km以内）" : ""}`; }).join("\n")}
- ${SHOP.payment_note}${SHOP.hold_note}
- 注文は販売ページのフォームから（AI からの注文 API は未提供）。

## 注意
- 価格はすべて目安${PRICES.provisional ? "（現在は仮の金額）" : ""}。最終額は訪問査定で人が決める。AI がお客様に金額を約束しないこと。
- 買取では古物営業法の本人確認が必要。本人確認は訪問時に人が行う（運転免許証・マイナンバーカード等）。
- 予約は、フォームまたは LINE・電話の受付のあと、電話の折返しで日時を相談して確定する。フォーム送信だけでは確定しない。
- 買取代金の受け取りは現金が基本、高額の場合は銀行振込。お客様が支払う費用（回収・片付け・配送・商品代）は現金・クレジットカード・PayPay。
- 出張費・査定料は店から30km圏内は無料。
- 購入商品の配送料（店からの道のりの目安）：${deliv}。送料無料の商品は50km以内なら無料。
- 予約の書き込み API は段階2（未提供）。
`;
}

function coreGs(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const names = [...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, "").replace(/^/gm, "  ").replace(/^\s+$/gm, "");
  return `// 自動生成：tools/build.mjs が ${file} から作る。手で直さない（直すのは ${file}）。
var ${name} = (function () {
${body}
  return { ${names.map((n) => `${n}: ${n}`).join(", ")} };
})();
`;
}
const quoteCoreGs = () => coreGs("js/quote-core.js", "QuoteCore");
function pricesGs() {
  return `// 自動生成：tools/build.mjs が data/prices.json から作る。手で直さない。
// 価格を変えたら build → このファイルを Apps Script に反映（gas/README.md）。
var PRICES = ${JSON.stringify(PRICES, null, 2)};
`;
}

// ---------- ブログ（content/posts → blog/） ----------
const LIVE_OPEN = "<!--live-->";
const LIVE_CLOSE = "<!--/live-->";
const stripLive = (s) => s.replace(/<!--live-->[\s\S]*?<!--\/live-->/g, LIVE_OPEN + LIVE_CLOSE);
const PER_PAGE = 20;
const BLOG = { path: "blog/", nav: null, form: "kaitori/#form-a", services: [] };
const postPath = (p) => `blog/${p.slug}/`;
const pageCount = () => Math.max(1, Math.ceil(POSTS.length / PER_PAGE));
const blogPagePaths = () => Array.from({ length: pageCount() }, (_, i) => (i === 0 ? "blog/" : `blog/page/${i + 1}/`));
const relOf = (p) => "../".repeat(p.split("/").filter(Boolean).length);
const jaDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${y}年${m}月${dd}日`; };
const absOrRel = (p, rel) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : rel + p);

function org() {
  return { "@type": "Organization", "@id": (CONFIG.SITE_URL || "") + "#business", name: CONFIG.SITE_NAME, ...(CONFIG.SITE_URL ? { url: CONFIG.SITE_URL } : {}) };
}
function ldScript(graph) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 1).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
function shell({ pagePath, title, desc, graph, main, ogType, form, script, rss = true }) {
  const rel = relOf(pagePath);
  const page = { ...BLOG, path: pagePath, ...(form ? { form } : {}) };
  const canonical = pageUrl(pagePath) ? `<link rel="canonical" href="${esc(pageUrl(pagePath))}">\n` : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}｜${esc(CONFIG.SITE_NAME)}（${esc(CONFIG.AREA_CENTER)}）</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#1f5e46">
<meta property="og:type" content="${ogType || "website"}">
<meta property="og:title" content="${esc(title)}">
${canonical}<link rel="stylesheet" href="${rel}css/site.css?v=${CSS_VER}">
<link rel="icon" href="${rel}assets/icons/truck-mini.svg" type="image/svg+xml">
${rss ? `<link rel="alternate" type="application/rss+xml" title="${esc(CONFIG.SITE_NAME)} の記事" href="${rel}blog/feed.xml">\n` : ""}${ldScript(graph)}
</head>
<body>
<a class="visually-hidden" href="#main">本文へ</a>
${header(page, rel)}
<main id="main" class="wrap">
${main}
</main>
${footer(page, rel)}
${cta(page, rel)}
${script ? `<script type="module" src="${rel}${script}"></script>\n` : ""}</body>
</html>
`;
}

// 商品ごとの静的ページ（shop/<id>/index.html）。build が作り、コミットする
function shopItemPage(it) {
  const pagePath = shopItemPath(it);
  const rel = relOf(pagePath);
  const p = SC.shopPrice(it);
  const ok = SC.orderable(it);
  const rows = [["状態", SC.SHOP_STATUS[it.status] || it.status], ["価格", p.undetermined ? "確認中（お問い合わせください）" : yen(p.price) + "（税込）" + (p.sale ? `／定価 ${yen(p.list)} から ${Math.round(p.sale * 100)}% OFF` : "")], ["品物の状態", it.condition], ["年式", isNum(it.year) ? it.year + "年" : "—"], ["大きさ", it.size || "—"], ["配送", it.free_shipping ? "送料無料（店から50km以内）" : "配送料は店からの距離で決まります"]];
  const pay = it.payment_link ? `<a class="btn btn-ghost" href="${esc(it.payment_link)}" target="_blank" rel="noopener">カードで支払う（外部サイト）</a>` : "";
  const main = `<article class="section" aria-labelledby="h-item">
<p class="post-meta"><a href="${rel}shop/">販売中の商品</a></p>
<h1 id="h-item">${esc(it.name)}</h1>
<div class="shop-detail">
<div class="shop-photo">${imgTag(it.photos[0], rel, it.name)}${it.status !== "available" ? `<span class="shop-band shop-band-${esc(it.status)}">${esc(SC.SHOP_STATUS[it.status])}</span>` : ""}</div>
<div>
<p class="price-tag">${shopPriceHTML(it)}</p>
<dl class="shop-spec">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${it.note ? `<p>${esc(it.note)}</p>` : ""}
<div class="btn-row" style="grid-template-columns:1fr">
${ok ? `<a class="btn btn-form" href="${rel}shop/?item=${encodeURIComponent(it.id)}#order">この商品を申し込む</a>` : `<span class="btn btn-form is-disabled" aria-disabled="true">${esc(SC.SHOP_STATUS[it.status])}のため申し込めません</span>`}
${pay}
</div>
<p class="muted" style="margin-top:10px">${esc(SHOP.payment_note)}${esc(SHOP.hold_note)}</p>
</div>
</div>
</article>
<section class="section" aria-labelledby="h-more">
<h2 id="h-more">ほかの商品</h2>
<p><a href="${rel}shop/">販売中の商品の一覧へ</a>　／　<a href="${rel}price/#delivery">配送料の表</a></p>
${contact(BLOG, rel)}
</section>`;
  return [pagePath + "index.html", shell({ pagePath, title: it.name, desc: `${it.name}。${p.undetermined ? "価格は確認中" : yen(p.price) + "（税込）"}。熊本県合志市のリサイクル店で販売中。`, graph: [business(), productLd(it)], main, form: "shop/#order", rss: false })];
}
function postCard(p, rel) {
  const tags = p.tags.length ? `<ul class="post-tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  return `<li class="card post-card"><a href="${rel}${postPath(p)}"><b>${esc(p.title)}</b></a>
<p class="post-meta"><time datetime="${p.date}">${jaDate(p.date)}</time></p>${p.summary ? `\n<p>${esc(p.summary)}</p>` : ""}${tags}</li>`;
}
function blogIndexPage(n) {
  const paths = blogPagePaths();
  const pagePath = paths[n - 1];
  const rel = relOf(pagePath);
  const list = POSTS.slice((n - 1) * PER_PAGE, n * PER_PAGE);
  const prev = n > 1 ? `<a class="btn btn-ghost" href="${rel}${paths[n - 2]}" rel="prev">新しい記事へ</a>` : "";
  const next = n < paths.length ? `<a class="btn btn-ghost" href="${rel}${paths[n]}" rel="next">古い記事へ</a>` : "";
  const pager = prev || next ? `<nav class="pager" aria-label="ページ送り">${prev}<span>${n} / ${paths.length} ページ</span>${next}</nav>` : "";
  const main = `<section class="section" aria-labelledby="h-blog">
<h1 id="h-blog">記事一覧${n > 1 ? `（${n}ページ目）` : ""}</h1>
<p>買取・片付け・遺品整理について、合志市の店からお伝えします。<a href="${rel}blog/feed.xml">RSS</a></p>
${list.length ? `<ul class="post-list">\n${list.map((p) => postCard(p, rel)).join("\n")}\n</ul>` : `<p class="empty">記事は準備中です。</p>`}
${pager}
</section>`;
  const graph = [
    business(),
    { "@type": "Blog", name: CONFIG.SITE_NAME + " の記事", ...(pageUrl("blog/") ? { url: pageUrl("blog/") } : {}), publisher: org(), blogPost: list.map((p) => ({ "@type": "BlogPosting", headline: p.title, datePublished: p.date, ...(pageUrl(postPath(p)) ? { url: pageUrl(postPath(p)) } : {}) })) }
  ];
  return [pagePath + "index.html", shell({ pagePath, title: "記事一覧" + (n > 1 ? `（${n}ページ目）` : ""), desc: "買取・片付け・遺品整理についての記事。" + CONFIG.AREA_CENTER + "のリサイクル店。", graph, main })];
}
function postPage(p, i) {
  const pagePath = postPath(p);
  const rel = relOf(pagePath);
  const body = mdToHtml(p.body, { base: rel });
  const cover = p.cover ? `<img class="post-cover" src="${rel}${esc(p.cover)}" alt="" loading="lazy">\n` : "";
  const tags = p.tags.length ? `<ul class="post-tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  const newer = POSTS[i - 1], older = POSTS[i + 1];
  const pn = newer || older ? `<nav class="pager" aria-label="前後の記事">${newer ? `<a href="${rel}${postPath(newer)}" rel="prev">← ${esc(newer.title)}</a>` : "<span></span>"}${older ? `<a href="${rel}${postPath(older)}" rel="next">${esc(older.title)} →</a>` : ""}</nav>` : "";
  const main = `<article class="section post" aria-labelledby="h-post">
<p class="post-meta"><a href="${rel}blog/">記事一覧</a>　<time datetime="${p.date}">${jaDate(p.date)}</time></p>
<h1 id="h-post">${esc(p.title)}</h1>
${tags}${cover}<div class="post-body">
${body}
</div>
</article>
<section class="section" aria-labelledby="h-related">
<h2 id="h-related">関連する相談</h2>
<ul class="related" style="list-style:none;padding:0;margin:0">
<li><a href="${rel}kaitori/"><b>出張買取</b><br><small>冷蔵庫・洗濯機・家具など。概算フォームあり</small></a></li>
<li><a href="${rel}kataduke/"><b>不用品回収・片付け</b><br><small>量の区分・間取り別の目安と概算フォーム</small></a></li>
<li><a href="${rel}seiri/"><b>遺品整理・生前整理</b><br><small>ゴミ屋敷・空き家の片付けも</small></a></li>
</ul>
${contact(BLOG, rel)}
</section>
${pn}`;
  const posting = {
    "@type": "BlogPosting",
    headline: p.title,
    datePublished: p.date,
    ...(p.summary ? { description: p.summary } : {}),
    ...(p.tags.length ? { keywords: p.tags.join(",") } : {}),
    ...(pageUrl(pagePath) ? { url: pageUrl(pagePath), mainEntityOfPage: pageUrl(pagePath) } : {}),
    ...(p.cover && CONFIG.SITE_URL ? { image: CONFIG.SITE_URL + p.cover } : {}),
    author: org(),
    publisher: org()
  };
  return [pagePath + "index.html", shell({ pagePath, title: p.title, desc: p.summary || p.title, graph: [business(), posting], main, ogType: "article" })];
}
function rssDate(d) {
  const dt = new Date(d + "T07:00:00+09:00");
  const j = new Date(dt.getTime() + 9 * 3600 * 1000);
  const W = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][j.getUTCDay()];
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][j.getUTCMonth()];
  return `${W}, ${String(j.getUTCDate()).padStart(2, "0")} ${M} ${j.getUTCFullYear()} 07:00:00 +0900`;
}
function feed() {
  // SITE_URL が未設定のときは feed.xml（blog/ の中）から見た相対パス
  const link = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : p.replace(/^blog\//, "") || "./");
  const items = POSTS.slice(0, 20).map((p) => `<item>
<title>${esc(p.title)}</title>
<link>${esc(link(postPath(p)))}</link>
<guid isPermaLink="${CONFIG.SITE_URL ? "true" : "false"}">${esc(link(postPath(p)))}</guid>
<pubDate>${rssDate(p.date)}</pubDate>
<description>${esc(p.summary)}</description>
${p.tags.map((t) => `<category>${esc(t)}</category>`).join("")}
</item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${esc(CONFIG.SITE_NAME)} の記事</title>
<link>${esc(link("blog/"))}</link>
<description>${esc(CONFIG.AREA_CENTER)}のリサイクル店から、買取・片付け・遺品整理についての記事。</description>
<language>ja</language>
${POSTS.length ? `<lastBuildDate>${rssDate(POSTS[0].date)}</lastBuildDate>\n` : ""}${items}
</channel>
</rss>
`;
}
function latestPosts(rel) {
  const list = POSTS.slice(0, 3);
  const inner = list.length
    ? `<ul class="post-list">\n${list.map((p) => postCard(p, rel)).join("\n")}\n</ul>\n<p style="margin-top:12px"><a href="${rel}blog/">記事一覧を見る</a></p>`
    : `<p class="empty">記事は準備中です。</p>`;
  return `${LIVE_OPEN}\n${inner}\n${LIVE_CLOSE}`;
}
function blogOutputs() {
  const m = new Map();
  for (let n = 1; n <= pageCount(); n++) { const [f, html] = blogIndexPage(n); m.set(f, html); }
  POSTS.forEach((p, i) => { const [f, html] = postPage(p, i); m.set(f, html); });
  m.set("blog/feed.xml", feed());
  return m;
}

// ---------- 実行 ----------
const outputs = new Map(); // 相対パス → 中身
for (const p of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, p.file), "utf8");
  outputs.set(p.file, fill(src, p));
}
outputs.set("sitemap.xml", sitemap());
outputs.set("robots.txt", robots());
outputs.set("llms.txt", llms());
outputs.set("gas/QuoteCore.gs", quoteCoreGs());
outputs.set("gas/Prices.gs", pricesGs());
outputs.set("gas/ShopCore.gs", coreGs("js/shop-core.js", "ShopCore"));
outputs.set("gas/Shop.gs", `// 自動生成：tools/build.mjs が data/shop.json から作る。手で直さない。\n// 商品を変えたら build → このファイルを Apps Script に反映（gas/README.md）。\nvar SHOP = ${JSON.stringify(SHOP, null, 2)};\n`);
for (const it of SHOP.items) { const [f, html] = shopItemPage(it); outputs.set(f, html); }

// blog/ は丸ごと作り直す（消えた記事・未来日に戻した記事が残らないように）
function writeBlog(dir) {
  const out = blogOutputs();
  fs.rmSync(path.join(dir, "blog"), { recursive: true, force: true });
  for (const [rel, content] of out) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  console.log(`blog: 今日 ${TODAY}（日本時間）で ${POSTS.length} 本を公開、${out.size} ファイル`);
}

if (CHECK) {
  const stale = [];
  for (const [rel, content] of outputs) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p) || stripLive(fs.readFileSync(p, "utf8")) !== stripLive(content)) stale.push(rel);
  }
  if (stale.length) {
    console.error("生成物が古い：" + stale.join(", ") + "\n→ node tools/build.mjs を実行してコミットしてください");
    process.exit(1);
  }
  console.log("build --check: 生成物は最新（" + outputs.size + " ファイル）");
} else if (OUT) {
  // 公開用の写し（gas・tests・tools など公開しない物は除く）
  // content（未来日・下書きの記事）と blog（手元の組み立て）は写さず、blog は下でその日の分だけ作る
  const SKIP = new Set([".git", ".github", "node_modules", "tests", "tools", "gas", "screens", "content", "blog", "package.json", "package-lock.json", "README.md", "DESIGN.md", "prices.template.json", ".gitignore", path.basename(OUT)]);
  fs.rmSync(OUT, { recursive: true, force: true });
  const copy = (from, to) => {
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      if (from === ROOT && SKIP.has(ent.name)) continue;
      const a = path.join(from, ent.name), b = path.join(to, ent.name);
      if (ent.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
      else if (ent.isFile()) fs.copyFileSync(a, b);
    }
  };
  fs.mkdirSync(OUT, { recursive: true });
  copy(ROOT, OUT);
  for (const [rel, content] of outputs) {
    if (rel.startsWith("gas/")) continue;
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), content);
  }
  writeBlog(OUT);
  fs.writeFileSync(path.join(OUT, "js/config.js"), "// 公開用に組み立てた設定（tools/build.mjs --out）\nexport const CONFIG = " + JSON.stringify(CONFIG, null, 2) + ";\n");
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  console.log("build --out: " + path.relative(ROOT, OUT) + " に公開用の写しを作成（差し込んだ設定：" + OVERRIDABLE.filter((k) => process.env["CFG_" + k]).join(", ") + "）");
} else {
  // 消した商品のページを残さない
  const keep = new Set(SHOP.items.map((it) => it.id));
  for (const ent of fs.readdirSync(path.join(ROOT, "shop"), { withFileTypes: true })) {
    if (ent.isDirectory() && !keep.has(ent.name)) fs.rmSync(path.join(ROOT, "shop", ent.name), { recursive: true, force: true });
  }
  let n = 0;
  for (const [rel, content] of outputs) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); n++; }
  }
  writeBlog(ROOT);
  console.log("build: " + outputs.size + " ファイルを確認、" + n + " ファイルを更新");
}
