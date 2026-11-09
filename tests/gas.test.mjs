// gas/Code.gs を素のスクリプトとして読み、外の世界（シート・メール）に触れない関数だけを確かめる
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read("gas/Prices.gs") + "\n" + read("gas/QuoteCore.gs") + "\n" + read("gas/Code.gs") + "\nthis.G = { HEADERS, validate_, colOf_, rowOf_, cell_, logDelivery_, quoteStr_ };", ctx);
  return ctx.G;
}

test("受付の列：名前の重複なし、分析用の列と商品・配送の列がある", () => {
  const { HEADERS } = load();
  assert.equal(new Set(HEADERS).size, HEADERS.length);
  for (const h of ["メール", "LINE名", "郵便番号(上3桁)", "メルマガ", "同意日時", "同意文(指紋)", "ページ", "参照元", "utm_source", "utm_medium", "utm_campaign", "端末", "言語", "画面", "商品ID", "配送料"]) assert.ok(HEADERS.includes(h), h);
  // gas/README.md に同じ列の一覧
  const readme = read("gas/README.md");
  HEADERS.forEach((h) => assert.ok(readme.includes("`" + h + "`"), "README に列 " + h));
});

test("列の文字と、式として読まれない値", () => {
  const { HEADERS, colOf_, cell_ } = load();
  assert.equal(colOf_(HEADERS, "受付番号"), "A");
  assert.equal(colOf_(["x", ...Array(26).fill("y"), "z"], "z"), "AB");
  assert.equal(cell_("=1+1"), "'=1+1");
});

test("受付：メールは必須", () => {
  const { validate_ } = load();
  const at = "@";
  const ok = { form: "A", input: { form: "A" }, consent: true, dates: [{ date: "2026-11-20" }], customer: { name_kana: "ヤマダ", tel: "0" + "900000000", address: "合志市", email: "a" + at + "b.jp" } };
  assert.equal(validate_(ok), "");
  assert.match(validate_({ ...ok, customer: { ...ok.customer, email: "" } }), /メール/);
});

test("配送料ログ：郵便番号の形が違えば書かない", () => {
  const { logDelivery_ } = load();
  assert.equal(logDelivery_({ zip: "12-34" }).ok, false);
});
