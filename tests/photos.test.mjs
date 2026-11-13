// 販売商品の写真：メタデータ（EXIF・GPS・ICC・XMP）が無いこと、大きさ
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_ORIGIN } from "./origin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "assets/shop");

// JPEG のセグメントを読み、APPn（E1〜EF）と大きさ（SOF）を返す
function scan(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, "JPEG ではない");
  const app = [];
  let size = null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    const m = buf[i + 1];
    if (m === 0xda) break; // 画素の始まり
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xe1 && m <= 0xef) app.push(m.toString(16));
    if (m >= 0xc0 && m <= 0xc3) size = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { app, size };
}

test("assets/shop の写真に EXIF・GPS などのメタデータが無い、長辺は 1200px／480px 以下", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".jpg"));
  assert.ok(files.length >= (IS_ORIGIN ? 2 : 0)); // 量産した店は写真が届くまで0枚
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const { app, size } = scan(buf);
    assert.deepEqual(app, [], f + " に APP セグメント（EXIF など）");
    assert.ok(!buf.includes(Buffer.from("Exif\0")), f + " に Exif");
    const max = f.endsWith("-480.jpg") ? 480 : 1200;
    assert.ok(size && Math.max(size.w, size.h) <= max, f + " の大きさ");
  }
});

test("元写真や公開しない写真の名前が無い", () => {
  for (const f of fs.readdirSync(DIR)) {
    assert.ok(!/DO_NOT_PUBLISH|HAS_POSTER|_\d{4,}\.jpg$/i.test(f), f);
  }
});
