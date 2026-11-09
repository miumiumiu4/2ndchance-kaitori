// 郵便番号 → 配送料（js/delivery-core.js）と、生成した data/postal/*.json の形
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeZip, postalFile, haversineKm, deliveryTierFor, deliveryQuote, deliveryFeeText, ROAD_FACTOR } from "../js/delivery-core.js";
import { CONFIG } from "../js/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const PRICES = read("data/prices.json");
const STORE = CONFIG.STORE_LATLNG;
// 店から真東へ d km の点（緯度はそのまま）
const east = (d) => [STORE[0], STORE[1] + d / (111.32 * Math.cos((STORE[0] * Math.PI) / 180))];
const tableAt = (straightKm) => ({ "8600000": east(straightKm) });
const q = (straightKm, o = {}) => deliveryQuote("860-0000", tableAt(straightKm), PRICES, { store: STORE, ...o });

test("郵便番号の正規化：ハイフン・全角・〒を取り、7桁でなければ空", () => {
  assert.equal(normalizeZip("861-1112"), "8611112");
  assert.equal(normalizeZip("〒８６１－１１１２"), "8611112");
  assert.equal(normalizeZip(" 861 1112 "), "8611112");
  assert.equal(normalizeZip("86111"), "");
  assert.equal(normalizeZip(null), "");
  assert.equal(postalFile("861-1112"), "data/postal/861.json");
});

test("haversine：店から真東 10km は 10km（誤差 0.05km 以内）", () => {
  assert.ok(Math.abs(haversineKm(STORE, east(10)) - 10) < 0.05);
  assert.equal(haversineKm(STORE, STORE), 0);
});

test("料金区分：3km 無料・10km 2,000・30km 6,000・30〜50km 10,000・50km 超は要相談", () => {
  const t = PRICES.delivery_tiers;
  assert.equal(deliveryTierFor(2.9, t).tier.fee, 0);
  assert.equal(deliveryTierFor(3.1, t).tier.fee, 2000);
  assert.equal(deliveryTierFor(14, t).tier.fee, 3000);
  assert.equal(deliveryTierFor(30, t).tier.fee, 6000);
  assert.equal(deliveryTierFor(49, t).tier.fee, 10000);
  assert.equal(deliveryTierFor(51, t).tier.fee, null);
});

test("直線 × 1.3 を道のりの目安にして料金を出す", () => {
  assert.equal(ROAD_FACTOR, 1.3);
  const a = q(5); // 6.5km → 10km 以内
  assert.equal(a.km, 6.5);
  assert.equal(a.fee, 2000);
  assert.equal(a.consult, false);
  assert.equal(a.near_boundary, false);
  assert.equal(deliveryFeeText(a), "¥2,000");
  assert.equal(q(1).fee, 0);
  assert.equal(deliveryFeeText(q(1)), "無料");
  const far = q(40); // 52km
  assert.equal(far.consult, true);
  assert.equal(far.fee, null);
  assert.equal(deliveryFeeText(far), "要相談");
});

test("境界 ±1km は「お届けの前に確定」の注記", () => {
  const near = q(7.5); // 9.75km（10km の手前）
  assert.equal(near.fee, 2000);
  assert.equal(near.near_boundary, true);
  assert.match(near.note, /確定/);
  assert.equal(q(8).near_boundary, true); // 10.4km（10km を少し超えた）
  assert.equal(q(9).near_boundary, false); // 11.7km
});

test("送料無料の商品は 50km 以内なら 0円、50km 超は要相談", () => {
  assert.equal(q(30, { freeShipping: true }).fee, 0); // 39km
  assert.equal(q(30, { freeShipping: true }).free_shipping, true);
  assert.equal(q(40, { freeShipping: true }).consult, true); // 52km
});

test("表に無い郵便番号・形の違う番号は要相談", () => {
  const a = deliveryQuote("8999999", {}, PRICES, { store: STORE });
  assert.equal(a.ok, true);
  assert.equal(a.consult, true);
  const b = deliveryQuote("12", {}, PRICES, { store: STORE });
  assert.equal(b.ok, false);
  assert.equal(deliveryQuote("8611112", null, PRICES, { store: STORE }).consult, true);
});

test("data/postal：上3桁ごとの JSON、7桁 → [緯度, 経度]（小数4桁）、店の近くの番号が入っている", () => {
  const idx = read("data/postal/index.json");
  assert.ok(idx.count > 1000, "件数");
  assert.match(idx.source, /Geolonia/);
  let n = 0;
  for (const p3 of idx.prefixes) {
    const t = read(`data/postal/${p3}.json`);
    for (const [k, v] of Object.entries(t)) {
      assert.match(k, /^\d{7}$/);
      assert.equal(k.slice(0, 3), p3);
      assert.ok(Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number"), k);
      assert.ok(haversineKm(STORE, v) <= idx.radius_km + 0.1, k + " は半径の外");
      n++;
    }
  }
  assert.equal(n, idx.count);
  // 合志市幾久富（店の町域）は 3km 以内＝無料
  const koshi = read("data/postal/861.json");
  const r = deliveryQuote("861-1112", koshi, PRICES, { store: STORE });
  assert.equal(r.fee, 0);
  // 熊本市中央区の中心部は 10〜20km 程度
  const kc = deliveryQuote("860-0806", read("data/postal/860.json"), PRICES, { store: STORE });
  assert.ok(kc.km > 10 && kc.km < 25, String(kc.km));
});
