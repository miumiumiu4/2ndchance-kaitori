// 見本の店（2nd chance recycle）の実物（記事・金額の数・商品・郵便番号表）に頼る試験の印。
// 量産の型（tools/new-store.mjs）で作った店では、data/store.json の repo が見本と違うので、その試験だけ飛ばす。
// 型そのものの試験（式・組み立て・管理画面・受け口・秘密 grep・リンク）はどの店でも全部走る。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORIGIN_REPO = "miumiumiu4/2ndchance-kaitori";
export const STORE = JSON.parse(fs.readFileSync(path.join(ROOT, "data/store.json"), "utf8"));
export const IS_ORIGIN = STORE.repo === ORIGIN_REPO;
// test(名前, originOnly, 中身) の形で使う
export const originOnly = { skip: IS_ORIGIN ? false : "見本の店の実物に頼る試験（量産した店では飛ばす）" };
