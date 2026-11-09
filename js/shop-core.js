// 販売商品の金額（純粋関数だけ）。販売ページ・注文フォーム・GAS の照合が同じ式を使う。
// 商品は data/shop.json だけが正。price は税込、null は「価格は確認中」。sale は割引率（0.1 = 10% OFF）。
// tools/build.mjs がこのファイルから gas/ShopCore.gs を生成する（export を外して var ShopCore に包む）。

export const SHOP_STATUS = { available: "販売中", reserved: "取り置き中", sold: "売切れ" };
export const RECEIVE = { store: "店頭で受け取る", delivery: "配送してもらう" };
export const SHOP_PAYMENTS = { cash: "現金", card: "クレジットカード", paypay: "PayPay" };

function isNum(v) {
  return typeof v === "number" && isFinite(v);
}

export function findItem(shop, id) {
  const list = (shop && shop.items) || [];
  return list.find(function (x) { return x.id === id; }) || null;
}

// 申し込めるか（販売中だけ）
export function orderable(item) {
  return !!item && item.status === "available";
}

// 商品の値段。{ list: 定価, price: 割引後（10円未満切り捨て）, sale: 割引率, undetermined }
export function shopPrice(item) {
  if (!item || !isNum(item.price)) return { list: null, price: null, sale: 0, undetermined: true };
  const rate = isNum(item.sale) && item.sale > 0 && item.sale < 1 ? item.sale : 0;
  const price = rate ? Math.floor((item.price * (1 - rate)) / 10) * 10 : item.price;
  return { list: item.price, price: price, sale: rate, undetermined: false };
}

// ---------- カート（中古品は1点もの：数量なし。入っているか、いないか） ----------
export const CART_MAX = 30;

// 保存した文字列（sessionStorage の JSON）→ id の配列。形の違う値・重複は捨てる
export function parseCart(text) {
  let a;
  try { a = JSON.parse(text || "[]"); } catch (_) { return []; }
  if (!Array.isArray(a)) return [];
  const out = [];
  for (let i = 0; i < a.length && out.length < CART_MAX; i++) {
    const id = a[i];
    if (typeof id === "string" && /^[a-z0-9-]{1,60}$/.test(id) && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

export function inCart(ids, id) {
  return (ids || []).indexOf(id) >= 0;
}

// 入れる（入っていれば外す）。新しい配列を返す
export function toggleCart(ids, id) {
  const list = (ids || []).slice();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else if (list.length < CART_MAX) list.push(id);
  return list;
}

// id の並び → 申し込める商品。{ items: 販売中の商品（カートの順）, dropped: 見つからない・売切れ・取り置き中の id }
export function resolveCart(shop, ids) {
  const items = [];
  const dropped = [];
  (ids || []).forEach(function (id) {
    const it = findItem(shop, id);
    if (orderable(it) && items.indexOf(it) < 0) items.push(it);
    else dropped.push(id);
  });
  return { items: items, dropped: dropped };
}

// カートの商品がすべて送料無料か（1点でも送料無料でなければ通常の配送料）
export function cartFreeShipping(items) {
  return !!items && items.length > 0 && items.every(function (it) { return !!it.free_shipping; });
}

// 配送料（1回の注文で1回）。店頭は 0、配送は delivery-core の deliveryQuote の返り値から。要相談は null
export function cartDeliveryFee(receive, delivery) {
  if (receive !== "delivery") return 0;
  return delivery && !delivery.consult && isNum(delivery.fee) ? delivery.fee : null;
}

// お支払いの目安 ＝ 商品代の合計 ＋ 配送料（1回分）。deliveryFee は数値（店頭は 0）か null（要相談）
//   goods：価格の決まっている商品の合計、pending：価格が確認中の点数
//   known_total：分かっている分の合計（商品代＋配送料）、total：全部決まっているときだけ数値（それ以外 null）
export function cartTotal(items, deliveryFee) {
  const list = items || [];
  let goods = 0;
  let pending = 0;
  list.forEach(function (it) {
    const p = shopPrice(it);
    if (p.undetermined) pending++;
    else goods += p.price;
  });
  const fee = isNum(deliveryFee) ? deliveryFee : null;
  const complete = list.length > 0 && pending === 0 && fee !== null;
  const known = goods + (fee || 0);
  return {
    count: list.length,
    goods: goods,
    pending: pending,
    delivery_fee: fee,
    known_total: known,
    total: complete ? known : null,
    undetermined: !complete,
    note: !list.length ? "" : pending ? "価格が確認中の商品は、担当者から金額をお伝えします" : fee === null ? "配送料はご相談です" : ""
  };
}

// 金額の書き方（¥12,345）。画面と GAS のメールで同じ書き方にする
export function yenText(n) {
  return "¥" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 商品代の合計の言い方：「¥50,500」「¥50,500 ＋確認中の商品」「確認中の商品」
export function cartGoodsText(t) {
  if (!t || !t.count) return "";
  if (!t.pending) return yenText(t.goods);
  return t.goods > 0 ? yenText(t.goods) + " ＋確認中の商品" : "確認中の商品";
}

// お支払いの目安の言い方：「¥52,500」「¥52,500 ＋確認中の商品」「¥50,500 ＋配送料（要相談）」
export function cartTotalText(t) {
  if (!t || !t.count) return "";
  if (t.total !== null) return yenText(t.total);
  const extra = [];
  if (t.pending) extra.push("確認中の商品");
  if (t.delivery_fee === null) extra.push("配送料（要相談）");
  return t.known_total > 0 ? yenText(t.known_total) + " ＋" + extra.join("・") : extra.join("・");
}

// 画面の [{id, price}] と、受付での再計算が一致するか（GAS の照合用）
export function sameCart(shop, lines) {
  if (!lines || !lines.length) return false;
  return lines.every(function (x) {
    const it = x && findItem(shop, x.id);
    return !!it && sameGoods(it, x.price);
  });
}

// 画面の商品代と、受付での再計算が一致するか（GAS の照合用）
export function sameGoods(item, goodsPrice) {
  const p = shopPrice(item);
  return p.undetermined ? goodsPrice === null || goodsPrice === undefined : p.price === goodsPrice;
}
