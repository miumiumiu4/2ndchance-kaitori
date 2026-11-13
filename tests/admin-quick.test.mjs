// かんたん入力（js/admin-quick-core.js）：id の作り方・1点の商品の形・入力の読み取り・保存に送る中身・売切れの切り替え・二重保存の防ぎ
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../js/admin-core.js";
import * as Q from "../js/admin-quick-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SHOP = JSON.parse(read("tests/fixtures/shop.json"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const PIC = fs.readFileSync(path.join(ROOT, "tests/fixtures/photos/industrial-fan-480.jpg")).toString("base64");
const pics = (n) => Array.from({ length: n }, () => ({ big: PIC, thumb: PIC }));

test("商品名 → id の頭と種類：候補の言葉・候補にない言葉・英数字・どれでもなければ item", () => {
  assert.deepEqual(Q.guessKind("冷蔵庫"), { slug: "fridge", category: "家電" });
  assert.deepEqual(Q.guessKind("AQUA 冷蔵庫 355L"), { slug: "fridge", category: "家電" }, "候補の言葉が先");
  assert.deepEqual(Q.guessKind("電子レンジ（ターンテーブル）"), { slug: "microwave", category: "家電" }, "長い言葉から");
  assert.deepEqual(Q.guessKind("食器棚 白"), { slug: "cupboard", category: "家具" }, "「棚」より「食器棚」");
  assert.deepEqual(Q.guessKind("3人掛けソファー"), { slug: "sofa", category: "家具" });
  assert.deepEqual(Q.guessKind("ＢＩＧ ＤＲＵＭ"), { slug: "big-drum", category: "その他" }, "全角の英数字も");
  assert.deepEqual(Q.guessKind("木彫りの像"), { slug: "item", category: "その他" });
  assert.deepEqual(Q.guessKind("X"), { slug: "item", category: "その他" }, "英数字1文字は使わない");
  for (const q of Q.QUICK_NAMES) assert.ok(A.SHOP_CATEGORIES.includes(q.category), q.name);
  assert.deepEqual(Q.QUICK_NAMES.map((q) => q.name), ["冷蔵庫", "洗濯機", "電子レンジ", "ソファ", "テーブル", "食器棚", "その他"]);
});

test("id：<slug>-YYYYMMDD、同じ日に重なれば -2・-3、写真のファイル名にも重ならない。写真の置き場は <id>.jpg・<id>-p2.jpg", () => {
  assert.equal(Q.quickProductId("冷蔵庫", SHOP, "2026-11-13"), "fridge-20261113");
  const s = clone(SHOP);
  s.items.unshift(Q.buildQuickItem({ id: "fridge-20261113", name: "冷蔵庫", price: 1000, photoCount: 1 }));
  assert.equal(Q.quickProductId("冷蔵庫 2ドア", s, "2026-11-13"), "fridge-20261113-2");
  s.items.unshift(Q.buildQuickItem({ id: "fridge-20261113-2", name: "冷蔵庫", price: 1000, photoCount: 1 }));
  assert.equal(Q.quickProductId("冷蔵庫", s, "2026-11-13"), "fridge-20261113-3");
  assert.equal(Q.quickProductId("冷蔵庫", s, "2026-11-14"), "fridge-20261114", "日が変われば頭から");
  // 別の id の商品が、その名前の写真を使っていたら避ける
  const t = clone(SHOP);
  t.items[0].photos = ["assets/shop/sofa-20261113-p2.jpg"];
  assert.equal(Q.quickProductId("ソファ", t, "2026-11-13"), "sofa-20261113-2");
  assert.deepEqual(Q.quickPhotoPaths("sofa-20261113", 3), ["assets/shop/sofa-20261113.jpg", "assets/shop/sofa-20261113-p2.jpg", "assets/shop/sofa-20261113-p3.jpg"]);
  for (const p of Q.quickPhotoPaths("sofa-20261113", 3)) {
    assert.match(p, A.SHOP_PHOTO_RE);
    assert.equal(A.photoMaxFor(p), A.PHOTO_MAX);
    assert.equal(A.photoMaxFor(A.photoThumbPath(p)), A.THUMB_MAX);
  }
  for (const it of SHOP.items) assert.ok(/^[a-z0-9-]{1,60}$/.test(Q.quickProductId(it.name, SHOP, "2026-12-31")), it.name);
});

test("1点の商品：data/shop.json と同じ項目と並び、中古・販売中・写真の数だけ置き場", () => {
  const it = Q.buildQuickItem({ id: "washer-20261113", name: " 洗濯機 8kg ", price: 12000, year: 2021, free_shipping: true, photoCount: 2 });
  assert.deepEqual(Object.keys(it), A.SHOP_ITEM_KEYS.filter((k) => k !== "sale"));
  assert.deepEqual(it, { id: "washer-20261113", name: "洗濯機 8kg", category: "家電", price: 12000, year: 2021, condition: "中古", size: "", free_shipping: true, status: "available", photos: ["assets/shop/washer-20261113.jpg", "assets/shop/washer-20261113-p2.jpg"], note: "", payment_link: "" });
  assert.deepEqual(Object.keys(it), Object.keys(SHOP.items.find((x) => !("sale" in x))), "今の表と同じ並び");
  assert.equal(Q.buildQuickItem({ id: "x-1", name: "x", price: 1, photoCount: 1 }).year, null);
});

test("入力の読み取り：金額は必須（全角・カンマ可）、商品名は必須、年式は任意の西暦4桁、写真は1〜3枚", () => {
  const ok = Q.readQuickForm({ name: "冷蔵庫", price: "１２，０００", year: "", free_shipping: false, photoCount: 1 });
  assert.deepEqual(ok, { fields: { name: "冷蔵庫", price: 12000, year: null, free_shipping: false, photoCount: 1 }, errors: [] });
  assert.equal(Q.readQuickForm({ name: "冷蔵庫", price: "8000", year: "２０２１", photoCount: 3 }).fields.year, 2021);
  const bad = Q.readQuickForm({ name: " ", price: "", year: "21", photoCount: 0 }).errors.join("／");
  for (const w of ["写真を1枚以上", "金額を入れて", "商品名を入れて", "年式は西暦4桁"]) assert.ok(bad.includes(w), w);
  assert.ok(Q.readQuickForm({ name: "a", price: "-5", photoCount: 1 }).errors[0].startsWith("金額は数字で"));
  assert.ok(Q.readQuickForm({ name: "a", price: "5", photoCount: 4 }).errors[0].includes("3枚まで"));
  assert.ok(Q.readQuickForm({ name: "a".repeat(81), price: "5", photoCount: 1 }).errors[0].includes("80文字"));
});

test("保存に送る中身（1点ふやす）：/admin/ と同じ admin_save の形・先頭に追加・写真は 1200px と 480px の2つずつ・同じ確かめを通る", () => {
  const op = Q.addOp({ name: "冷蔵庫 2ドア", price: 15000, year: 2020, free_shipping: true, photoCount: 2 }, pics(2), SHOP, "2026-11-13");
  assert.equal(op.id, "fridge-20261113");
  const ap = Q.applyQuickOp(SHOP, op);
  assert.deepEqual(ap.errors, []);
  assert.equal(ap.id, "fridge-20261113");
  const body = Q.savePayload(ap, "sha-shop");
  assert.deepEqual(Object.keys(body), ["target", "data", "base_sha", "photos"]);
  assert.equal(body.target, "shop");
  assert.equal(body.base_sha, "sha-shop");
  assert.equal(body.data.items.length, SHOP.items.length + 1);
  assert.equal(body.data.items[0].id, "fridge-20261113");
  assert.deepEqual(body.data.items.slice(1), SHOP.items, "ほかの商品はそのまま");
  assert.deepEqual(body.photos.map((x) => x.path), ["assets/shop/fridge-20261113.jpg", "assets/shop/fridge-20261113-480.jpg", "assets/shop/fridge-20261113-p2.jpg", "assets/shop/fridge-20261113-p2-480.jpg"]);
  assert.deepEqual(A.validateData("shop", body.data, SHOP, {}), []);
  assert.deepEqual(A.diffSummary("shop", SHOP, body.data), ["追加：商品「冷蔵庫 2ドア」（¥15,000）"]);
  assert.deepEqual(SHOP, JSON.parse(read("tests/fixtures/shop.json")), "元の表は変えない");
  // 個人情報は /admin/ と同じく止まる
  const bad = Q.applyQuickOp(SHOP, Q.addOp({ name: "山田様の冷蔵庫", price: 1, year: null, photoCount: 1 }, pics(1), SHOP, "2026-11-13"));
  assert.ok(bad.errors.some((e) => e.includes("個人情報")));
});

test("二重に保存しない：同じ op をもう一度当てると「もう入っている」。id がほかに取られていたら取り直す", () => {
  const op = Q.addOp({ name: "ソファ", price: 9800, year: null, photoCount: 1 }, pics(1), SHOP, "2026-11-13");
  const first = Q.applyQuickOp(SHOP, op);
  const again = Q.applyQuickOp(first.data, op);
  assert.equal(again.already, true);
  assert.equal(again.id, "sofa-20261113");
  // 同じ日に同じソファをもう1点（別の op）は別の id
  const op2 = Q.addOp({ name: "ソファ", price: 9800, year: null, photoCount: 1 }, pics(1), first.data, "2026-11-13");
  assert.equal(op2.id, "sofa-20261113-2");
  assert.equal(Q.applyQuickOp(first.data, op2).already, undefined);
  // 下書きのあいだに別の所で同じ id の別の商品が足された
  const other = clone(SHOP);
  other.items.unshift(Q.buildQuickItem({ id: "sofa-20261113", name: "ソファ（別）", price: 1, photoCount: 1 }));
  const moved = Q.applyQuickOp(other, op);
  assert.equal(moved.id, "sofa-20261113-2");
  assert.deepEqual(moved.errors, []);
  assert.equal(moved.photos[0].path, "assets/shop/sofa-20261113-2.jpg");
});

test("売切れにする・販売中に戻す：その商品の status だけ変わる。もうその状態なら送らない。見つからなければエラー", () => {
  const it = SHOP.items.find((x) => x.status === "available");
  const ap = Q.applyQuickOp(SHOP, Q.statusOp(it, "sold"));
  assert.deepEqual(ap.errors, []);
  assert.deepEqual(ap.photos, []);
  assert.deepEqual(A.diffSummary("shop", SHOP, ap.data), [`商品「${it.name}」：状態 販売中 → 売切れ`]);
  assert.equal(Q.applyQuickOp(ap.data, Q.statusOp(it, "sold")).already, true);
  const back = Q.applyQuickOp(ap.data, Q.statusOp(it, "available"));
  assert.deepEqual(A.diffSummary("shop", ap.data, back.data), [`商品「${it.name}」：状態 売切れ → 販売中`]);
  assert.ok(Q.applyQuickOp(SHOP, { type: "status", id: "nope", name: "無い", status: "sold" }).errors[0].includes("見つかりません"));
  assert.ok(Q.applyQuickOp(SHOP, Q.statusOp(it, "gone")).errors.length);
  assert.equal(Q.describeOp(Q.statusOp(it, "sold")), `「${it.name}」を売切れに`);
  assert.equal(Q.describeOp(Q.addOp({ name: "冷蔵庫" }, [], SHOP, "2026-11-13")), "「冷蔵庫」を追加");
  const draft = JSON.parse(JSON.stringify(Q.addOp({ name: "冷蔵庫", price: 1, year: null, photoCount: 1 }, pics(1), SHOP, "2026-11-13")));
  assert.deepEqual(Q.applyQuickOp(SHOP, draft).errors, [], "下書き（JSON に戻したもの）からも送れる");
});

test("かんたん入力のページ：noindex・同じログインの印・同じ受け口・外部を読まない・くわしい編集と行き来できる", () => {
  const html = read("admin/quick/index.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /css\/site\.css\?v=[0-9a-f]{8}/);
  assert.match(html, /src="\.\.\/\.\.\/js\/admin-quick\.js"/);
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, "")), "外部の読み込みなし");
  const js = read("js/admin-quick.js");
  assert.ok(!/https?:\/\//.test(js), "admin-quick.js は外部を読まない");
  assert.match(js, /const KEY = "admin-session"/, "ログインの印は /admin/ と同じ");
  assert.match(read("js/admin.js"), /const KEY = "admin-session"/);
  for (const k of ["admin_login", "admin_load", "admin_save"]) assert.ok(js.includes(`"${k}"`), k);
  assert.match(js, /from "\.\/admin-core\.js"/);
  assert.match(js, /from "\.\/admin-photo\.js"/);
  assert.match(read("js/admin.js"), /from "\.\/admin-photo\.js"/, "写真の作り直しは同じ式");
  assert.match(js, /capture="environment"/);
  assert.match(js, /href="\.\.\/"[^>]*>くわしい編集/);
  assert.match(read("js/admin.js"), /href="quick\/"[^>]*>かんたん入力/);
  assert.match(read("robots.txt"), /^Disallow: \/admin\/$/m, "admin/quick/ も含まれる");
  for (const p of ["sitemap.xml", "llms.txt", "index.html", "shop/index.html"].filter((p) => fs.existsSync(path.join(ROOT, p)))) // 販売しない店は shop/ が無い assert.ok(!read(p).includes("quick/"), p);
  assert.ok(!read("gas/AdminCore.gs").includes("quickProductId"), "GAS は今のまま（出し直し不要）");
});
