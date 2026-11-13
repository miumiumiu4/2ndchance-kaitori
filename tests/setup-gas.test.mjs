// gas/Setup.gs（店ごとの初回設定）を偽物の Google の中で動かす：シートは1回だけ作る・値は上書きしない・ログに値を出さない
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
function load(initial) {
  const props = new Map(Object.entries(initial || {}));
  const logs = [];
  let created = 0;
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    SpreadsheetApp: { create: (name) => { created++; return { getId: () => "sheet-id-" + created, getName: () => name }; } },
    Logger: { log: (s) => logs.push(String(s)) }
  };
  vm.createContext(ctx);
  vm.runInContext([read("gas/Store.gs"), read("gas/Prices.gs"), read("gas/QuoteCore.gs"), read("gas/Code.gs"), read("gas/Setup.gs")].join("\n") + "\nthis.S = { setupStore };", ctx);
  return { S: ctx.S, props, logs, created: () => created };
}

test("setupStore：シートを作って SHEET_ID・ADMIN_REPO を入れ、足りない名前だけを返す", () => {
  const g = load({});
  const r = g.S.setupStore();
  assert.equal(g.created(), 1);
  assert.equal(g.props.get("SHEET_ID"), "sheet-id-1");
  const repo = JSON.parse(read("data/store.json")).repo; // 量産した店はリポジトリが決まるまで空
  assert.equal(g.props.get("ADMIN_REPO") || "", repo);
  assert.deepEqual([...r.missing], ["OWNER_EMAIL"]);
  assert.deepEqual([...r.missing_admin], ["ADMIN_PASS_HASH", "ADMIN_GITHUB_TOKEN", ...(repo ? [] : ["ADMIN_REPO"])]);
  assert.ok(!g.logs.join("\n").includes("sheet-id-1"), "シートの ID をログに出さない");
});

test("setupStore：2回目は何も作らず、入っている値を上書きしない", () => {
  const g = load({ SHEET_ID: "keep", OWNER_EMAIL: "x", ADMIN_REPO: "someone/else", ADMIN_PASS_HASH: "h", ADMIN_GITHUB_TOKEN: "t" });
  const r = g.S.setupStore();
  assert.equal(g.created(), 0);
  assert.equal(g.props.get("SHEET_ID"), "keep");
  assert.equal(g.props.get("ADMIN_REPO"), "someone/else");
  assert.deepEqual([...r.missing], []);
  assert.deepEqual([...r.missing_admin], []);
  for (const v of ["keep", "h", "t"]) assert.ok(!g.logs.join("\n").includes(v + "\n") && !g.logs.join("\n").endsWith(v), "値をログに出さない");
});
