/**
 * 管理画面（/admin/）の受け口。Code.gs の doPost が kind「admin_…」をここへ回す。
 *   admin_login  … パスコード（ハッシュで照合）→ ログインの印（token）。5回続けて間違えると15分ロックし、オーナーへメール
 *   admin_load   … data/shop.json・prices.json・site.json・results.json・items.json を GitHub（main）から読む
 *   admin_save   … AdminCore で確かめてから、変えたファイル（と写真）を1つのコミットで main に積む → オーナーへメール
 *   admin_logout … ログインの印を消す
 * 公開は GitHub Actions が自動で行う（Pages：1〜2分。生成物は rebuild.yml がコミットし直す）。
 * 受付（Code.gs）の価格表・商品表は、ADMIN_GITHUB_TOKEN があれば main の data/*.json を読み（5分ごと）、
 * 管理画面で直した金額・売切れが Apps Script を出し直さなくても照合に効く（adminLiveData_）。
 *
 * スクリプトプロパティ（値はリポジトリに書かない）：
 *   ADMIN_PASS_HASH     … パスコードの SHA-256（16進）。手元で node tools/passhash.mjs を実行して作る
 *   ADMIN_GITHUB_TOKEN  … GitHub の fine-grained token（このリポジトリだけ・Contents の Read and write だけ）
 *   ADMIN_REPO          … 任意。既定 miumiumiu4/2ndchance-kaitori
 *   ADMIN_BRANCH        … 任意。既定 main
 *   ADMIN_FAILS         … 自動。パスコードの失敗回数とロックの時刻（手で入れない）
 * 同じフォルダの AdminCore.gs は tools/build.mjs が js/admin-core.js から生成する（手で直さない）。
 */

var ADMIN_REPO_DEFAULT = 'miumiumiu4/2ndchance-kaitori';
var ADMIN_LOAD = { shop: 'data/shop.json', prices: 'data/prices.json', site: 'data/site.json', results: 'data/results.json', items: 'data/items.json' };
var ADMIN_MAX_PHOTOS = 12;

function adminRepo_() { return props_().getProperty('ADMIN_REPO') || ADMIN_REPO_DEFAULT; }
function adminBranch_() { return props_().getProperty('ADMIN_BRANCH') || 'main'; }
function adminNow_() { return Date.now(); }
function adminActionsUrl_() { return 'https://github.com/' + adminRepo_() + '/actions'; }

function adminHandle_(b) {
  try {
    if (b.kind === 'admin_login') return adminLogin_(b);
    var sess = adminSession_(b.token);
    if (!sess) return { ok: false, relogin: true, error: 'ログインし直してください（時間切れか、ログアウトしました）' };
    if (b.kind === 'admin_logout') { CacheService.getScriptCache().remove('adm:' + b.token); return { ok: true }; }
    if (b.kind === 'admin_load') return adminLoad_(sess);
    if (b.kind === 'admin_save') return adminSave_(b, sess);
    return { ok: false, error: '知らない操作です' };
  } catch (x) {
    console.error(x);
    return { ok: false, error: '管理画面の受け口でエラーが起きました（' + String((x && x.message) || x).slice(0, 160) + '）' };
  }
}

// ---------- ログイン ----------
function adminLogin_(b) {
  var p = props_();
  var hash = String(p.getProperty('ADMIN_PASS_HASH') || '').trim().toLowerCase();
  if (!hash || !p.getProperty('ADMIN_GITHUB_TOKEN')) return { ok: false, error: '管理画面の設定がまだです（スクリプト プロパティ ADMIN_PASS_HASH と ADMIN_GITHUB_TOKEN）' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = adminNow_();
    var st = JSON.parse(p.getProperty('ADMIN_FAILS') || '{}');
    if (AdminCore.isLocked(st, now)) return { ok: false, locked: true, error: 'パスコードを続けて間違えたため、あと' + Math.ceil((st.until - now) / 60000) + '分ほどログインできません' };
    var given = AdminCore.bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, AdminCore.ADMIN_PASS_PREFIX + String(b.passcode || ''), Utilities.Charset.UTF_8));
    if (!AdminCore.sameText(given, hash)) {
      var nx = AdminCore.afterFailure(st, now);
      p.setProperty('ADMIN_FAILS', JSON.stringify({ fails: nx.fails, until: nx.until }));
      if (nx.locked) {
        adminMail_('【管理画面】パスコードの間違いが続いたので' + AdminCore.LOCK_MINUTES + '分止めました', [
          '管理画面のパスコードが' + AdminCore.LOCK_MAX + '回続けて間違えられたため、' + AdminCore.LOCK_MINUTES + '分間ログインを止めました（' + now_() + '）。',
          '心当たりがなければ、パスコードを変えてください（node tools/passhash.mjs で新しいハッシュを作り、スクリプト プロパティ ADMIN_PASS_HASH を差し替え）。'
        ]);
        return { ok: false, locked: true, error: 'パスコードを' + AdminCore.LOCK_MAX + '回続けて間違えたため、' + AdminCore.LOCK_MINUTES + '分ほどログインできません' };
      }
      return { ok: false, error: 'パスコードが違います（あと' + (AdminCore.LOCK_MAX - nx.fails) + '回間違えると' + AdminCore.LOCK_MINUTES + '分使えなくなります）' };
    }
    p.setProperty('ADMIN_FAILS', '{}');
    var who = AdminCore.ADMIN_ROLES.indexOf(b.who) >= 0 ? b.who : AdminCore.ADMIN_ROLES[0];
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    adminPutSession_(token, { who: who, at: now });
    return { ok: true, token: token, who: who, hours: AdminCore.SESSION_HOURS };
  } finally {
    lock.releaseLock();
  }
}

// ログインの印は CacheService に置く（上限6時間なので、使うたびに延ばし、ログインから8時間で切る）
function adminPutSession_(token, s) {
  var left = Math.floor((s.at + AdminCore.SESSION_HOURS * 3600000 - adminNow_()) / 1000);
  if (left <= 0) return;
  CacheService.getScriptCache().put('adm:' + token, JSON.stringify(s), Math.min(21600, left));
}
function adminSession_(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return null;
  var raw = CacheService.getScriptCache().get('adm:' + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (!AdminCore.sessionAlive(s, adminNow_())) return null;
  adminPutSession_(token, s);
  return s;
}

// ---------- GitHub ----------
function gh_(method, path, payload) {
  var opt = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + props_().getProperty('ADMIN_GITHUB_TOKEN'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + adminRepo_() + path, opt);
  var text = res.getContentText();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { code: res.getResponseCode(), json: json };
}
function ghOk_(r, want, what) {
  if (r.code !== want) throw new Error('GitHub：' + what + 'に失敗（' + r.code + (r.json && r.json.message ? '：' + r.json.message : '') + '）');
  return r.json;
}
// data/*.json を1つ読む。{ sha, text, data }（無ければ null）
function ghFile_(path) {
  var r = gh_('get', '/contents/' + path + '?ref=' + encodeURIComponent(adminBranch_()));
  if (r.code === 404) return null;
  var j = ghOk_(r, 200, path + ' の読み込み');
  var text = Utilities.newBlob(Utilities.base64Decode(String(j.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
  return { sha: j.sha, text: text, data: JSON.parse(text) };
}
// 写真の置き場にあるファイルの一覧（assets/shop・assets/items）
function ghPhotos_(dir) {
  var r = gh_('get', '/contents/' + dir + '?ref=' + encodeURIComponent(adminBranch_()));
  if (r.code === 404) return [];
  return (ghOk_(r, 200, dir + ' の一覧') || []).map(function (f) { return dir + '/' + f.name; });
}
// いくつかのファイルを1つのコミットで main に積む（Git Data API：blob → tree → commit → ref）
function adminCommit_(files, message) {
  var br = adminBranch_();
  var base = ghOk_(gh_('get', '/git/ref/heads/' + br), 200, 'main の位置の読み込み').object.sha;
  var tree = ghOk_(gh_('get', '/git/commits/' + base), 200, 'コミットの読み込み').tree.sha;
  var blobs = {};
  var entries = files.map(function (f) {
    var sha = ghOk_(gh_('post', '/git/blobs', { content: f.base64, encoding: 'base64' }), 201, f.path + ' の書き込み').sha;
    blobs[f.path] = sha;
    return { path: f.path, mode: '100644', type: 'blob', sha: sha };
  });
  var t = ghOk_(gh_('post', '/git/trees', { base_tree: tree, tree: entries }), 201, '変更のまとめ');
  var c = ghOk_(gh_('post', '/git/commits', { message: message, tree: t.sha, parents: [base] }), 201, 'コミット');
  var u = gh_('patch', '/git/refs/heads/' + br, { sha: c.sha, force: false });
  if (u.code !== 200) throw new Error('ほかの変更と重なりました。少し待ってもう一度保存してください（' + u.code + '）');
  return { sha: c.sha, blobs: blobs };
}

// ---------- 読み込み ----------
function adminLoad_(sess) {
  var files = {};
  Object.keys(ADMIN_LOAD).forEach(function (k) {
    var f = ghFile_(ADMIN_LOAD[k]);
    files[k] = f ? { sha: f.sha, data: f.data } : null;
  });
  return { ok: true, who: sess.who, files: files, actions_url: adminActionsUrl_() };
}

// ---------- 保存 ----------
// b：{ target: shop|prices|site|results, data, base_sha（読み込んだときの sha）, photos: [{ path, base64 }] }
function adminSave_(b, sess) {
  var target = b.target;
  var path = AdminCore.ADMIN_FILES[target];
  if (!path) return { ok: false, error: '知らない種類です' };
  var data = b.data;
  if (!data || typeof data !== 'object') return { ok: false, error: '中身がありません' };
  var photos = b.photos || [];
  if (photos.length > ADMIN_MAX_PHOTOS) return { ok: false, error: '写真は1回に' + ADMIN_MAX_PHOTOS / 2 + '枚までにしてください' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cur = ghFile_(path);
    if (!cur) return { ok: false, error: path + ' が見つかりません' };
    if (b.base_sha && b.base_sha !== cur.sha) return { ok: false, conflict: true, error: 'ほかの所で先に保存されています。「読み直す」を押して、もう一度直してください' };
    if (Object.prototype.hasOwnProperty.call(cur.data, 'updated')) data.updated = AdminCore.todayJST(new Date(adminNow_()));

    // 写真：置き場・JPEG・EXIF なし・大きさを確かめる
    var files = [];
    var added = [];
    for (var i = 0; i < photos.length; i++) {
      var ph = photos[i] || {};
      var max = AdminCore.photoMaxFor(String(ph.path || ''));
      if (!max || (target === 'shop') !== /^assets\/shop\//.test(ph.path)) return { ok: false, error: '写真の置き場が正しくありません（' + ph.path + '）' };
      // EXIF・位置情報などの記録は、画面で落としてあっても念のためここでも取り除く
      var clean = AdminCore.stripJpegMeta(Utilities.base64Decode(String(ph.base64 || '')));
      if (!clean) return { ok: false, error: ph.path + '：JPEG ではありません' };
      var bytes = clean.map(function (x) { return x > 127 ? x - 256 : x; });
      var e = AdminCore.checkPhoto(bytes, max);
      if (e) return { ok: false, error: ph.path + '：' + e };
      files.push({ path: ph.path, base64: Utilities.base64Encode(bytes) });
      added.push(ph.path);
    }
    // 中身から使われていない写真は積まない（消した商品の写真など）
    var used = {};
    if (target === 'shop') (data.items || []).forEach(function (it) { (it.photos || []).forEach(function (p) { used[p] = 1; used[AdminCore.photoThumbPath(p)] = 1; }); });
    if (target === 'results') (data.results || []).forEach(function (r) { if (r.photo) used[r.photo] = 1; });
    files = files.filter(function (f) { return used[f.path]; });
    added = added.filter(function (p) { return used[p]; });
    var opts = {};
    if (target === 'shop' || target === 'results') opts.knownPhotos = added.concat(ghPhotos_(target === 'shop' ? 'assets/shop' : 'assets/items'));
    if (target === 'results') {
      var items = ghFile_('data/items.json');
      opts.itemIds = ((items && items.data.items) || []).map(function (x) { return x.id; });
    }
    var errs = AdminCore.validateData(target, data, cur.data, opts);
    if (errs.length) return { ok: false, errors: errs, error: '保存できません。直してください' };

    var lines = AdminCore.diffSummary(target, cur.data, data);
    added.forEach(function (p) { if (!/-480\.jpg$/.test(p)) lines.push('写真：' + p); });
    if (!lines.length) return { ok: true, unchanged: true, sha: cur.sha, data: cur.data };

    var text = AdminCore.stringifyData(data);
    files.push({ path: path, base64: Utilities.base64Encode(text, Utilities.Charset.UTF_8) });
    var c = adminCommit_(files, AdminCore.commitMessage(target, lines, sess.who));
    adminCacheLive_(target, text);
    var commitUrl = 'https://github.com/' + adminRepo_() + '/commit/' + c.sha;
    adminMail_('【管理画面】' + AdminCore.ADMIN_KIND_NAMES[target] + 'を更新しました（' + sess.who + '）', [
      sess.who + 'が管理画面で' + AdminCore.ADMIN_KIND_NAMES[target] + 'を直しました（' + now_() + '）。1〜2分でサイトに反映されます。',
      '',
      '【変えたところ】'
    ].concat(lines.slice(0, 40).map(function (l) { return '・' + l; })).concat(lines.length > 40 ? ['…ほか' + (lines.length - 40) + '件'] : []).concat([
      '',
      '反映の様子（緑のチェックで完了）：' + adminActionsUrl_(),
      '変更の中身（コミット ' + c.sha.slice(0, 8) + '）：' + commitUrl,
      '元に戻したいときは、この2つの URL を添えて開発担当へ連絡してください。'
    ]));
    return { ok: true, commit: c.sha.slice(0, 8), commit_url: commitUrl, actions_url: adminActionsUrl_(), changes: lines, sha: c.blobs[path], data: data };
  } finally {
    lock.releaseLock();
  }
}

function adminMail_(subject, lines) {
  var to = props_().getProperty('OWNER_EMAIL');
  if (!to) return;
  MailApp.sendEmail({ to: to, subject: subject, body: lines.join('\n'), name: siteName_() });
}

// ---------- 受付が使う価格表・商品表を main の最新に ----------
// Prices.gs・Shop.gs（build が作る）は Apps Script を出し直すまで古いまま。管理画面で直した金額・売切れを
// すぐ照合に効かせるため、トークンがあれば main の data/*.json を読む（5分ごと。読めなければ Prices.gs・Shop.gs のまま）
function adminLiveData_() {
  if (!props_().getProperty('ADMIN_GITHUB_TOKEN')) return;
  try {
    var s = adminLiveJson_('shop');
    if (s && s.items) SHOP = s;
    var p = adminLiveJson_('prices');
    if (p && p.buyback_items) PRICES = p;
  } catch (x) {
    console.error(x);
  }
}
function adminLiveJson_(target) {
  var cache = CacheService.getScriptCache();
  var key = 'live:' + target;
  var hit = cache.get(key);
  if (hit === 'x') return null;
  if (hit) return JSON.parse(hit);
  try {
    var f = ghFile_(AdminCore.ADMIN_FILES[target]);
    if (!f) { cache.put(key, 'x', 60); return null; }
    cache.put(key, f.text, 300);
    return f.data;
  } catch (x) {
    cache.put(key, 'x', 60);
    throw x;
  }
}
function adminCacheLive_(target, text) {
  if (target === 'shop' || target === 'prices') CacheService.getScriptCache().put('live:' + target, text, 300);
}
