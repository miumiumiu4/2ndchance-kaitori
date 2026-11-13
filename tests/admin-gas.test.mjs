// 管理画面の受け口（gas/Admin.gs）を、Apps Script と GitHub の偽物の上で動かす。
// ログイン（ハッシュ照合・5回でロック・オーナーへメール）、読み込み、保存（確かめ → 1つのコミット → メール）、
// 重なり（base_sha）、写真の確かめ、受付が main の価格表・商品表を使うこと。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { passHash } from "../tools/passhash.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PASS = "test-passcode-123";
const signed = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => b & 255));
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

// GitHub の偽物：ファイル（パス → Buffer）と main の位置、作られたコミット
function fakeGitHub() {
  const files = new Map();
  // 中身は試験用の写し（data/*.json は管理画面で変わるので）
  for (const p of ["shop", "prices", "site", "results"]) files.set("data/" + p + ".json", fs.readFileSync(path.join(ROOT, "tests/fixtures", p + ".json")));
  files.set("data/items.json", fs.readFileSync(path.join(ROOT, "data/items.json")));
  // 試験用の商品表に載っている写真（大と -480）だけを置いておく（実物の assets/shop には頼らない）
  for (const it of JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/shop.json"), "utf8")).items) for (const p of it.photos) for (const q of [p, p.replace(/\.jpg$/, "-480.jpg")]) files.set(q, Buffer.from("x"));
  const gh = { files, head: "c0", commits: [], blobs: new Map(), trees: new Map(), calls: [], failPatch: false };
  gh.fetch = (url, opt) => {
    const m = /^https:\/\/api\.github\.com\/repos\/miumiumiu4\/2ndchance-kaitori(\/[^?]*)(\?.*)?$/.exec(url);
    assert.ok(m, "GitHub の URL：" + url);
    assert.match(opt.headers.Authorization, /^Bearer test-token$/);
    const p = m[1];
    const method = (opt.method || "get").toLowerCase();
    const body = opt.payload ? JSON.parse(opt.payload) : null;
    gh.calls.push(method + " " + p);
    const res = (code, j) => ({ getResponseCode: () => code, getContentText: () => (j === undefined ? "" : JSON.stringify(j)) });
    let r;
    if (method === "get" && p.startsWith("/contents/")) {
      const fp = p.slice("/contents/".length);
      if (files.has(fp)) return res(200, { sha: sha1(files.get(fp)), content: files.get(fp).toString("base64").replace(/(.{60})/g, "$1\n") });
      const list = [...files.keys()].filter((k) => k.startsWith(fp + "/")).map((k) => ({ name: k.slice(fp.length + 1) }));
      return list.length ? res(200, list) : res(404, { message: "Not Found" });
    }
    if (method === "get" && p === "/git/ref/heads/main") return res(200, { object: { sha: gh.head } });
    if (method === "get" && p.startsWith("/git/commits/")) return res(200, { tree: { sha: "t-" + p.slice(13) } });
    if (method === "post" && p === "/git/blobs") { const buf = Buffer.from(body.content, "base64"); const s = sha1(buf); gh.blobs.set(s, buf); return res(201, { sha: s }); }
    if (method === "post" && p === "/git/trees") { const s = "tree" + gh.trees.size; gh.trees.set(s, body); return res(201, { sha: s }); }
    if (method === "post" && p === "/git/commits") { const s = "c" + (gh.commits.length + 1) + "abcdef0123"; gh.commits.push({ sha: s, ...body }); return res(201, { sha: s }); }
    if (method === "patch" && p === "/git/refs/heads/main") {
      if (gh.failPatch) return res(422, { message: "Update is not a fast forward" });
      const c = gh.commits.find((x) => x.sha === body.sha);
      gh.trees.get(c.tree).tree.forEach((e) => files.set(e.path, gh.blobs.get(e.sha)));
      gh.head = c.sha;
      return res(200, {});
    }
    r = res(500, { message: "偽物にない呼び出し " + method + " " + p });
    return r;
  };
  return gh;
}

function load(props = {}) {
  const store = { OWNER_EMAIL: "owner" + "@" + "example.invalid", ADMIN_PASS_HASH: passHash(PASS), ADMIN_GITHUB_TOKEN: "test-token", ...props };
  const cache = new Map();
  const mails = [];
  const gh = fakeGitHub();
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, setProperties: (o) => Object.assign(store, o) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k).v : null), put: (k, v, s) => { assert.ok(s <= 21600, "CacheService の上限は6時間"); cache.set(k, { v, s }); }, remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: (o) => mails.push(o) },
    UrlFetchApp: { fetch: (u, o) => gh.fetch(u, o) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => signed(createHash(alg).update(s, "utf8").digest()),
      getUuid: () => randomUUID(),
      base64Decode: (s) => signed(Buffer.from(s, "base64")),
      base64Encode: (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : unsigned(x)).toString("base64"),
      newBlob: (bytes) => ({ getDataAsString: () => unsigned(bytes).toString("utf8") }),
      formatDate: (d) => d.toISOString().slice(0, 19).replace("T", " ")
    }
  };
  vm.createContext(ctx);
  // Prices.gs・Shop.gs の代わりに試験用の写し
  const src = ["var PRICES = " + read("tests/fixtures/prices.json") + ";", read("gas/QuoteCore.gs"), read("gas/ShopCore.gs"), "var SHOP = " + read("tests/fixtures/shop.json") + ";", ...["gas/AdminCore.gs", "gas/Code.gs", "gas/Admin.gs"].map(read)].join("\n");
  vm.runInContext(src + "\nthis.post = function (b) { return doPost({ postData: { contents: JSON.stringify(b) } }); }; this.setNow = function (t) { adminNow_ = function () { return t; }; }; this.live = function () { adminLiveData_(); return { SHOP: SHOP, PRICES: PRICES }; };", ctx);
  return { ctx, store, cache, mails, gh, post: ctx.post };
}
const login = (G, extra) => G.post({ kind: "admin_login", passcode: PASS, who: "共同代表", ...extra });

test("ログイン：正しいパスコードで印（64桁）、違えば残り回数、5回でロックしてオーナーへメール", () => {
  const G = load();
  const ok = login(G);
  assert.equal(ok.ok, true);
  assert.match(ok.token, /^[0-9a-f]{64}$/);
  assert.equal(ok.who, "共同代表");
  for (let i = 1; i <= 4; i++) {
    const r = G.post({ kind: "admin_login", passcode: "wrong" });
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp("あと" + (5 - i) + "回"));
  }
  assert.equal(G.mails.length, 0);
  const locked = G.post({ kind: "admin_login", passcode: "wrong" });
  assert.equal(locked.locked, true);
  assert.equal(G.mails.length, 1);
  assert.match(G.mails[0].subject, /15分止めました/);
  // ロック中は正しいパスコードでも入れない
  assert.equal(login(G).ok, false);
  assert.ok(!JSON.stringify(G.mails).includes(PASS), "メールにパスコードを書かない");
});

test("ログイン：設定（ADMIN_PASS_HASH・ADMIN_GITHUB_TOKEN）が無ければ入れない。印が無い・古いと「ログインし直して」", () => {
  const G = load({ ADMIN_PASS_HASH: "" });
  assert.match(login(G).error, /設定がまだ/);
  const H = load();
  assert.equal(H.post({ kind: "admin_load", token: "nai" }).relogin, true);
  const t0 = Date.UTC(2026, 10, 13, 0);
  H.ctx.setNow(t0);
  const tok = login(H).token;
  H.ctx.setNow(t0 + 7 * 3600000);
  assert.equal(H.post({ kind: "admin_load", token: tok }).ok, true);
  H.ctx.setNow(t0 + 8 * 3600000 + 1);
  assert.equal(H.post({ kind: "admin_load", token: tok }).relogin, true, "ログインから8時間で切れる");
  const t2 = login(H).token;
  assert.equal(H.post({ kind: "admin_logout", token: t2 }).ok, true);
  assert.equal(H.post({ kind: "admin_load", token: t2 }).relogin, true);
});

test("読み込み → 商品を直して保存：1つのコミット・文・メール・新しい sha、写真も同じコミット", () => {
  const G = load();
  const token = login(G).token;
  const L = G.post({ kind: "admin_load", token });
  assert.equal(L.ok, true);
  assert.ok(L.files.shop.sha && L.files.prices.data.buyback_items && L.files.items.data.items.length);
  const shop = L.files.shop.data;
  shop.items[0].price = 60000;
  shop.items[1].status = "sold";
  const id = "item-20261113-1";
  shop.items.unshift({ id, name: "テスト棚", category: "家具", price: 3000, year: null, condition: "中古", size: "", free_shipping: false, status: "available", photos: ["assets/shop/" + id + ".jpg"], note: "", payment_link: "" });
  const pic = fs.readFileSync(path.join(ROOT, "tests/fixtures/photos/industrial-fan-480.jpg")).toString("base64");
  const r = G.post({ kind: "admin_save", token, target: "shop", data: shop, base_sha: L.files.shop.sha, photos: [{ path: "assets/shop/" + id + ".jpg", base64: pic }, { path: "assets/shop/" + id + "-480.jpg", base64: pic }] });
  assert.equal(r.ok, true, r.error + " " + (r.errors || []).join());
  assert.equal(G.gh.commits.length, 1, "写真と商品表は1つのコミット");
  const c = G.gh.commits[0];
  assert.match(c.message, /^管理画面：商品を更新（共同代表・/);
  assert.match(c.message, /価格 ¥65,000 → ¥60,000/);
  assert.match(c.message, /追加：商品「テスト棚」/);
  const paths = G.gh.trees.get(c.tree).tree.map((e) => e.path).sort();
  assert.deepEqual(paths, ["assets/shop/" + id + "-480.jpg", "assets/shop/" + id + ".jpg", "data/shop.json"]);
  const saved = G.gh.files.get("data/shop.json").toString("utf8");
  assert.equal(JSON.parse(saved).items[0].id, id);
  assert.match(JSON.parse(saved).updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.sha, sha1(G.gh.files.get("data/shop.json")));
  assert.equal(r.commit, c.sha.slice(0, 8));
  assert.match(r.actions_url, /^https:\/\/github\.com\/miumiumiu4\/2ndchance-kaitori\/actions$/);
  assert.ok(r.changes.length >= 3);
  // オーナーへのメール：変えたところと Actions の URL
  const m = G.mails.at(-1);
  assert.match(m.subject, /【管理画面】商品を更新しました（共同代表）/);
  assert.match(m.body, /価格 ¥65,000 → ¥60,000/);
  assert.match(m.body, /github\.com\/miumiumiu4\/2ndchance-kaitori\/actions/);
  assert.ok(!m.body.includes("test-token"));
  // 受付（Code.gs）は main の最新を照合に使う（Shop.gs を出し直さなくても売切れが効く）
  const live = G.ctx.live();
  assert.equal(live.SHOP.items[0].id, id);
  assert.equal(G.ctx.validateShop_({ items: [{ id: shop.items[2].id }], receive: "store", payment: "cash", consent: true, customer: { name: "x", email: "a" + "@" + "b.jp", line_name: "y" } }).includes("売切れ"), true);
  // 同じ base_sha でもう一度 → 重なり
  const again = G.post({ kind: "admin_save", token, target: "shop", data: shop, base_sha: L.files.shop.sha });
  assert.equal(again.conflict, true);
  // 新しい sha なら、変更なしは「変更はありません」
  const same = G.post({ kind: "admin_save", token, target: "shop", data: r.data, base_sha: r.sha });
  assert.equal(same.unchanged, true);
  assert.equal(G.gh.commits.length, 1);
});

test("保存の確かめ：金額の形・写真（EXIF・置き場・大きさ）・個人情報は GitHub に積まない", () => {
  const G = load();
  const token = login(G).token;
  const L = G.post({ kind: "admin_load", token });
  const p = L.files.prices.data;
  p.collection_tiers[0].price_from = -5;
  let r = G.post({ kind: "admin_save", token, target: "prices", data: p, base_sha: L.files.prices.sha });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /0以上の整数/);
  const shop = L.files.shop.data;
  const big = fs.readFileSync(path.join(ROOT, "tests/fixtures/photos/aqua-fridge-355.jpg"));
  r = G.post({ kind: "admin_save", token, target: "shop", data: shop, base_sha: L.files.shop.sha, photos: [{ path: "assets/shop/x-480.jpg", base64: big.toString("base64") }] });
  assert.match(r.error, /大きすぎ/);
  const exif = Buffer.concat([big.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from("Exif\0\0"), big.subarray(2)]);
  r = G.post({ kind: "admin_save", token, target: "shop", data: shop, base_sha: L.files.shop.sha, photos: [{ path: "index.html", base64: big.toString("base64") }] });
  assert.match(r.error, /置き場/);
  r = G.post({ kind: "admin_save", token, target: "results", data: L.files.results.data, base_sha: L.files.results.sha, photos: [{ path: "assets/shop/y.jpg", base64: big.toString("base64") }] });
  assert.match(r.error, /置き場/, "実績の写真は assets/items だけ");
  // EXIF 入りは GAS でも取り除いてから積む。中身から使われない写真は積まない
  const x = JSON.parse(JSON.stringify(shop));
  x.items[0].photos = ["assets/shop/x.jpg"];
  r = G.post({ kind: "admin_save", token, target: "shop", data: x, base_sha: L.files.shop.sha, photos: [{ path: "assets/shop/x.jpg", base64: exif.toString("base64") }, { path: "assets/shop/x-480.jpg", base64: fs.readFileSync(path.join(ROOT, "tests/fixtures/photos/industrial-fan-480.jpg")).toString("base64") }, { path: "assets/shop/unused.jpg", base64: big.toString("base64") }] });
  assert.equal(r.ok, true, r.error + (r.errors || []).join());
  const tree = G.gh.trees.get(G.gh.commits.at(-1).tree).tree.map((e) => e.path).sort();
  assert.deepEqual(tree, ["assets/shop/x-480.jpg", "assets/shop/x.jpg", "data/shop.json"], "使われない写真は積まない");
  const stored = G.gh.files.get("assets/shop/x.jpg");
  assert.ok(!stored.includes(Buffer.from("Exif")), "EXIF は取り除いて積む");
  assert.equal(stored.length, big.length, "画素はそのまま");
  const n = G.gh.commits.length;
  const L2 = G.post({ kind: "admin_load", token });
  const site = L2.files.site.data;
  site.notice = "お問い合わせは 090" + "-1234-5678 まで";
  r = G.post({ kind: "admin_save", token, target: "site", data: site, base_sha: L2.files.site.sha });
  assert.match(r.errors.join(), /個人情報/);
  r = G.post({ kind: "admin_save", token, target: "nai", data: {} });
  assert.equal(r.ok, false);
  assert.equal(G.gh.commits.length, n, "確かめで止めたものは積まない");
});

test("お店の情報を保存（お知らせ・キャンペーンの金額）。GitHub が先に進んでいたら「もう一度」", () => {
  const G = load();
  const token = login(G).token;
  const L = G.post({ kind: "admin_load", token });
  const site = L.files.site.data;
  site.notice = "年末年始も営業します";
  site.referral_campaign.reward_yen = 5000;
  G.gh.failPatch = true;
  let r = G.post({ kind: "admin_save", token, target: "site", data: site, base_sha: L.files.site.sha });
  assert.equal(r.ok, false);
  assert.match(r.error, /もう一度保存/);
  G.gh.failPatch = false;
  r = G.post({ kind: "admin_save", token, target: "site", data: site, base_sha: L.files.site.sha });
  assert.equal(r.ok, true);
  assert.match(G.gh.commits.at(-1).message, /^管理画面：お店の情報を更新（共同代表・お知らせ/);
  assert.match(G.gh.commits.at(-1).message, /紹介料（1件・円） ¥10,000 → ¥5,000/);
});

test("受付の doPost は管理画面の kind を先に振り分け、トークンが無ければ main を読まない", () => {
  const G = load({ ADMIN_GITHUB_TOKEN: "" });
  const live = G.ctx.live();
  assert.equal(G.gh.calls.length, 0);
  assert.ok(live.SHOP.items.length > 0, "Shop.gs のまま");
  assert.match(read("gas/Code.gs"), /indexOf\('admin_'\) === 0\) return json_\(adminHandle_\(body\)\)/);
});

test("かんたん入力の中身（js/admin-quick-core.js）も同じ admin_save で積める：写真3枚＝6ファイル＋商品表を1つのコミット、売切れも", async () => {
  const Q = await import("../js/admin-quick-core.js");
  const G = load();
  const token = login(G).token;
  const L = G.post({ kind: "admin_load", token });
  const pic = fs.readFileSync(path.join(ROOT, "tests/fixtures/photos/industrial-fan-480.jpg")).toString("base64");
  const op = Q.addOp({ name: "食器棚 白", price: 18000, year: 2019, free_shipping: false }, [1, 2, 3].map(() => ({ big: pic, thumb: pic })), L.files.shop.data, "2026-11-13");
  const ap = Q.applyQuickOp(L.files.shop.data, op);
  const r = G.post({ kind: "admin_save", token, ...Q.savePayload(ap, L.files.shop.sha) });
  assert.equal(r.ok, true, r.error + " " + (r.errors || []).join());
  const c = G.gh.commits.at(-1);
  assert.match(c.message, /^管理画面：商品を更新（共同代表・追加：商品「食器棚 白」（¥18,000） ほか3件）\n\n[\s\S]*\n写真：assets\/shop\/cupboard-20261113-p3\.jpg$/);
  assert.equal(G.gh.trees.get(c.tree).tree.length, 7);
  assert.equal(JSON.parse(G.gh.files.get("data/shop.json").toString("utf8")).items[0].id, "cupboard-20261113");
  // 結果が届かず同じ下書きをもう一度：sha が古いので重なり → 読み直して当てると「もう入っている」（二重に積まない）
  assert.equal(G.post({ kind: "admin_save", token, ...Q.savePayload(ap, L.files.shop.sha) }).conflict, true);
  const L2 = G.post({ kind: "admin_load", token });
  assert.equal(Q.applyQuickOp(L2.files.shop.data, op).already, true);
  // 売切れにする
  const s = Q.applyQuickOp(L2.files.shop.data, Q.statusOp(L2.files.shop.data.items[0], "sold"));
  const r2 = G.post({ kind: "admin_save", token, ...Q.savePayload(s, L2.files.shop.sha) });
  assert.equal(r2.ok, true);
  assert.match(G.gh.commits.at(-1).message, /状態 販売中 → 売切れ/);
  assert.equal(G.gh.commits.length, 2);
});
