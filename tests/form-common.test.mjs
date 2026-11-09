// フォーム共通：メール必須・メルマガ同意の記録・分析用 meta（個人を特定する値を入れない）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isEmail, postal3, buildMeta, referrerHost, hash8, newsletterRecord, NEWSLETTER_TEXT } from "../js/form-common.js";

const FORM_JS = fs.readFileSync(new URL("../js/form.js", import.meta.url), "utf8");

test("メールの形", () => {
  const at = "@";
  assert.ok(isEmail("a" + at + "b.jp"));
  assert.ok(!isEmail(""));
  assert.ok(!isEmail("a" + at + "b"));
});

test("郵便番号の上3桁（7桁のときだけ）", () => {
  assert.equal(postal3("861-1112"), "861");
  assert.equal(postal3("８６１１１１２"), "861");
  assert.equal(postal3("861"), "");
});

test("meta：ページ・参照元（ドメインだけ）・utm・端末・言語・画面", () => {
  const m = buildMeta({ href: "https://example.invalid/site/kaitori/?utm_source=flyer&utm_medium=qr&utm_campaign=nov#form-a", referrer: "https://www.google.com/search?q=secret", userAgent: "Mozilla/5.0 (iPhone)", language: "ja-JP", width: 390, height: 844 });
  assert.deepEqual(m, { page: "/site/kaitori/", referrer: "www.google.com", utm_source: "flyer", utm_medium: "qr", utm_campaign: "nov", device: "mobile", lang: "ja-JP", screen: "390x844" });
  assert.equal(buildMeta({ userAgent: "Mozilla/5.0 (X11; Linux)", width: 1280, height: 900 }).device, "desktop");
  assert.equal(referrerHost("not a url"), "");
  assert.equal(buildMeta({}).page, "");
});

test("メルマガ同意：opt_in・日時・同意文のハッシュ先頭8桁", async () => {
  const h = await hash8(NEWSLETTER_TEXT);
  assert.match(h, /^[0-9a-f]{8}$/);
  const r = await newsletterRecord(true, new Date("2026-11-09T00:00:00Z"));
  assert.deepEqual(r, { opt_in: true, at: "2026-11-09T00:00:00.000Z", text_hash: h });
  assert.match(NEWSLETTER_TEXT, /月1〜2回/);
});

test("概算フォーム：メールは必須、メルマガは既定オン、LINE名は任意、meta と postal3 を送る", () => {
  assert.match(FORM_JS, /メールアドレス<span class="req">必須<\/span>/);
  assert.match(FORM_JS, /name="newsletter" checked/);
  assert.match(FORM_JS, /LINE の名前<span class="opt">任意<\/span>/);
  assert.match(FORM_JS, /meta: browserMeta\(\)/);
  assert.match(FORM_JS, /postal3: postal3\(/);
});
