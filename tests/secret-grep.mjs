// 秘密・個人情報らしき文字列がリポジトリに無いか調べる（見つけたら失敗）。
// 見つかったら allowlist に足すのではなく、値を伏せる（値は GAS のスクリプトプロパティか Actions Variables へ）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "screens", "_site"]);
const TEXT_EXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".xml", ".svg", ".gs", ".yml", ".yaml", ""]);

// パターンは文字列をつないで作る（このファイル自身に引っかからないように）
export const PATTERNS = [
  { name: "メールアドレス", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { name: "電話番号らしき並び（ハイフンあり）", re: /(?<![0-9])0\d{1,4}[-‐ー－]\d{1,4}[-‐ー－]\d{3,4}(?![0-9])/g },
  { name: "電話番号らしき並び（携帯 11 桁）", re: /(?<![0-9])0[5789]0\d{8}(?![0-9])/g },
  { name: "電話番号らしき並び（+81）", re: /\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g },
  { name: "デプロイ ID", re: new RegExp("AKfy" + "cb", "g") },
  { name: "32桁以上の hex", re: /[0-9a-fA-F]{32,}/g }
];

// 公開してよい番号（完全一致の文字列だけ。パターンを弱めたり、パスを除外したりはしない）
// 店の代表番号・チラシに印刷済み・オーナー指示 2026-11-13（携帯の番号はここに足さない）
// 量産の型：店ごとの代表番号は data/store.json の tel を1つだけ許す（看板・チラシに出している番号だけを書く約束）
const STORE_TEL = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data/store.json"), "utf8")).tel || ""; } catch (_) { return ""; } })();
export const PUBLIC_NUMBERS = new Set(["096-206-2490", ...(STORE_TEL ? [STORE_TEL] : [])]);

export function listFiles(dir = ROOT) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(p));
    else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

export function scanText(text) {
  const hits = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (PUBLIC_NUMBERS.has(m[0])) continue;
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ name, line, sample: m[0].slice(0, 6) + "…" });
    }
  }
  return hits;
}

test("秘密 grep：パターンが効く（自己点検）", () => {
  const at = "@";
  assert.ok(scanText("info" + at + "example.jp").length, "メール");
  assert.ok(scanText("0" + "96-123-4567").length, "固定電話");
  assert.ok(scanText("0" + "9012345678").length, "携帯");
  assert.ok(scanText("AKfy" + "cbXYZ").length, "デプロイ ID");
  assert.ok(scanText("ab".repeat(16)).length, "hex");
  assert.equal(scanText("電話：" + "096-206-2490").length, 0, "店の代表番号（公開）は通す");
  assert.ok(scanText("096-206-" + "2491").length, "1桁違いは止める（完全一致だけ）");
  assert.equal(scanText("actions/upload-pages-artifact" + at + "v3 2026-11-07 ¥12,000").length, 0, "誤検知しない");
});

test("秘密 grep：リポジトリに秘密・個人情報らしき文字列が無い", () => {
  const found = [];
  for (const f of listFiles()) {
    for (const h of scanText(fs.readFileSync(f, "utf8"))) found.push(`${path.relative(ROOT, f)}:${h.line} ${h.name}（${h.sample}）`);
  }
  assert.deepEqual(found, [], "見つかった：\n" + found.join("\n"));
});
