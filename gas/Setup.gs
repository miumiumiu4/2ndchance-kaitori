/**
 * 店ごとの初回設定（量産の型）。Apps Script のエディタで関数 setupStore を選び ▶ を1回押す。
 * 何度押しても同じ結果になる（すでに入っている値は上書きしない）。
 *   1. SHEET_ID が空なら、受付用のスプレッドシート「<店名> 受付」をこのアカウントのドライブに作り、その ID を SHEET_ID に入れる
 *      （ID は画面にもログにも出さない。シートの「受付」「集計」などは最初の受付で自動で作られる）
 *   2. ADMIN_REPO が空なら、Store.gs の repo（data/store.json）を入れる
 *   3. 足りないスクリプトプロパティの「名前」だけをログに出す（値は出さない）
 * 人が入れるもの（値はリポジトリ・Issue・PR・チャットに書かない）：OWNER_EMAIL・ADMIN_PASS_HASH・ADMIN_GITHUB_TOKEN。
 * 手順の全体は tools/setup-store.md。
 */
var SETUP_REQUIRED = ['SHEET_ID', 'OWNER_EMAIL'];
var SETUP_FOR_ADMIN = ['ADMIN_PASS_HASH', 'ADMIN_GITHUB_TOKEN', 'ADMIN_REPO'];

function setupStore() {
  var p = props_();
  var done = [];
  if (!p.getProperty('SHEET_ID')) {
    var ss = SpreadsheetApp.create(siteName_() + ' 受付');
    p.setProperty('SHEET_ID', ss.getId());
    done.push('受付用のスプレッドシートを作って SHEET_ID に入れました');
  }
  if (!p.getProperty('ADMIN_REPO') && typeof STORE_INFO !== 'undefined' && STORE_INFO.repo) {
    p.setProperty('ADMIN_REPO', STORE_INFO.repo);
    done.push('ADMIN_REPO に ' + STORE_INFO.repo + ' を入れました');
  }
  var r = setupStatus_();
  r.done = done;
  Logger.log(setupReport_(r));
  return r;
}

// 足りないプロパティの名前（値は見ない・返さない）
function setupStatus_() {
  var p = props_();
  var miss = function (list) { return list.filter(function (k) { return !p.getProperty(k); }); };
  return { store: siteName_(), missing: miss(SETUP_REQUIRED), missing_admin: miss(SETUP_FOR_ADMIN) };
}

function setupReport_(r) {
  var lines = ['店：' + r.store];
  (r.done || []).forEach(function (d) { lines.push('・' + d); });
  lines.push(r.missing.length ? '受付に足りない設定：' + r.missing.join('、') + '（プロジェクトの設定 → スクリプト プロパティ）' : '受付の設定はそろっています');
  lines.push(r.missing_admin.length ? '管理画面に足りない設定：' + r.missing_admin.join('、') : '管理画面の設定はそろっています');
  return lines.join('\n');
}
