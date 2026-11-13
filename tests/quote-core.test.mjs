import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { quoteBuyback, quoteCollection, quoteCleanup, quoteFromInput, parseQuoteQuery, sameQuote, hoursText, perkStatus, optionPrice, cleanupRows, OFFSET_NOTE } from "../js/quote-core.js";

// 金額の式の試験は tests/fixtures/prices.json（2026-11-13 の価格表の写し）で行う。data/prices.json は管理画面で変わるので、そちらは形だけを確かめる（tests/data.test.mjs）
const REAL = JSON.parse(fs.readFileSync(new URL("./fixtures/prices.json", import.meta.url), "utf8"));
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
  p.cleanup_by_kind.ihin.find((r) => r.layout === "2DK・2LDK").price_from = 80000;
  p.cleanup_by_kind.ihin.find((r) => r.layout === "2DK・2LDK").hours = 6;
  p.options.find((o) => o.id === "stairs").price = 2000;
  p.perks.same_day_up.rate = 0.2;
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
  const r2 = quoteCleanup("1R・1K", "akiya", [], null, BLANK);
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

// ---------- 今の価格表（2026-11-09 打合せの仮の金額・provisional: true） ----------
test("今の価格表：冷蔵庫2台・年式わからない・普通 → 0〜24,000円（要相談にならない）", () => {
  const r = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 2, year: "unknown", condition: "normal" }] }, REAL);
  assert.equal(r.undetermined, false);
  assert.equal(r.min, 0);
  assert.equal(r.max, 24000);
  assert.equal(r.provisional, REAL.provisional === true);
});

test("最低額：年式以内と分かれば下限は min_price の合計、難ありでも min_price を下回らない", () => {
  const r = quoteBuyback([{ id: "microwave", qty: 2, year: "within", condition: "damaged" }, { id: "gas_stove", qty: 1, year: "within", condition: "damaged" }], REAL);
  // レンジ 3000×0.2=600 → 最低 1000、コンロ 600 ≧ 500
  assert.equal(r.lines[0].unit_max, 1000);
  assert.equal(r.lines[1].unit_max, 600);
  assert.equal(r.min, 1000 * 2 + 500);
  assert.equal(r.max, 1000 * 2 + 600);
  // 年式超過は従来どおり 0
  const over = quoteBuyback([{ id: "microwave", qty: 1, year: "over", condition: "good" }], REAL);
  assert.equal(over.min, 0);
  assert.equal(over.max, 0);
});

test("同日査定：買取見込みの幅を 1.2 倍（10,000円の冷蔵庫→12,000円）、照合に含める", () => {
  const p = filled();
  const a = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "good" }] }, p);
  const b = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "good" }], same_day: true }, p);
  assert.equal(a.max, 10000);
  assert.equal(b.max, 12000);
  assert.equal(b.same_day, true);
  assert.equal(sameQuote(a, { ...a, same_day: true }), false);
  const r = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "good" }], same_day: true }, REAL);
  assert.equal(r.min, 1200);
  assert.equal(r.max, 24000);
  // 回収 B でも買取見込みに掛かる
  const bq = quoteFromInput({ form: "B", tier: "mini", options: [], items: [{ id: "fridge", qty: 1, year: "unknown", condition: "normal" }], same_day: true }, REAL);
  assert.equal(bq.buyback.max, 14400);
  assert.equal(parseQuoteQuery({ form: "A", same_day: "1" }).same_day, true);
});

test("特典：クオカードは下限が 15,000円以上で対象、上限だけ届けば査定しだい", () => {
  assert.equal(perkStatus({ min: 15000, max: 30000 }, REAL).quo_card, "eligible");
  assert.equal(perkStatus({ min: 0, max: 20000 }, REAL).quo_card, "possible");
  assert.equal(perkStatus({ min: 0, max: 9000 }, REAL).quo_card, "");
  assert.equal(perkStatus({ min: null, max: null, undetermined: true }, REAL).quo_card, "");
  const r = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "good" }] }, REAL);
  assert.equal(r.perks.quo_card, "possible");
});

test("今の価格表：回収「軽トラ」＋冷蔵庫1台（不明・普通）の買取見込みで、お会計が幅で出る", () => {
  const r = quoteFromInput({ form: "B", tier: "mini", options: [], items: [{ id: "fridge", qty: 1, year: "unknown", condition: "normal" }] }, REAL);
  assert.equal(r.undetermined, false);
  assert.equal(r.cost.amount, 12000);
  assert.equal(r.min, 12000 - 12000);
  assert.equal(r.max, 12000);
});

test("オプション：階段は無料、解体は回収 B で 2,000円・片付け C で無料", () => {
  const def = REAL.options.find((o) => o.id === "dismantle");
  assert.equal(optionPrice(def, "B"), 2000);
  assert.equal(optionPrice(def, "C"), 0);
  const b = quoteCollection("mini", [{ id: "dismantle", qty: 2 }, { id: "stairs", qty: 1 }], null, REAL);
  assert.equal(b.cost.amount, 12000 + 4000);
  assert.equal(b.lines.find((l) => l.id === "stairs").note, "無料");
  const c = quoteCleanup("1R・1K", "ihin", [{ id: "dismantle", qty: 3 }, { id: "stairs", qty: 1 }], null, REAL);
  assert.equal(c.cost.amount, 30000);
});

test("片付け：種類ごとの間取り表（2LDK 遺品 90,000・ゴミ屋敷 50,000、生前 1DK 以上は要相談）", () => {
  assert.equal(quoteCleanup("2DK・2LDK", "ihin", [], null, REAL).cost.amount, 90000);
  assert.equal(quoteCleanup("2DK・2LDK", "gomiyashiki", [], null, REAL).cost.amount, 50000);
  assert.equal(quoteCleanup("1R・1K", "seizen", [], null, REAL).cost.amount, 15000);
  assert.equal(quoteCleanup("1R・1K", "akiya", [], null, REAL).cost.amount, 20000);
  assert.equal(quoteCleanup("5LDK", "ihin", [], null, REAL).cost.amount, 420000);
  const s = quoteCleanup("1DK・1LDK", "seizen", [], null, REAL);
  assert.equal(s.undetermined, true);
  const r = quoteCleanup("2DK・2LDK", "ihin", [], null, REAL);
  assert.equal(r.hours, "3〜5時間");
  assert.equal(hoursText(r.hours), "3〜5時間");
  assert.equal(hoursText(6), "約6時間");
  assert.equal(hoursText(null), "");
  assert.equal(cleanupRows("souko", REAL), null);
  // 旧ラベル「1K」はもう無い
  assert.equal(quoteCleanup("1K", "ihin", [], null, REAL).undetermined, true);
});

test("倉庫・草刈り：10坪単位で切り上げ（倉庫 25坪 → 30坪分 150,000円、草刈り 10坪 35,000円）", () => {
  const a = quoteFromInput({ form: "C", kind: "souko", tsubo: 25, items: [] }, REAL);
  assert.equal(a.cost.amount, 150000);
  assert.equal(a.tsubo, 25);
  assert.equal(quoteCleanup(null, "kusakari", [], null, REAL, 10).cost.amount, 35000);
  assert.equal(quoteCleanup(null, "kusakari", [], null, REAL, 0).undetermined, true);
  assert.equal(parseQuoteQuery({ form: "C", kind: "souko", tsubo: "25" }).tsubo, 25);
  assert.equal(quoteCleanup(null, "other", [], null, REAL).undetermined, true, "その他は要相談");
});

test("今の価格表：どの品目・区分・間取り（生前整理の確認中を除く）・オプションも要相談にならない", () => {
  REAL.buyback_items.forEach((b) => assert.equal(quoteBuyback([{ id: b.id, qty: 1, year: "unknown", condition: "damaged" }], REAL).undetermined, false, b.id));
  const opts = REAL.options.map((o) => ({ id: o.id, qty: 1 })).concat([{ id: "kuyou" }]);
  REAL.collection_tiers.forEach((t) => assert.equal(quoteCollection(t.id, opts, null, REAL).undetermined, false, t.id));
  for (const [kind, rows] of Object.entries(REAL.cleanup_by_kind)) {
    rows.forEach((l) => {
      const r = quoteCleanup(l.layout, kind, opts, null, REAL);
      assert.equal(r.undetermined, l.price_from === null, kind + " " + l.layout);
      assert.equal(r.lines.find((x) => x.id === "kuyou").note, "料金は担当者から別途ご案内");
    });
  }
});
