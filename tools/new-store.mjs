#!/usr/bin/env node
// 量産の型：聞き取り質問票の答え（stores/<店>/answers.json）から、新しい店のサイト一式を作る。
//   node tools/new-store.mjs stores/example/answers.json --out ../shop-example   … 型を写して、店の data を書き、build と test まで
//   node tools/new-store.mjs stores/example/answers.json --check                 … 答えを確かめるだけ（何も書かない）
//   --no-test … 写した先で npm test を走らせない
// 例え話：このリポジトリが「たい焼きの型」、answers.json が「あんこ」。型は変えず、あんこだけ店ごとに替える。
//
// 写さない物：.git・blog・screens・stores・content/posts（この店の記事）・assets/shop と assets/items と assets/blog の写真・shop/<商品>/。
// 書く物：data/store.json・site.json・areas.json・faq.json・prices.json・items.json・results.json・shop.json、js/config.js のエアコン送客の印、
//         content/posts に「選ばれる理由」の下書き（status: draft。公開はしない）。
// 書かない物：LINE の URL・GAS の URL・メール・合言葉（Actions Variables とスクリプトプロパティに人が入れる。tools/setup-store.md）。
// 答えが無い金額は null（画面では「要相談」）。よその店（2nd chance recycle）の金額を持ち込まない。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ANSWERS = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? path.resolve(args[outIdx + 1] || "") : null;
const CHECK = args.includes("--check");
if (!ANSWERS || (!OUT && !CHECK)) {
  console.error("使い方：node tools/new-store.mjs <answers.json> --out <新しい店のフォルダ>　または　--check");
  process.exit(2);
}

const A = JSON.parse(fs.readFileSync(path.resolve(ANSWERS), "utf8"));
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const isNum = (v) => typeof v === "number" && isFinite(v);
const numOrNull = (v) => (isNum(v) && v >= 0 ? v : null);
const str = (v) => (typeof v === "string" ? v.trim() : "");

// ---------- 答えの確かめ（必須が欠けていれば止める。任意は「あとで聞くこと」に並べる） ----------
const errors = [];
const todo = [];
const q1 = A.q1 || {}, q2 = A.q2 || {}, q3 = A.q3 || {}, q4 = A.q4 || {}, q5 = A.q5 || {}, q6 = A.q6 || {}, q7 = A.q7 || {}, q8 = A.q8 || {};
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(str(A.id))) errors.push("id：英小文字・数字・- だけ（例 sakura-kurume）");
if (!str(q1.name)) errors.push("Q1 店名");
if (!/[都道府県]$/.test(str(q1.region))) errors.push("Q1 都道府県（例 福岡県）");
if (!/[市区町村]$/.test(str(q1.locality))) errors.push("Q1 市区町村（例 久留米市）");
if (!(Array.isArray(q1.latlng) && q1.latlng.length === 2 && q1.latlng.every(isNum))) errors.push("Q1 店の位置 latlng（Googleマップで店を長押しすると出る2つの数字）");
if (!str(q1.street)) todo.push("Q1 番地（フッターと検索向けの住所。無ければ市区町村までで出る）");
if (!str(q1.hours)) todo.push("Q1 営業時間");
if (str(q2.tel) && !/^0\d{1,4}-\d{1,4}-\d{3,4}$/.test(str(q2.tel))) errors.push("Q2 電話：ハイフンつきの店の代表番号（市外局番から。例の形 0xx-xxx-xxxx）");
if (!str(q2.tel)) todo.push("Q2 載せてよい電話番号（店の代表番号だけ。携帯は載せない）");
if (q2.line) todo.push("Q2 公式LINE の友だち追加URL → Actions Variables の CFG_LINE_URL に入れる（リポジトリに書かない）");
if (!str(q3.number) || !str(q3.commission)) todo.push("Q3 古物商許可の番号と公安委員会名（ホームページで取引するなら表示が要る）");
if (!isNum(q5.radius_km) || q5.radius_km <= 0) errors.push("Q5 出張できる範囲（km）");
if (!Array.isArray(q5.towns) || !q5.towns.length) todo.push("Q5 出張できる市町村の名前");
if (!Array.isArray(A.q9) || A.q9.filter(str).length < 3) todo.push("Q9 他店に負けない点を3つ（店ごとに違う文章の元になる）");
if (!Array.isArray(A.q10) || A.q10.filter((f) => f && str(f.q) && str(f.a)).length < 3) todo.push("Q10 よく聞かれる質問を3つ（答えつき）");
if (!Array.isArray(A.q11) || !A.q11.length) todo.push("Q11 写真（外観・店内・人・作業）。届いたら assets/items か assets/blog へ");

const prices0 = readJSON("data/prices.json");
const ITEM_IDS = prices0.buyback_items.map((b) => b.id);
const KINDS = Object.keys(prices0.cleanup_by_kind);
const TIERS = prices0.collection_tiers.map((t) => t.id);
for (const k of Object.keys(q4.buy || {})) if (!ITEM_IDS.includes(k)) errors.push(`Q4 知らない品目 ${k}（使えるのは ${ITEM_IDS.join("・")}）`);
for (const k of Object.keys(q6)) if (!k.startsWith("_") && !TIERS.includes(k)) errors.push(`Q6 知らない区分 ${k}（使えるのは ${TIERS.join("・")}）`);
for (const k of q7.kinds || []) if (!KINDS.includes(k)) errors.push(`Q7 知らない種類 ${k}（使えるのは ${KINDS.join("・")}）`);

if (errors.length) {
  console.error("答えが足りない／形が違う：\n- " + errors.join("\n- "));
  process.exit(1);
}
if (CHECK) {
  console.log("答えの形は OK（" + A.id + "）");
  if (todo.length) console.log("あとで聞くこと：\n- " + todo.join("\n- "));
  process.exit(0);
}

// ---------- 店の data を作る ----------
const area = q1.region + q1.locality;
const DAYS = { 月: "Mo", 火: "Tu", 水: "We", 木: "Th", 金: "Fr", 土: "Sa", 日: "Su" };
function hoursSpec(hours, closed) {
  const m = /(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/.exec(hours || "");
  if (!m) return "";
  const t = `${m[1].padStart(2, "0")}:${m[2]}-${m[3].padStart(2, "0")}:${m[4]}`;
  const off = new Set([...String(closed || "")].filter((c) => DAYS[c]));
  const open = Object.keys(DAYS).filter((d) => !off.has(d)).map((d) => DAYS[d]);
  return (open.length === 7 ? "Mo-Su" : open.join(",")) + " " + t;
}
const closedText = str(q1.closed);
const hoursText = str(q1.hours) ? str(q1.hours) + (closedText ? `（定休日：${closedText}）` : "（年中無休）") : "";

const store = {
  _note: readJSON("data/store.json")._note,
  id: A.id,
  name: str(q1.name),
  area_label: area,
  town: q1.locality,
  address: { region: q1.region, locality: q1.locality, street: str(q1.street) },
  latlng: q1.latlng,
  tel: str(q2.tel),
  repo: str(A.repo),
  shop: !!A.q12,
  // 管理画面のログインで選ぶ名前（1つ目が店の人。既定は「店主」「運営」）
  admin_roles: Array.isArray(A.admin_roles) && A.admin_roles.map(str).filter(Boolean).length ? A.admin_roles.map(str).filter(Boolean) : ["店主", "運営"],
  kobutsu: { commission: str(q3.commission), number: str(q3.number), holder: str(q3.holder) },
  // 買取ページの「最低額のお約束」：Q4 で最低額と年式の目安の両方を答えた店だけ
  min_price_promise: isNum(q4.min_price) && isNum(q4.year_limit) ? `他で値段がつかなかった物でも、年式の目安（家電は${q4.year_limit}年以内）に入っていれば、最低${q4.min_price.toLocaleString("ja-JP")}円はお付けします。` : ""
};

const site = {
  _note: readJSON("data/site.json")._note,
  updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
  hours: hoursText,
  opening_hours_spec: hoursSpec(q1.hours, closedText),
  notice: "",
  opening_note: "料金はお店で確認中の目安です。",
  mail_perk_text: "登録特典は準備中です",
  referral_campaign: { active: false, title: "ご紹介キャンペーン", services: ["ihin", "seizen", "gomiyashiki", "akiya"], reward_yen: 0, gift: "", condition: "ご紹介いただいた案件がご成約になった場合", note: "" }
};

const areasTpl = readJSON("data/areas.json");
const areas = {
  _note: `出張エリア表。中心は${q1.locality}、目安は${q5.radius_km}km圏。needs_confirm=true は店の確認待ち。`,
  center: area,
  radius_km: q5.radius_km,
  travel_fee: str(q5.travel_fee) || "無料",
  assessment_fee: str(q5.assessment_fee) || "無料",
  fee_note: `出張費・査定料は${str(q5.travel_fee) || "無料"}（{radius}km圏内）。圏外はご相談ください。`,
  methods: [
    { id: "store", name: "店頭買取", note: "お店に持ち込み" },
    { id: "visit", name: "出張買取", note: "{town}から{radius}km圏内へ伺います" }
  ],
  not_offered: areasTpl.not_offered,
  areas: [q1.locality, ...(q5.towns || []).filter((t) => t !== q1.locality)].map((n) => ({ name: n, pref: q1.region, needs_confirm: n !== q1.locality }))
};

// 価格表：形は今の表、金額は全部 null にしてから答えを入れる
const nullify = (o) => JSON.parse(JSON.stringify(o), (k, v) => (["price_from", "price", "min_price", "max_price", "fee", "hours", "year_limit", "threshold", "value", "rate"].includes(k) ? null : v));
const prices = nullify(prices0);
prices._note = "概算フォーム・料金ページ・AI向けJSON・GAS再計算が共通で読む価格表。null は「要相談」表示。金額は聞き取り（Q6・Q7）の答えだけを入れた。provisional: true のあいだは仮の金額。";
prices.updated = site.updated;
prices.provisional = true;
prices.provisional_note = "現在の金額は聞き取りで伺った仮の目安です。最終額は訪問査定で確定します。";
prices.perks = { quo_card: null, same_day_up: null }; // 特典は店ごとに決める（決まるまで出さない）
prices.condition_factor = prices0.condition_factor;
for (const t of prices.collection_tiers) t.price_from = numOrNull(q6[t.id]);
const kinds = new Set(q7.kinds || []);
for (const k of KINDS) for (const r of prices.cleanup_by_kind[k]) r.price_from = kinds.has(k) ? numOrNull((q7.layouts || {})[r.layout]) : null;
for (const b of prices.buyback_items) {
  const v = (q4.buy || {})[b.id];
  b.max_price = numOrNull(v);
  b.min_price = numOrNull(q4.min_price);
  b.year_limit = numOrNull(q4.year_limit);
}

const items0 = readJSON("data/items.json");
const items = {
  ...items0,
  _note: "取扱品目表。買取の上限額と年式の目安年数は data/prices.json の buyback_items（null は要確認）。文言は型の共通文。",
  status: "仮（お店の確認待ち）",
  items: items0.items.map((it) => (it.id in (q4.buy || {}) ? it : { ...it, accept: "買取は行っていません（回収はできます）" })),
  not_accepted_examples: [...items0.not_accepted_examples, ...(q4.not_buy || []).map(str).filter(Boolean)]
};

// よくある質問：型の共通の問い（店名・距離は差し込み言葉）＋この店の3問。支払い方法は Q8 から作る
const PAY = { cash: "現金", card: "クレジットカード", paypay: "PayPay", bank: "銀行振込" };
const pays = (q8.customer_pays || []).map((p) => PAY[p] || p).join("・");
const faq0 = readJSON("data/faq.json").faq;
const pick = (q) => faq0.find((f) => f.q === q);
const common = ["1点だけでも来てもらえますか？", "壊れている家電も引き取ってもらえますか？", "見積りの金額から変わることはありますか？", "当日に用意するものは？", "家族の代わりに申し込めますか？", "片付けと買取を一緒に頼めますか？", "立ち会えなくても大丈夫ですか？"].map(pick).filter(Boolean);
const faq = {
  _note: "よくある質問。FAQPage の構造化データにも使う。前半はこの店の聞き取り（Q10）、後半は型の共通文。{town}・{radius} は build が店の名札から入れる。",
  faq: [
    ...(A.q10 || []).filter((f) => f && str(f.q) && str(f.a)).map((f) => ({ q: str(f.q), a: str(f.a) })),
    { q: "出張費や査定料はかかりますか？", a: `店から{radius}km圏内なら、出張費・査定料は${str(q5.travel_fee) || "無料"}です。圏外の場所はお申し込みの際にご相談ください。` },
    ...common,
    ...(str(q8.buyback_pays) ? [{ q: "お金はいつ受け取れますか？", a: `買取代金は、${str(q8.buyback_pays)}でお渡しします。` }] : []),
    ...(pays ? [{ q: "費用の支払い方法は？", a: `不用品回収・片付けの費用${A.q12 ? "や、購入商品の代金・配送料" : ""}は、${pays} でお支払いいただけます。` }] : [])
  ].slice(0, 20)
};
if (faq.faq.length < 10) todo.push(`よくある質問が ${faq.faq.length} 問（10問以上にする）`);

const results0 = readJSON("data/results.json");
const results = { ...results0, results: [] };
results.fields = { ...results0.fields, area: `市町村名まで（例 ${q1.locality}）` };
const shop0 = readJSON("data/shop.json");
const shop = { ...shop0, updated: site.updated, items: [], extras: [], payment_note: pays ? `お支払いは受け取り時に、${pays} でお願いします。` : shop0.payment_note };

// 「選ばれる理由」の下書き（店ごとに違う文章。公開は人が status を scheduled に変えてから）
const strengths = (A.q9 || []).map(str).filter(Boolean);
const post = `---
title: ${store.name}が選ばれる${strengths.length}つの理由
date: ${site.updated}
summary: ${area}の${store.name}が、買取と片付けで大事にしていること。
tags: [買取, 片付け]
status: draft
---

${area}のリサイクル店、${store.name}です。お客様によく「なぜここに頼んだのか」を伺います。いただいた声から、${strengths.length}つにまとめました。

${strengths.map((s, i) => `## ${i + 1}. ${s}\n\n（ここに店主の言葉で2〜3文。聞き取りのメモから書き足す）`).join("\n\n")}
`;

// ---------- 型を写す ----------
const SKIP_TOP = new Set([".git", "node_modules", "blog", "_site", "screens", "stores"]);
const KEEP_ONLY_README = new Set(["assets/shop", "assets/items", "assets/blog", "content/posts"]);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.error("--out のフォルダが空ではありません：" + OUT); process.exit(1); }
if (OUT.startsWith(ROOT + path.sep)) { console.error("--out は型（このリポジトリ）の外にしてください"); process.exit(1); }
function copy(from, to, rel = "") {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const r = rel ? rel + "/" + ent.name : ent.name;
    if (!rel && SKIP_TOP.has(ent.name)) continue;
    if (KEEP_ONLY_README.has(rel) && ent.name !== "README.md") continue;
    if (rel === "shop" && ent.isDirectory()) continue; // 商品ごとのページは build が作る
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (ent.isDirectory()) copy(a, b, r);
    else if (ent.isFile()) fs.copyFileSync(a, b);
  }
}
copy(ROOT, OUT);
const write = (rel, data) => fs.writeFileSync(path.join(OUT, rel), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
write("data/store.json", store);
write("data/site.json", site);
write("data/areas.json", areas);
write("data/prices.json", prices);
write("data/items.json", items);
write("data/faq.json", faq);
write("data/results.json", results);
write("data/shop.json", shop);
if (strengths.length) { fs.mkdirSync(path.join(OUT, "content/posts"), { recursive: true }); write(`content/posts/${site.updated}-erabareru-riyuu.md`, post); }
// エアコン送客：入口の印（src）を店の id に。紹介番号は空（決まったら人が入れる）
const cfgPath = path.join(OUT, "js/config.js");
fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, "utf8").replace(/\?src=[a-z0-9-]+/, "?src=" + A.id).replace(/AIRCON_REF_CODE: "[^"]*"/, 'AIRCON_REF_CODE: ""'));
const pkg = JSON.parse(fs.readFileSync(path.join(OUT, "package.json"), "utf8"));
pkg.name = A.id;
pkg.description = `${store.name}（${area}）買取・片付けサイト。量産の型（2ndchance-kaitori）から作成。`;
write("package.json", pkg);
if (!A.q12) fs.rmSync(path.join(OUT, "shop"), { recursive: true, force: true }); // 販売しない店：販売ページを置かない（ナビ・配送料の表も build が出さない）
if (A.q12) todo.push("Q12 ネット販売あり → 配送料の郵便番号表（data/postal/）をこの店の位置で作り直す：node tools/build-postal.mjs --db … --prefs " + q1.region);

// ---------- 組み立てと試験 ----------
execFileSync(process.execPath, ["tools/build.mjs"], { cwd: OUT, stdio: "inherit" });
if (!args.includes("--no-test")) execFileSync("npm", ["test", "--silent"], { cwd: OUT, stdio: ["ignore", "ignore", "inherit"] });

console.log(`\n${store.name}（${area}）のサイトを作りました：${OUT}`);
console.log("次：tools/setup-store.md の手順（リポジトリ・受け口・Actions Variables）。");
if (todo.length) console.log("あとで聞くこと：\n- " + todo.join("\n- "));
