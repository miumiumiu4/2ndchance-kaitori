#!/usr/bin/env node
// 組み立て：config と data/*.json を各ページの <!--build:名前--> 〜 <!--/build:名前--> に差し込み、
// sitemap.xml・robots.txt・llms.txt・gas/QuoteCore.gs・gas/Prices.gs を生成する。
//   node tools/build.mjs           … リポジトリの中をその場で更新（config.js の値だけを使う）
//   node tools/build.mjs --check   … 書き換えずに、生成物が最新かだけを確かめる（古ければ終了コード 1）
//   node tools/build.mjs --out _site … 公開用の写しを作る。環境変数 CFG_* の値をこの写しにだけ差し込む
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? path.resolve(ROOT, args[outIdx + 1] || "_site") : null;

const { CONFIG: BASE_CONFIG } = await import(pathToFileURL(path.join(ROOT, "js/config.js")).href);
const QC = await import(pathToFileURL(path.join(ROOT, "js/quote-core.js")).href);

// 公開用の写しにだけ、環境変数（GitHub の Actions Variables）で値を差し込む
const OVERRIDABLE = ["SITE_URL", "LINE_URL", "TEL", "GAS_URL", "HOURS", "OPENING_HOURS_SPEC", "OPENING_NOTE"];
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

// ページ表（設計書 4-1 の6ページ＋個人情報）
const PAGES = [
  { file: "index.html", path: "", nav: "トップ", title: "出張買取・不用品回収・片付け", desc: "熊本県合志市のリサイクル店。冷蔵庫・洗濯機・家具の出張買取と、不用品回収・片付け・遺品整理。", form: "kaitori/#form-a", services: ["buyback", "collection", "cleanup"] },
  { file: "kaitori/index.html", path: "kaitori/", nav: "買取", title: "出張買取（生活家電・家具）", desc: "冷蔵庫・洗濯機・電子レンジ・ガスコンロ・ソファ・ダイニングテーブル・食器棚・カーペット・カーテンの出張買取。合志市から30km圏。", form: "kaitori/#form-a", services: ["buyback"] },
  { file: "kataduke/index.html", path: "kataduke/", nav: "不用品回収・片付け", title: "不用品回収・片付け", desc: "量の4区分と間取り別の目安で、不用品回収と片付けの概算が出せます。買い取れる物は差し引きます。", form: "kataduke/#form-b", services: ["collection", "cleanup"] },
  { file: "seiri/index.html", path: "seiri/", nav: "遺品整理など", title: "遺品整理・生前整理・ゴミ屋敷・空き家片付け", desc: "遺品整理・生前整理・ゴミ屋敷片付け・空き家片付け。買取できる物は費用から差し引きます。", form: "kataduke/#form-c", services: ["ihin", "seizen", "gomiyashiki", "akiya"] },
  { file: "flow/index.html", path: "flow/", nav: "流れ・FAQ", title: "買取の流れ・必要なもの・よくある質問", desc: "申込から訪問査定までの3ステップ、本人確認書類、お金の受け取り方、よくある質問。", form: "kaitori/#form-a", services: ["buyback"], faq: true },
  { file: "price/index.html", path: "price/", nav: "料金・実績", title: "料金目安・買取実績", desc: "不用品回収・片付けの料金目安、買取の上限目安、買取実績。", form: "kaitori/#form-a", services: ["buyback", "collection", "cleanup"], catalog: true },
  { file: "privacy/index.html", path: "privacy/", nav: null, title: "個人情報の取扱い（仮）", desc: "個人情報の取扱い（仮の文面）。", form: "kaitori/#form-a", services: [] }
];

const SERVICES = {
  buyback: { name: "出張買取（生活家電・家具）", type: "買取", desc: "冷蔵庫・洗濯機・電子レンジ・ガスコンロ・ソファ・ダイニングテーブル・食器棚・カーペット・カーテンなどを訪問して査定し、買い取ります。", page: "kaitori/" },
  collection: { name: "不用品回収", type: "不用品回収", desc: "量の区分（少量〜トラック）で回収します。買い取れる物は費用から差し引きます。", page: "kataduke/" },
  cleanup: { name: "片付け", type: "片付け", desc: "間取り別の目安で、分別・運び出し・処分・清掃までまとめて行います。", page: "kataduke/" },
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
function centerParts() {
  const m = /^(.+?[都道府県])(.+)$/.exec(CONFIG.AREA_CENTER || "");
  return m ? { region: m[1], locality: m[2] } : { region: "", locality: CONFIG.AREA_CENTER || "" };
}

// ---------- 共通の部品 ----------
function header(page, rel) {
  const nav = PAGES.filter((p) => p.nav)
    .map((p) => `<li><a href="${rel}${p.path}"${p === page ? ' aria-current="page"' : ""}>${esc(p.nav)}</a></li>`)
    .join("");
  const note = CONFIG.OPENING_NOTE ? `\n<div class="notice" role="note"><div class="wrap">${esc(CONFIG.OPENING_NOTE)}</div></div>` : "";
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
<p class="muted" style="margin-top:8px">LINEは写真を送ると目安をお伝えできます（主な窓口）。電話はタップで発信します。${CONFIG.HOURS ? "受付時間：" + esc(CONFIG.HOURS) : "受付時間：" + PENDING}</p>`;
}

function footer(page, rel) {
  const links = PAGES.map((p) => `<li><a href="${rel}${p.path}">${esc(p.nav || p.title)}</a></li>`).join("");
  return `<footer class="site-footer"><div class="wrap">
<ul>${links}<li><a href="${rel}llms.txt">AI向けの案内（llms.txt）</a></li></ul>
<p>${esc(CONFIG.SITE_NAME)}（${esc(CONFIG.AREA_CENTER)}）｜受付時間：${CONFIG.HOURS ? esc(CONFIG.HOURS) : "準備中"}｜電話：${CONFIG.TEL ? esc(CONFIG.TEL) : "準備中"}</p>
<p class="muted">表示している金額は目安です。最終額は訪問査定で確定します。金・貴金属の買取は準備中です。</p>
</div></footer>`;
}

// ---------- データから作る部品 ----------
const buybackDef = (id) => (PRICES.buyback_items || []).find((b) => b.id === id) || {};
const yearText = (d) => (isNum(d.year_limit) ? `製造からおおむね${d.year_limit}年以内` : "年式の目安は確認中");
const maxText = (d) => (isNum(d.max_price) ? `最大 ${yen(d.max_price)}` : '<span class="consult">要相談</span>');

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
<p style="margin:0"><b>${esc(it.accept)}</b>｜${maxText(d)}｜${esc(yearText(d))}</p>
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
    .map((t) => `<tr><td><img src="${rel}assets/icons/truck-${esc(t.id)}.svg" alt="" width="40" height="40" style="vertical-align:middle;margin-right:6px">${esc(QC.tierName(t))}<br><small class="muted">${esc(t.note || "")}</small></td><td class="num">${isNum(t.price_from) ? yen(t.price_from) + "〜" : '<span class="consult">要相談</span>'}</td></tr>`)
    .join("");
  const layouts = PRICES.cleanup_by_layout
    .map((r) => `<tr><td>${esc(r.layout)}</td><td>${isNum(r.hours) ? "約" + r.hours + "時間" : "確認中"}</td><td class="num">${isNum(r.price_from) ? yen(r.price_from) + "〜" : '<span class="consult">要相談</span>'}</td></tr>`)
    .join("");
  const items = PRICES.buyback_items
    .map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(yearText(b))}</td><td class="num">${maxText(b)}</td></tr>`)
    .join("");
  const options = PRICES.options
    .map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${isNum(o.price) ? yen(o.price) + "／" + esc(o.unit) : '<span class="consult">要相談</span>'}</td></tr>`)
    .join("");
  const inc = PRICES.cleanup_includes.map((s) => `<li>${esc(s)}</li>`).join("");
  return `<p class="callout"><b>${esc(PRICES.disclaimer)}</b><br>価格表の更新日：${PRICES.updated ? esc(PRICES.updated) : "未定（金額は共同代表の確認待ち）"}／税：${PRICES.tax === "included" ? "税込" : esc(PRICES.tax)}</p>
<h3 id="collection">不用品回収（量の区分）</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">区分</th><th scope="col">料金の目安</th></tr></thead><tbody>${tiers}</tbody></table></div>
<h3 id="cleanup" style="margin-top:18px">片付け（間取り別）</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">間取り</th><th scope="col">作業時間</th><th scope="col">料金の目安</th></tr></thead><tbody>${layouts}</tbody></table></div>
<p style="margin-top:10px"><b>料金に含まれるもの</b></p>
<ul class="check">${inc}</ul>
<h3 id="options">オプション</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">内容</th><th scope="col">料金</th></tr></thead><tbody>${options}</tbody></table></div>
<h3 id="buyback" style="margin-top:18px">買取の上限目安</h3>
<div class="table-wrap"><table class="price"><thead><tr><th scope="col">品目</th><th scope="col">年式の目安</th><th scope="col">上限の目安</th></tr></thead><tbody>${items}</tbody></table></div>
<p class="muted">状態による目安：良い＝${Math.round((PRICES.condition_factor.good || 0) * 100)}%／普通＝${Math.round((PRICES.condition_factor.normal || 0) * 100)}%／難あり＝${Math.round((PRICES.condition_factor.damaged || 0) * 100)}%（上限に対して。確認中）。年式の目安を超えた家電は回収扱いです。</p>`;
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

// ---------- JSON-LD ----------
function business() {
  const c = centerParts();
  const o = {
    "@type": "LocalBusiness",
    "@id": (CONFIG.SITE_URL || "") + "#business",
    name: CONFIG.SITE_NAME,
    description: "生活家電・家具の出張買取と、不用品回収・片付け・遺品整理のリサイクル店。",
    address: { "@type": "PostalAddress", addressRegion: c.region, addressLocality: c.locality, addressCountry: "JP" },
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
function offer(name, price, unitText, desc) {
  const o = { "@type": "Offer", itemOffered: { "@type": "Service", name } };
  if (isNum(price)) o.priceSpecification = { "@type": "PriceSpecification", minPrice: price, priceCurrency: "JPY", ...(unitText ? { unitText } : {}) };
  else o.description = "要相談";
  if (desc) o.itemOffered.description = desc;
  return o;
}
function catalog() {
  return {
    "@type": "OfferCatalog",
    name: "料金目安（目安。最終額は訪問査定で確定）",
    itemListElement: [
      { "@type": "OfferCatalog", name: "不用品回収", itemListElement: PRICES.collection_tiers.map((t) => offer("不用品回収 " + QC.tierName(t), t.price_from, null, t.note)) },
      { "@type": "OfferCatalog", name: "片付け（間取り別）", itemListElement: PRICES.cleanup_by_layout.map((r) => offer("片付け " + r.layout, r.price_from, null, isNum(r.hours) ? "作業時間の目安 " + r.hours + "時間" : null)) },
      { "@type": "OfferCatalog", name: "オプション", itemListElement: PRICES.options.map((o) => offer(o.name, o.price, o.unit)) }
    ]
  };
}
function jsonld(page) {
  const graph = [business()];
  page.services.forEach((id) => graph.push(service(id)));
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
  results: (p, rel) => resultsCards(p, rel),
  "results-top": (p, rel) => resultsCards(p, rel, 3),
  hours: () => (CONFIG.HOURS ? esc(CONFIG.HOURS) : PENDING),
  "canonical": (p) => (pageUrl(p.path) ? `<link rel="canonical" href="${esc(pageUrl(p.path))}">` : "")
};

function fill(html, page) {
  const rel = page.path ? "../".repeat(page.path.split("/").filter(Boolean).length) : "./";
  return html.replace(/<!--build:([a-z0-9-]+)-->[\s\S]*?<!--\/build:\1-->/g, (m, name) => {
    const fn = FRAGMENTS[name];
    if (!fn) throw new Error(`${page.file}: 知らない差し込み口 ${name}`);
    return `<!--build:${name}-->\n${fn(page, rel)}\n<!--/build:${name}-->`;
  });
}

// ---------- 生成ファイル ----------
function sitemap() {
  const loc = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : p || "./");
  const head = CONFIG.SITE_URL ? "" : "<!-- SITE_URL が未設定のため相対パス。公開URLを決めたら CFG_SITE_URL（または config.js）に入れて build する -->\n";
  const urls = PAGES.map((p) => `  <url><loc>${esc(loc(p.path))}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${head}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
function robots() {
  return `User-agent: *\nAllow: /\n` + (CONFIG.SITE_URL ? `\nSitemap: ${CONFIG.SITE_URL}sitemap.xml\n` : "");
}
function llms() {
  const u = (p) => (CONFIG.SITE_URL ? CONFIG.SITE_URL + p : "/" + p);
  const pages = PAGES.map((p) => `- [${p.title}](${u(p.path)}): ${p.desc}`).join("\n");
  const items = PRICES.buyback_items.map((b) => `${b.id}（${b.name}）`).join("、");
  const tiers = PRICES.collection_tiers.map((t) => `${t.id}（${QC.tierName(t)}・${t.note}）`).join("、");
  const layouts = PRICES.cleanup_by_layout.map((r) => r.layout).join("、");
  const opts = PRICES.options.map((o) => `${o.id}（${o.name}）`).concat(Object.entries(QC.CONSULT_OPTIONS).map(([k, v]) => `${k}（${v}・相談のみ）`)).join("、");
  const kinds = Object.entries(QC.CLEANUP_KINDS).map(([k, v]) => `${k}（${v}）`).join("、");
  const api = CONFIG.GAS_URL || "（準備中：URL は公開後に入ります）";
  return `# ${CONFIG.SITE_NAME}（${CONFIG.AREA_CENTER}）買取・片付け

> ${CONFIG.AREA_CENTER}のリサイクル店。生活家電・家具の出張買取（${AREAS.center}から${AREAS.radius_km}km圏・出張費と査定料は無料）と、不用品回収・片付け・遺品整理・生前整理・ゴミ屋敷片付け・空き家片付けを行う。宅配買取は行っていない。

この文書は AI エージェント向けの目次です。人が読む画面と同じ情報を、機械が読める形でも置いています。

## ページ
${pages}

## 機械可読データ（個人情報は含まない）
- [料金目安](${u("data/prices.json")}): 不用品回収の量の区分・片付けの間取り別・オプション・買取の上限目安と年式の目安・状態係数。null は「要相談」。
- [取扱品目](${u("data/items.json")}): 買取の可否、見るところ、減額になりやすいこと、買取できない物の例。
- [出張エリア](${u("data/areas.json")}): 市町村名と要確認フラグ、出張費・査定料。
- [よくある質問](${u("data/faq.json")})
- [買取実績](${u("data/results.json")}): 過去の例。最初は空。

## 概算の式（画面・受付の再計算・下の API が同じ式を使う）
- 買取見込み（フォームA）＝ Σ（品目の上限目安 max_price × 年式係数 × 状態係数 condition_factor）× 台数。10円未満切り捨て。
  - 年式係数：目安年数以内＝1.0、超えている＝0（買取見込み 0円・回収扱い）。年式不明は 1.0 で計算し訪問時に確認。
  - 下限は 0円（査定で買い取れない場合があるため）。上限目安が null の品目があれば「要相談」。
- 不用品回収（フォームB）：お会計 ＝ 回収費用（区分の price_from ＋ オプション）− 買取見込み。幅（最小〜最大）で返す。マイナスはお客様の受け取り。
- 片付け（フォームC）：お会計 ＝ 間取りの基本料 price_from ＋ オプション − 買取見込み。作業時間の目安 hours つき。
- 価格表のどこかが null なら undetermined: true（要相談）。
- 品目 id：${items}
- 量の区分 tier：${tiers}
- 間取り layout：${layouts}
- 片付けの種別 kind：${kinds}
- オプション options：${opts}

## 概算 API（読み取り専用）
- URL：${api}
- 概算：\`?action=quote&form=A&items=fridge:2:within:good,washer:1:over:normal\`
  - items は「品目id:台数:年式(within|over|unknown):状態(good|normal|damaged)」をカンマ区切り。
  - \`?action=quote&form=B&tier=mini&options=stairs:1&items=sofa:1:within:normal\`
  - \`?action=quote&form=C&layout=2DK・2LDK&kind=ihin&options=kuyou\`
- 価格表：\`?action=prices\`
- 返り値は JSON（min・max・undetermined・lines・offset_note）。

## 注意
- 価格はすべて目安。最終額は訪問査定で人が決める。AI がお客様に金額を約束しないこと。
- 買取では古物営業法の本人確認が必要。本人確認は訪問時に人が行う（運転免許証・マイナンバーカード等）。
- 予約は、フォームまたは LINE・電話の受付のあと、電話の折返しで日時を相談して確定する。フォーム送信だけでは確定しない。
- お金の受け取り方（その場で現金／高額時は振込）は方針確認中。
- 予約の書き込み API は段階2（未提供）。
`;
}

function quoteCoreGs() {
  const src = fs.readFileSync(path.join(ROOT, "js/quote-core.js"), "utf8");
  const names = [...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, "").replace(/^/gm, "  ").replace(/^\s+$/gm, "");
  return `// 自動生成：tools/build.mjs が js/quote-core.js から作る。手で直さない（直すのは js/quote-core.js）。
var QuoteCore = (function () {
${body}
  return { ${names.map((n) => `${n}: ${n}`).join(", ")} };
})();
`;
}
function pricesGs() {
  return `// 自動生成：tools/build.mjs が data/prices.json から作る。手で直さない。
// 価格を変えたら build → このファイルを Apps Script に反映（gas/README.md）。
var PRICES = ${JSON.stringify(PRICES, null, 2)};
`;
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

if (CHECK) {
  const stale = [];
  for (const [rel, content] of outputs) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) stale.push(rel);
  }
  if (stale.length) {
    console.error("生成物が古い：" + stale.join(", ") + "\n→ node tools/build.mjs を実行してコミットしてください");
    process.exit(1);
  }
  console.log("build --check: 生成物は最新（" + outputs.size + " ファイル）");
} else if (OUT) {
  // 公開用の写し（gas・tests・tools など公開しない物は除く）
  const SKIP = new Set([".git", ".github", "node_modules", "tests", "tools", "gas", "screens", "package.json", "package-lock.json", "README.md", "DESIGN.md", "prices.template.json", ".gitignore", path.basename(OUT)]);
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
    fs.writeFileSync(path.join(OUT, rel), content);
  }
  fs.writeFileSync(path.join(OUT, "js/config.js"), "// 公開用に組み立てた設定（tools/build.mjs --out）\nexport const CONFIG = " + JSON.stringify(CONFIG, null, 2) + ";\n");
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  console.log("build --out: " + path.relative(ROOT, OUT) + " に公開用の写しを作成（差し込んだ設定：" + OVERRIDABLE.filter((k) => process.env["CFG_" + k]).join(", ") + "）");
} else {
  let n = 0;
  for (const [rel, content] of outputs) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) { fs.writeFileSync(p, content); n++; }
  }
  console.log("build: " + outputs.size + " ファイルを確認、" + n + " ファイルを更新");
}
