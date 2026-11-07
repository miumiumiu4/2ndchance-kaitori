#!/usr/bin/env node
// 画面の確認（任意）：簡易サーバーで配信し、Playwright で 390px と 1280px を撮影して screens/ に保存。
// あわせてフォームの動き（冷蔵庫2台の概算・仮の帯・タブ切替・相殺・確認画面・送信ボタンの「準備中」）を確かめる。
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

  check("コンソールエラーなし", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
const ng = results.filter((r) => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
