// 管理画面の純粋関数（画面 js/admin.js と GAS の受け口 gas/Admin.gs が同じ式を使う）。
// - 入力の読み取り（金額）・データの確かめ（商品・金額表・お店の情報・買取実績）・変更点の要約・JSON の書き方
// - パスコードの失敗回数とロック、ログインの有効時間、写真（JPEG）の確かめ
// tools/build.mjs がこのファイルから gas/AdminCore.gs を生成する（export を外して var AdminCore に包む）。
// GAS でも動くように、DOM・fetch・Node の API は使わない。

export const ADMIN_FILES = { shop: "data/shop.json", prices: "data/prices.json", site: "data/site.json", results: "data/results.json" };
export const ADMIN_KIND_NAMES = { shop: "商品", prices: "金額表", site: "お店の情報", results: "買取実績" };
export const ADMIN_ROLES = ["共同代表", "オーナー"];
// パスコードのハッシュ：sha256(ADMIN_PASS_PREFIX + パスコード) の16進。tools/passhash.mjs と GAS が同じ前置きを使う
export const ADMIN_PASS_PREFIX = "2ndchance-admin:";
export const LOCK_MAX = 5; // 続けて間違えたらロック
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 8;
export const SHOP_STATUS_NAMES = { available: "販売中", reserved: "取り置き中", sold: "売切れ" };
export const SHOP_CATEGORIES = ["家電", "家具", "インテリア", "その他"];
export const SHOP_CONDITIONS = ["中古", "新品", "未使用品"];
export const PHOTO_MAX = 1200; // 写真の長辺（px）
export const THUMB_MAX = 480; // 一覧用の小さい写真の長辺（px）
export const PHOTO_MAX_BYTES = 1500000;

function isNum(v) {
  return typeof v === "number" && isFinite(v);
}
function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return v == null ? "" : String(v);
}

// ---------- 入力の読み取り ----------
// 金額の入力 → 整数（円）／null（空欄＝要相談・確認中）／NaN（読めない）。全角・カンマ・¥・円は許す
export function parseAmount(text) {
  const s = str(text)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
    .replace(/[,，¥￥円\s]/g, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

// 金額として正しいか（null か 0 以上の整数）
export function isAmount(v) {
  return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100000000);
}

// 日本時間の今日（YYYY-MM-DD）
export function todayJST(now) {
  const d = new Date((now ? now.getTime() : Date.now()) + 9 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
}

// ---------- JSON の書き方（差分が読みやすいように、表の1行は1行に） ----------
function flatValue(v) {
  if (v === null || typeof v !== "object") return true;
  if (Array.isArray(v)) return v.every(function (x) { return x === null || typeof x !== "object"; });
  return Object.keys(v).every(function (k) { return flatValue(v[k]) && (v[k] === null || typeof v[k] !== "object" || Object.keys(v[k]).length <= 4); });
}
function inline(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(inline).join(", ") + "]";
  const ks = Object.keys(v);
  return ks.length ? "{ " + ks.map(function (k) { return JSON.stringify(k) + ": " + inline(v[k]); }).join(", ") + " }" : "{}";
}
function fmt(v, ind, top) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const pad = "  ".repeat(ind + 1);
  const end = "  ".repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const one = inline(v);
    if (flatValue(v) && one.length <= 100) return one;
    return "[\n" + v.map(function (x) { return pad + (flatValue(x) ? inline(x) : fmt(x, ind + 1, false)); }).join(",\n") + "\n" + end + "]";
  }
  const ks = Object.keys(v);
  if (!ks.length) return "{}";
  if (!top && flatValue(v) && inline(v).length <= 100) return inline(v);
  return "{\n" + ks.map(function (k) { return pad + JSON.stringify(k) + ": " + fmt(v[k], ind + 1, false); }).join(",\n") + "\n" + end + "}";
}
export function stringifyData(obj) {
  return fmt(obj, 0, true) + "\n";
}

// 公開中の JSON と保存した JSON が同じか（「反映を確認」）
export function sameData(a, b) {
  return stringifyData(a) === stringifyData(b);
}

// ---------- 個人情報・秘密らしき文字列（tests/secret-grep.mjs と tests/data.test.mjs と同じ見方） ----------
const PRIVACY = [
  { name: "メールアドレス", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  { name: "電話番号", re: /(?:^|[^0-9])0\d{1,4}[-‐ー－]\d{1,4}[-‐ー－]\d{3,4}(?![0-9])/ },
  { name: "電話番号", re: /(?:^|[^0-9])0[5789]0\d{8}(?![0-9])/ },
  { name: "電話番号", re: /\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/ },
  { name: "長い英数字（ID・鍵）", re: /[0-9a-fA-F]{32,}/ },
  { name: "ウェブアプリの ID", re: new RegExp("AKfy" + "cb") },
  { name: "郵便番号", re: /〒?\d{3}-\d{4}/ },
  { name: "番地", re: /\d+丁目|\d+番地|\d+-\d+-\d+/ },
  { name: "お名前（〜様）", re: /[一-龥ァ-ヶ]{1,6}様/ }
];
// 文字の中に個人情報らしき物があれば、その種類の一覧（無ければ空）
export function privacyHits(text) {
  const t = str(text).replace(/お客様/g, "").replace(/"updated":\s*"\d{4}-\d{2}-\d{2}"/g, "");
  const out = [];
  PRIVACY.forEach(function (p) { if (p.re.test(t) && out.indexOf(p.name) < 0) out.push(p.name); });
  return out;
}
function privacyErrors(obj, errs) {
  const hits = privacyHits(stringifyData(obj));
  if (hits.length) errs.push("個人情報や秘密らしき文字（" + hits.join("・") + "）は載せられません。電話番号・メール・お客様の名前・番地は書かないでください");
}

// ---------- 商品（data/shop.json） ----------
export const SHOP_PHOTO_RE = /^assets\/shop\/[a-z0-9-]{1,60}\.jpg$/;
export function photoThumbPath(p) {
  return str(p).replace(/\.jpg$/, "-480.jpg");
}
export function shopPhotoPath(id) {
  return "assets/shop/" + id + ".jpg";
}
export function resultPhotoPath(id) {
  return "assets/items/" + id + ".jpg";
}

// 新しい商品の id：item-YYYYMMDD-n（重ならない番号）
export function newProductId(ids, today) {
  const day = str(today).replace(/-/g, "");
  let n = 1;
  while ((ids || []).indexOf("item-" + day + "-" + n) >= 0) n++;
  return "item-" + day + "-" + n;
}

// opts.knownPhotos：あってよい写真のパス（いまリポジトリにある写真＋今回上げる写真）。省くと確かめない
export function validateShop(shop, opts) {
  const o = opts || {};
  const errs = [];
  if (!isObj(shop) || !Array.isArray(shop.items)) return ["商品表の形が正しくありません"];
  if (typeof shop.payment_note !== "string" || typeof shop.hold_note !== "string") errs.push("お支払い・取り置きの文が見つかりません");
  const seen = {};
  shop.items.forEach(function (it, i) {
    const label = "商品「" + (it && it.name ? it.name : i + 1 + "番目") + "」：";
    if (!isObj(it)) { errs.push(label + "形が正しくありません"); return; }
    if (!/^[a-z0-9-]{1,60}$/.test(str(it.id))) errs.push(label + "id は半角の小文字・数字・ハイフン");
    else if (seen[it.id]) errs.push(label + "id が重なっています（" + it.id + "）");
    seen[it.id] = true;
    if (!str(it.name).trim() || str(it.name).length > 80) errs.push(label + "名前は1〜80文字");
    if (!isAmount(it.price)) errs.push(label + "価格は0以上の整数（円）か空欄（確認中）");
    if (it.sale != null && !(isNum(it.sale) && it.sale >= 0 && it.sale < 1)) errs.push(label + "割引は0〜99%");
    if (it.year != null && !(Number.isInteger(it.year) && it.year >= 1950 && it.year <= 2100)) errs.push(label + "年式は西暦4桁か空欄");
    if (!str(it.condition).trim() || str(it.condition).length > 20) errs.push(label + "品物の状態を選んでください");
    if (typeof it.category !== "string" || it.category.length > 20) errs.push(label + "種類が正しくありません");
    if (typeof it.size !== "string" || it.size.length > 60) errs.push(label + "大きさは60文字まで");
    if (typeof it.note !== "string" || it.note.length > 300) errs.push(label + "ひとことは300文字まで");
    if (typeof it.free_shipping !== "boolean") errs.push(label + "送料無料は「はい／いいえ」");
    if (!SHOP_STATUS_NAMES[it.status]) errs.push(label + "状態は販売中・取り置き中・売切れのどれか");
    if (typeof it.payment_link !== "string" || (it.payment_link && !/^https:\/\/[^\s"<>]{3,500}$/.test(it.payment_link))) errs.push(label + "決済ページは https:// で始まる URL か空欄");
    if (!Array.isArray(it.photos) || !it.photos.length) errs.push(label + "写真が必要です");
    else it.photos.forEach(function (p) {
      if (!SHOP_PHOTO_RE.test(str(p))) errs.push(label + "写真の場所が正しくありません");
      else if (o.knownPhotos && (o.knownPhotos.indexOf(p) < 0 || o.knownPhotos.indexOf(photoThumbPath(p)) < 0)) errs.push(label + "写真が見つかりません（撮り直してください）");
    });
  });
  privacyErrors(shop, errs);
  return errs;
}

// ---------- 金額表（data/prices.json）：id・品目名・間取りは固定、値だけ変えられる ----------
const FIXED_KEYS = { id: 1, name: 1, layout: 1, unit: 1, currency: 1, tax: 1 };
// 形がそろっているか（キー・並び・id が同じ）。違う場所を返す（同じなら ""）
function shapeDiff(a, b, path) {
  if (a === null || b === null) return a === null && b !== null && typeof b === "object" ? path : b === null && a !== null && typeof a === "object" ? path : "";
  if (Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b) return path;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return path;
    for (let i = 0; i < a.length; i++) { const d = shapeDiff(a[i], b[i], path + "[" + i + "]"); if (d) return d; }
    return "";
  }
  if (typeof a === "object") {
    const ka = Object.keys(a).join("|"), kb = Object.keys(b).join("|");
    if (ka !== kb) return path || "(全体)";
    for (const k in a) {
      if (FIXED_KEYS[k] && a[k] !== b[k]) return path + "." + k;
      const d = shapeDiff(a[k], b[k], path + "." + k);
      if (d) return d;
    }
  }
  return "";
}
const HOURS_RE = /^\d+(〜\d+)?時間$/;
export function validatePrices(next, prev) {
  const errs = [];
  if (!isObj(next)) return ["金額表の形が正しくありません"];
  if (prev) {
    const d = shapeDiff(prev, next, "");
    if (d) return ["金額表の形（品目・区分・間取り）は変えられません：" + d];
  }
  const amount = function (v, label) { if (!isAmount(v)) errs.push(label + "は0以上の整数（円）か空欄（要相談）"); };
  if (typeof next.provisional !== "boolean") errs.push("「仮の金額」は「はい／いいえ」");
  if (next.provisional && !(typeof next.provisional_note === "string" && next.provisional_note.indexOf("仮") >= 0)) errs.push("仮の金額のあいだは、説明の文に「仮」の字を入れてください");
  if (next.updated !== null && !/^\d{4}-\d{2}-\d{2}$/.test(str(next.updated))) errs.push("更新日は YYYY-MM-DD");
  if (!str(next.disclaimer).trim()) errs.push("注意書き（disclaimer）が空です");
  (next.collection_tiers || []).forEach(function (t) { amount(t.price_from, "不用品回収「" + t.name + "」の料金"); });
  const kinds = next.cleanup_by_kind || {};
  Object.keys(kinds).forEach(function (k) {
    kinds[k].forEach(function (r) {
      amount(r.price_from, "片付け（" + k + "）" + r.layout + " の料金");
      if (!(r.hours === null || (isNum(r.hours) && r.hours >= 0) || (typeof r.hours === "string" && HOURS_RE.test(r.hours)))) errs.push("片付け（" + k + "）" + r.layout + " の作業時間は「1〜2時間」の形か数字");
    });
  });
  (next.other_cleanup || []).forEach(function (o) {
    amount(o.price_from, o.name + "の料金");
    if (!(Number.isInteger(o.per_tsubo) && o.per_tsubo > 0)) errs.push(o.name + "の坪数の単位は1以上の整数");
  });
  (next.buyback_items || []).forEach(function (b) {
    amount(b.min_price, "買取「" + b.name + "」の最低額");
    amount(b.max_price, "買取「" + b.name + "」の上限");
    amount(b.year_limit, "買取「" + b.name + "」の年式の目安（年）".replace("（円）", ""));
    if (isNum(b.min_price) && isNum(b.max_price) && b.min_price > b.max_price) errs.push("買取「" + b.name + "」：最低額が上限より大きい");
  });
  (next.options || []).forEach(function (o) {
    amount(o.price, "オプション「" + o.name + "」の料金");
    if (o.price_by_form) Object.keys(o.price_by_form).forEach(function (f) { amount(o.price_by_form[f], "オプション「" + o.name + "」（" + f + "）の料金"); });
  });
  const cf = next.condition_factor || {};
  Object.keys(cf).forEach(function (k) { if (k.charAt(0) !== "_" && !(isNum(cf[k]) && cf[k] >= 0 && cf[k] <= 1)) errs.push("状態の係数 " + k + " は0〜1"); });
  const pk = next.perks || {};
  if (pk.quo_card) { amount(pk.quo_card.threshold, "クオカードの条件の金額"); amount(pk.quo_card.value, "クオカードの金額"); }
  if (pk.same_day_up && !(isNum(pk.same_day_up.rate) && pk.same_day_up.rate >= 0 && pk.same_day_up.rate <= 1)) errs.push("同日査定の上乗せは0〜100%");
  ["delivery_tiers", "delivery_tiers_store"].forEach(function (key) {
    const list = next[key];
    if (!list) return;
    const name = key === "delivery_tiers" ? "配送料（ネット注文）" : "配送料（店頭購入）";
    list.forEach(function (d, i) {
      amount(d.fee, name + "「" + d.label + "」");
      if (!str(d.label).trim()) errs.push(name + "：表示が空の行があります");
      if (i < list.length - 1) {
        if (!(Number.isInteger(d.max_km) && d.max_km > (i ? list[i - 1].max_km : 0))) errs.push(name + "：距離（km）は上から小さい順の整数");
      } else if (d.max_km !== null) errs.push(name + "：最後の行の距離は空欄（それより遠いは要相談）");
    });
  });
  privacyErrors(next, errs);
  return errs;
}

// ---------- お店の情報（data/site.json） ----------
export const SITE_FIELDS = [
  { key: "hours", label: "営業時間", max: 40, hint: "例：10:00〜19:00。全ページの下とお問い合わせの所に出ます" },
  { key: "notice", label: "お知らせ（トップに出す）", max: 300, multiline: true, hint: "臨時休業・セールなど。空欄ならトップに何も出ません" },
  { key: "opening_note", label: "上部の帯（LINE などの準備中の案内）", max: 200, multiline: true, hint: "LINE と電話の両方がそろうまで全ページの上に出ます" },
  { key: "mail_perk_text", label: "メール会員の登録特典", max: 100, hint: "フォームのメール登録の横に出ます" }
];
// ご紹介キャンペーンのうち管理画面で直せる所
export const CAMPAIGN_FIELDS = [
  { key: "active", label: "出す", type: "bool" },
  { key: "reward_yen", label: "紹介料（1件・円）", type: "amount" },
  { key: "gift", label: "お礼の品", max: 40 },
  { key: "condition", label: "条件", max: 120 },
  { key: "note", label: "一言", max: 120 }
];
export function validateSite(site) {
  const errs = [];
  if (!isObj(site)) return ["お店の情報の形が正しくありません"];
  SITE_FIELDS.forEach(function (f) {
    if (typeof site[f.key] !== "string") errs.push(f.label + "が見つかりません");
    else if (site[f.key].length > f.max) errs.push(f.label + "は" + f.max + "文字まで");
  });
  if (site.updated != null && !/^\d{4}-\d{2}-\d{2}$/.test(str(site.updated))) errs.push("更新日は YYYY-MM-DD");
  const c = site.referral_campaign;
  if (c !== undefined) {
    if (!isObj(c)) errs.push("ご紹介キャンペーンの形が正しくありません");
    else {
      if (typeof c.active !== "boolean") errs.push("ご紹介キャンペーンの「出す／出さない」が正しくありません");
      if (!isAmount(c.reward_yen)) errs.push("紹介料は0以上の整数（円）か空欄");
      if (typeof c.gift !== "string" || c.gift.length > 40) errs.push("紹介のお礼の品は40文字まで");
      if (typeof c.title !== "string" || !c.title.trim() || c.title.length > 40) errs.push("キャンペーンの名前は1〜40文字");
      if (typeof c.condition !== "string" || c.condition.length > 120) errs.push("キャンペーンの条件は120文字まで");
      if (typeof c.note !== "string" || c.note.length > 120) errs.push("キャンペーンの一言は120文字まで");
      if (!Array.isArray(c.services) || !c.services.length) errs.push("キャンペーンの対象が空です");
    }
  }
  privacyErrors(site, errs);
  return errs;
}

// ---------- 買取実績（data/results.json） ----------
export function newResultId(ids) {
  let n = 1;
  while ((ids || []).indexOf("r" + ("00" + n).slice(-3)) >= 0) n++;
  return "r" + ("00" + n).slice(-3);
}
// opts.itemIds：品目 id の一覧（data/items.json）、opts.knownPhotos：あってよい写真のパス
export function validateResults(res, opts) {
  const o = opts || {};
  const errs = [];
  if (!isObj(res) || !Array.isArray(res.results)) return ["買取実績の形が正しくありません"];
  const seen = {};
  res.results.forEach(function (r, i) {
    const label = "実績「" + (r && r.name ? r.name : i + 1 + "番目") + "」：";
    if (!isObj(r)) { errs.push(label + "形が正しくありません"); return; }
    if (!/^r\d{3,6}$/.test(str(r.id))) errs.push(label + "id は r001 の形");
    else if (seen[r.id]) errs.push(label + "id が重なっています");
    seen[r.id] = true;
    if (!r.item_id || (o.itemIds && o.itemIds.indexOf(r.item_id) < 0)) errs.push(label + "品目を選んでください");
    if (!str(r.name).trim() || str(r.name).length > 60) errs.push(label + "品名は1〜60文字");
    if (!isAmount(r.price)) errs.push(label + "買取価格は0以上の整数（円）か空欄");
    if (r.date && !/^\d{4}-\d{2}$/.test(r.date)) errs.push(label + "買取日は YYYY-MM（月まで）");
    if (r.area && (str(r.area).length > 20 || !/[市町村]$/.test(r.area))) errs.push(label + "地域は市町村名まで（例 合志市）");
    if (r.comment && str(r.comment).length > 200) errs.push(label + "一言は200文字まで");
    if (r.photo) {
      if (!/^assets\/items\/[a-z0-9-]{1,60}\.(jpg|webp)$/.test(r.photo)) errs.push(label + "写真の場所が正しくありません");
      else if (o.knownPhotos && o.knownPhotos.indexOf(r.photo) < 0) errs.push(label + "写真が見つかりません");
    }
  });
  privacyErrors(res, errs);
  return errs;
}

export const SHOP_ITEM_KEYS = ["id", "name", "category", "price", "sale", "year", "condition", "size", "free_shipping", "status", "photos", "note", "payment_link"];
export const RESULT_KEYS = ["id", "item_id", "name", "category", "price", "date", "area", "photo", "comment"];
function extraKeys(o, allowed) {
  return Object.keys(o || {}).filter(function (k) { return allowed.indexOf(k) < 0; });
}
// 保存してよいか（エラーの文の一覧。空なら保存してよい）。prev は今の中身（形をそろえる）
export function validateData(target, next, prev, opts) {
  if (isObj(next) && isObj(prev) && target !== "prices" && Object.keys(next).sort().join("|") !== Object.keys(prev).sort().join("|")) return ["ファイルの形（項目の名前）は変えられません"];
  if (target === "shop" && isObj(next) && Array.isArray(next.items)) {
    const bad = next.items.map(function (it) { return extraKeys(it, SHOP_ITEM_KEYS); }).filter(function (x) { return x.length; });
    if (bad.length) return ["商品に知らない項目があります：" + bad[0].join("・")];
  }
  if (target === "results" && isObj(next) && Array.isArray(next.results)) {
    const bad = next.results.map(function (it) { return extraKeys(it, RESULT_KEYS); }).filter(function (x) { return x.length; });
    if (bad.length) return ["実績に知らない項目があります：" + bad[0].join("・")];
  }
  if (target === "shop") return validateShop(next, opts);
  if (target === "prices") return validatePrices(next, prev);
  if (target === "site") return validateSite(next);
  if (target === "results") return validateResults(next, opts);
  return ["知らない種類です"];
}

// ---------- 変更点の要約（保存の前の確認・コミットの文・メール） ----------
const FIELD_NAMES = {
  name: "名前", price: "価格", sale: "割引", year: "年式", condition: "品物の状態", size: "大きさ", note: "ひとこと", free_shipping: "送料無料", status: "状態", payment_link: "決済ページ", photos: "写真", category: "種類",
  price_from: "料金", min_price: "最低額", max_price: "上限", year_limit: "年式の目安(年)", fee: "配送料", max_km: "距離(km)", label: "表示", hours: "作業時間", per_tsubo: "坪数の単位",
  threshold: "条件の金額", value: "金額", rate: "上乗せ率", provisional: "仮の金額", provisional_note: "仮の説明", disclaimer: "注意書き", desc: "説明", good: "良い", normal: "普通", damaged: "難あり",
  hours_site: "営業時間", notice: "お知らせ", opening_note: "上部の帯", mail_perk_text: "メール会員の特典",
  item_id: "品目", date: "買取日", area: "地域", comment: "一言", photo: "写真"
};
const SECTION_NAMES = { collection_tiers: "不用品回収", cleanup_by_kind: "片付け", other_cleanup: "その他の片付け", buyback_items: "買取", options: "オプション", perks: "特典", delivery_tiers: "配送料（ネット注文）", delivery_tiers_store: "配送料（店頭購入）", condition_factor: "状態の係数", price_by_form: "フォーム別", quo_card: "クオカード", same_day_up: "同日査定", ihin: "遺品整理", seizen: "生前整理", gomiyashiki: "ゴミ屋敷", akiya: "空き家" };
function show(v, key) {
  if (key === "reward_yen" && typeof v === "number") return "¥" + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (v === null || v === undefined || v === "") return key === "price" || key === "price_from" || key === "fee" || key === "min_price" || key === "max_price" ? "空欄（要相談）" : "空欄";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (key === "status") return SHOP_STATUS_NAMES[v] || v;
  if (key === "sale" || key === "rate") return Math.round(v * 100) + "%";
  if (typeof v === "number" && /price|fee|threshold|value/.test(key)) return "¥" + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (Array.isArray(v)) return v.length + "件";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
function rowName(r, k) {
  return r && (r.name || r.layout || r.label || r.title || r.id) ? String(r.name || r.layout || r.label || r.title || r.id) : SECTION_NAMES[k] || k;
}
// 2つの値の違いを「場所：前 → 後」の行に
function walk(a, b, where, key, out) {
  if (key === "updated" || (key && key.charAt(0) === "_")) return;
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b) && !(key === "photos")) {
    if (Array.isArray(a)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) walk(a[i], b[i], where.concat(rowName(b[i] || a[i], key)), "", out);
    } else {
      const ks = Object.keys(b).concat(Object.keys(a).filter(function (k) { return !(k in b); }));
      ks.forEach(function (k) {
        const sub = (a[k] !== null && typeof a[k] === "object") || (b[k] !== null && typeof b[k] === "object");
        walk(a[k], b[k], sub && !Array.isArray(a[k] || b[k]) ? where.concat(SECTION_NAMES[k] || FIELD_NAMES[k] || k) : sub ? where.concat(SECTION_NAMES[k] || k) : where, k, out);
      });
    }
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  out.push((where.length ? where.join(" ") + "：" : "") + (FIELD_NAMES[key] || key) + " " + show(a, key) + " → " + show(b, key));
}
function listDiff(a, b, label, out) {
  const before = {}, after = {};
  (a || []).forEach(function (x) { before[x.id] = x; });
  (b || []).forEach(function (x) { after[x.id] = x; });
  (b || []).forEach(function (x) {
    if (!before[x.id]) out.push("追加：" + label + "「" + x.name + "」（" + show(x.price, "price") + "）");
    else {
      const lines = [];
      walk(before[x.id], x, [], "", lines);
      lines.forEach(function (l) { out.push(label + "「" + x.name + "」：" + l); });
    }
  });
  (a || []).forEach(function (x) { if (!after[x.id]) out.push("削除：" + label + "「" + x.name + "」"); });
}
export function diffSummary(target, before, after) {
  const out = [];
  if (target === "shop") listDiff(before && before.items, after && after.items, "商品", out);
  else if (target === "results") listDiff(before && before.results, after && after.results, "実績", out);
  else if (target === "site") {
    SITE_FIELDS.forEach(function (f) {
      const a = before ? str(before[f.key]) : "", b = after ? str(after[f.key]) : "";
      if (a !== b) out.push(f.label + "：" + (a ? "「" + show(a) + "」" : "空欄") + " → " + (b ? "「" + show(b) + "」" : "空欄"));
    });
    const ca = (before && before.referral_campaign) || {}, cb = (after && after.referral_campaign) || {};
    CAMPAIGN_FIELDS.forEach(function (f) {
      if (JSON.stringify(ca[f.key]) !== JSON.stringify(cb[f.key])) out.push("ご紹介キャンペーン：" + f.label + " " + show(ca[f.key], f.key) + " → " + show(cb[f.key], f.key));
    });
  } else walk(before || {}, after || {}, [], "", out);
  return out;
}

// コミットの文：「管理画面：商品を更新（共同代表・商品「…」：価格 … ほか2件）」＋全部の行
export function commitMessage(target, lines, who) {
  const list = lines || [];
  const head = "管理画面：" + (ADMIN_KIND_NAMES[target] || target) + "を更新（" + (who || "管理画面") + (list.length ? "・" + list[0].slice(0, 60) + (list.length > 1 ? " ほか" + (list.length - 1) + "件" : "") : "") + "）";
  return head + (list.length ? "\n\n" + list.slice(0, 50).join("\n") + (list.length > 50 ? "\n…ほか" + (list.length - 50) + "件" : "") : "");
}

// ---------- ログイン ----------
// state：{ fails: 続けて間違えた回数, until: ロックが解ける時刻(ms) }
export function isLocked(state, now) {
  return !!state && isNum(state.until) && now < state.until;
}
// 間違えたあとの state。5回目でロック（locked: true のときだけオーナーへ知らせる）
export function afterFailure(state, now) {
  const fails = (state && !isLocked(state, now) ? state.fails || 0 : 0) + 1;
  if (fails >= LOCK_MAX) return { fails: 0, until: now + LOCK_MINUTES * 60000, locked: true };
  return { fails: fails, until: 0, locked: false };
}
export function sessionAlive(sess, now) {
  return !!sess && isNum(sess.at) && now - sess.at >= 0 && now - sess.at < SESSION_HOURS * 3600000;
}
// 文字列の比較（長さと中身。早く抜けない）
export function sameText(a, b) {
  const x = str(a), y = str(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
export function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  return s;
}

// ---------- 写真（JPEG）の確かめ ----------
// bytes：0〜255（GAS の符号つきでも可）の並び。{ ok, w, h, app: APP1〜15 の印, error }
export function jpegInfo(bytes) {
  const b = function (i) { return bytes[i] & 0xff; };
  if (!bytes || bytes.length < 4 || b(0) !== 0xff || b(1) !== 0xd8) return { ok: false, error: "JPEG ではありません" };
  const app = [];
  let i = 2, w = 0, h = 0;
  while (i + 4 <= bytes.length) {
    if (b(i) !== 0xff) return { ok: false, error: "JPEG が壊れています" };
    const m = b(i + 1);
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda) break;
    const len = (b(i + 2) << 8) | b(i + 3);
    if (m >= 0xe1 && m <= 0xef) app.push(m.toString(16));
    if (m >= 0xc0 && m <= 0xc3) { h = (b(i + 5) << 8) | b(i + 6); w = (b(i + 7) << 8) | b(i + 8); }
    i += 2 + len;
  }
  if (!w || !h) return { ok: false, error: "写真の大きさが読めません" };
  return { ok: true, w: w, h: h, app: app };
}
// JPEG から APP1〜15（EXIF・位置情報・ICC など）とコメントを取り除いた 0〜255 の配列（画素はそのまま）。JPEG でなければ null
export function stripJpegMeta(bytes) {
  const b = function (i) { return bytes[i] & 0xff; };
  if (!bytes || bytes.length < 4 || b(0) !== 0xff || b(1) !== 0xd8) return null;
  const out = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (b(i) !== 0xff) return null;
    const m = b(i + 1);
    if (m === 0xda) { for (let k = i; k < bytes.length; k++) out.push(b(k)); return out; }
    const len = (b(i + 2) << 8) | b(i + 3);
    if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) for (let k = i; k < i + 2 + len && k < bytes.length; k++) out.push(b(k));
    i += 2 + len;
  }
  return null;
}
// 公開してよい写真か：JPEG・EXIF などなし・長辺が max 以下・大きすぎない
export function checkPhoto(bytes, max) {
  const info = jpegInfo(bytes);
  if (!info.ok) return info.error;
  if (info.app.length) return "写真に位置情報などの記録（EXIF）が残っています";
  if (Math.max(info.w, info.h) > max) return "写真が大きすぎます（長辺 " + max + "px まで）";
  if (bytes.length > PHOTO_MAX_BYTES) return "写真のファイルが大きすぎます";
  return "";
}
// 写真の置き場として正しいか（商品：assets/shop/<id>.jpg と -480.jpg、実績：assets/items/<id>.jpg）
export function photoMaxFor(path) {
  if (/^assets\/shop\/[a-z0-9-]{1,60}-480\.jpg$/.test(path)) return THUMB_MAX;
  if (/^assets\/(shop|items)\/[a-z0-9-]{1,60}\.jpg$/.test(path)) return PHOTO_MAX;
  return 0;
}
// 長辺を max に収める大きさ（大きくはしない）
export function fitSize(w, h, max) {
  const r = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}
