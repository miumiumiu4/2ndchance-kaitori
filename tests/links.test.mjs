// 相対リンク・画像の簡易チェック（リンク切れが無いか）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = ["index.html", "kaitori/index.html", "kataduke/index.html", "seiri/index.html", "flow/index.html", "price/index.html", "privacy/index.html"];

test("相対リンクの行き先がある（ページ内の #id も確かめる）", () => {
  const broken = [];
  for (const f of HTML) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    const dir = path.dirname(path.join(ROOT, f));
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const url = m[1];
      if (!url || url === "#" || /^(https?:|tel:|mailto:|data:)/.test(url)) continue;
      if (url.startsWith("/")) { broken.push(`${f}: 絶対パス ${url}（相対にする）`); continue; }
      const [p, hash] = url.split("#");
      const pathOnly = p.split("?")[0];
      let target = pathOnly ? path.resolve(dir, pathOnly) : path.join(ROOT, f);
      if (pathOnly === "" && !hash) continue;
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
      if (!fs.existsSync(target)) { broken.push(`${f}: ${url}`); continue; }
      if (hash && target.endsWith(".html")) {
        const t = fs.readFileSync(target, "utf8");
        if (!new RegExp(`id="${hash}"`).test(t)) broken.push(`${f}: ${url}（#${hash} が無い）`);
      }
    }
  }
  assert.deepEqual(broken, []);
});
