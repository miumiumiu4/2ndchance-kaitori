// ブログの予約公開：未来日・draft は出さない／scheduled かつ今日以前は出す／Markdown 変換／XSS／RSS・sitemap／--today
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mdToHtml, inline, parseFrontmatter, safeUrl } from "../tools/md.mjs";
import { loadPosts, publishedPosts, todayJST } from "../tools/blog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "tools/build.mjs");
const TMPS = [];
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "blog-" + name + "-")); TMPS.push(d); return d; };
test.after(() => TMPS.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function post(dir, file, fm, body = "本文です。") {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? "[" + v.join(", ") + "]" : v}`);
  fs.writeFileSync(path.join(dir, file), `---\n${lines.join("\n")}\n---\n${body}\n`);
}
// 試験用の記事倉庫：過去の scheduled／当日の scheduled／未来の scheduled／過去の draft／XSS 入り
function fixtures() {
  const dir = tmp("posts");
  post(dir, "2026-11-01-kako.md", { title: "過去の記事", date: "2026-11-01", summary: "過去", tags: ["片付け"], status: "scheduled" });
  post(dir, "2026-11-10-touzitsu.md", { title: "当日の記事", date: "2026-11-10", summary: "当日", tags: ["買取"], status: "scheduled" });
  post(dir, "2026-11-11-ashita.md", { title: "明日の記事", date: "2026-11-11", summary: "明日", tags: [], status: "scheduled" });
  post(dir, "2026-10-01-shitagaki.md", { title: "下書きの記事", date: "2026-10-01", summary: "下書き", tags: [], status: "draft" });
  post(dir, "2026-11-02-xss.md", { title: '"><script>alert(1)</script>', date: "2026-11-02", summary: "<img src=x onerror=alert(1)>", tags: ["<b>"], status: "scheduled" },
    "<script>alert('x')</script>\n\n[押す](javascript:alert(1))");
  return dir;
}
function build(today, postsDir) {
  const out = tmp("site");
  const args = [BUILD, "--out", out, "--today=" + today];
  if (postsDir) args.push("--posts", postsDir);
  execFileSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, CFG_SITE_URL: "https://example.invalid/site/" } });
  return { out, read: (p) => fs.readFileSync(path.join(out, p), "utf8"), has: (p) => fs.existsSync(path.join(out, p)) };
}

test("公開判定：scheduled かつ今日以前だけ（draft・未来日は出ない）", () => {
  const posts = loadPosts(fixtures());
  const titles = publishedPosts(posts, "2026-11-10").map((p) => p.title);
  assert.deepEqual(titles, ["当日の記事", '"><script>alert(1)</script>', "過去の記事"]);
  assert.equal(publishedPosts(posts, "2026-11-11")[0].title, "明日の記事");
  assert.ok(!publishedPosts(posts, "2099-12-31").some((p) => p.status === "draft"));
});

test("生成物：未来日・draft は blog/ にも sitemap・RSS・llms.txt・トップにも出ない。過去の scheduled は出る", () => {
  const s = build("2026-11-10", fixtures());
  assert.ok(s.has("blog/kako/index.html"));
  assert.ok(s.has("blog/touzitsu/index.html"));
  assert.ok(!s.has("blog/ashita"), "未来日が出ている");
  assert.ok(!s.has("blog/shitagaki"), "draft が出ている");
  assert.ok(!s.has("content"), "記事の倉庫（未来日を含む）が公開用の写しに入っている");
  for (const f of ["blog/index.html", "blog/feed.xml", "sitemap.xml", "llms.txt", "index.html"]) {
    const t = s.read(f);
    assert.ok(!t.includes("明日の記事") && !t.includes("ashita"), f + " に未来日");
    assert.ok(!t.includes("下書きの記事") && !t.includes("shitagaki"), f + " に draft");
  }
  const rss = s.read("blog/feed.xml");
  assert.match(rss, /<rss version="2.0">/);
  assert.match(rss, /<link>https:\/\/example\.invalid\/site\/blog\/kako\/<\/link>/);
  assert.match(rss, /<pubDate>Tue, 10 Nov 2026 07:00:00 \+0900<\/pubDate>/);
  const sm = s.read("sitemap.xml");
  assert.match(sm, /<loc>https:\/\/example\.invalid\/site\/blog\/<\/loc>/);
  assert.match(sm, /<loc>https:\/\/example\.invalid\/site\/blog\/touzitsu\/<\/loc><lastmod>2026-11-10<\/lastmod>/);
  assert.match(s.read("llms.txt"), /## 記事一覧[\s\S]*\[当日の記事\]\(https:\/\/example\.invalid\/site\/blog\/touzitsu\/\)/);
  // トップの最新3件は新しい順
  const top = s.read("index.html");
  const order = ["当日の記事", "&quot;&gt;&lt;script&gt;", "過去の記事"].map((t) => top.indexOf(t));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "トップの最新の記事が新しい順でない");
});

test("記事ページ：JSON-LD BlogPosting・関連する相談・固定CTA・相対リンクが切れていない", () => {
  const s = build("2026-11-10", fixtures());
  const html = s.read("blog/kako/index.html");
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const bp = ld["@graph"].find((x) => x["@type"] === "BlogPosting");
  assert.equal(bp.headline, "過去の記事");
  assert.equal(bp.datePublished, "2026-11-01");
  assert.equal(bp.author["@type"], "Organization");
  assert.equal(bp.author.name, "2nd chance recycle");
  assert.equal(bp.publisher.name, "2nd chance recycle");
  assert.match(html, /関連する相談/);
  for (const href of ["../../kaitori/", "../../kataduke/", "../../seiri/"]) assert.ok(html.includes(`href="${href}"`), href);
  assert.match(html, /class="cta-bar"/);
  // 生成したブログのページとトップの相対リンク
  const pages = ["index.html", "blog/index.html", "blog/kako/index.html", "blog/touzitsu/index.html"];
  const broken = [];
  for (const f of pages) {
    const t = s.read(f);
    for (const m of t.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const url = m[1].split("#")[0];
      if (!url || /^(https?:|tel:|mailto:|data:)/.test(url)) continue;
      let target = path.resolve(path.dirname(path.join(s.out, f)), url);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
      if (!fs.existsSync(target)) broken.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("XSS：タイトル・要約・タグ・本文の <script> はエスケープされ、javascript: のリンクは捨てる", () => {
  const s = build("2026-11-10", fixtures());
  const html = s.read("blog/xss/index.html");
  const outsideLd = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
  assert.ok(!/<script>/i.test(outsideLd), "生の <script> が出ている");
  assert.ok(!/<img src=x/i.test(outsideLd));
  assert.ok(!/javascript:/i.test(html));
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.ok(!/<\/script>alert|<script>alert/.test(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]), "JSON-LD の中で script が閉じている");
  assert.ok(!s.read("blog/feed.xml").includes("<script>"));
  assert.ok(!s.read("index.html").includes("<script>alert"));
});

test("--today で公開される記事が切り替わる（実際の content/posts）", () => {
  const a = build("2026-11-07");
  assert.ok(!a.has("blog/hajimeni"), "11/8 の記事が 11/7 に出ている");
  const b = build("2026-11-08");
  assert.ok(b.has("blog/hajimeni/index.html"));
  assert.match(b.read("blog/feed.xml"), /hajimeni/);
  assert.ok(!b.has("blog/mirai-test"), "2099 年の記事が出ている");
  assert.ok(!b.read("sitemap.xml").includes("mirai-test"));
  assert.ok(!b.has("blog/risou-no-kurashi"), "draft の記事が出ている");
  const c = build("2099-01-01");
  assert.ok(c.has("blog/mirai-test/index.html"), "日付が来たら未来日の記事も出る");
});

test("一覧：1ページ20件、21件目から blog/page/2/", () => {
  const dir = tmp("many");
  for (let i = 1; i <= 21; i++) {
    const d = `2026-10-${String(i).padStart(2, "0")}`;
    post(dir, `${d}-k${i}.md`, { title: "記事" + i, date: d, summary: "", tags: [], status: "scheduled" });
  }
  const s = build("2026-11-10", dir);
  const first = s.read("blog/index.html");
  assert.equal((first.match(/class="card post-card"/g) || []).length, 20);
  assert.ok(first.includes("記事21") && !first.includes(">記事1<"), "新しい順でない");
  assert.match(first, /href="\.\.\/blog\/page\/2\/"/);
  const second = s.read("blog/page/2/index.html");
  assert.equal((second.match(/class="card post-card"/g) || []).length, 1);
  assert.match(second, /<b>記事1<\/b>/);
  assert.match(second, /href="\.\.\/\.\.\/\.\.\/css\/site\.css"/);
  assert.match(s.read("sitemap.xml"), /blog\/page\/2\//);
});

test("Markdown 変換の基本", () => {
  const html = mdToHtml("# 大見出し\n## 見出し\n### 小見出し\n\n段落の1行目\n2行目\n\n- りんご\n- **みかん**\n\n1. 一\n2. 二\n\n> 引用です\n\n---\n\n[料金](price/) と ![写真](assets/blog/a.webp) と [外](https://example.invalid/)", { base: "../../" });
  assert.match(html, /<h2>大見出し<\/h2>\n<h2>見出し<\/h2>\n<h3>小見出し<\/h3>/);
  assert.match(html, /<p>段落の1行目<br>2行目<\/p>/);
  assert.match(html, /<ul><li>りんご<\/li><li><strong>みかん<\/strong><\/li><\/ul>/);
  assert.match(html, /<ol><li>一<\/li><li>二<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>引用です<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<a href="\.\.\/\.\.\/price\/">料金<\/a>/);
  assert.match(html, /<img src="\.\.\/\.\.\/assets\/blog\/a\.webp" alt="写真" loading="lazy">/);
  assert.match(html, /<a href="https:\/\/example\.invalid\/" rel="noopener">外<\/a>/);
  assert.equal(inline("a < b & \"c\""), "a &lt; b &amp; &quot;c&quot;");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  const fm = parseFrontmatter("---\ntitle: \"題: 名\"\ntags:\n  - 片付け\n  - 買取\nstatus: draft\n---\n本文");
  assert.deepEqual(fm.data, { title: "題: 名", tags: ["片付け", "買取"], status: "draft" });
  assert.equal(fm.body, "本文");
});

test("記事の形の誤りは build を止める（日付とファイル名の不一致・status の誤り）", () => {
  const dir = tmp("bad");
  post(dir, "2026-11-01-a.md", { title: "a", date: "2026-11-02", summary: "", tags: [], status: "scheduled" });
  post(dir, "2026-11-01-b.md", { title: "b", date: "2026-11-01", summary: "", tags: [], status: "published" });
  assert.throws(() => loadPosts(dir), /ファイル名の日付[\s\S]*status は draft か scheduled/);
});

test("実際の content/posts が読めて、見本と下書きがある", () => {
  const posts = loadPosts(path.join(ROOT, "content/posts"), ROOT);
  const slugs = posts.map((p) => p.slug);
  for (const s of ["hajimeni", "risou-no-kurashi", "mirai-test"]) assert.ok(slugs.includes(s), s);
  assert.equal(posts.find((p) => p.slug === "mirai-test").title, "未来日のテスト");
  assert.match(todayJST(new Date("2026-11-09T22:00:00Z")), /^2026-11-10$/, "UTC 22:00 は日本時間の翌日 07:00");
});
