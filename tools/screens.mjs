#!/usr/bin/env node
// 画面の確認（任意）：簡易サーバーで配信し、Playwright で 390px と 1280px を撮影して screens/ に保存。
// あわせてフォームの動き（冷蔵庫2台の概算・仮の帯・タブ切替・相殺・確認画面・送信ボタンの「準備中」・固定バーの概算パネル）を確かめる。
//   node tools/screens.mjs      （Playwright が入っている環境で）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": TYPES[".html"] }); return res.end(fs.readFileSync(path.join(ROOT, "404.html"))); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "OK " : "NG "} ${name}${detail ? "：" + detail : ""}`); };

const browser = await chromium.launch();
const errors = [];
try {
  fs.mkdirSync(path.join(ROOT, "screens"), { recursive: true });
  const shots = [["top", ""], ["kaitori", "kaitori/"], ["kataduke", "kataduke/"], ["price", "price/"], ["seiri", "seiri/"], ["flow", "flow/"]];
  for (const w of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1, locale: "ja-JP" });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${w}px ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${w}px ${e.message}`));
    for (const [name, url] of shots) {
      await page.goto(BASE + url, { waitUntil: "networkidle" });
      if (name === "kaitori" || name === "kataduke") await page.waitForSelector("#q-est .est-value");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${name} ${w}px 横スクロールなし`, overflow <= 0, `はみ出し ${overflow}px`);
      await page.screenshot({ path: path.join(ROOT, "screens", `${name}-${w}.png`), fullPage: true });
    }
    await ctx.close();
  }

  // ブログ：一覧と記事1本（390px）。blog/ は node tools/build.mjs が作る
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ja-JP" });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`blog ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`blog ${e.message}`));
    await page.goto(BASE + "blog/", { waitUntil: "networkidle" });
    const first = page.locator(".post-card a").first();
    check("ブログ一覧 390px：記事が1本以上", (await page.locator(".post-card").count()) >= 1);
    check("ブログ一覧 390px：横スクロールなし", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
    await page.screenshot({ path: path.join(ROOT, "screens", "blog-390.png"), fullPage: true });
    await first.click();
    await page.waitForSelector("article.post");
    check("記事ページ 390px：関連する相談と固定CTA", (await page.isVisible("#h-related")) && (await page.isVisible(".cta-bar")));
    check("記事ページ 390px：横スクロールなし", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
    await page.screenshot({ path: path.join(ROOT, "screens", "blog-post-390.png"), fullPage: true });
    await page.goto(BASE, { waitUntil: "networkidle" });
    check("トップ：最新の記事が出る", (await page.locator("#h-posts ~ ul .post-card, section[aria-labelledby=h-posts] .post-card").count()) >= 1);
    await ctx.close();
  }

  // 仮の金額のときは帯が出る
  const PRICES = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prices.json"), "utf8"));
  // フォームA：冷蔵庫2台 → 0円〜¥18,000（年式わからない・普通）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ja-JP" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "kaitori/#form-a", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-step="item:fridge"][data-d="1"]');
  await page.click('[data-step="item:fridge"][data-d="1"]');
  await page.click('[data-step="item:fridge"][data-d="1"]');
  const qty = await page.textContent('[data-out="item:fridge"]');
  const estA = await page.textContent("#q-est [data-est-value]");
  check("フォームA：冷蔵庫2台", qty === "2", qty);
  check("フォームA：概算が金額の幅（0円 〜 ¥18,000）", estA.trim() === "0円 〜 ¥18,000", estA);
  if (PRICES.provisional) check("フォームA：概算の上に「仮の目安（調整中）」の帯", (await page.textContent("#q-est .provisional-band")).includes("仮の目安（調整中）"));
  check("フォームA：金額の真横に目安の注記", (await page.textContent("#q-est .est-note")).includes("最終額は訪問査定で確定"));
  check("フォームA：年式・状態の選択が出る", await page.isVisible("#y-fridge"));
  await page.selectOption("#y-fridge", "over");
  const estOver = await page.textContent("#q-est [data-est-value]");
  check("フォームA：年式超過は 0円（回収扱い）", estOver.includes("回収扱い"), estOver);
  await page.selectOption("#y-fridge", "within");
  await page.locator("#q-est").screenshot({ path: path.join(ROOT, "screens", "form-a-estimate-390.png") });

  check("固定バー：フォームが見えている間は概算パネルが出て、箱と同じ金額", (await page.isVisible("#cta-est")) && (await page.textContent("#cta-est [data-sticky-value]")) === (await page.textContent("#q-est [data-est-value]")));

  // 確認画面（GAS_URL が空 → 送信は準備中）
  await page.fill("#f-name", "やまだ はなこ");
  await page.fill("#f-tel", "0" + "9000000000");
  await page.fill("#f-addr", "熊本県合志市（試験）");
  const d = await page.getAttribute("#date1", "min");
  await page.fill("#date1", d);
  await page.check("#f-consent");
  await page.click("form.qform button[type=submit]");
  await page.waitForSelector("#q-confirm:not([hidden])");
  const confirmText = await page.textContent("#q-confirm");
  check("確認画面：カナに自動変換", confirmText.includes("ヤマダ ハナコ"));
  check("確認画面：概算が残る", confirmText.includes("¥18,000"));
  const sendBtn = page.locator("#q-confirm button.btn-form");
  check("送信ボタン：GAS_URL 空なら「準備中」で押せない", (await sendBtn.isDisabled()) && (await sendBtn.textContent()).includes("準備中"));
  await page.screenshot({ path: path.join(ROOT, "screens", "form-a-confirm-390.png"), fullPage: false });
  check("確認画面：固定バーの概算パネルに金額が残る", (await page.isVisible("#cta-est")) && (await page.textContent("#cta-est")).includes("¥18,000"));
  await page.click('[data-act="back"]');
  check("戻ると入力が残る", (await page.inputValue("#f-name")) === "ヤマダ ハナコ" && (await page.textContent('[data-out="item:fridge"]')) === "2");

  // 入力漏れ
  await page.goto(BASE + "kaitori/", { waitUntil: "networkidle" });
  await page.waitForSelector("form.qform");
  await page.click("form.qform button[type=submit]");
  check("入力漏れでエラー一覧が出る", await page.isVisible("#q-errs"));

  // フォームB/C：タブ切替
  await page.goto(BASE + "kataduke/#form-b", { waitUntil: "networkidle" });
  await page.waitForSelector("[role=tab]");
  check("タブ：最初は不用品回収", (await page.getAttribute("#tab-B", "aria-selected")) === "true" && (await page.locator("input[name=tier]").count()) === 4);
  await page.click("#tab-C");
  const cSel = await page.getAttribute("#tab-C", "aria-selected");
  const layouts = await page.locator("input[name=layout]").count();
  check("タブ：片付けに切り替わる（間取り6つ）", cSel === "true" && layouts === 6, `selected=${cSel} layouts=${layouts}`);
  await page.click('label.choice:has(input[value="2DK・2LDK"])');
  const estC = await page.textContent("#q-est [data-est-value]");
  check("フォームC：2LDK を選ぶと ¥50,000", estC.trim() === "¥50,000", estC);
  check("フォームC：作業時間の目安", (await page.textContent("#q-est")).includes("3〜5時間"));
  check("フォームC：相殺の注記が金額の真横", (await page.textContent("#q-est .est-note")).includes("お会計も変わります"));
  await page.keyboard.press("Shift+Tab");
  await page.click("#tab-B");
  check("タブ：不用品回収に戻る", (await page.locator("input[name=tier]").count()) === 4);
  // フォームB：軽トラ＋冷蔵庫1台（買取見込み）→ お会計が幅で出る
  await page.click('label.choice:has(input[value="mini"])');
  await page.click("details.card summary");
  await page.click('[data-step="item:fridge"][data-d="1"]');
  const estB = await page.textContent("#q-est [data-est-value]");
  check("フォームB：軽トラ＋冷蔵庫1台で ¥9,000 〜 ¥18,000", estB.trim() === "¥9,000 〜 ¥18,000", estB);
  await page.locator("#q-est").screenshot({ path: path.join(ROOT, "screens", "form-b-estimate-390.png") });
  await page.locator(".tabs").screenshot({ path: path.join(ROOT, "screens", "form-bc-tabs-390.png") });

  await page.goto(BASE + "kataduke/?kind=akiya#form-c", { waitUntil: "networkidle" });
  await page.waitForSelector("[role=tab]");
  check("#form-c と ?kind=akiya で片付け・空き家が選ばれる", (await page.getAttribute("#tab-C", "aria-selected")) === "true" && (await page.isChecked('input[name=kind][value="akiya"]')));
  await ctx.close();

  // 固定バーの概算パネル：ページ上部では出さず、フォームの下の方（メール・郵便番号）まで来ても金額が見える
  const stickyRun = async (w, h, url, prepare, shot, label, want) => {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: "ja-JP" });
    const pg = await c.newPage();
    pg.on("console", (m) => { if (m.type() === "error") errors.push(`${w}px ${m.text()}`); });
    pg.on("pageerror", (e) => errors.push(`${w}px ${e.message}`));
    await pg.goto(BASE + url, { waitUntil: "networkidle" });
    await pg.waitForSelector("#q-est .est-value");
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(150);
    check(`${label} ${w}px：ページ上部ではパネルを出さない`, !(await pg.isVisible("#cta-est")));
    await prepare(pg);
    await pg.locator("#f-zip").scrollIntoViewIfNeeded();
    await pg.evaluate(() => document.querySelector("#f-zip").scrollIntoView({ block: "center" }));
    await pg.waitForTimeout(300);
    const box = await pg.evaluate(() => {
      const e = document.querySelector("#cta-est");
      const r = e.getBoundingClientRect();
      return { h: Math.round(r.height), fs: parseFloat(getComputedStyle(e).fontSize), estInView: document.querySelector("#q-est").getBoundingClientRect().bottom > 0 };
    });
    const sv = (await pg.textContent("#cta-est [data-sticky-value]")).trim();
    const ev = (await pg.textContent("#q-est [data-est-value]")).trim();
    check(`${label} ${w}px：下へスクロールしても固定バーに概算（${want}）`, (await pg.isVisible("#cta-est")) && sv === want && sv === ev && !box.estInView, `パネル=${sv} 箱=${ev}`);
    check(`${label} ${w}px：パネルの高さ 44px 以上・文字 16px 以上`, box.h >= 44 && box.fs >= 16, `高さ ${box.h}px 文字 ${box.fs}px`);
    const label2 = (await pg.textContent("#cta-est [data-sticky-label]")).trim();
    check(`${label} ${w}px：ラベル`, label2.startsWith(url.startsWith("kaitori") ? "買取見込み" : "お会計の目安"), label2);
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} ${w}px：横スクロールなし`, overflow <= 0, `はみ出し ${overflow}px`);
    if (shot) await pg.screenshot({ path: path.join(ROOT, "screens", shot), fullPage: false });
    // 最後の入力欄・ボタンが固定バーに隠れない（ページ最下部までスクロール）
    await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pg.waitForTimeout(150);
    const gap = await pg.evaluate(() => document.querySelector(".cta-bar").getBoundingClientRect().top - document.querySelector("form.qform button[type=submit]").getBoundingClientRect().bottom);
    const footGap = await pg.evaluate(() => document.querySelector(".cta-bar").getBoundingClientRect().top - document.querySelector(".site-footer").getBoundingClientRect().bottom);
    check(`${label} ${w}px：最下部で送信ボタン・フッターが固定バーに隠れない`, gap > 0 && footGap >= 0, `ボタンとの間 ${Math.round(gap)}px／フッターとの間 ${Math.round(footGap)}px`);
    // タップで概算の箱へ
    await pg.click("#cta-est");
    await pg.waitForTimeout(800);
    const top = await pg.evaluate(() => document.querySelector("#q-est").getBoundingClientRect().top);
    check(`${label} ${w}px：パネルをタップすると概算の箱へ`, top >= -2 && top < 120, `箱の上端 ${Math.round(top)}px`);
    await c.close();
  };
  const fridgeA = async (pg) => { await pg.click('[data-step="item:fridge"][data-d="1"]'); };
  const fridgeB = async (pg) => {
    await pg.click('label.choice:has(input[value="mini"])');
    await pg.click("details.card summary");
    await pg.click('[data-step="item:fridge"][data-d="1"]');
  };
  for (const [w, h] of [[390, 844], [1280, 900]]) {
    await stickyRun(w, h, "kaitori/", fridgeA, w === 390 ? "form-a-sticky-390.png" : "", "フォームA（冷蔵庫1台）", "0円 〜 ¥9,000");
    await stickyRun(w, h, "kataduke/", fridgeB, w === 390 ? "form-b-sticky-390.png" : "", "フォームB（軽トラ＋冷蔵庫1台）", "¥9,000 〜 ¥18,000");
  }

  check("コンソールエラーなし", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
const ng = results.filter((r) => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
