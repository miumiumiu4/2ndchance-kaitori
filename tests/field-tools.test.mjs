// 現場の道具（/admin/tools/）：業種の型・見積書の合計と文面・訪問の連絡・予定表の .ics
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { industryOf, toolsFor, sheetTotals, sheetText, visitText, dayBeforeText, reviewText, icsEvent, jaDate } from "../js/field-tools-core.js";

const IND = JSON.parse(fs.readFileSync(new URL("../data/industries.json", import.meta.url), "utf8"));
const KEYS = Object.keys(IND).filter((k) => !k.startsWith("_"));

test("4業種の型がそろい、道具は _tools にある物だけ", () => {
  assert.deepEqual(KEYS.sort(), ["fuyou", "ihin", "kaitori", "recycle"]);
  for (const k of KEYS) {
    const ind = IND[k];
    assert.ok(ind.label && Array.isArray(ind.terms) && ind.terms.length >= 3, k);
    for (const t of ind.tools) assert.ok(IND._tools[t], `${k} の ${t}`);
    assert.ok(ind.tools.includes("estimate") && ind.tools.includes("visit"), `${k} は見積書と訪問の連絡を持つ`);
  }
});

test("知らない業種は recycle（今の見本と同じ）", () => {
  assert.equal(industryOf("nope", IND).key, "recycle");
  assert.equal(industryOf(undefined, IND).key, "recycle");
  assert.equal(industryOf("_tools", IND).key, "recycle");
  assert.equal(industryOf("ihin", IND).label, "遺品整理・生前整理");
});

test("古物を扱う業種だけに買取の記録が出る", () => {
  for (const k of KEYS) assert.equal(toolsFor(k, IND).some((t) => t.id === "ledger"), IND[k].kobutsu, k);
});

test("見積書の合計：数×単価＋出張費−買取の差し引き。空の行と全角・カンマも扱う", () => {
  const t = sheetTotals({ lines: [{ name: "軽トラ1台分", qty: "1", unit: "15,000" }, { name: "エアコン取り外し", qty: "２", unit: "５０００" }, { name: " ", qty: 3, unit: 999 }], travel: "2000", buyback: "3000" });
  assert.equal(t.rows.length, 2);
  assert.equal(t.work, 25000);
  assert.equal(t.total, 24000);
  assert.equal(sheetTotals({ lines: [{ name: "冷蔵庫", qty: 1, unit: 0 }], buyback: 5000 }).total, -5000);
});

test("見積書の文面に内訳・合計・追加料金の決まり・キャンセル・有効期限が入る", () => {
  const totals = sheetTotals({ lines: [{ name: "2DK 片付け", qty: 1, unit: 98000 }], travel: 0, buyback: 8000 });
  const s = sheetText({ storeName: "見本の店", customer: "山田", date: "2026-11-20", totals, terms: IND.fuyou.terms, cancel: IND.fuyou.cancel });
  assert.match(s, /【お見積書】 見本の店/);
  assert.match(s, /・2DK 片付け　¥98,000/);
  assert.match(s, /・買取の差し引き　−¥8,000/);
  assert.match(s, /■ 合計（税込）　¥90,000/);
  assert.match(s, /ご了承なしに追加の請求はしません/);
  assert.match(s, /前日までのキャンセルは無料/);
  assert.match(s, /有効期限は、作成日から14日/);
  assert.match(sheetText({ storeName: "x", totals: sheetTotals({ lines: [{ name: "a", unit: 0 }], buyback: 500 }) }), /お受け取り ¥500/);
});

test("訪問の連絡と前日の知らせ：曜日つきの日時、変更の連絡先", () => {
  assert.equal(jaDate("2026-11-20", "10:00"), "11月20日（金）10:00");
  const v = visitText({ storeName: "見本の店", customer: "山田", date: "2026-11-20", time: "10:00", minutes: 90, tel: "店の番号", bring: ["本人確認書類"] });
  assert.match(v, /山田 様/);
  assert.match(v, /11月20日（金）10:00（90分ほど）/);
  assert.match(v, /ご用意いただく物　本人確認書類/);
  assert.match(v, /前日までに/);
  assert.match(dayBeforeText({ storeName: "見本の店", date: "2026-11-20", time: "10:00" }), /明日 11月20日（金）10:00 にお伺いします/);
});

test("口コミのお願いは、お礼と引き換えにしない", () => {
  const r = reviewText({ storeName: "見本の店", url: "https://example.com/review" });
  assert.match(r, /https:\/\/example\.com\/review/);
  assert.doesNotMatch(r, /プレゼント|割引|値引き|クーポン|特典/);
});

test(".ics：日本時間、終わりは分を足す、前日の知らせ、日付が変なら空", () => {
  const s = icsEvent({ title: "訪問（不用品回収・片付け）", date: "2026-11-20", time: "23:30", minutes: 60 });
  assert.match(s, /DTSTART;TZID=Asia\/Tokyo:20261120T233000/);
  assert.match(s, /DTEND;TZID=Asia\/Tokyo:20261121T003000/);
  assert.match(s, /TRIGGER:-P1D/);
  assert.ok(s.endsWith("\r\n"));
  assert.equal(icsEvent({ title: "x", date: "11/20", time: "10:00" }), "");
});

test("画面はログイン不要で、何も送らない（GAS・fetch の POST・保存を使わない）", () => {
  const ui = fs.readFileSync(new URL("../js/field-tools.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /GAS_URL|method:\s*"POST"|localStorage|sessionStorage|indexedDB/);
  const html = fs.readFileSync(new URL("../admin/tools/index.html", import.meta.url), "utf8");
  assert.match(html, /noindex, nofollow/);
});
