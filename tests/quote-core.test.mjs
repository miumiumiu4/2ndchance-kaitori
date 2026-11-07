import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { quoteBuyback, quoteCollection, quoteCleanup, quoteFromInput, parseQuoteQuery, sameQuote, OFFSET_NOTE } from "../js/quote-core.js";

const REAL = JSON.parse(fs.readFileSync(new URL("../data/prices.json", import.meta.url), "utf8"));

// 金額を入れた試験用の価格表（本物の prices.json は書き換えない）
function filled() {
  const p = structuredClone(REAL);
  p.updated = "2026-11-07";
  p.buyback_items.find((b) => b.id === "fridge").max_price = 10000;
  p.buyback_items.find((b) => b.id === "fridge").year_limit = 7;
  p.buyback_items.find((b) => b.id === "washer").max_price = 5000;
  p.collection_tiers.find((t) => t.id === "mini").price_from = 15000;
  p.cleanup_by_layout.find((r) => r.layout === "2DK・2LDK").price_from = 80000;
  p.cleanup_by_layout.find((r) => r.layout === "2DK・2LDK").hours = 6;
  p.options.find((o) => o.id === "stairs").price = 2000;
  return p;
}

test("今の価格表（null）では冷蔵庫2台は要相談（undetermined）", () => {
  const r = quoteBuyback([{ id: "fridge", qty: 2, year: "within", condition: "good" }], REAL);
  assert.equal(r.undetermined, true);
  assert.equal(r.min, null);
  assert.equal(r.max, null);
  assert.equal(r.lines[0].note, "要相談");
});

test("買取：上限 × 年式係数 × 状態係数 × 台数、下限は 0", () => {
  const p = filled();
  const r = quoteBuyback([
    { id: "fridge", qty: 2, year: "within", condition: "good" },
    { id: "washer", qty: 1, year: "within", condition: "normal" }
  ], p);
  assert.equal(r.undetermined, false);
  assert.equal(r.max, 10000 * 2 + 3000);
  assert.equal(r.min, 0);
});

test("年式超過は買取見込み 0・回収扱い（上限が null でも 0 で確定）", () => {
  const p = filled();
  const r = quoteBuyback([{ id: "fridge", qty: 1, year: "over", condition: "good" }], p);
  assert.equal(r.max, 0);
  assert.match(r.lines[0].note, /回収扱い/);
  const r2 = quoteBuyback([{ id: "fridge", qty: 1, year: "over", condition: "good" }], REAL);
  assert.equal(r2.undetermined, false);
  assert.equal(r2.max, 0);
});

test("不明な品目・0台・上限を超える台数の扱い", () => {
  const p = filled();
  const r = quoteBuyback([{ id: "piano", qty: 1 }, { id: "fridge", qty: 0 }, { id: "washer", qty: 999, year: "within", condition: "good" }], p);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 20);
  assert.equal(r.notes.length, 1);
});

test("不用品回収：費用 − 買取見込み を幅で返す（相殺）", () => {
  const p = filled();
  const bb = quoteBuyback([{ id: "fridge", qty: 1, year: "within", condition: "normal" }], p); // 0〜6000
  const r = quoteCollection("mini", [{ id: "stairs", qty: 1 }], bb, p); // 費用 17000
  assert.equal(r.undetermined, false);
  assert.equal(r.cost.amount, 17000);
  assert.equal(r.min, 17000 - 6000);
  assert.equal(r.max, 17000);
  assert.equal(r.offset_note, OFFSET_NOTE);
});

test("買取見込みが費用を上回るとお会計はマイナス（お客様の受け取り）", () => {
  const p = filled();
  const bb = quoteBuyback([{ id: "fridge", qty: 3, year: "within", condition: "good" }], p); // 0〜30000
  const r = quoteCollection("mini", [], bb, p);
  assert.equal(r.min, 15000 - 30000);
  assert.equal(r.max, 15000);
});

test("区分の価格が null なら要相談", () => {
  const r = quoteCollection("mini", [], null, REAL);
  assert.equal(r.undetermined, true);
  assert.equal(r.min, null);
});

test("オプションの価格が null なら要相談、相談だけのオプションは額に足さない", () => {
  const p = filled();
  const r = quoteCollection("mini", [{ id: "dismantle", qty: 1 }], null, p);
  assert.equal(r.undetermined, true);
  const r2 = quoteCollection("mini", [{ id: "sorting" }], null, p);
  assert.equal(r2.undetermined, false);
  assert.equal(r2.max, 15000);
  assert.ok(r2.lines.some((l) => l.consult));
});

test("買取見込みが要相談なら、お会計も要相談", () => {
  const p = filled();
  const bb = quoteBuyback([{ id: "sofa", qty: 1, year: "within", condition: "good" }], p);
  assert.equal(bb.undetermined, true);
  const r = quoteCollection("mini", [], bb, p);
  assert.equal(r.undetermined, true);
});

test("片付け：間取りの基本料 + オプション − 買取見込み、作業時間つき", () => {
  const p = filled();
  const bb = quoteBuyback([{ id: "washer", qty: 1, year: "within", condition: "good" }], p); // 0〜5000
  const r = quoteCleanup("2DK・2LDK", "ihin", [{ id: "stairs", qty: 2 }, { id: "kuyou" }], bb, p);
  assert.equal(r.hours, 6);
  assert.equal(r.cost.amount, 84000);
  assert.equal(r.min, 79000);
  assert.equal(r.max, 84000);
  assert.equal(r.cleanup_kind, "ihin");
  assert.ok(r.includes.length > 0);
  const r2 = quoteCleanup("1K", "akiya", [], null, REAL);
  assert.equal(r2.undetermined, true);
});

test("quoteFromInput と parseQuoteQuery（AI 向け action=quote）が同じ答えになる", () => {
  const p = filled();
  const input = parseQuoteQuery({ form: "b", tier: "mini", options: "stairs:1", items: "fridge:1:within:normal" });
  assert.equal(input.form, "B");
  const a = quoteFromInput(input, p);
  const b = quoteCollection("mini", [{ id: "stairs", qty: 1 }], quoteBuyback([{ id: "fridge", qty: 1, year: "within", condition: "normal" }], p), p);
  assert.equal(a.min, b.min);
  assert.equal(a.max, b.max);
  assert.ok(sameQuote(a, b));
  assert.equal(quoteFromInput({ form: "X" }, p).error !== undefined, true);
});

test("画面の額が書き換えられていたら照合で差が出る", () => {
  const p = filled();
  const real = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "good" }] }, p);
  assert.equal(sameQuote(real, { ...real, max: 999999 }), false);
});
