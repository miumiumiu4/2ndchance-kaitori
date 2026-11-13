// 販売ページ：data/shop.json の形、商品代の式、生成した一覧・商品ページ・JSON-LD
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { shopPrice, sameGoods, orderable, findItem, parseCart, toggleCart, inCart, resolveCart, cartFreeShipping, cartDeliveryFee, cartTotal, cartGoodsText, cartTotalText, sameCart, yenText, CART_MAX } from "../js/shop-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// 式の試験は tests/fixtures/shop.json（2026-11-13 の商品表の写し）で行う。
// data/shop.json は管理画面で変わる（売切れ・入れ替え）ので、形と生成したページだけを確かめる。
const SHOP = JSON.parse(read("tests/fixtures/shop.json"));
const REAL = JSON.parse(read("data/shop.json"));

test("shop.json：id 重複なし、価格は null か 0 以上、status と写真がある、payment_link は空か https", () => {
  const ids = REAL.items.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  REAL.items.forEach((x) => {
    assert.match(x.id, /^[a-z0-9-]+$/);
    assert.ok(x.price === null || (Number.isInteger(x.price) && x.price >= 0), x.id);
    assert.ok(["available", "reserved", "sold"].includes(x.status), x.id);
    assert.equal(typeof x.free_shipping, "boolean");
    assert.equal(typeof x.payment_link, "string");
    assert.ok(x.payment_link === "" || /^https:\/\//.test(x.payment_link), "決済リンクは空か https");
    x.photos.forEach((p) => { assert.ok(fs.existsSync(path.join(ROOT, p)), p); assert.ok(fs.existsSync(path.join(ROOT, p.replace(/\.jpg$/, "-480.jpg"))), p + " のサムネ"); });
  });
  assert.equal(findItem(SHOP, "electric-heater").status, "sold");
  assert.equal(REAL.hold_days, 3);
  assert.match(REAL.payment_note, /現金・クレジットカード・PayPay/);
});

test("商品代：割引は 10円未満切り捨て、null は確認中", () => {
  assert.deepEqual(shopPrice(findItem(SHOP, "citizen-wall-clock")), { list: 3300, price: 2970, sale: 0.1, undetermined: false });
  assert.equal(shopPrice(findItem(SHOP, "aqua-fridge-355")).price, 65000);
  assert.equal(shopPrice(findItem(SHOP, "cupboard-white")).undetermined, true);
  assert.ok(sameGoods(findItem(SHOP, "citizen-wall-clock"), 2970));
  assert.ok(!sameGoods(findItem(SHOP, "citizen-wall-clock"), 3300));
  assert.ok(sameGoods(findItem(SHOP, "cupboard-white"), null));
  assert.ok(!orderable(findItem(SHOP, "electric-heater")));
});

const items = (...ids) => ids.map((id) => findItem(SHOP, id));

test("カートの保存：形の違う値・重複は捨て、入れる⇔外す", () => {
  assert.deepEqual(parseCart('["drum-washer","drum-washer","x y",3,"industrial-fan"]'), ["drum-washer", "industrial-fan"]);
  assert.deepEqual(parseCart("壊れた"), []);
  assert.deepEqual(parseCart('{"a":1}'), []);
  assert.deepEqual(parseCart(null), []);
  assert.equal(parseCart(JSON.stringify(Array.from({ length: 40 }, (_, i) => "a" + i))).length, CART_MAX);
  let c = toggleCart([], "drum-washer");
  c = toggleCart(c, "industrial-fan");
  assert.deepEqual(c, ["drum-washer", "industrial-fan"]);
  assert.ok(inCart(c, "industrial-fan"));
  assert.deepEqual(toggleCart(c, "drum-washer"), ["industrial-fan"]);
  assert.deepEqual(c, ["drum-washer", "industrial-fan"], "元の配列は変えない");
});

test("カートの中身：販売中だけ残し、売切れ・見つからない id は外す", () => {
  const r = resolveCart(SHOP, ["drum-washer", "electric-heater", "nai", "industrial-fan", "drum-washer"]);
  assert.deepEqual(r.items.map((x) => x.id), ["drum-washer", "industrial-fan"]);
  assert.deepEqual(r.dropped, ["electric-heater", "nai", "drum-washer"]);
});

test("送料無料：カートが全部送料無料のときだけ。配送料は1注文で1回分", () => {
  assert.equal(cartFreeShipping(items("drum-washer", "aqua-fridge-355")), true);
  assert.equal(cartFreeShipping(items("drum-washer", "industrial-fan")), false);
  assert.equal(cartFreeShipping([]), false);
  assert.equal(cartDeliveryFee("store", null), 0);
  assert.equal(cartDeliveryFee("delivery", { fee: 3000, consult: false }), 3000);
  assert.equal(cartDeliveryFee("delivery", { fee: null, consult: true }), null);
  assert.equal(cartDeliveryFee("delivery", null), null);
  // 2点でも配送料は1回分
  const t = cartTotal(items("drum-washer", "industrial-fan"), 3000);
  assert.deepEqual([t.count, t.goods, t.delivery_fee, t.total, t.undetermined], [2, 50500, 3000, 53500, false]);
  assert.equal(cartTotalText(t), "¥53,500");
  assert.equal(cartGoodsText(t), "¥50,500");
});

test("お支払いの目安：割引は割引後、確認中の商品は「＋確認中の商品」、配送料が要相談なら数値にしない", () => {
  assert.equal(cartTotal(items("citizen-wall-clock", "industrial-fan"), 0).total, 2970 + 5500);
  const p = cartTotal(items("industrial-fan", "cupboard-white"), 2000);
  assert.deepEqual([p.goods, p.pending, p.known_total, p.total, p.undetermined], [5500, 1, 7500, null, true]);
  assert.equal(cartGoodsText(p), "¥5,500 ＋確認中の商品");
  assert.equal(cartTotalText(p), "¥7,500 ＋確認中の商品");
  assert.equal(cartGoodsText(cartTotal(items("cupboard-white"), 0)), "確認中の商品");
  assert.equal(cartTotalText(cartTotal(items("cupboard-white"), 0)), "確認中の商品");
  const c = cartTotal(items("industrial-fan"), null);
  assert.equal(c.total, null);
  assert.equal(cartTotalText(c), "¥5,500 ＋配送料（要相談）");
  assert.equal(cartTotal([], 0).total, null);
  assert.equal(cartTotalText(cartTotal([], 0)), "");
  assert.equal(yenText(1234567), "¥1,234,567");
  assert.equal(yenText(0), "¥0");
});

test("照合：画面の [{id, price}] と Shop の価格", () => {
  assert.ok(sameCart(SHOP, [{ id: "citizen-wall-clock", price: 2970 }, { id: "cupboard-white", price: null }]));
  assert.ok(!sameCart(SHOP, [{ id: "citizen-wall-clock", price: 3300 }]));
  assert.ok(!sameCart(SHOP, [{ id: "nai", price: 1 }]));
  assert.ok(!sameCart(SHOP, []));
});

test("一覧と商品ページ：全商品のページがあり、Product と Offer の JSON-LD、売切れは帯と申込不可", () => {
  const list = read("shop/index.html");
  REAL.items.forEach((it) => {
    assert.ok(list.includes(`href="../shop/${it.id}/"`), it.id);
    const html = read(`shop/${it.id}/index.html`);
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
    const prod = ld["@graph"].find((x) => x["@type"] === "Product");
    assert.equal(prod.name, it.name);
    assert.equal(prod.offers["@type"], "Offer");
    if (it.price !== null) assert.equal(prod.offers.price, shopPrice(it).price);
    else assert.equal(prod.offers.description, "価格は確認中");
    if (it.status === "available") {
      assert.ok(html.includes(`shop/?item=${it.id}#order`), it.id + " の申込ボタン");
      assert.ok(html.includes(`data-cart-add="${it.id}"`), it.id + " のカートのボタン（商品ページ）");
      assert.ok(list.includes(`data-cart-add="${it.id}"`), it.id + " のカートのボタン（一覧）");
    } else {
      assert.ok(!html.includes(`?item=${it.id}#order`));
      assert.ok(!html.includes(`data-cart-add="${it.id}"`) && !list.includes(`data-cart-add="${it.id}"`), it.id + " はカートに入れられない");
    }
    assert.ok(html.includes('src="../../js/cart.js"'), it.id + " はカートの script を読む");
    assert.equal(html.includes("カードで支払う"), !!it.payment_link, "payment_link があるときだけ出す");
  });
  if (REAL.items.some((it) => it.status === "sold")) {
    assert.match(list, /class="shop-band shop-band-sold">売切れ/);
    assert.match(list, /<button type="button" class="btn cart-btn" disabled aria-disabled="true">売切れ<\/button>/);
  }
  assert.match(list, /data-shop-root/);
  assert.match(list, /ネット決済は準備中/);
  assert.match(list, /お取り置きは3日間（仮）/);
  // トップ・ナビ
  assert.match(read("index.html"), /<a href="\.\/shop\/">販売中の商品<\/a>/);
});

test("GAS：ShopCore.gs と Shop.gs が素のスクリプトとして動き、注文の確かめ", () => {
  const ctx = {};
  vm.createContext(ctx);
  // 商品表は Shop.gs（data/shop.json から生成）ではなく試験用の写しを使う
  const shopGs = "var SHOP = " + read("tests/fixtures/shop.json") + ";";
  assert.match(read("gas/Shop.gs"), /^\/\/ 自動生成/);
  vm.runInContext([read("gas/Prices.gs"), read("gas/QuoteCore.gs"), read("gas/ShopCore.gs"), shopGs, read("gas/Code.gs")].join("\n") + "\nthis.G = { ShopCore, SHOP, validateShop_, shopRecalc_, HEADERS };", ctx);
  const { ShopCore, SHOP: S, validateShop_, shopRecalc_, HEADERS } = ctx.G;
  assert.ok(HEADERS.indexOf("点数") > HEADERS.indexOf("商品ID"), "点数の列");
  assert.equal(ShopCore.cartTotalText(ShopCore.cartTotal([ShopCore.findItem(S, "industrial-fan"), ShopCore.findItem(S, "cupboard-white")], 2000)), "¥7,500 ＋確認中の商品");
  assert.equal(ShopCore.shopPrice(ShopCore.findItem(S, "citizen-wall-clock")).price, 2970);
  const at = "@";
  const ok = { items: [{ id: "industrial-fan", price: 5500 }], receive: "store", payment: "cash", consent: true, customer: { name: "山田", email: "a" + at + "b.jp", line_name: "やまだ" } };
  assert.equal(validateShop_(ok), "");
  assert.equal(validateShop_({ ...ok, items: [{ id: "industrial-fan", price: 5500 }, { id: "drum-washer", price: 45000 }] }), "");
  assert.match(validateShop_({ ...ok, items: [] }), /商品を選んで/);
  assert.match(validateShop_({ ...ok, items: [{ id: "industrial-fan" }, { id: "electric-heater" }] }), /売切れ/);
  assert.match(validateShop_({ ...ok, items: [{ id: "industrial-fan" }, { id: "industrial-fan" }] }), /2回/);
  assert.match(validateShop_({ ...ok, items: [{ id: "nai" }] }), /見つかりません/);
  assert.match(validateShop_({ ...ok, receive: "delivery" }), /郵便番号/);
  assert.match(validateShop_({ ...ok, customer: { ...ok.customer, line_name: "" } }), /電話番号か LINE/);
  // 再計算：配送料は1回分、送料無料のごまかしは差あり
  const base = { ...ok, shop_updated: S.updated, receive: "delivery", items: [{ id: "drum-washer", price: 45000 }, { id: "industrial-fan", price: 5500 }] };
  const r1 = shopRecalc_({ ...base, delivery: { fee: 3000, consult: false, free_shipping: false }, total: 53500 });
  assert.equal(r1.t.total, 53500);
  assert.equal(r1.match, true);
  assert.equal(shopRecalc_({ ...base, delivery: { fee: 0, consult: false, free_shipping: true }, total: 50500 }).match, false, "送料無料でない商品があるのに 0円");
  assert.equal(shopRecalc_({ ...base, items: [{ id: "drum-washer", price: 45000 }], delivery: { fee: 0, consult: false, free_shipping: true }, total: 45000 }).match, true);
  assert.equal(shopRecalc_({ ...base, items: [{ id: "drum-washer", price: 40000 }, { id: "industrial-fan", price: 5500 }], delivery: { fee: 3000, consult: false }, total: 48500 }).match, false, "価格のずれ");
  assert.equal(shopRecalc_({ ...base, receive: "store", delivery: null, total: 50500 }).match, true);
  assert.equal(shopRecalc_({ ...base, items: [{ id: "industrial-fan", price: 5500 }, { id: "cupboard-white", price: null }], receive: "store", delivery: null, total: null }).match, true);
});
