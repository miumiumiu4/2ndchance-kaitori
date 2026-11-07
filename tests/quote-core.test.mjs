import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { quoteBuyback, quoteCollection, quoteCleanup, quoteFromInput, parseQuoteQuery, sameQuote, hoursText, OFFSET_NOTE } from "../js/quote-core.js";

const REAL = JSON.parse(fs.readFileSync(new URL("../data/prices.json", import.meta.url), "utf8"));
// 金額が全部 null の価格表（形の見本）。「要相談」の振る舞いはこれで確かめる
const BLANK = JSON.parse(fs.readFileSync(new URL("../prices.template.json", import.meta.url), "utf8"));

// 一部だけ金額を入れた試験用の価格表（本物の prices.json は書き換えない）
function filled() {
  const p = structuredClone(BLANK);
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

test("金額が null の価格表では冷蔵庫2台は要相談（undetermined）", () => {
  const r = quoteBuyback([{ id: "fridge", qty: 2, year: "within", condition: "good" }], BLANK);
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
  const r2 = quoteBuyback([{ id: "fridge", qty: 1, year: "over", condition: "good" }], BLANK);
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
  const r = quoteCollection("mini", [], null, BLANK);
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
  const r2 = quoteCleanup("1K", "akiya", [], null, BLANK);
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

// ---------- 今の価格表（仮の一般的な金額・provisional: true） ----------
test("今の価格表：冷蔵庫2台・目安年数以内・普通 → 0〜18,000円（要相談にならない）", () => {
  const r = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 2, year: "within", condition: "normal" }] }, REAL);
  assert.equal(r.undetermined, false);
  assert.equal(r.min, 0);
  assert.equal(r.max, 18000);
  assert.equal(r.provisional, REAL.provisional === true);
});

test("今の価格表：回収「軽トラ」＋冷蔵庫1台（以内・普通）の買取見込みで、お会計が幅で出る", () => {
  const r = quoteFromInput({ form: "B", tier: "mini", options: [], items: [{ id: "fridge", qty: 1, year: "within", condition: "normal" }] }, REAL);
  assert.equal(r.undetermined, false);
  assert.equal(r.cost.amount, 18000);
  assert.equal(r.min, 18000 - 9000);
  assert.equal(r.max, 18000);
});

test("今の価格表：片付け 2LDK は 50,000〜、作業時間は文字列のまま", () => {
  const r = quoteCleanup("2DK・2LDK", "ihin", [], null, REAL);
  assert.equal(r.undetermined, false);
  assert.equal(r.cost.amount, 50000);
  assert.equal(r.min, 50000);
  assert.equal(r.hours, "3〜5時間");
  assert.equal(hoursText(r.hours), "3〜5時間");
  assert.equal(hoursText(6), "約6時間");
  assert.equal(hoursText(null), "");
});

test("今の価格表：どの品目・区分・間取り・オプションも要相談にならない（相談だけのオプションは別途ご案内）", () => {
  REAL.buyback_items.forEach((b) => assert.equal(quoteBuyback([{ id: b.id, qty: 1, year: "unknown", condition: "damaged" }], REAL).undetermined, false, b.id));
  const opts = REAL.options.map((o) => ({ id: o.id, qty: 1 })).concat([{ id: "kuyou" }]);
  REAL.collection_tiers.forEach((t) => assert.equal(quoteCollection(t.id, opts, null, REAL).undetermined, false, t.id));
  REAL.cleanup_by_layout.forEach((l) => {
    const r = quoteCleanup(l.layout, "other", opts, null, REAL);
    assert.equal(r.undetermined, false, l.layout);
    assert.equal(r.lines.find((x) => x.id === "kuyou").note, "料金は担当者から別途ご案内");
  });
});
