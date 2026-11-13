// 量産の型：架空の店（stores/example）を tools/new-store.mjs で焼いて、見本の店の言葉が残らないこと・販売しない店の切り替え・管理画面の名前を確かめる
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EX = path.join(ROOT, "stores/example/answers.json");
const opt = { skip: fs.existsSync(EX) ? false : "stores/example が無い（量産した店のリポジトリ）" };

test("架空の店を焼く：店名・地域が入り、見本の店の言葉・商品・ログイン名が残らない。販売しない店は販売ページを出さない", opt, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "new-store-"));
  const out = path.join(tmp, "shop");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools/new-store.mjs"), EX, "--out", out, "--no-test"], { encoding: "utf8" });
    const A = JSON.parse(fs.readFileSync(EX, "utf8"));
    const site = path.join(tmp, "_site");
    execFileSync(process.execPath, [path.join(out, "tools/build.mjs"), "--out", site], { cwd: out, encoding: "utf8" });
    const read = (p) => fs.readFileSync(path.join(site, p), "utf8");
    const pages = ["index.html", "kaitori/index.html", "kataduke/index.html", "seiri/index.html", "flow/index.html", "price/index.html", "privacy/index.html", "404.html", "admin/index.html"];
    for (const p of pages) {
      const html = read(p);
      assert.ok(html.includes(A.q1.name), p + "：店名");
      for (const w of ["2nd chance", "合志", "熊本", "幾久富", "共同代表", "クオカード", "揚げたて"]) assert.ok(!html.replace(/<!--[\s\S]*?-->/g, "").includes(w), `${p}：見本の店の言葉「${w}」が残る`);
    }
    assert.match(read("index.html"), new RegExp(`<title>[^<]*${A.q1.name.replace(/[()（）]/g, ".")}（${A.q1.region}${A.q1.locality}）</title>`));
    assert.ok(read("index.html").replace(/<!--[\s\S]*?-->/g, "").includes(`${A.q1.locality}から${A.q5.radius_km}km圏内`), "出張の範囲");
    // 販売しない店（q12: false）
    assert.equal(A.q12, false);
    assert.ok(!fs.existsSync(path.join(site, "shop")), "販売ページを置かない");
    for (const p of pages) assert.ok(!/href="[./]*shop\//.test(read(p)), p + "：販売ページへのリンク");
    assert.ok(!read("sitemap.xml").includes("shop/"), "sitemap に販売ページ");
    assert.ok(!read("llms.txt").includes("販売中の商品"), "llms.txt に販売");
    assert.ok(!read("price/index.html").includes('id="delivery"'), "配送料の表");
    // 管理画面のログインの名前と、受け口の店名
    const siteJs = read("js/site.js");
    for (const r of A.admin_roles) assert.ok(siteJs.includes(`"${r}"`), "ログインの名前 " + r);
    assert.ok(fs.readFileSync(path.join(out, "gas/Store.gs"), "utf8").includes(A.q1.name));
    // 見本の店の記事・商品写真は持ち込まない
    assert.deepEqual(fs.readdirSync(path.join(out, "content/posts")).filter((f) => !f.includes("erabareru")), []);
    assert.deepEqual(fs.readdirSync(path.join(out, "assets/shop")), ["README.md"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("site.js と Store.gs のログインの名前は data/store.json の admin_roles", async () => {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "data/store.json"), "utf8"));
  const { SITE } = await import(path.join(ROOT, "js/site.js"));
  assert.deepEqual(SITE.ADMIN_ROLES, store.admin_roles);
  assert.ok(fs.readFileSync(path.join(ROOT, "gas/Store.gs"), "utf8").includes(JSON.stringify(store.admin_roles[0])));
});
