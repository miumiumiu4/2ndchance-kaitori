// 小さな Markdown → HTML 変換（依存ゼロ）。ブログ記事（content/posts/*.md）用。
// 対応：見出し（# は h2 に読み替え。記事の h1 はタイトル）・段落（1行の改行は <br>）・箇条書き（- / *）・
//       番号付き（1.）・太字（**）・リンク [文字](URL)・画像 ![説明](URL)・引用（>）・水平線（--- / ***）。
// 文字はすべて HTML エスケープする（<script> などはそのまま文字として出る）。
// URL は http(s)・mailto・tel・相対パスだけ通す（javascript: などは捨てる）。
// 相対パス（kaitori/ や assets/blog/x.webp）はサイトの直下からの道として書き、opts.base を前に付ける。

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function safeUrl(url, base = "") {
  const u = String(url || "").trim();
  if (!u) return null;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//") || u.includes("\\")) return null; // javascript: など
  if (u.startsWith("#") || u.startsWith("/") || u.startsWith("./") || u.startsWith("../")) return u;
  return base + u;
}

export function inline(text, opts = {}) {
  const base = opts.base || "";
  const out = [];
  let i = 0;
  const s = String(text);
  // 画像 → リンク → 太字 の順に拾い、残りはエスケープ
  const re = /!\[([^\]]*)\]\(([^)\s]*)\)|\[([^\]]+)\]\(([^)\s]*)\)|\*\*(.+?)\*\*/g;
  let m;
  while ((m = re.exec(s))) {
    out.push(esc(s.slice(i, m.index)));
    if (m[2] !== undefined && m[0].startsWith("!")) {
      const src = safeUrl(m[2], base);
      out.push(src ? `<img src="${esc(src)}" alt="${esc(m[1])}" loading="lazy">` : esc(m[1]));
    } else if (m[3] !== undefined) {
      const href = safeUrl(m[4], base);
      const ext = href && /^https?:/i.test(href);
      out.push(href ? `<a href="${esc(href)}"${ext ? ' rel="noopener"' : ""}>${inline(m[3], opts)}</a>` : inline(m[3], opts));
    } else {
      out.push(`<strong>${inline(m[5], opts)}</strong>`);
    }
    i = re.lastIndex;
  }
  out.push(esc(s.slice(i)));
  return out.join("");
}

export function mdToHtml(src, opts = {}) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let para = [];
  let list = null; // { tag, items: [] }
  let quote = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${para.map((l) => inline(l, opts)).join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((t) => `<li>${inline(t, opts)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { html.push(`<blockquote>${mdToHtml(quote.join("\n"), opts)}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (/^\s*>/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^\s*>\s?/, "")); continue; }
    flushQuote();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$/.test(line)) { flushAll(); html.push("<hr>"); continue; }
    if ((m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line))) {
      flushAll();
      const lv = Math.min(6, Math.max(2, m[1].length === 1 ? 2 : m[1].length));
      html.push(`<h${lv}>${inline(m[2], opts)}</h${lv}>`);
      continue;
    }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; } // 箇条書きの続きの行
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return html.join("\n");
}

// frontmatter（--- で囲んだ先頭）を読む。YAML のごく一部：key: 値／"引用"／[a, b]／次の行の「- 値」の並び
export function parseFrontmatter(src) {
  const text = String(src).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  let lastKey = null;
  const unq = (v) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
  };
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    let mm;
    if ((mm = /^\s+-\s+(.*)$/.exec(line)) && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = [];
      data[lastKey].push(unq(mm[1]));
      continue;
    }
    if ((mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line))) {
      const [, k, v] = mm;
      lastKey = k;
      if (v.trim().startsWith("[") && v.trim().endsWith("]")) data[k] = v.trim().slice(1, -1).split(",").map(unq).filter(Boolean);
      else data[k] = v.trim() === "" ? "" : unq(v);
    }
  }
  return { data, body: text.slice(m[0].length) };
}
