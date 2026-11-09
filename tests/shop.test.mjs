// 販売ページ：data/shop.json の形、商品代の式、生成した一覧・商品ページ・JSON-LD
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { shopPrice, orderTotal, sameGoods, orderable, findItem } from "../js/shop-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SHOP = JSON.parse(read("data/shop.json"));

test("shop.json：id 重複なし、価格は null か 0 以上、status と写真がある、payment_link は今は空", () => {
  const ids = SHOP.items.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  SHOP.items.forEach((x) => {
    assert.match(x.id, /^[a-z0-9-]+$/);
    assert.ok(x.price === null || (Number.isInteger(x.price) && x.price >= 0), x.id);
    assert.ok(["available", "reserved", "sold"].includes(x.status), x.id);
    assert.equal(typeof x.free_shipping, "boolean");
    assert.equal(typeof x.payment_link, "string");
    assert.equal(x.payment_link, "", "決済リンクは段階1では空");
    x.photos.forEach((p) => { assert.ok(fs.existsSync(path.join(ROOT, p)), p); assert.ok(fs.existsSync(path.join(ROOT, p.replace(/\.jpg$/, "-480.jpg"))), p + " のサムネ"); });
  });
  assert.equal(findItem(SHOP, "electric-heater").status, "sold");
  assert.equal(SHOP.hold_days, 3);
  assert.match(SHOP.payment_note, /現金・クレジットカード・PayPay/);
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

test("お支払いの目安 ＝ 商品代 ＋ 配送料（店頭は 0、配送料が要相談なら目安も要相談）", () => {
  const fan = findItem(SHOP, "industrial-fan");
  assert.equal(orderTotal(fan, "store", null).total, 5500);
  assert.equal(orderTotal(fan, "delivery", { fee: 2000, consult: false }).total, 7500);
  assert.equal(orderTotal(fan, "delivery", { fee: null, consult: true }).total, null);
  assert.equal(orderTotal(fan, "delivery", null).undetermined, true);
  assert.equal(orderTotal(findItem(SHOP, "dresser-mirror"), "store", null).undetermined, true);
});

test("一覧と商品ページ：全商品のページがあり、Product と Offer の JSON-LD、売切れは帯と申込不可", () => {
  const list = read("shop/index.html");
  SHOP.items.forEach((it) => {
    assert.ok(list.includes(`href="../shop/${it.id}/"`), it.id);
    const html = read(`shop/${it.id}/index.html`);
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
    const prod = ld["@graph"].find((x) => x["@type"] === "Product");
    assert.equal(prod.name, it.name);
    assert.equal(prod.offers["@type"], "Offer");
    if (it.price !== null) assert.equal(prod.offers.price, shopPrice(it).price);
    else assert.equal(prod.offers.description, "価格は確認中");
    if (it.status === "available") assert.ok(html.includes(`shop/?item=${it.id}#order`), it.id + " の申込ボタン");
    else assert.ok(!html.includes(`?item=${it.id}#order`));
    assert.ok(!html.includes("カードで支払う"), "payment_link が空なら出さない");
  });
  assert.match(list, /class="shop-band shop-band-sold">売切れ/);
  assert.match(list, /data-shop-root/);
  assert.match(list, /ネット決済は準備中/);
  assert.match(list, /お取り置きは3日間（仮）/);
  // トップ・ナビ
  assert.match(read("index.html"), /<a href="\.\/shop\/">販売中の商品<\/a>/);
});

test("GAS：ShopCore.gs と Shop.gs が素のスクリプトとして動き、注文の確かめ", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(["gas/Prices.gs", "gas/QuoteCore.gs", "gas/ShopCore.gs", "gas/Shop.gs", "gas/Code.gs"].map(read).join("\n") + "\nthis.G = { ShopCore, SHOP, validateShop_ };", ctx);
  const { ShopCore, SHOP: S, validateShop_ } = ctx.G;
  assert.equal(ShopCore.shopPrice(ShopCore.findItem(S, "citizen-wall-clock")).price, 2970);
  const at = "@";
  const ok = { item_id: "industrial-fan", receive: "store", payment: "cash", consent: true, customer: { name: "山田", email: "a" + at + "b.jp", line_name: "やまだ" } };
  assert.equal(validateShop_(ok), "");
  assert.match(validateShop_({ ...ok, item_id: "electric-heater" }), /売切れ/);
  assert.match(validateShop_({ ...ok, receive: "delivery" }), /郵便番号/);
  assert.match(validateShop_({ ...ok, customer: { ...ok.customer, line_name: "" } }), /電話番号か LINE/);
});
