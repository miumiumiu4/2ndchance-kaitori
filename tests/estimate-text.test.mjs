// 固定バーの概算パネルと概算の箱が同じ関数・同じ文字列を使うこと、初期は非表示で差し込まれること
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { quoteFromInput } from "../js/quote-core.js";
import { estimateValueText, stickyEstimate, ESTIMATE_LABEL } from "../js/estimate-text.js";

// 金額の式の試験は tests/fixtures/prices.json（2026-11-13 の価格表の写し）で行う。data/prices.json は管理画面で変わるので、そちらは形だけを確かめる（tests/data.test.mjs）
const REAL = JSON.parse(fs.readFileSync(new URL("./fixtures/prices.json", import.meta.url), "utf8"));
const BLANK = JSON.parse(fs.readFileSync(new URL("../prices.template.json", import.meta.url), "utf8"));
const FORM_JS = fs.readFileSync(new URL("../js/form.js", import.meta.url), "utf8");
const CSS = fs.readFileSync(new URL("../css/site.css", import.meta.url), "utf8");
const fridge = (qty, year = "unknown") => [{ id: "fridge", qty, year, condition: "normal" }];

test("ラベル：A は買取見込み、B/C はお会計の目安", () => {
  assert.equal(ESTIMATE_LABEL.A, "買取見込み");
  assert.equal(ESTIMATE_LABEL.B, "お会計の目安");
  assert.equal(ESTIMATE_LABEL.C, "お会計の目安");
});

test("パネルの金額は quote-core の結果そのまま（フォームA）", () => {
  const r = quoteFromInput({ form: "A", items: fridge(1) }, REAL);
  const s = stickyEstimate("A", r, true);
  assert.equal(s.label, "買取見込み");
  if (r.undetermined) assert.equal(s.value, "要相談");
  else assert.equal(s.value, "0円 〜 ¥" + r.max.toLocaleString("ja-JP"));
  const w = quoteFromInput({ form: "A", items: [{ id: "fridge", qty: 1, year: "within", condition: "normal" }] }, REAL);
  assert.equal(estimateValueText("A", w), "¥1,000 〜 ¥12,000", "年式以内なら最低額から");
  assert.equal(stickyEstimate("C", quoteFromInput({ form: "C", kind: "souko", items: [] }, REAL), false).value, "坪数を入れてください");
  assert.equal(s.value, estimateValueText("A", r));
  assert.equal(s.provisional, !!REAL.provisional);
  assert.equal(stickyEstimate("A", quoteFromInput({ form: "A", items: [] }, REAL)).value, "品目を選んでください");
  assert.equal(stickyEstimate("A", quoteFromInput({ form: "A", items: fridge(1, "over") }, REAL)).value, "0円（回収扱い）");
});

test("パネルの金額は quote-core の結果そのまま（フォームB：軽トラ＋冷蔵庫1台）", () => {
  const r = quoteFromInput({ form: "B", tier: "mini", items: fridge(1), options: [] }, REAL);
  const s = stickyEstimate("B", r, true);
  assert.equal(s.label, "お会計の目安");
  if (!r.undetermined) {
    const want = r.min === r.max ? "¥" + r.min.toLocaleString("ja-JP") : "¥" + r.min.toLocaleString("ja-JP") + " 〜 ¥" + r.max.toLocaleString("ja-JP");
    assert.equal(s.value, want);
  }
  assert.equal(stickyEstimate("B", quoteFromInput({ form: "B", tier: null, items: [] }, REAL), false).value, "量を選んでください");
  assert.equal(stickyEstimate("C", quoteFromInput({ form: "C", layout: null, kind: "ihin", items: [] }, REAL), false).value, "間取りを選んでください");
});

test("金額が null の価格表では、パネルも「要相談」", () => {
  assert.equal(stickyEstimate("A", quoteFromInput({ form: "A", items: fridge(2) }, BLANK)).value, "要相談");
  assert.equal(stickyEstimate("B", quoteFromInput({ form: "B", tier: "mini", items: [], options: [] }, BLANK), true).value, "要相談");
  assert.equal(stickyEstimate("C", quoteFromInput({ form: "C", layout: "2DK・2LDK", kind: "ihin", items: [], options: [] }, BLANK), true).value, "要相談");
  assert.equal(stickyEstimate("A", quoteFromInput({ form: "A", items: fridge(2) }, BLANK)).provisional, false);
});

test("form.js：パネルを固定バーに初期非表示で差し込み、IntersectionObserver で出す。箱と同じ計算結果を渡す", () => {
  assert.match(FORM_JS, /className = "cta-est"/);
  assert.match(FORM_JS, /btn\.hidden = true;/);
  assert.match(FORM_JS, /IntersectionObserver/);
  assert.match(FORM_JS, /const r = calc\(\);\s*est\.innerHTML = estimateHTML\(r\);\s*sticky\.update\(stickyEstimate\(st\.form, r, chosenNow\(\)\)\);/);
  assert.match(FORM_JS, /prefers-reduced-motion/);
});

test("site.css：パネルは 44px 以上・16px 以上、下余白を足し、reduced-motion でアニメ無し", () => {
  assert.match(CSS, /\.cta-est \{[^}]*min-height: 44px/);
  assert.match(CSS, /\.cta-est \{[^}]*font-size: 16px/);
  assert.match(CSS, /\.cta-est\[hidden\] \{ display: none; \}/);
  assert.match(CSS, /body\.has-cta-est \{[^}]*padding-bottom: calc\(var\(--cta-h\) \+ var\(--cta-est-h\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.cta-est \{ animation: none; \} \}/);
});
