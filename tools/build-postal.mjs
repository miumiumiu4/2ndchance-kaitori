#!/usr/bin/env node
// 郵便番号 → 緯度経度 の表（data/postal/<上3桁>.json）を作る。生成物はコミットする（毎回は作らない）。
//   node tools/build-postal.mjs --db <posuto の postaldata.db> [--cache <取得した町域データの置き場>] [--radius 60]
// 出典：
//   郵便番号 → 市区町村・町域 … 日本郵便「郵便番号データ」（Python パッケージ posuto に同梱の SQLite。
//                                 `pip download posuto` で得た whl を展開した posuto/postaldata.db）
//   町域 → 緯度経度          … Geolonia「japanese-addresses」（CC BY 4.0）
//                                 https://raw.githubusercontent.com/geolonia/japanese-addresses/master/api/ja/<都道府県>/<市区町村>.json
// 突合：町域名が一致する行（小字が空の行を優先）→ 町域名で始まる行（丁目違い）の平均 → 市区町村の平均座標。
// 店（js/config.js の STORE_LATLNG）から直線で radius km 以内の郵便番号だけを書き出す（軽くするため）。
// 事業所の個別番号（office_data）は使わない。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DB = arg("--db");
if (!DB) { console.error("--db <posuto の postaldata.db> を指定してください"); process.exit(2); }
const CACHE = arg("--cache", null);
const RADIUS = Number(arg("--radius", 60));
const PREFS = ["熊本県", "福岡県", "大分県", "佐賀県", "長崎県", "宮崎県", "鹿児島県"];
const BASE = "https://raw.githubusercontent.com/geolonia/japanese-addresses/master/api/ja";

const { CONFIG } = await import(pathToFileURL(path.join(ROOT, "js/config.js")).href);
const { haversineKm } = await import(pathToFileURL(path.join(ROOT, "js/delivery-core.js")).href);
const STORE = CONFIG.STORE_LATLNG;

async function getJSON(url, cacheName) {
  const cp = CACHE ? path.join(CACHE, cacheName) : null;
  if (cp && fs.existsSync(cp)) return JSON.parse(fs.readFileSync(cp, "utf8"));
  let text;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(String(r.status));
      text = await r.text();
      break;
    } catch (e) {
      // fetch が使えない環境では curl で
      try { text = execFileSync("curl", ["-sSf", url], { encoding: "utf8", maxBuffer: 64 << 20 }); break; } catch (_) {}
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** i));
    }
  }
  if (text === undefined) throw new Error("取得できません：" + url);
  if (cp) { fs.mkdirSync(path.dirname(cp), { recursive: true }); fs.writeFileSync(cp, text); }
  return JSON.parse(text);
}

const strip = (s) => String(s || "").replace(/（.*?）|\(.*?\)/g, "").replace(/^大字/, "").replace(/^字/, "").trim();
const avg = (rows) => rows.length ? [rows.reduce((a, r) => a + r.lat, 0) / rows.length, rows.reduce((a, r) => a + r.lng, 0) / rows.length] : null;

function locate(town, rows) {
  const t = strip(town);
  if (!t || /以下に掲載がない場合|の次に番地がくる場合|一円/.test(town)) return { ll: avg(rows.filter((r) => !r.koaza)) || avg(rows), how: "city" };
  const exact = rows.filter((r) => r.town === t || r.town === "大字" + t || r.town === "字" + t);
  if (exact.length) {
    const base = exact.filter((r) => !r.koaza);
    return { ll: avg(base.length ? base : exact), how: "town" };
  }
  const prefix = rows.filter((r) => r.town.startsWith(t) && !r.koaza);
  if (prefix.length) return { ll: avg(prefix), how: "prefix" };
  return { ll: avg(rows.filter((r) => !r.koaza)) || avg(rows), how: "city" };
}

const db = new DatabaseSync(DB, { readOnly: true });
const index = await getJSON(BASE + ".json", "ja.json");
const out = {};
const stat = { town: 0, prefix: 0, city: 0, none: 0, kept: 0 };
for (const pref of PREFS) {
  const rows = db.prepare("select code, city, neighborhood from postal_data where prefecture = ?").all(pref);
  const byCity = new Map();
  rows.forEach((r) => { if (!byCity.has(r.city)) byCity.set(r.city, []); byCity.get(r.city).push(r); });
  for (const [city, list] of byCity) {
    const geo = (index[pref] || []).includes(city) ? await getJSON(`${BASE}/${encodeURIComponent(pref)}/${encodeURIComponent(city)}.json`, `${pref}/${city}.json`) : null;
    if (!geo || !geo.length) { stat.none += list.length; continue; }
    // 市区町村のどこも半径に入らないなら飛ばす
    if (!geo.some((g) => haversineKm(STORE, [g.lat, g.lng]) <= RADIUS + 5)) continue;
    for (const r of list) {
      if (!/^\d{7}$/.test(r.code)) continue;
      const { ll, how } = locate(r.neighborhood, geo);
      if (!ll) { stat.none++; continue; }
      if (haversineKm(STORE, ll) > RADIUS) continue;
      stat[how]++;
      // 同じ郵便番号が複数の町域にまたがるときは平均
      const prev = out[r.code];
      const v = [Number(ll[0].toFixed(4)), Number(ll[1].toFixed(4))];
      out[r.code] = prev ? [Number(((prev[0] + v[0]) / 2).toFixed(4)), Number(((prev[1] + v[1]) / 2).toFixed(4))] : v;
    }
  }
}

const dir = path.join(ROOT, "data/postal");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const groups = {};
for (const code of Object.keys(out).sort()) (groups[code.slice(0, 3)] ||= {})[code] = out[code];
for (const [p3, obj] of Object.entries(groups)) fs.writeFileSync(path.join(dir, p3 + ".json"), JSON.stringify(obj).replace(/\],"/g, '],\n"') + "\n");
stat.kept = Object.keys(out).length;
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
  _note: "郵便番号（7桁）→ 緯度経度の表。tools/build-postal.mjs が生成。店から直線 " + RADIUS + "km 以内だけ。",
  source: "日本郵便 郵便番号データ（posuto 経由）／Geolonia japanese-addresses（CC BY 4.0）",
  store: STORE,
  radius_km: RADIUS,
  prefixes: Object.keys(groups).sort(),
  count: stat.kept
}, null, 1) + "\n");
console.log(`data/postal: ${stat.kept} 件（町域一致 ${stat.town}・丁目違い ${stat.prefix}・市区町村の平均 ${stat.city}・座標なし ${stat.none}）、${Object.keys(groups).length} ファイル`);
