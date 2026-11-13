// かんたん入力（/admin/quick/）の純粋関数：商品の id・1点の商品の形・売切れの切り替え・保存に送る中身・下書き。
// 確かめは /admin/ と同じ admin-core.js（validateData）、保存は同じ GAS の admin_save（gas/Admin.gs）。
// GAS には持っていかない（GAS は送られてきた商品表を admin-core.js と同じ式で確かめるだけ）。DOM・fetch は使わない。
import * as A from "./admin-core.js";

export const QUICK_MAX_PHOTOS = 3;
// 商品名の候補（押すと入る）。slug は id の頭、category は商品の種類。「その他」は名前を空にして打ってもらう
export const QUICK_NAMES = [
  { name: "冷蔵庫", slug: "fridge", category: "家電" },
  { name: "洗濯機", slug: "washer", category: "家電" },
  { name: "電子レンジ", slug: "microwave", category: "家電" },
  { name: "ソファ", slug: "sofa", category: "家具" },
  { name: "テーブル", slug: "table", category: "家具" },
  { name: "食器棚", slug: "cupboard", category: "家具" },
  { name: "その他", slug: "item", category: "その他" }
];
// 候補にない名前でも分かる言葉（id と種類のため。画面には出さない）
const MORE_WORDS = [
  { word: "レンジ", slug: "microwave", category: "家電" },
  { word: "ソファー", slug: "sofa", category: "家具" },
  { word: "炊飯器", slug: "rice-cooker", category: "家電" },
  { word: "テレビ", slug: "tv", category: "家電" },
  { word: "エアコン", slug: "aircon", category: "家電" },
  { word: "扇風機", slug: "fan", category: "家電" },
  { word: "ストーブ", slug: "heater", category: "家電" },
  { word: "掃除機", slug: "cleaner", category: "家電" },
  { word: "タンス", slug: "chest", category: "家具" },
  { word: "たんす", slug: "chest", category: "家具" },
  { word: "椅子", slug: "chair", category: "家具" },
  { word: "イス", slug: "chair", category: "家具" },
  { word: "ベッド", slug: "bed", category: "家具" },
  { word: "棚", slug: "shelf", category: "家具" },
  { word: "机", slug: "desk", category: "家具" }
];

function str(v) {
  return v == null ? "" : String(v);
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// 商品名 → { slug, category }。候補の言葉が入っていればそれ、無ければ名前の英数字（2文字以上）、それも無ければ item
export function guessKind(name) {
  const n = str(name);
  const words = QUICK_NAMES.filter(function (q) { return q.slug !== "item"; }).map(function (q) { return { word: q.name, slug: q.slug, category: q.category }; }).concat(MORE_WORDS);
  // 長い言葉から（「電子レンジ」を「レンジ」より先に）
  words.sort(function (a, b) { return b.word.length - a.word.length; });
  for (let i = 0; i < words.length; i++) if (n.indexOf(words[i].word) >= 0) return { slug: words[i].slug, category: words[i].category };
  const ascii = n
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/, "");
  return { slug: ascii.length >= 2 ? ascii : "item", category: "その他" };
}

// 商品の写真の置き場（1枚目は <id>.jpg、2枚目からは <id>-p2.jpg …。どれにも -480.jpg の小さい写真が付く）
export function quickPhotoPaths(id, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(A.shopPhotoPath(i ? id + "-p" + (i + 1) : id));
  return out;
}

function usedPhotos(shop) {
  const used = {};
  ((shop && shop.items) || []).forEach(function (it) { (it.photos || []).forEach(function (p) { used[p] = 1; used[A.photoThumbPath(p)] = 1; }); });
  return used;
}
function photoClash(shop, id) {
  const used = usedPhotos(shop);
  return quickPhotoPaths(id, QUICK_MAX_PHOTOS).some(function (p) { return used[p] || used[A.photoThumbPath(p)]; });
}

// 新しい商品の id：<slug>-YYYYMMDD（重なれば -2, -3 …）。今ある id と、今ある写真のファイル名に重ならない
export function quickProductId(name, shop, today) {
  const items = (shop && shop.items) || [];
  const ids = items.map(function (x) { return x.id; });
  const head = guessKind(name).slug + "-" + str(today).replace(/-/g, "");
  for (let n = 1; ; n++) {
    const id = n === 1 ? head : head + "-" + n;
    if (ids.indexOf(id) < 0 && !photoClash(shop, id)) return id;
  }
}

// 画面の入力 → 1点の商品（項目の並びは data/shop.json と同じ）。f：{ id, name, price, year, free_shipping, photoCount }
export function buildQuickItem(f) {
  const kind = guessKind(f.name);
  const it = {
    id: f.id,
    name: str(f.name).trim(),
    category: kind.category,
    price: f.price,
    year: f.year === undefined ? null : f.year,
    condition: "中古",
    size: "",
    free_shipping: !!f.free_shipping,
    status: "available",
    photos: quickPhotoPaths(f.id, f.photoCount || 0),
    note: "",
    payment_link: ""
  };
  const item = {};
  A.SHOP_ITEM_KEYS.forEach(function (k) { if (k in it) item[k] = it[k]; });
  return item;
}

// 入力欄の文字 → { fields, errors }。金額は必須（税込の円）、年式は任意（西暦4桁）、写真は1〜3枚
export function readQuickForm(input) {
  const errs = [];
  const name = str(input.name).trim();
  const price = A.parseAmount(input.price);
  const yearText = str(input.year).trim();
  const year = A.parseAmount(yearText);
  const n = input.photoCount || 0;
  if (n < 1) errs.push("写真を1枚以上撮ってください");
  if (n > QUICK_MAX_PHOTOS) errs.push("写真は" + QUICK_MAX_PHOTOS + "枚まで");
  if (price === null) errs.push("金額を入れてください（税込・円）");
  else if (Number.isNaN(price) || !A.isAmount(price)) errs.push("金額は数字で（例：12000）");
  if (!name) errs.push("商品名を入れてください（下の候補を押しても入ります）");
  else if (name.length > 80) errs.push("商品名は80文字まで");
  if (Number.isNaN(year) || (year !== null && !(year >= 1950 && year <= 2100))) errs.push("年式は西暦4桁（例：2021）か空欄");
  return { fields: { name: name, price: price, year: year, free_shipping: !!input.free_shipping, photoCount: n }, errors: errs };
}

// 「1点ふやす」の操作 → op（下書きにそのまま残せる形）。id はこの時の商品表で決める。photos：[{ big: base64, thumb: base64 }]
export function addOp(fields, photos, shop, today) {
  return { type: "add", id: quickProductId(fields.name, shop, today), today: today, name: fields.name, price: fields.price, year: fields.year, free_shipping: !!fields.free_shipping, photos: photos || [] };
}
// 「売切れにする／販売中に戻す」の操作 → op
export function statusOp(item, status) {
  return { type: "status", id: item.id, name: item.name, status: status };
}
// 下書きの見出し（「冷蔵庫 2ドア」を追加 など）
export function describeOp(op) {
  if (!op) return "";
  if (op.type === "add") return "「" + op.name + "」を追加";
  return "「" + op.name + "」を" + (A.SHOP_STATUS_NAMES[op.status] || op.status) + "に";
}

// 今の商品表に op を当てる → { data, photos: [{ path, base64 }], id, already, errors }
// already：その変更はもう入っている（電波が切れて結果だけ届かなかったときなど）→ 送らない
export function applyQuickOp(shop, op) {
  if (!shop || !Array.isArray(shop.items)) return { errors: ["商品表が読めません。読み直してください"] };
  const next = clone(shop);
  if (op.type === "status") {
    const it = next.items.find(function (x) { return x.id === op.id; });
    if (!it) return { errors: ["「" + op.name + "」が見つかりません（消されたかもしれません）"] };
    if (!A.SHOP_STATUS_NAMES[op.status]) return { errors: ["状態が正しくありません"] };
    if (it.status === op.status) return { already: true, id: op.id, data: shop, photos: [] };
    it.status = op.status;
    return { data: next, photos: [], id: op.id, errors: A.validateData("shop", next, shop, {}) };
  }
  if (op.type !== "add") return { errors: ["知らない操作です"] };
  // 前に送った分が入っていれば（同じ id・同じ名前・同じ金額）二重に足さない。id がほかで使われていたら取り直す
  const prev = shop.items.find(function (x) { return x.id === op.id; });
  if (prev && prev.name === op.name && prev.price === op.price) return { already: true, id: op.id, data: shop, photos: [] };
  const free = !prev && /^[a-z0-9-]{1,60}$/.test(str(op.id)) && !photoClash(shop, op.id);
  const id = free ? op.id : quickProductId(op.name, shop, op.today);
  const item = buildQuickItem({ id: id, name: op.name, price: op.price, year: op.year, free_shipping: op.free_shipping, photoCount: op.photos.length });
  next.items.unshift(item);
  const photos = [];
  item.photos.forEach(function (p, i) {
    photos.push({ path: p, base64: op.photos[i].big });
    photos.push({ path: A.photoThumbPath(p), base64: op.photos[i].thumb });
  });
  // 今ある商品の写真＋今回上げる写真（GAS はリポジトリの写真の一覧で同じ確かめをする）
  const known = photos.map(function (x) { return x.path; });
  shop.items.forEach(function (it) { (it.photos || []).forEach(function (p) { known.push(p, A.photoThumbPath(p)); }); });
  return { data: next, photos: photos, id: id, errors: A.validateData("shop", next, shop, { knownPhotos: known }) };
}

// GAS の admin_save に送る中身（/admin/ の保存と同じ形）
export function savePayload(applied, baseSha) {
  return { target: "shop", data: applied.data, base_sha: baseSha, photos: applied.photos };
}
