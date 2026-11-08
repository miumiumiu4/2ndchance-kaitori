#!/usr/bin/env node
// 記事のひな形を作る。
//   node tools/new-post.mjs "タイトル" --date 2026-11-10 --tags 片付け,遺品整理 [--slug katazuke-junban]
// → content/posts/2026-11-10-<slug>.md（status: draft）。書き終えたら status を scheduled にすると、その日の朝 7時に公開。
//   --date を省くと日本時間の今日。--slug を省くとタイトルの英数字から作り、無ければ kiji（重複は -2, -3…）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayJST, isValidDate } from "./blog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "content/posts");
const args = process.argv.slice(2);
const opt = (name) => {
  const eq = args.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const used = new Set();
["--date", "--tags", "--slug"].forEach((n) => { const i = args.indexOf(n); if (i >= 0) { used.add(i); used.add(i + 1); } });
const title = args.find((a, i) => !used.has(i) && !a.startsWith("--"));
if (!title) {
  console.error('使い方：node tools/new-post.mjs "タイトル" --date YYYY-MM-DD --tags 片付け,遺品整理 [--slug 英小文字-ハイフン]');
  process.exit(2);
}
const date = opt("--date") || todayJST();
if (!isValidDate(date)) { console.error("--date は YYYY-MM-DD（今は「" + date + "」）"); process.exit(2); }
const tags = (opt("--tags") || "").split(/[,、]/).map((s) => s.trim()).filter(Boolean);
let slug = (opt("--slug") || title.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || "kiji";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { console.error("--slug は英小文字・数字・ハイフン（例 katazuke-junban）"); process.exit(2); }

fs.mkdirSync(DIR, { recursive: true });
const taken = (s) => fs.readdirSync(DIR).some((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, "") === s + ".md");
if (opt("--slug") && taken(slug)) { console.error(`slug「${slug}」はもう使われています。別の --slug を付けてください`); process.exit(1); }
const baseSlug = slug;
for (let n = 2; taken(slug); n++) slug = `${baseSlug}-${n}`;

const q = (s) => (/[:#\[\]",]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);
const file = path.join(DIR, `${date}-${slug}.md`);
fs.writeFileSync(file, `---
title: ${q(title)}
date: ${date}
summary: 一覧と検索結果に出る1〜2文の要約を書く
tags: [${tags.map(q).join(", ")}]
# cover: assets/blog/${slug}-01.webp
status: draft
---
書き出しの段落（何の記事か、誰の役に立つか）。

## 見出し1

本文。箇条書きは「- 」、番号付きは「1. 」、太字は **ここ**、リンクは [料金・実績](price/)。

## 見出し2

（写真を入れるときは assets/blog/${slug}-01.webp に置き、次の行の形で書く。使わないなら次の行を消す）
![写真の説明](assets/blog/${slug}-01.webp)
`);
console.log(`作成：${path.relative(ROOT, file)}（status: draft。公開するときは scheduled に）`);
