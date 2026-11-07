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
  p.cleanup_by_layout.forEach((r) => { assert.ok(nullOrNum(r.price_from), r.layout); assert.ok(hoursOk(r.hours), r.layout); });
  p.buyback_items.forEach((b) => { assert.ok(nullOrNum(b.max_price), b.id); assert.ok(nullOrNum(b.year_limit), b.id); });
  p.options.forEach((o) => assert.ok(nullOrNum(o.price), o.id));
  for (const [k, v] of Object.entries(p.condition_factor)) if (!k.startsWith("_")) assert.ok(typeof v === "number" && v >= 0 && v <= 1, k);
  for (const list of [p.collection_tiers, p.buyback_items, p.options]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(new Set(p.cleanup_by_layout.map((r) => r.layout)).size, p.cleanup_by_layout.length);
});

test("prices.json：provisional は真偽値、true なら provisional_note がある", () => {
  const p = read("data/prices.json");
  assert.equal(typeof p.provisional, "boolean");
  if (p.provisional) assert.ok(typeof p.provisional_note === "string" && p.provisional_note.includes("仮"), "provisional_note");
});

test("prices.json は prices.template.json と同じ形（キーが欠けていない）", () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(read("data/prices.json")), keys(read("prices.template.json")));
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
    const text = fs.readFileSync(path.join(ROOT, "data", f), "utf8");
    assert.deepEqual(scanText(text), [], f);
    // 「お客様」と更新日（"updated": "YYYY-MM-DD"）は対象外
    const plain = text.replace(/お客様/g, "").replace(/"updated":\s*"\d{4}-\d{2}-\d{2}"/g, "");
    for (const { name, re } of extra) assert.ok(!re.test(plain), `${f}: ${name}らしき文字列`);
  }
});
