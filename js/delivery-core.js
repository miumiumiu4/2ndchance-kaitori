// 配送料の計算（純粋関数だけ）。購入商品の配送（販売ページの注文フォーム）で使う。
// 料金表は data/prices.json の delivery_tiers（ネット注文の表。店頭購入の delivery_tiers_store は料金ページの表示だけ）。郵便番号 → 緯度経度は data/postal/<上3桁>.json。
// 道のりの目安 ＝ 店からの直線距離（haversine）× ROAD_FACTOR。境界 ±BOUNDARY_KM は「お届け時に確定」の注記つき。

export const ROAD_FACTOR = 1.3;
export const BOUNDARY_KM = 1;
export const FREE_SHIPPING_MAX_KM = 50;

// 全角数字・ハイフン・〒・空白を取り除いて 7桁に。7桁でなければ ""。
export function normalizeZip(s) {
  const half = String(s == null ? "" : s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const d = half.replace(/[〒\s\-‐－ー−]/g, "");
  return /^\d{7}$/.test(d) ? d : "";
}

// 郵便番号の表のファイル名（上3桁）
export function postalFile(zip) {
  const z = normalizeZip(zip);
  return z ? "data/postal/" + z.slice(0, 3) + ".json" : "";
}

// 2点間の直線距離（km）。点は [緯度, 経度]
export function haversineKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 道のりの目安（km）→ 料金区分。tiers は max_km の小さい順、最後は max_km: null（要相談）
export function deliveryTierFor(km, tiers) {
  const list = tiers || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.max_km === null || t.max_km === undefined || km <= t.max_km) return { tier: t, index: i };
  }
  return { tier: null, index: -1 };
}

// 配送料の目安。
//   zip: 郵便番号、table: その上3桁の表 { "8611112": [lat, lng], … }（読めなければ null）
//   prices: data/prices.json、opts: { store: [lat, lng], freeShipping: true|false }
// 返り値：{ ok, zip, postal3, km, straight_km, band, fee, consult, near_boundary, note }
//   fee は数値（0 は無料）か null（要相談）。consult が true なら「要相談」。
export function deliveryQuote(zip, table, prices, opts) {
  const o = opts || {};
  const z = normalizeZip(zip);
  const base = { ok: false, zip: z, postal3: z ? z.slice(0, 3) : "", km: null, straight_km: null, band: "", fee: null, consult: true, near_boundary: false, note: "" };
  if (!z) return { ...base, note: "郵便番号は7桁で入れてください" };
  const ll = table && Object.prototype.hasOwnProperty.call(table, z) ? table[z] : null;
  if (!ll || !o.store) return { ...base, ok: true, band: "要相談", note: "この郵便番号は配送料の表にありません（店から遠い・番号が新しいなど）。配送料はご相談ください" };
  const straight = haversineKm(o.store, ll);
  const km = Math.round(straight * ROAD_FACTOR * 10) / 10;
  const tiers = (prices && prices.delivery_tiers) || [];
  const { tier, index } = deliveryTierFor(km, tiers);
  const r = { ...base, ok: true, km: km, straight_km: Math.round(straight * 10) / 10 };
  if (!tier || tier.fee === null || tier.fee === undefined) {
    return { ...r, band: tier ? tier.label : "要相談", fee: null, consult: true, note: "店から" + FREE_SHIPPING_MAX_KM + "km を超えるため、配送料はご相談ください" };
  }
  const lower = index > 0 ? tiers[index - 1].max_km : 0;
  const near = (lower > 0 && km - lower <= BOUNDARY_KM) || (typeof tier.max_km === "number" && tier.max_km - km <= BOUNDARY_KM);
  const free = !!o.freeShipping && km <= FREE_SHIPPING_MAX_KM;
  return {
    ...r,
    band: tier.label,
    fee: free ? 0 : tier.fee,
    consult: false,
    free_shipping: free,
    near_boundary: near && !free,
    note: free ? "送料無料の商品です（" + FREE_SHIPPING_MAX_KM + "km 以内）" : near ? "区分の境目に近いため、配送料はお届けの前に確定します" : ""
  };
}

// 表示用の文字列（「無料」「¥2,000」「要相談」）
export function deliveryFeeText(q) {
  if (!q || q.consult || q.fee === null) return "要相談";
  return q.fee === 0 ? "無料" : "¥" + q.fee.toLocaleString("ja-JP");
}
