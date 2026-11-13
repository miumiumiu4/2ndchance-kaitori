// 管理画面の純粋関数（js/admin-core.js）：入力の読み取り・確かめ・変更点の要約・JSON の書き方・ログイン・写真
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../js/admin-core.js";
import { passHash } from "../tools/passhash.mjs";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const clone = (o) => JSON.parse(JSON.stringify(o));
const SHOP = json("tests/fixtures/shop.json");
const PRICES = json("tests/fixtures/prices.json");
// 式の試験は tests/fixtures（2026-11-13 の写し）で。data/*.json は管理画面で変わる
const SITE = json("tests/fixtures/site.json");
const RESULTS = json("tests/fixtures/results.json");
const shopPhotos = fs.readdirSync(path.join(ROOT, "assets/shop")).map((f) => "assets/shop/" + f);

test("金額の入力：全角・カンマ・円は読む、空欄は null、ほかは NaN", () => {
  assert.equal(A.parseAmount("12000"), 12000);
  assert.equal(A.parseAmount("１２，０００円"), 12000);
  assert.equal(A.parseAmount(" ¥3,300 "), 3300);
  assert.equal(A.parseAmount(""), null);
  assert.ok(Number.isNaN(A.parseAmount("-5")));
  assert.ok(Number.isNaN(A.parseAmount("1.5")));
  assert.ok(Number.isNaN(A.parseAmount("abc")));
  assert.ok(A.isAmount(0) && A.isAmount(null) && !A.isAmount(-1) && !A.isAmount(1.5) && !A.isAmount(NaN) && !A.isAmount("100"));
  assert.equal(A.todayJST(new Date("2026-11-13T16:00:00Z")), "2026-11-14", "日本時間で日付が変わる");
});

test("今の data/*.json は全部そのまま保存できる（確かめを通る）", () => {
  const items = json("data/items.json").items.map((x) => x.id);
  for (const [t, p] of Object.entries(A.ADMIN_FILES)) {
    const d = json(p);
    assert.deepEqual(A.validateData(t, d, d, { itemIds: items, knownPhotos: t === "shop" ? shopPhotos : undefined }), [], p);
  }
});

test("JSON の書き方：表の1行は1行、読み直すと同じ。商品表は今のファイルと同じ文字", () => {
  for (const p of Object.values(A.ADMIN_FILES)) {
    const d = json(p);
    const s = A.stringifyData(d);
    assert.deepEqual(JSON.parse(s), d, p);
    assert.ok(s.endsWith("}\n"));
  }
  assert.equal(A.stringifyData(SHOP), read("tests/fixtures/shop.json"), "今の商品表の書き方と同じ");
  assert.match(A.stringifyData(PRICES), /\n {4}\{ "id": "mini", "name": "軽トラック1台分", "price_from": 12000, "note": "例：軽トラック1台分" \},\n/);
  assert.ok(A.sameData(SHOP, clone(SHOP)));
  const b = clone(SHOP); b.items[0].price = 1;
  assert.ok(!A.sameData(SHOP, b));
});

test("商品の確かめ：価格・状態・写真・決済ページ・id の重なり・知らない項目", () => {
  const ok = (s) => A.validateData("shop", s, SHOP, { knownPhotos: shopPhotos });
  const s = clone(SHOP);
  s.items[0].price = -1;
  s.items[1].status = "gone";
  s.items[2].photos = ["assets/shop/nai.jpg"];
  s.items[3].payment_link = "http://insecure.example";
  s.items[4].sale = 1.5;
  s.items[5].id = s.items[6].id;
  const e = ok(s).join("\n");
  for (const w of ["価格は0以上", "状態は販売中", "写真が見つかりません", "https://", "割引は0〜99%", "id が重なって"]) assert.ok(e.includes(w), w);
  const x = clone(SHOP); x.items[0].secret = 1;
  assert.match(ok(x).join(), /知らない項目/);
  const y = clone(SHOP); y.extra = 1;
  assert.match(ok(y).join(), /形（項目の名前）は変えられません/);
  // 新しい商品：写真は今回上げる分を knownPhotos に足せば通る
  const n = clone(SHOP);
  const id = A.newProductId(n.items.map((i) => i.id), "2026-11-13");
  assert.equal(id, "item-20261113-1");
  n.items.unshift({ id, name: "テスト棚", category: "家具", price: 3000, year: null, condition: "中古", size: "", free_shipping: false, status: "available", photos: [A.shopPhotoPath(id)], note: "", payment_link: "" });
  assert.match(ok(n).join(), /写真が見つかりません/);
  assert.deepEqual(A.validateShop(n, { knownPhotos: shopPhotos.concat([A.shopPhotoPath(id), A.photoThumbPath(A.shopPhotoPath(id))]) }), []);
  assert.equal(A.newProductId([id], "2026-11-13"), "item-20261113-2");
});

test("個人情報・秘密らしき文字は止める（tests/data.test.mjs と同じ見方）", () => {
  const at = "@";
  for (const bad of ["090" + "12345678", "0" + "96-123-4567", "a" + at + "b.jp", "〒861-1112", "3丁目", "山田様", "ab".repeat(16)]) {
    const s = clone(SHOP); s.items[0].note = "連絡は " + bad;
    assert.match(A.validateShop(s).join(), /個人情報や秘密らしき文字/, bad);
  }
  const s = clone(SHOP); s.items[0].note = "お客様の声：12/31 まで 10% OFF";
  assert.deepEqual(A.validateShop(s), []);
  assert.deepEqual(A.privacyHits('"updated": "2026-11-13"'), []);
});

test("金額表：値だけ変えられる（id・品目名・間取り・行の数は固定）、数の範囲、配送料の並び", () => {
  const ok = (p) => A.validatePrices(p, PRICES);
  assert.deepEqual(ok(clone(PRICES)), []);
  const a = clone(PRICES); a.buyback_items[0].id = "reizouko";
  assert.match(ok(a).join(), /形.*変えられません/);
  const b = clone(PRICES); b.collection_tiers.pop();
  assert.match(ok(b).join(), /変えられません/);
  const c = clone(PRICES); c.buyback_items[0].name = "別の名前";
  assert.match(ok(c).join(), /変えられません/);
  const d = clone(PRICES);
  d.collection_tiers[0].price_from = NaN;
  d.buyback_items[0].min_price = 30000;
  d.cleanup_by_kind.ihin[0].hours = "すぐ";
  d.delivery_tiers[2].max_km = 5;
  d.perks.same_day_up.rate = 2;
  d.provisional_note = "正式な金額です";
  const e = ok(d).join("\n");
  for (const w of ["0以上の整数", "最低額が上限より大きい", "作業時間", "小さい順", "上乗せ", "「仮」の字"]) assert.ok(e.includes(w), w);
  // null（要相談）は通る。provisional を外せば説明に「仮」は要らない
  const f = clone(PRICES); f.collection_tiers[0].price_from = null; f.provisional = false; f.provisional_note = "正式";
  assert.deepEqual(ok(f), []);
});

test("お店の情報・ご紹介キャンペーン・買取実績の確かめ", () => {
  const s = clone(SITE); s.notice = "x".repeat(301); s.referral_campaign.reward_yen = -1;
  const e = A.validateSite(s).join();
  assert.match(e, /300文字/);
  assert.match(e, /紹介料/);
  const r = clone(RESULTS);
  r.results.push({ id: "r001", item_id: "fridge", name: "冷蔵庫 2ドア", category: "家電", price: 3000, date: "2026-11", area: "合志市", photo: "", comment: "" });
  assert.deepEqual(A.validateResults(r, { itemIds: ["fridge"] }), []);
  r.results.push({ ...r.results[0], id: "r002", date: "2026-11-13", area: "合志市幾久富1-2-3", item_id: "nai" });
  const re = A.validateResults(r, { itemIds: ["fridge"] }).join();
  assert.match(re, /月まで/);
  assert.match(re, /市町村/);
  assert.match(re, /品目/);
  assert.equal(A.newResultId(["r001", "r002"]), "r003");
});

test("変更点の要約：商品（価格・売切れ・追加・削除）、金額表、お店の情報", () => {
  const b = clone(SHOP);
  b.items[0].price = 60000;
  b.items[1].status = "sold";
  b.items.pop();
  b.items.push({ ...SHOP.items[2], id: "item-20261113-1", name: "新しい棚", price: null });
  const d = A.diffSummary("shop", SHOP, b);
  assert.deepEqual(d, [
    "商品「AQUA 冷蔵庫 355L（2024年）」：価格 ¥65,000 → ¥60,000",
    "商品「ドラム式洗濯乾燥機（BIG DRUM）」：状態 販売中 → 売切れ",
    "追加：商品「新しい棚」（空欄（要相談））",
    "削除：商品「電気ストーブ」"
  ]);
  const p = clone(PRICES);
  p.collection_tiers[1].price_from = 13000;
  p.delivery_tiers[0].fee = 2500;
  p.updated = "2030-01-01";
  assert.deepEqual(A.diffSummary("prices", PRICES, p), ["不用品回収 軽トラック1台分：料金 ¥12,000 → ¥13,000", "配送料（ネット注文） 10km以内：配送料 ¥2,000 → ¥2,500"], "更新日は数えない");
  const s = clone(SITE); s.notice = "12/31 は休みます"; s.referral_campaign.active = false;
  assert.deepEqual(A.diffSummary("site", SITE, s), ["お知らせ（トップに出す）：空欄 → 「12/31 は休みます」", "ご紹介キャンペーン：出す はい → いいえ"]);
  assert.deepEqual(A.diffSummary("shop", SHOP, clone(SHOP)), []);
  const m = A.commitMessage("shop", d, "共同代表");
  assert.match(m, /^管理画面：商品を更新（共同代表・商品「AQUA 冷蔵庫 355L（2024年）」：価格 ¥65,000 → ¥60,000 ほか3件）\n\n/);
  assert.ok(!m.startsWith("build:"), "自動の組み立て直しのコミット（build:）と区別できる");
});

test("ログイン：5回続けて間違えると15分ロック、成功で0に、ログインは8時間", () => {
  let st = {};
  const t0 = Date.UTC(2026, 10, 13, 1);
  for (let i = 1; i <= 4; i++) { st = A.afterFailure(st, t0 + i); assert.equal(st.fails, i); assert.equal(st.locked, false); }
  st = A.afterFailure(st, t0 + 5);
  assert.equal(st.locked, true);
  assert.ok(A.isLocked(st, t0 + 5 + 14 * 60000));
  assert.ok(!A.isLocked(st, t0 + 5 + 15 * 60000));
  assert.equal(A.afterFailure(st, t0 + 16 * 60000).fails, 1, "ロックが解けたら数え直し");
  assert.ok(A.sessionAlive({ at: t0 }, t0 + 7.9 * 3600000));
  assert.ok(!A.sessionAlive({ at: t0 }, t0 + 8 * 3600000));
  assert.ok(A.sameText("abc", "abc") && !A.sameText("abc", "abd") && !A.sameText("abc", "abcd"));
});

test("パスコードのハッシュ：tools/passhash.mjs と GAS（bytesToHex）が同じ値", () => {
  const h = passHash("test-passcode-123");
  assert.match(h, /^[0-9a-f]{64}$/);
  const signed = Array.from(createHash("sha256").update(A.ADMIN_PASS_PREFIX + "test-passcode-123").digest()).map((b) => (b > 127 ? b - 256 : b));
  assert.equal(A.bytesToHex(signed), h, "GAS の computeDigest は符号つきのバイト");
});

test("写真：JPEG・EXIF なし・長辺の上限。置き場は assets/shop と assets/items だけ", () => {
  const thumb = fs.readFileSync(path.join(ROOT, "assets/shop/industrial-fan-480.jpg"));
  const big = fs.readFileSync(path.join(ROOT, "assets/shop/industrial-fan.jpg"));
  assert.equal(A.checkPhoto(thumb, 480), "");
  assert.equal(A.checkPhoto(big, 1200), "");
  assert.match(A.checkPhoto(big, 480), /大きすぎ/);
  assert.match(A.checkPhoto(Buffer.from("not a jpeg"), 1200), /JPEG ではありません/);
  // EXIF（APP1）入りは断る
  const exif = Buffer.concat([thumb.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from("Exif\0\0"), thumb.subarray(2)]);
  assert.match(A.checkPhoto(exif, 480), /EXIF/);
  const stripped = Buffer.from(A.stripJpegMeta(exif));
  assert.equal(A.checkPhoto(stripped, 480), "", "EXIF を取り除けば通る");
  assert.ok(stripped.equals(thumb), "画素はそのまま");
  assert.equal(A.stripJpegMeta(Buffer.from("png")), null);
  const signed = Array.from(thumb).map((b) => (b > 127 ? b - 256 : b));
  assert.equal(A.jpegInfo(signed).ok, true, "GAS の符号つきバイトでも読める");
  assert.equal(A.photoMaxFor("assets/shop/item-20261113-1.jpg"), 1200);
  assert.equal(A.photoMaxFor("assets/shop/item-20261113-1-480.jpg"), 480);
  assert.equal(A.photoMaxFor("assets/items/r001.jpg"), 1200);
  assert.equal(A.photoMaxFor("js/admin.js"), 0);
  assert.equal(A.photoMaxFor("assets/shop/../../index.html"), 0);
  assert.deepEqual(A.fitSize(4032, 3024, 1200), { w: 1200, h: 900 });
  assert.deepEqual(A.fitSize(300, 200, 1200), { w: 300, h: 200 }, "大きくはしない");
});

test("gas/AdminCore.gs は js/admin-core.js から生成され、素のスクリプトとして動く", async () => {
  const vm = await import("node:vm");
  const gs = read("gas/AdminCore.gs");
  assert.match(gs, /^\/\/ 自動生成/);
  assert.ok(!/^\s*export\s/m.test(gs));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(gs + "\nthis.AdminCore = AdminCore;", ctx);
  assert.equal(ctx.AdminCore.parseAmount("1,000"), 1000);
  assert.equal(ctx.AdminCore.validateShop(clone(SHOP)).length, 0);
});
