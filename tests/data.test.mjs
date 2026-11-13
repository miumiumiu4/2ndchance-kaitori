import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanText } from "./secret-grep.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const nullOrNum = (v) => v === null || (typeof v === "number" && isFinite(v) && v >= 0);
// 作業時間は数値か「1〜2時間」のような文字列も可
const hoursOk = (v) => nullOrNum(v) || (typeof v === "string" && /^\d+(〜\d+)?時間$/.test(v));

test("data/*.json がすべて JSON として読める", () => {
  for (const f of fs.readdirSync(path.join(ROOT, "data"))) {
    if (f.endsWith(".json")) assert.doesNotThrow(() => read("data/" + f), f);
  }
});

test("prices.json：金額・時間は null か 0 以上の数値、id は重複なし", () => {
  const p = read("data/prices.json");
  assert.equal(p.currency, "JPY");
  assert.ok(p.updated === null || /^\d{4}-\d{2}-\d{2}$/.test(p.updated), "updated は null か YYYY-MM-DD");
  p.collection_tiers.forEach((t) => assert.ok(nullOrNum(t.price_from), "tier " + t.id));
  for (const [k, rows] of Object.entries(p.cleanup_by_kind)) {
    rows.forEach((r) => { assert.ok(nullOrNum(r.price_from), k + " " + r.layout); assert.ok(hoursOk(r.hours), k + " " + r.layout); });
    assert.equal(new Set(rows.map((r) => r.layout)).size, rows.length, k);
  }
  p.other_cleanup.forEach((o) => { assert.ok(nullOrNum(o.price_from), o.id); assert.ok(o.per_tsubo > 0, o.id); });
  p.buyback_items.forEach((b) => {
    assert.ok(nullOrNum(b.max_price), b.id); assert.ok(nullOrNum(b.min_price), b.id); assert.ok(nullOrNum(b.year_limit), b.id);
    if (b.min_price !== null && b.max_price !== null) assert.ok(b.min_price <= b.max_price, b.id + " 最低額 ≦ 上限");
  });
  p.options.forEach((o) => { assert.ok(nullOrNum(o.price), o.id); Object.values(o.price_by_form || {}).forEach((v) => assert.ok(nullOrNum(v), o.id)); });
  // 配送料：max_km は小さい順、最後だけ null（要相談）
  const dt = p.delivery_tiers;
  dt.forEach((d, i) => { assert.ok(nullOrNum(d.fee), d.label); if (i < dt.length - 1) assert.ok(d.max_km > (i ? dt[i - 1].max_km : 0), d.label); });
  assert.equal(dt[dt.length - 1].max_km, null);
  for (const [k, v] of Object.entries(p.condition_factor)) if (!k.startsWith("_")) assert.ok(typeof v === "number" && v >= 0 && v <= 1, k);
  for (const list of [p.collection_tiers, p.buyback_items, p.options]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  // 種類ごとの間取り表は同じ間取りの並び
  const lays = Object.values(p.cleanup_by_kind).map((rows) => rows.map((r) => r.layout).join("|"));
  assert.equal(new Set(lays).size, 1, "種類ごとの間取りの並びが同じ");
});

test("prices.json：provisional は真偽値、true なら provisional_note がある", () => {
  const p = read("data/prices.json");
  assert.equal(typeof p.provisional, "boolean");
  if (p.provisional) assert.ok(typeof p.provisional_note === "string" && p.provisional_note.includes("仮"), "provisional_note");
});

test("prices.json は prices.template.json と同じ形（キーが欠けていない）", () => {
  const keys = (o) => Object.keys(o).sort();
  const p = read("data/prices.json"), t = read("prices.template.json");
  assert.deepEqual(keys(p), keys(t));
  assert.deepEqual(keys(p.cleanup_by_kind), keys(t.cleanup_by_kind));
  assert.deepEqual(keys(p.perks), keys(t.perks));
});

// 金額そのものは管理画面で共同代表が変えるので data/prices.json には固定しない。
// 式の試験に使う写し（tests/fixtures/prices.json）が 11/9 打合せ＋11/13 配送料の表のままかを確かめる。
test("試験用の価格表（tests/fixtures/prices.json）：11/9 打合せの金額と 11/13 の配送料（10km 以内は無料）", () => {
  const p = read("tests/fixtures/prices.json");
  assert.equal(p.updated, "2026-11-13");
  assert.deepEqual(p.delivery_tiers.map((d) => [d.max_km, d.fee]), [[10, 0], [15, 3000], [20, 4000], [25, 5000], [30, 6000], [50, 10000], [null, null]], "配送料は店のチラシどおり（10km 以内は無料）");
  const b = Object.fromEntries(p.buyback_items.map((x) => [x.id, x]));
  ["fridge", "washer", "microwave", "gas_stove", "carpet", "curtain"].forEach((id) => assert.equal(b[id].year_limit, 5, id));
  assert.deepEqual([b.fridge.min_price, b.fridge.max_price], [1000, 20000]);
  assert.deepEqual([b.gas_stove.min_price, b.gas_stove.max_price], [500, 3000]);
  assert.equal(p.perks.quo_card.threshold, 15000);
  assert.equal(p.perks.same_day_up.rate, 0.2);
  assert.ok(!JSON.stringify(p).includes("40%"), "40% は書かない");
  const o = Object.fromEntries(p.options.map((x) => [x.id, x]));
  assert.equal(o.stairs.price, 0);
  assert.equal(o.dismantle.price, 2000);
  assert.equal(o.dismantle.price_by_form.C, 0);
  assert.equal(p.cleanup_by_kind.ihin[0].layout, "1R・1K");
  assert.equal(p.cleanup_by_kind.seizen[0].price_from, 15000);
  assert.ok(p.cleanup_by_kind.seizen.slice(1).every((r) => r.price_from === null), "生前整理の 1DK 以上は確認中");
  assert.equal(p.collection_tiers.find((t) => t.id === "mini").price_from, 12000);
});

test("items.json：prices.json の品目と1対1、アイコンがある", () => {
  const items = read("data/items.json").items;
  const prices = read("data/prices.json").buyback_items;
  assert.deepEqual(items.map((i) => i.id).sort(), prices.map((b) => b.id).sort());
  items.forEach((i) => {
    assert.ok(fs.existsSync(path.join(ROOT, "assets/icons", i.icon)), i.icon);
    assert.ok(i.check.length && i.reduce.length, i.id);
  });
  ["small", "mini", "basic", "large"].forEach((t) => assert.ok(fs.existsSync(path.join(ROOT, "assets/icons/truck-" + t + ".svg")), t));
});

test("areas.json：中心と半径、市町村に要確認フラグ", () => {
  const a = read("data/areas.json");
  assert.equal(a.center, "熊本県合志市");
  assert.equal(a.radius_km, 30);
  assert.ok(a.areas.length >= 9);
  a.areas.forEach((x) => { assert.equal(typeof x.needs_confirm, "boolean"); assert.match(x.name, /[市町村]$/); });
});

test("faq.json：12問程度、質問と答えが空でない", () => {
  const f = read("data/faq.json").faq;
  assert.ok(f.length >= 10 && f.length <= 15);
  f.forEach((x) => { assert.ok(x.q.trim()); assert.ok(x.a.trim()); });
});

test("results.json：配列と項目定義、各行が定義どおり", () => {
  const r = read("data/results.json");
  assert.ok(Array.isArray(r.results));
  assert.ok(r.fields && r.fields.price && r.fields.photo);
  r.results.forEach((x) => {
    assert.ok(x.id && x.item_id && x.name, "id・item_id・name は必須");
    assert.ok(nullOrNum(x.price), "price");
    if (x.date) assert.match(x.date, /^\d{4}-\d{2}$/, "日付は月まで");
    if (x.photo) assert.ok(fs.existsSync(path.join(ROOT, x.photo)), x.photo);
  });
});

test("data/*.json に個人情報らしき文字列が無い", () => {
  const extra = [
    { name: "郵便番号", re: /〒?\d{3}-\d{4}/ },
    { name: "番地", re: /\d+丁目|\d+番地|\d+-\d+-\d+/ },
    { name: "様", re: /[一-龥ァ-ヶ]{1,6}様/ }
  ];
  for (const f of fs.readdirSync(path.join(ROOT, "data"))) {
    if (!f.endsWith(".json")) continue; // data/postal/ は tests/delivery-core.test.mjs が確かめる
    const text = fs.readFileSync(path.join(ROOT, "data", f), "utf8");
    assert.deepEqual(scanText(text), [], f);
    // 「お客様」と更新日（"updated": "YYYY-MM-DD"）は対象外
    const plain = text.replace(/お客様/g, "").replace(/"updated":\s*"\d{4}-\d{2}-\d{2}"/g, "");
    for (const { name, re } of extra) assert.ok(!re.test(plain), `${f}: ${name}らしき文字列`);
  }
});
