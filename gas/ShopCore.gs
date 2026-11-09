// 自動生成：tools/build.mjs が js/shop-core.js から作る。手で直さない（直すのは js/shop-core.js）。
var ShopCore = (function () {
  // 販売商品の金額（純粋関数だけ）。販売ページ・注文フォーム・GAS の照合が同じ式を使う。
  // 商品は data/shop.json だけが正。price は税込、null は「価格は確認中」。sale は割引率（0.1 = 10% OFF）。
  // tools/build.mjs がこのファイルから gas/ShopCore.gs を生成する（export を外して var ShopCore に包む）。

  const SHOP_STATUS = { available: "販売中", reserved: "取り置き中", sold: "売切れ" };
  const RECEIVE = { store: "店頭で受け取る", delivery: "配送してもらう" };
  const SHOP_PAYMENTS = { cash: "現金", card: "クレジットカード", paypay: "PayPay" };

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function findItem(shop, id) {
    const list = (shop && shop.items) || [];
    return list.find(function (x) { return x.id === id; }) || null;
  }

  // 申し込めるか（販売中だけ）
  function orderable(item) {
    return !!item && item.status === "available";
  }

  // 商品の値段。{ list: 定価, price: 割引後（10円未満切り捨て）, sale: 割引率, undetermined }
  function shopPrice(item) {
    if (!item || !isNum(item.price)) return { list: null, price: null, sale: 0, undetermined: true };
    const rate = isNum(item.sale) && item.sale > 0 && item.sale < 1 ? item.sale : 0;
    const price = rate ? Math.floor((item.price * (1 - rate)) / 10) * 10 : item.price;
    return { list: item.price, price: price, sale: rate, undetermined: false };
  }

  // お支払いの目安 ＝ 商品代 ＋ 配送料。delivery は店頭受け取りなら null、配送なら delivery-core の deliveryQuote の返り値
  function orderTotal(item, receive, delivery) {
    const p = shopPrice(item);
    const isDelivery = receive === "delivery";
    const fee = !isDelivery ? 0 : delivery && !delivery.consult && isNum(delivery.fee) ? delivery.fee : null;
    const undetermined = p.undetermined || fee === null;
    return {
      goods: p.price,
      delivery_fee: fee,
      total: undetermined ? null : p.price + fee,
      undetermined: undetermined,
      note: p.undetermined ? "商品の価格は確認中です" : fee === null ? "配送料はご相談です" : ""
    };
  }

  // 画面の商品代と、受付での再計算が一致するか（GAS の照合用）
  function sameGoods(item, goodsPrice) {
    const p = shopPrice(item);
    return p.undetermined ? goodsPrice === null || goodsPrice === undefined : p.price === goodsPrice;
  }

  return { SHOP_STATUS: SHOP_STATUS, RECEIVE: RECEIVE, SHOP_PAYMENTS: SHOP_PAYMENTS, findItem: findItem, orderable: orderable, shopPrice: shopPrice, orderTotal: orderTotal, sameGoods: sameGoods };
})();
