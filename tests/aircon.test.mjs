// ありがとうエアコンの予約フォームへの送客リンク（設定1か所・紹介番号のパラメータ）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { airconHref, airconItem, airconLink } from "../tools/aircon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// 関数の単体試験は「?」の無い素の URL で、設定の確認は実際の入口（予約フォームの welcome ページ・src 付き）で
const URL_ = "https://miumiumiu4.github.io/arigatou-booking/";
const WELCOME = "https://miumiumiu4.github.io/arigatou-booking/welcome/?src=2ndchance";
const cfg = (o) => ({ AIRCON_BOOKING_URL: URL_, AIRCON_REF_PARAM: "ref", AIRCON_REF_CODE: "", ...o });

test("CODE が空のとき href は素の BOOKING_URL", () => {
  assert.equal(airconHref(cfg({})), URL_);
  assert.equal(airconHref(cfg({ AIRCON_REF_CODE: undefined })), URL_);
});

test("CODE=TEST123 PARAM=ref で ?ref=TEST123、PARAM=partner でも同様", () => {
  assert.equal(airconHref(cfg({ AIRCON_REF_CODE: "TEST123" })), URL_ + "?ref=TEST123");
  assert.equal(airconHref(cfg({ AIRCON_REF_PARAM: "partner", AIRCON_REF_CODE: "C012" })), URL_ + "?partner=C012");
  assert.equal(airconHref(cfg({ AIRCON_REF_CODE: "a b&c" })), URL_ + "?ref=a%20b%26c", "値はエンコード");
});

test("BOOKING_URL に ? があれば & でつなぐ（welcome/?src=2ndchance&ref=CODE）", () => {
  assert.equal(airconHref(cfg({ AIRCON_BOOKING_URL: WELCOME })), WELCOME);
  assert.equal(airconHref(cfg({ AIRCON_BOOKING_URL: WELCOME, AIRCON_REF_CODE: "CODE" })), WELCOME + "&ref=CODE");
  assert.equal(airconHref(cfg({ AIRCON_BOOKING_URL: WELCOME, AIRCON_REF_PARAM: "partner", AIRCON_REF_CODE: "C012" })), WELCOME + "&partner=C012");
  assert.match(airconLink(cfg({ AIRCON_BOOKING_URL: WELCOME, AIRCON_REF_CODE: "CODE" })), /href="https:\/\/miumiumiu4\.github\.io\/arigatou-booking\/welcome\/\?src=2ndchance&amp;ref=CODE"/, "HTML では &amp;");
});

test("リンクの HTML は target=_blank rel=noopener、文言と注記つき", () => {
  for (const html of [airconItem(cfg({ AIRCON_REF_CODE: "TEST123" })), airconLink(cfg({ AIRCON_REF_CODE: "TEST123" }))]) {
    assert.match(html, /href="https:\/\/miumiumiu4\.github\.io\/arigatou-booking\/\?ref=TEST123" target="_blank" rel="noopener"/);
    assert.match(html, /提携店のページが開きます/);
  }
  assert.match(airconLink(cfg({})), /エアコンクリーニング・取付取外しの予約（ありがとうエアコン）/);
});

test("config.js が AIRCON_* を1か所に持ち、各ページに rel=noopener 付きで出ている（手書きの href なし）", async () => {
  const { CONFIG } = await import(path.join(ROOT, "js/config.js"));
  assert.equal(CONFIG.AIRCON_BOOKING_URL, WELCOME);
  assert.ok(["ref", "partner"].includes(CONFIG.AIRCON_REF_PARAM));
  assert.equal(typeof CONFIG.AIRCON_REF_CODE, "string");
  const href = airconHref(CONFIG).replace(/&/g, "&amp;");
  const expect = { "seiri/index.html": 4, "kataduke/index.html": 1, "index.html": 1, "flow/index.html": 0, "price/index.html": 0 };
  for (const [p, n] of Object.entries(expect)) {
    const html = read(p);
    const links = [...html.matchAll(/<a [^>]*href="https:\/\/miumiumiu4\.github\.io\/arigatou-booking\/[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.equal(links.length, n, p + " のリンク数");
    links.forEach((a) => {
      assert.ok(a.includes(`href="${href}"`), p + " の href が config と違う");
      assert.match(a, /target="_blank" rel="noopener"/, p);
    });
    // リンクは全部 build の差し込み口の中（手書きしない）
    const outside = html.replace(/<!--build:(aircon-[a-z]+)-->[\s\S]*?<!--\/build:\1-->/g, "");
    assert.ok(!outside.includes("arigatou-booking"), p + " に差し込み口の外の手書きリンク");
  }
  assert.ok(!read("seiri/index.html").includes("<b>エアコン取外し</b><br><small>準備中</small>"), "準備中の項目が残る");
});

test("公開用の写し（--out）に CFG_AIRCON_REF_PARAM／CODE が差し込まれる", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "aircon-"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools/build.mjs"), "--out", out], {
      encoding: "utf8", env: { ...process.env, CFG_AIRCON_REF_PARAM: "partner", CFG_AIRCON_REF_CODE: "C099" }
    });
    for (const p of ["index.html", "seiri/index.html", "kataduke/index.html"]) {
      assert.ok(fs.readFileSync(path.join(out, p), "utf8").includes(WELCOME + "&amp;partner=C099"), p);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
// 秘密 grep は tests/secret-grep.mjs がリポジトリ全体（js/config.js の公開URLを含む）で確かめる。allowlist は足さない。
