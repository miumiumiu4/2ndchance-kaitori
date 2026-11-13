import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["index.html", "kaitori/index.html", "kataduke/index.html", "seiri/index.html", "flow/index.html", "price/index.html", "privacy/index.html", "shop/index.html"];
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("build の生成物が最新（node tools/build.mjs --check）", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "tools/build.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, /最新/);
});

test("各ページの JSON-LD が読めて、LocalBusiness と Service がある", () => {
  for (const p of PAGES) {
    const html = read(p);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(m, p + " に JSON-LD が無い");
    const ld = JSON.parse(m[1]);
    const types = ld["@graph"].map((x) => x["@type"]);
    assert.ok(types.includes("LocalBusiness"), p);
    if (p !== "privacy/index.html" && p !== "shop/index.html") assert.ok(types.includes("Service"), p);
    if (p === "shop/index.html") assert.ok(types.includes("ItemList"), p);
    if (p === "flow/index.html") assert.ok(types.includes("FAQPage"));
    if (p === "price/index.html") {
      const cat = ld["@graph"].find((x) => x["@type"] === "OfferCatalog");
      assert.ok(cat);
      // 値が null の項目は priceSpecification 無しで「要相談」
      const offers = cat.itemListElement.flatMap((c) => c.itemListElement);
      offers.forEach((o) => assert.ok(o.priceSpecification || o.description === "要相談"));
      const prices = JSON.parse(read("data/prices.json"));
      if (prices.provisional) {
        assert.match(cat.description || "", /仮の目安/, "OfferCatalog の description に仮の旨");
        offers.filter((o) => o.priceSpecification).forEach((o) => assert.match(o.description || "", /仮の目安/));
      }
    }
  }
});

test("各ページに固定 CTA（LINE・電話・フォーム）、空の設定は「準備中」で無効表示", async () => {
  const { CONFIG } = await import(path.join(ROOT, "js/config.js"));
  for (const p of PAGES) {
    const html = read(p);
    assert.match(html, /class="cta-bar"/, p);
    if (!CONFIG.LINE_URL) assert.match(html, /LINEで相談<small>準備中<\/small>/, p);
    if (!CONFIG.TEL) assert.match(html, /電話する<small>準備中<\/small>/, p);
    assert.match(html, /<meta charset="UTF-8">/, p);
    assert.ok(!html.includes("�"), p + " に文字化け（U+FFFD）");
  }
});

test("provisional: true のとき、料金ページ・トップ・フォーム・llms.txt に「仮の目安（調整中）」の帯が出る", () => {
  const prices = JSON.parse(read("data/prices.json"));
  const pages = ["price/index.html", "index.html"];
  if (!prices.provisional) {
    pages.forEach((p) => assert.ok(!read(p).includes('class="provisional-band"'), p));
    return;
  }
  for (const p of pages) {
    const html = read(p);
    assert.match(html, /class="provisional-band"[^>]*><b>仮の目安（調整中）<\/b>/, p);
    assert.ok(html.includes(prices.provisional_note), p + " に provisional_note");
  }
  // フォームは JS が prices.provisional を見て概算の上に帯を出す
  const form = read("js/form.js");
  assert.match(form, /prices\.provisional/);
  assert.match(form, /仮の目安（調整中）/);
  const llms = read("llms.txt");
  assert.ok(llms.includes("仮の目安（調整中）") && llms.includes(prices.provisional_note));
  // 料金ページの表の「要相談」は、値が null の所（生前整理の確認中・配送 50km 超）だけ
  const table = /<!--build:prices-->([\s\S]*?)<!--\/build:prices-->/.exec(read("price/index.html"))[1];
  const nulls = Object.values(prices.cleanup_by_kind).flat().filter((r) => r.price_from === null).length
    + prices.delivery_tiers.filter((d) => d.fee === null).length
    + (prices.delivery_tiers_store || []).filter((d) => d.fee === null).length;
  assert.equal((table.match(/<span class="consult">要相談<\/span>/g) || []).length, nulls, "料金表の要相談の数");
  // 金額は管理画面で変わるので、data/prices.json の値から期待する文字を作る
  const yen = (n) => "¥" + n.toLocaleString("ja-JP") + "〜";
  const t0 = prices.collection_tiers.find((t) => t.price_from !== null);
  if (t0) assert.ok(table.includes(yen(t0.price_from)), "量の区分の金額");
  assert.match(table, /1R・1K/);
  // 配送料はネット注文と店頭購入の2つの表
  assert.match(table, /<caption>ネット注文（販売ページ）の場合<\/caption>/);
  if ((prices.delivery_tiers_store || []).length) assert.match(table, /<caption>店頭でご購入の場合<\/caption>/);
  assert.match(table, /クオカード/);
  const stairs = prices.options.find((o) => o.id === "stairs");
  if (stairs && stairs.price === 0) assert.match(table, /階段での運び出し<\/td><td class="num">無料/);
});

test("llms.txt・sitemap.xml・robots.txt・gas/QuoteCore.gs がある", () => {
  const llms = read("llms.txt");
  for (const s of ["data/prices.json", "data/items.json", "data/areas.json", "data/faq.json", "action=quote", "本人確認", "目安"]) assert.ok(llms.includes(s), "llms.txt に " + s);
  assert.match(read("sitemap.xml"), /<urlset/);
  assert.match(read("robots.txt"), /User-agent/);
  const gs = read("gas/QuoteCore.gs");
  assert.ok(!/^\s*export\s/m.test(gs), "QuoteCore.gs に export が残っている");
  assert.match(gs, /var QuoteCore = \(function/);
});

test("gas/QuoteCore.gs + Prices.gs が Apps Script と同じく素のスクリプトとして動く", async () => {
  const vm = await import("node:vm");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read("gas/Prices.gs") + "\n" + read("gas/QuoteCore.gs") + "\nthis.QuoteCore = QuoteCore; this.PRICES = PRICES;", ctx);
  const r = ctx.QuoteCore.quoteFromInput(ctx.QuoteCore.parseQuoteQuery({ form: "A", items: "fridge:2:within:normal" }), ctx.PRICES);
  const prices = JSON.parse(read("data/prices.json"));
  const fridge = prices.buyback_items.find((b) => b.id === "fridge");
  if (fridge.max_price === null) assert.equal(r.undetermined, true);
  else {
    assert.equal(r.undetermined, false);
    assert.equal(r.max, Math.floor((fridge.max_price * prices.condition_factor.normal) / 10) * 10 * 2);
    assert.equal(r.provisional, !!prices.provisional);
  }
});

test("公開用の写し（--out）に CFG_* が差し込まれ、リポジトリ側は変わらない", () => {
  const out = path.join(ROOT, "node_modules", ".tmp-site-test");
  const before = read("index.html");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools/build.mjs"), "--out", out], {
      env: { ...process.env, CFG_SITE_URL: "https://example.invalid/site", CFG_LINE_URL: "https://example.invalid/line" },
      encoding: "utf8"
    });
    const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(html, /href="https:\/\/example\.invalid\/line"/);
    assert.match(fs.readFileSync(path.join(out, "sitemap.xml"), "utf8"), /https:\/\/example\.invalid\/site\/kaitori\//);
    assert.match(fs.readFileSync(path.join(out, "js/config.js"), "utf8"), /example\.invalid\/line/);
    assert.ok(!fs.existsSync(path.join(out, "tests")) && !fs.existsSync(path.join(out, "gas")));
    assert.equal(read("index.html"), before);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("お店の情報（data/site.json）：営業時間・年中無休・ご紹介キャンペーンの帯・js/site.js", async () => {
  const site = JSON.parse(read("data/site.json"));
  const top = read("index.html");
  assert.ok(top.includes("営業時間：" + site.hours), "フッターの営業時間");
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(top)[1]);
  assert.equal(ld["@graph"].find((x) => x["@type"] === "LocalBusiness").openingHours, site.opening_hours_spec);
  const c = site.referral_campaign;
  const banner = /<!--build:campaign-->([\s\S]*?)<!--\/build:campaign-->/;
  if (c && c.active) {
    const reward = c.reward_yen.toLocaleString("ja-JP") + "円";
    for (const p of ["index.html", "seiri/index.html"]) {
      const b = banner.exec(read(p))[1];
      assert.match(b, /class="campaign"/, p);
      assert.ok(b.includes("<b>" + reward + "</b>") && b.includes(c.gift), p + " に金額と贈り物");
    }
    // トップはヒーローのすぐ下（最初のサービスの前）
    assert.ok(top.indexOf('class="campaign"') > top.indexOf('class="hero"') && top.indexOf('class="campaign"') < top.indexOf('id="h-what"'));
    // 遺品整理などのページは4つのサービスの前
    const seiri = read("seiri/index.html");
    assert.ok(seiri.indexOf('class="campaign"') < seiri.indexOf('id="ihin"'));
    assert.match(read("kataduke/index.html"), /class="campaign-strip"/);
    assert.match(read("flow/index.html"), /id="faq-referral"/);
  } else assert.ok(!banner.exec(top)[1].includes('class="campaign"'));
  const { SITE } = await import(path.join(ROOT, "js/site.js"));
  assert.equal(SITE.HOURS, site.hours);
  assert.equal(SITE.MAIL_PERK_TEXT, site.mail_perk_text);
  // お知らせは空ならトップに出さない
  const notice = /<!--build:notice-->([\s\S]*?)<!--\/build:notice-->/.exec(top)[1];
  assert.equal(notice.includes("site-notice"), !!site.notice);
  // ナナチキなどお店の商品名は書かない
  assert.ok(!/ナナチキ/.test(JSON.stringify(site)));
});

test("公開用の写し：CFG_HOURS が data/site.json より勝つ", () => {
  const out = path.join(ROOT, "node_modules", ".tmp-site-test2");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools/build.mjs"), "--out", out], { env: { ...process.env, CFG_HOURS: "9:00〜18:00（試験）" }, encoding: "utf8" });
    assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /営業時間：9:00〜18:00（試験）/);
    assert.match(fs.readFileSync(path.join(out, "js/site.js"), "utf8"), /9:00〜18:00（試験）/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("管理画面：noindex・robots.txt で Disallow・ナビと sitemap と llms.txt に出さない・外部 CDN なし", () => {
  const html = read("admin/index.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /css\/site\.css\?v=[0-9a-f]{8}/, "CSS の版番号を build が付ける");
  assert.match(html, /src="\.\.\/js\/admin\.js"/);
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, "")), "外部の読み込みなし");
  assert.match(read("robots.txt"), /^Disallow: \/admin\/$/m);
  for (const p of [...PAGES, "sitemap.xml", "llms.txt"]) assert.ok(!read(p).includes("admin/"), p + " に admin/ が出ていない");
  const js = read("js/admin.js");
  assert.ok(!/https?:\/\/(?!github)/.test(js.replace(/https:\/\/〜/g, "")), "admin.js は外部を読まない");
  assert.match(js, /from "\.\/admin-core\.js"/);
});

test("自動の刷り直し：pages.yml は組み立て → テスト → 公開の写し、rebuild.yml は data の push で生成物をコミットし直し、build: では回らない", () => {
  const pages = read(".github/workflows/pages.yml");
  const iBuild = pages.indexOf("run: node tools/build.mjs\n"), iTest = pages.indexOf("run: npm test"), iOut = pages.indexOf("run: node tools/build.mjs --out _site");
  assert.ok(iBuild > 0 && iBuild < iTest && iTest < iOut, "組み立て → テスト → 公開の写し");
  const daily = read(".github/workflows/publish-daily.yml");
  assert.ok(daily.indexOf("run: node tools/build.mjs\n") < daily.indexOf("run: npm test"));
  const rb = read(".github/workflows/rebuild.yml");
  assert.match(rb, /- "data\/\*\*"/);
  assert.match(rb, /- "assets\/shop\/\*\*"/);
  assert.match(rb, /!startsWith\(github\.event\.head_commit\.message, 'build:'\)/);
  assert.match(rb, /git commit -m "build: /);
  assert.match(rb, /contents: write/);
  assert.match(rb, /node tools\/build\.mjs\n\s+npm test/);
});
