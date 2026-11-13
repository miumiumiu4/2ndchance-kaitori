#!/usr/bin/env node
// 画面の確認（任意）：簡易サーバーで配信し、Playwright で 390px と 1280px を撮影して screens/ に保存。
// あわせてフォームの動き（冷蔵庫2台の概算・仮の帯・タブ切替・相殺・確認画面・送信ボタンの「準備中」・固定バーの概算パネル）と、
// 販売ページのカート（2点入れる・配送料1回分・外す・売切れは入れられない・確認画面）を確かめる。
//   node tools/screens.mjs      （Playwright が入っている環境で）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".jpg": "image/jpeg", ".png": "image/png", ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };

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
  const shots = [["top", ""], ["kaitori", "kaitori/"], ["kataduke", "kataduke/"], ["price", "price/"], ["seiri", "seiri/"], ["flow", "flow/"], ["shop", "shop/"], ["shop-item", "shop/aqua-fridge-355/"]];
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
  // フォームA：冷蔵庫2台 → 0円〜¥24,000（年式わからない・普通）
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
  check("フォームA：概算が金額の幅（0円 〜 ¥24,000）", estA.trim() === "0円 〜 ¥24,000", estA);
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
  await page.fill("#f-email", "test" + "@" + "example.invalid");
  check("メルマガのチェックは既定でオン", await page.isChecked("#f-news"));
  const d = await page.getAttribute("#date1", "min");
  await page.fill("#date1", d);
  await page.check("#f-consent");
  await page.click("form.qform button[type=submit]");
  await page.waitForSelector("#q-confirm:not([hidden])");
  const confirmText = await page.textContent("#q-confirm");
  check("確認画面：カナに自動変換", confirmText.includes("ヤマダ ハナコ"));
  check("確認画面：概算が残る", confirmText.includes("¥24,000"));
  check("確認画面：メールとお知らせの受け取り", confirmText.includes("example.invalid") && confirmText.includes("受け取る"));
  const sendBtn = page.locator("#q-confirm button.btn-form");
  check("送信ボタン：GAS_URL 空なら「準備中」で押せない", (await sendBtn.isDisabled()) && (await sendBtn.textContent()).includes("準備中"));
  await page.screenshot({ path: path.join(ROOT, "screens", "form-a-confirm-390.png"), fullPage: false });
  check("確認画面：固定バーの概算パネルに金額が残る", (await page.isVisible("#cta-est")) && (await page.textContent("#cta-est")).includes("¥24,000"));
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
  check("フォームC：遺品整理 2LDK を選ぶと ¥90,000", estC.trim() === "¥90,000", estC);
  await page.click('label.choice:has(input[name=kind][value="gomiyashiki"])');
  const estG = await page.textContent("#q-est [data-est-value]");
  check("フォームC：種類をゴミ屋敷に変えると同じ間取りで ¥50,000", estG.trim() === "¥50,000", estG);
  await page.click('label.choice:has(input[name=kind][value="souko"])');
  check("フォームC：倉庫は坪数の入力", await page.isVisible("#f-tsubo"));
  await page.fill("#f-tsubo", "25");
  const estS = await page.textContent("#q-est [data-est-value]");
  check("フォームC：倉庫 25坪 → ¥150,000", estS.trim() === "¥150,000", estS);
  await page.click('label.choice:has(input[name=kind][value="ihin"])');
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
  check("フォームB：軽トラ＋冷蔵庫1台で ¥0 〜 ¥12,000", estB.trim() === "¥0 〜 ¥12,000", estB);
  await page.check("[data-same-day]");
  const estB2 = await page.textContent("#q-est [data-est-value]");
  check("フォームB：同日査定にチェックで買取見込み +20%（お受け取り ¥2,400 〜 ¥12,000）", estB2.trim() === "お受け取り ¥2,400 〜 ¥12,000", estB2);
  await page.uncheck("[data-same-day]");
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
    await stickyRun(w, h, "kaitori/", fridgeA, w === 390 ? "form-a-sticky-390.png" : "", "フォームA（冷蔵庫1台）", "0円 〜 ¥12,000");
    await stickyRun(w, h, "kataduke/", fridgeB, w === 390 ? "form-b-sticky-390.png" : "", "フォームB（軽トラ＋冷蔵庫1台）", "¥0 〜 ¥12,000");
  }

  // 販売ページ：一覧でカートに2点（送料無料1・通常1）→ 商品ページでも同じカート → 注文フォーム（郵便番号 → 配送料1回分）
  // → 1点外す（全部送料無料に戻る）→ 価格確認中の商品 → 確認画面 → 全部外すと送信できない。売切れは入れられない
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ja-JP" });
    const pg = await c.newPage();
    pg.on("console", (m) => { if (m.type() === "error") errors.push(`shop ${m.text()}`); });
    pg.on("pageerror", (e) => errors.push(`shop ${e.message}`));
    const badge = async () => ((await pg.isVisible("#cta-cart")) ? (await pg.textContent("#cta-cart")).trim() : "");
    const txt = async (sel) => (await pg.textContent(sel)).trim();
    await pg.goto(BASE + "shop/", { waitUntil: "networkidle" });
    await pg.waitForSelector("#o-cart");
    check("販売：商品カードが並ぶ", (await pg.locator(".shop-card").count()) >= 10);
    check("販売：売切れの帯", (await pg.locator(".shop-band-sold").count()) === 1);
    check("販売：画像が読み込まれる", await pg.evaluate(() => [...document.querySelectorAll(".shop-card img")].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0)));
    check("販売：カートが空なら「カートを見る」は出ず、送信ボタンは押せない", (await badge()) === "" && (await pg.isVisible("[data-cart-empty]")) && (await pg.locator("form.qform button[type=submit]").isDisabled()));
    check("販売：空のカートの案内", (await txt("[data-cart-empty]")) === "商品一覧から「カートに入れる」を押してください");
    const soldBtn = pg.locator(".shop-card.is-sold .cart-btn");
    await soldBtn.click({ force: true });
    check("販売：売切れの商品はカートに入れられない（ボタンは「売切れ」で押せない）", (await soldBtn.isDisabled()) && (await soldBtn.textContent()).trim() === "売切れ" && (await badge()) === "");
    await pg.click('[data-cart-add="drum-washer"]');
    await pg.click('[data-cart-add="industrial-fan"]');
    check("販売：入れるとボタンが「カートから外す」に", (await txt('[data-cart-add="drum-washer"]')) === "カートから外す" && (await pg.getAttribute('[data-cart-add="industrial-fan"]', "aria-pressed")) === "true");
    check("販売：固定バーの上に「カートを見る（2点）」", (await badge()) === "カートを見る（2点）");
    check("販売：注文フォームに2行（写真・名前・価格・外す）", (await pg.locator("#o-cart .cart-row").count()) === 2 && (await pg.locator("#o-cart .cart-row img").count()) === 2 && (await pg.locator("#o-cart [data-cart-remove]").count()) === 2);
    const imgW = await pg.evaluate(() => Math.round(document.querySelector("#o-cart .cart-row img").getBoundingClientRect().width));
    check("販売：行の写真は小さい（64px）", imgW === 64, `${imgW}px`);
    await pg.locator(".shop-card").first().screenshot({ path: path.join(ROOT, "screens", "shop-card-cart-390.png") });

    // 商品ページ：同じカート（sessionStorage）を見て、バッジは一覧の注文フォームへ
    await pg.goto(BASE + "shop/aqua-fridge-355/", { waitUntil: "networkidle" });
    check("商品ページ：カートの点数が一覧と同じ（2点）", (await badge()) === "カートを見る（2点）");
    check("商品ページ：カートに入れるボタン", (await txt('[data-cart-add="aqua-fridge-355"]')) === "カートに入れる");
    const href = await pg.getAttribute("#cta-cart", "href");
    check("商品ページ：「カートを見る」は /shop/#order へ", /\/shop\/#order$/.test(href), href);
    await pg.goto(BASE + "shop/electric-heater/", { waitUntil: "networkidle" });
    check("商品ページ：売切れは申し込めず、カートのボタンも押せない", (await pg.locator("text=売切れのため申し込めません").count()) === 1 && (await pg.locator(".shop-detail .cart-btn").isDisabled()));
    await pg.click("#cta-cart");
    await pg.waitForSelector("#o-cart .cart-row");
    check("商品ページのバッジから注文フォームへ（カート2点のまま）", pg.url().endsWith("/shop/#order") && (await pg.locator("#o-cart .cart-row").count()) === 2);
    check("販売：商品代の合計（2点）", (await txt("[data-goods]")) === "¥50,500");
    check("販売：店頭受け取りならお支払いの目安は商品代の合計", (await txt("[data-total]")) === "¥50,500");

    // 配送：送料無料でない商品があるので、通常の配送料を1回分
    await pg.click('label.choice:has(input[value="delivery"])');
    await pg.fill("#o-zip", "8600806");
    await pg.waitForFunction(() => document.querySelector("[data-delivery-fee]") && /¥/.test(document.querySelector("[data-delivery-fee]").textContent));
    const fee = Number((await txt("[data-delivery-fee]")).replace(/[^0-9]/g, ""));
    const total2 = await txt("[data-total]");
    check("販売：2点（送料無料1・通常1）→ 商品代＋配送料1回分（860-0806 は約16km → ¥4,000）", fee === 4000 && total2 === "¥" + (50500 + fee).toLocaleString("ja-JP"), `配送料 ¥${fee}／目安 ${total2}`);
    check("販売：内訳に「1回分」と送料無料でない商品の案内", (await txt("#o-total")).includes("（1回分）") && (await txt("#o-total")).includes("送料無料でない商品が入っているため"));
    await pg.locator("#shop-order").screenshot({ path: path.join(ROOT, "screens", "shop-cart-390.png") });
    // 店の近く（861-1112・10km 以内）は送料無料でない商品が入っていても配送料は無料
    await pg.fill("#o-zip", "8611112");
    await pg.waitForFunction(() => document.querySelector("[data-delivery-fee]").textContent.trim() === "無料");
    check("販売：861-1112（店から10km以内）は送料無料でない商品があっても配送料 無料", (await txt("[data-total]")) === "¥50,500", await txt("[data-total]"));
    await pg.fill("#o-zip", "8600806");
    await pg.waitForFunction(() => /¥/.test(document.querySelector("[data-delivery-fee]").textContent));

    // 1点外す → 全部送料無料 → 配送料は無料
    await pg.click('[data-cart-remove="industrial-fan"]');
    await pg.waitForFunction(() => document.querySelectorAll("#o-cart .cart-row").length === 1);
    await pg.waitForFunction(() => document.querySelector("[data-delivery-fee]").textContent.trim() === "無料");
    check("販売：外すと1行・バッジ1点・一覧のボタンも戻る", (await badge()) === "カートを見る（1点）" && (await txt('[data-cart-add="industrial-fan"]')) === "カートに入れる");
    check("販売：送料無料の商品だけ → 配送料 無料、目安は商品代", (await txt("[data-total]")) === "¥45,000");

    // 価格が確認中の商品を足す → 「＋確認中の商品」
    await pg.click('[data-cart-add="cupboard-white"]');
    await pg.waitForFunction(() => document.querySelectorAll("#o-cart .cart-row").length === 2 && /¥/.test(document.querySelector("[data-delivery-fee]").textContent));
    const fee3 = Number((await txt("[data-delivery-fee]")).replace(/[^0-9]/g, ""));
    check("販売：確認中の商品 → 合計は「＋確認中の商品」", (await txt("[data-goods]")) === "¥45,000 ＋確認中の商品" && (await txt("[data-total]")) === "¥" + (45000 + fee3).toLocaleString("ja-JP") + " ＋確認中の商品", await txt("[data-total]"));

    await pg.fill("#o-addr", "熊本県熊本市（試験）");
    await pg.fill("#o-name", "試験 太郎");
    await pg.fill("#o-email", "test" + "@" + "example.invalid");
    await pg.fill("#o-line", "しけん");
    await pg.check("#o-consent");
    // 最下部で送信ボタン・フッターが固定バー（カートのバッジつき）に隠れない
    await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pg.waitForTimeout(150);
    const gap = await pg.evaluate(() => document.querySelector(".cta-bar").getBoundingClientRect().top - document.querySelector("form.qform button[type=submit]").getBoundingClientRect().bottom);
    const footGap = await pg.evaluate(() => document.querySelector(".cta-bar").getBoundingClientRect().top - document.querySelector(".site-footer").getBoundingClientRect().bottom);
    check("販売 390px：最下部で送信ボタン・フッターが固定バーに隠れない", gap > 0 && footGap >= 0, `ボタンとの間 ${Math.round(gap)}px／フッターとの間 ${Math.round(footGap)}px`);
    await pg.click("form.qform button[type=submit]");
    await pg.waitForSelector("#o-confirm:not([hidden])");
    const ct = await pg.textContent("#o-confirm");
    check("販売：確認画面に写真つきの商品の行（2点）", (await pg.locator("#o-confirm .cart-row img").count()) === 2 && ct.includes("ドラム式洗濯乾燥機") && ct.includes("食器棚"));
    check("販売：確認画面に点数・配送料・お支払いの目安・受け取り時", ct.includes("2点") && ct.includes("配送料（1回分）") && ct.includes("＋確認中の商品") && ct.includes("お支払いは受け取り時"));
    check("販売：決済リンクが空ならカード払いのボタンは出ない", (await pg.locator("#o-confirm .cart-pay").count()) === 0);
    check("販売：GAS_URL 空なら送信は準備中", await pg.locator("#o-confirm button.btn-form").isDisabled());
    await pg.screenshot({ path: path.join(ROOT, "screens", "shop-confirm-390.png"), fullPage: false });
    check("販売 390px：横スクロールなし", (await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
    await pg.click('#o-confirm [data-act="back"]');
    await pg.click('[data-cart-remove="drum-washer"]');
    await pg.click('[data-cart-remove="cupboard-white"]');
    await pg.waitForSelector("[data-cart-empty]");
    check("販売：全部外すと空の案内・送信ボタンは押せない・バッジは消える", (await pg.locator("form.qform button[type=submit]").isDisabled()) && (await badge()) === "");

    // 商品ページの「カートに入れて注文フォームへ」（?item=）→ カートに入り、URL から ?item は消える
    await pg.goto(BASE + "shop/rice-cooker-2024/", { waitUntil: "networkidle" });
    await pg.click("text=カートに入れて注文フォームへ");
    await pg.waitForSelector("#o-cart .cart-row");
    check("販売：商品ページから「カートに入れて注文フォームへ」", (await pg.locator("#o-cart .cart-row").count()) === 1 && (await txt("[data-goods]")) === "¥8,200" && !pg.url().includes("?item"));
    await pg.reload({ waitUntil: "networkidle" });
    await pg.waitForSelector("#o-cart .cart-row");
    check("販売：再読み込みしてもカートは1点のまま", (await pg.locator("#o-cart .cart-row").count()) === 1);
    await c.close();
  }

  check("コンソールエラーなし", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
const ng = results.filter((r) => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
