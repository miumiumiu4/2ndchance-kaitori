// ブログ記事の倉庫（content/posts/YYYY-MM-DD-<slug>.md）を読み、公開してよい記事を選ぶ。
// 公開判定：status が scheduled で、date が今日（日本時間）以前のものだけ。draft と未来日は出さない。
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./md.mjs";

export const STATUSES = ["draft", "scheduled"];
const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 日本時間の今日（YYYY-MM-DD）
export function todayJST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isValidDate(s) {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// 記事を全部読む（形の誤りは例外にして build を止める）
export function loadPosts(dir, root) {
  if (!fs.existsSync(dir)) return [];
  const errors = [];
  const posts = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const where = `content/posts/${name}`;
    const fm = FILE_RE.exec(name);
    if (!fm) { errors.push(`${where}: ファイル名は YYYY-MM-DD-<英小文字・数字・ハイフン>.md`); continue; }
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
    const tags = Array.isArray(data.tags) ? data.tags : data.tags ? String(data.tags).split(",").map((s) => s.trim()).filter(Boolean) : [];
    const p = { file: name, slug: fm[2], title: data.title || "", date: data.date || "", summary: data.summary || "", tags, cover: data.cover || "", status: data.status || "", body };
    if (!p.title) errors.push(`${where}: title が空`);
    if (!isValidDate(p.date)) errors.push(`${where}: date は YYYY-MM-DD（今は「${p.date}」）`);
    else if (p.date !== fm[1]) errors.push(`${where}: date（${p.date}）とファイル名の日付（${fm[1]}）が違う。日付を変えたらファイル名も変える`);
    if (!STATUSES.includes(p.status)) errors.push(`${where}: status は draft か scheduled（今は「${p.status}」）`);
    if (p.cover) {
      if (!/^assets\/blog\/[\w.-]+$/.test(p.cover)) errors.push(`${where}: cover は assets/blog/ の画像（例 assets/blog/katazuke-01.webp）`);
      else if (root && !fs.existsSync(path.join(root, p.cover))) errors.push(`${where}: cover の画像 ${p.cover} が無い`);
    }
    // 予約した記事の本文の画像（assets/blog/…）が置いてあるか
    if (root && p.status === "scheduled") {
      for (const m of p.body.matchAll(/!\[[^\]]*\]\(([^)\s]*)\)/g)) {
        if (/^assets\//.test(m[1]) && !fs.existsSync(path.join(root, m[1]))) errors.push(`${where}: 本文の画像 ${m[1]} が無い（assets/blog/ に置く）`);
      }
    }
    posts.push(p);
  }
  const seen = new Map();
  for (const p of posts) {
    if (seen.has(p.slug)) errors.push(`content/posts: slug「${p.slug}」が重複（${seen.get(p.slug)} と ${p.file}）`);
    seen.set(p.slug, p.file);
  }
  if (errors.length) throw new Error("記事の形に誤り：\n" + errors.join("\n"));
  return posts;
}

// 公開してよい記事（新しい順。同じ日はファイル名の逆順）
export function publishedPosts(posts, today) {
  return posts
    .filter((p) => p.status === "scheduled" && p.date <= today)
    .sort((a, b) => (a.date === b.date ? b.file.localeCompare(a.file) : b.date.localeCompare(a.date)));
}
