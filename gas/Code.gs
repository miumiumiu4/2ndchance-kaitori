/**
 * 2nd chance recycle フォームの受け口（Google Apps Script）。
 * - doPost：フォームの JSON を受け取る。kind で振り分ける。
 *     （なし）       … 概算フォーム A・B・C。QuoteCore で再計算して画面の額と照合し、「受付」シートに追記、
 *                      オーナー宛メール、お客様宛の自動返信、メルマガ同意なら「メール会員」に upsert。
 *     shop           … 販売ページの注文（カート：items = [{id, price}]）。商品と商品代を Shop.gs（data/shop.json）と ShopCore で照合し、
 *                      1注文1行で「受付」に追記（商品は「、」でつなぐ・点数の列）・通知・自動返信。配送料は1注文で1回分。
 *     delivery_log   … 配送料を計算しただけの記録（郵便番号・区分・日時だけ）を「配送料ログ」に追記。
 *     admin_…        … 管理画面（/admin/）。Admin.gs の adminHandle_ が受ける（ログイン・読み込み・保存）。
 *   初回の受付で「集計」シート（式だけ）を ensureDashboard_() が作る。
 * - doGet ：action=quote で概算（読み取り専用・AI エージェント向け）、action=prices で価格表。
 * 値（シート ID・メールアドレス）はスクリプトプロパティだけに置く。このファイルに書かない。
 *   SHEET_ID         … 受付を書くスプレッドシートの ID
 *   OWNER_EMAIL      … 受付の通知先（自動返信の返信先にもなる）
 *   SITE_NAME        … 任意。メールの差出人名（既定 2nd chance recycle）
 *   MAX_PER_DAY      … 任意。1日の受付上限（既定 50。超えたら受け付けずにエラー）
 *   LOG_MAX_PER_DAY  … 任意。配送料ログの1日の上限（既定 500。超えたら黙って捨てる）
 *   MAILER_API_KEY   … 予約（未使用）。メール配信サービスへの連携は後日
 * 同じフォルダの QuoteCore.gs・Prices.gs・ShopCore.gs・Shop.gs・AdminCore.gs は tools/build.mjs が生成する（手で直さない）。
 * 管理画面のプロパティ（ADMIN_PASS_HASH・ADMIN_GITHUB_TOKEN）は Admin.gs の先頭。
 */

var SHEET_NAME = '受付';
// 全フォーム共通の列（gas/README.md に一覧）。列を足すときは末尾に足す
var HEADERS = [
  '受付番号', '受付日時', '種類', '概算(最小)', '概算(最大)', '要相談', '照合', '画面の概算', '再計算の概算',
  '価格表の版(画面)', '価格表の版(受付)', '選んだ内容', 'お名前(カナ)', '電話', 'メール', 'LINE名', '郵便番号', '郵便番号(上3桁)', '住所',
  '第1希望', '第2希望', '第3希望', '写真(枚)', '写真(ファイル名)', '支払い方法', '要望',
  'メルマガ', '同意日時', '同意文(指紋)', '同日査定',
  '商品ID', '商品名', '商品代', '受け取り方法', '配送区分', '配送料', 'お支払い目安',
  'ページ', '参照元', 'utm_source', 'utm_medium', 'utm_campaign', '端末', '言語', '画面',
  '点数', 'ご紹介者', 'ご紹介者の連絡先'
];
var MEMBER_SHEET = 'メール会員';
var MEMBER_HEADERS = ['メール', 'お名前', '同意日時', '出典フォーム', '受付番号', '状態', '同意文(指紋)', '更新日時'];
var LOG_SHEET = '配送料ログ';
var LOG_HEADERS = ['日時', '郵便番号', '郵便番号(上3桁)', '区分'];
var DASHBOARD_SHEET = '集計';
var FORM_NAMES = { A: '出張買取', B: '不用品回収', C: '片付け', shop: '販売' };
var PAYMENT_NAMES = { cash: '現金', card: 'クレジットカード', paypay: 'PayPay' };
var UNSUB_LINE = '※ お知らせメールの配信停止は、このメールに「停止」とだけ書いて返信してください。';

function props_() { return PropertiesService.getScriptProperties(); }
function siteName_() { return props_().getProperty('SITE_NAME') || '2nd chance recycle'; }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'); }
function book_() { return SpreadsheetApp.openById(props_().getProperty('SHEET_ID')); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 読み取り（AI 向け） ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (typeof adminLiveData_ === 'function') adminLiveData_(); // 管理画面で直した価格表（Admin.gs）
  if (p.action === 'prices') return json_(PRICES);
  if (p.action === 'quote') {
    var input = QuoteCore.parseQuoteQuery(p);
    var q = QuoteCore.quoteFromInput(input, PRICES);
    return json_({
      ok: !q.error,
      input: input,
      quote: q,
      prices_updated: PRICES.updated,
      disclaimer: PRICES.disclaimer,
      note: '目安です。最終額は訪問査定で人が決めます。予約は電話の折返しで確定します。'
    });
  }
  return json_({ ok: true, usage: '?action=quote&form=A&items=fridge:2:within:good ／ ?action=prices' });
}

// ---------- 受付 ----------
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // 管理画面（/admin/）は Admin.gs へ
    if (String(body.kind || '').indexOf('admin_') === 0) return json_(adminHandle_(body));
    if (typeof adminLiveData_ === 'function') adminLiveData_(); // 管理画面で直した価格表・商品表を照合に使う
    if (body.website) return json_({ ok: true, id: '' }); // ロボット対策の空欄に何か入っていたら黙って捨てる
    if (body.kind === 'delivery_log') return json_(logDelivery_(body));
    if (body.kind === 'shop') return json_(handleShop_(body, lock));
    var err = validate_(body);
    if (err) return json_({ ok: false, error: err });

    lock.waitLock(20000);
    var id = nextId_();
    if (!id) return json_({ ok: false, error: '本日の受付数が上限に達しました。お電話でご連絡ください。' });

    // 画面の額と、同じ式・同じ価格表での再計算を照合（改ざん・古いキャッシュ対策）
    var re = QuoteCore.quoteFromInput(body.input, PRICES);
    var match = QuoteCore.sameQuote(body.quote, re) && body.prices_updated === PRICES.updated;

    var ss = book_();
    appendRow_(ss, id, body, re, match);
    if (body.newsletter && body.newsletter.opt_in) upsertMember_(ss, id, body);
    ensureDashboard_(ss);
    lock.releaseLock();

    notifyOwner_(id, body, re, match);
    replyCustomer_(id, body, re);
    return json_({ ok: true, id: id });
  } catch (x) {
    console.error(x);
    return json_({ ok: false, error: '受付でエラーが起きました' });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function validate_(b) {
  if (!b || !b.customer || !b.input) return '内容が足りません';
  if (['A', 'B', 'C'].indexOf(b.form) < 0 || b.input.form !== b.form) return '種類が正しくありません';
  if (!b.consent) return '個人情報の取扱いへの同意が必要です';
  var c = b.customer;
  if (!c.name_kana || !c.tel || !c.address || !c.email) return 'お名前・電話・メール・住所は必須です';
  if (String(c.tel).replace(/[^0-9]/g, '').length < 10) return '電話番号を確かめてください';
  if (!isEmail_(c.email)) return 'メールアドレスを確かめてください';
  if (!b.dates || !b.dates.length) return '第1希望の日付が必要です';
  return '';
}

// ご紹介（不用品回収・片付けのフォームの「ご紹介で知りました」）。無ければ null
function referrer_(b) {
  var r = b && b.referrer;
  if (!r || b.form === 'A') return null;
  return { name: String(r.name || '').slice(0, 40), contact: String(r.contact || '').slice(0, 80) };
}

function isEmail_(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '')); }

// 受付番号：R（販売は S）+ 日付(yyyyMMdd) + '-' + その日の連番(3桁)。連番は全種類で共通
function nextId_(prefix) {
  var p = props_();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var n = p.getProperty('SEQ_DATE') === today ? Number(p.getProperty('SEQ_N') || 0) : 0;
  var max = Number(p.getProperty('MAX_PER_DAY') || 50);
  if (n >= max) return '';
  n += 1;
  p.setProperties({ SEQ_DATE: today, SEQ_N: String(n) });
  return (prefix || 'R') + today + '-' + ('00' + n).slice(-3);
}

// シートの式として解釈されないように（= + - @ で始まる文字は先頭に ' を付ける）
function cell_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 見出しが今の HEADERS と違う古いシートは「（旧）」を付けて残し、新しいシートを作る
function sheetWith_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh && sh.getLastRow() > 0) {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join('\t');
    if (head !== headers.join('\t')) {
      sh.setName(name + '（旧 ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmm') + '）');
      sh = null;
      // 「集計」の式は名前を変えた古いシートを指したままになるので消す（次の ensureDashboard_ が新しい列で作り直す）
      var dash = name === DASHBOARD_SHEET ? null : ss.getSheetByName(DASHBOARD_SHEET);
      if (dash) ss.deleteSheet(dash);
    }
  }
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function quoteStr_(form, q) {
  if (!q) return '';
  if (q.undetermined) return '要相談';
  return (q.min + '〜' + q.max) + (q.same_day ? '（同日+20%）' : '');
}

function detail_(body, re) {
  var out = [];
  var bb = body.form === 'A' ? re.buyback : re.buyback_detail;
  if (body.form === 'B') out.push('量：' + (re.tier || '—'));
  if (body.form === 'C') out.push('種類：' + (QuoteCore.CLEANUP_KINDS[re.cleanup_kind] || '') + (re.tsubo ? '／広さ：' + re.tsubo + '坪' : '／間取り：' + (re.layout || '—')));
  if (re.same_day) out.push('同日査定（買取見込み +20%）');
  if (re.perks && re.perks.quo_card) out.push('クオカード特典：' + (re.perks.quo_card === 'eligible' ? '対象' : '査定しだい'));
  if (body.form !== 'A') re.lines.forEach(function (l) { if (l.unit !== undefined || l.consult) out.push('オプション：' + l.name + ' ×' + l.qty); });
  (bb ? bb.lines : []).forEach(function (l) { out.push('買取：' + l.name + ' ×' + l.qty + '（年式 ' + l.year + '・状態 ' + l.condition + '）'); });
  return out.join('\n');
}

// 受付の1行（全フォーム共通の列順）。o は列名 → 値
function rowOf_(o) {
  return HEADERS.map(function (h) { return cell_(o[h]); });
}

function commonCols_(id, b) {
  var c = b.customer || {};
  var m = b.meta || {};
  var nl = b.newsletter || {};
  return {
    '受付番号': id,
    '受付日時': now_(),
    'お名前(カナ)': c.name_kana || c.name || '',
    '電話': c.tel || '',
    'メール': c.email || '',
    'LINE名': c.line_name || '',
    '郵便番号': c.zip || '',
    '郵便番号(上3桁)': b.postal3 || '',
    '住所': c.address || '',
    '支払い方法': PAYMENT_NAMES[b.payment] || '',
    '要望': b.note || '',
    'メルマガ': nl.opt_in ? '同意' : '不同意',
    '同意日時': nl.at || '',
    '同意文(指紋)': nl.text_hash || '',
    'ページ': m.page || b.page || '',
    '参照元': m.referrer || '',
    'utm_source': m.utm_source || '',
    'utm_medium': m.utm_medium || '',
    'utm_campaign': m.utm_campaign || '',
    '端末': m.device || '',
    '言語': m.lang || '',
    '画面': m.screen || ''
  };
}

function appendRow_(ss, id, b, re, match) {
  var sh = sheetWith_(ss, SHEET_NAME, HEADERS);
  var d = b.dates || [];
  var dt = function (i) { return d[i] ? d[i].date + ' ' + (d[i].time || '') : ''; };
  var o = commonCols_(id, b);
  o['種類'] = FORM_NAMES[b.form];
  o['概算(最小)'] = re.undetermined ? '' : re.min;
  o['概算(最大)'] = re.undetermined ? '' : re.max;
  o['要相談'] = re.undetermined ? '要相談' : '';
  o['照合'] = match ? '一致' : '差あり';
  o['画面の概算'] = quoteStr_(b.form, b.quote);
  o['再計算の概算'] = quoteStr_(b.form, re);
  o['価格表の版(画面)'] = b.prices_updated == null ? '(未設定)' : b.prices_updated;
  o['価格表の版(受付)'] = PRICES.updated == null ? '(未設定)' : PRICES.updated;
  o['選んだ内容'] = detail_(b, re);
  o['第1希望'] = dt(0); o['第2希望'] = dt(1); o['第3希望'] = dt(2);
  o['写真(枚)'] = (b.photos && b.photos.count) || 0;
  o['写真(ファイル名)'] = ((b.photos && b.photos.names) || []).join(', ');
  o['同日査定'] = re.same_day ? 'あり' : '';
  var rf = referrer_(b);
  o['ご紹介者'] = rf ? rf.name || '（名前なし）' : '';
  o['ご紹介者の連絡先'] = rf ? rf.contact : '';
  sh.appendRow(rowOf_(o));
}

// メール会員：メールで1行。同意したら active（既にあれば日時・受付番号を更新）
function upsertMember_(ss, id, b) {
  var sh = sheetWith_(ss, MEMBER_SHEET, MEMBER_HEADERS);
  var c = b.customer || {};
  var mail = String(c.email || '').trim().toLowerCase();
  if (!isEmail_(mail)) return;
  var nl = b.newsletter || {};
  var row = [mail, c.name_kana || c.name || '', nl.at || now_(), FORM_NAMES[b.form] || b.form || '', id, 'active', nl.text_hash || '', now_()].map(cell_);
  var last = sh.getLastRow();
  if (last > 1) {
    var mails = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < mails.length; i++) {
      if (String(mails[i][0]).toLowerCase() === mail) { sh.getRange(i + 2, 1, 1, row.length).setValues([row]); return; }
    }
  }
  sh.appendRow(row);
}

// 配送料の計算ログ（名前なし）。郵便番号の形と1日の上限だけ確かめる
function logDelivery_(b) {
  var zip = String(b.zip || '');
  if (!/^\d{7}$/.test(zip)) return { ok: false, error: '郵便番号の形' };
  var band = String(b.band || '').slice(0, 30);
  var p = props_();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var n = p.getProperty('LOG_DATE') === today ? Number(p.getProperty('LOG_N') || 0) : 0;
    if (n >= Number(p.getProperty('LOG_MAX_PER_DAY') || 500)) return { ok: true, skipped: true };
    p.setProperties({ LOG_DATE: today, LOG_N: String(n + 1) });
    var ss = book_();
    sheetWith_(ss, LOG_SHEET, LOG_HEADERS).appendRow([now_(), zip, zip.slice(0, 3), band].map(cell_));
    ensureDashboard_(ss);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// 列名 → 列の文字（A, B, …, AA）
function colOf_(headers, name) {
  var n = headers.indexOf(name) + 1;
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// 「集計」シート：式だけを置く（値はシート側で計算）。無ければ作る。
// 日別件数・種類別・商品別・郵便番号上3桁別・流入元別・メルマガ同意率・配送料ログの地域別
function ensureDashboard_(ss) {
  if (ss.getSheetByName(DASHBOARD_SHEET)) return;
  sheetWith_(ss, SHEET_NAME, HEADERS);
  sheetWith_(ss, LOG_SHEET, LOG_HEADERS);
  var sh = ss.insertSheet(DASHBOARD_SHEET);
  var R = "'" + SHEET_NAME + "'!";
  var L = "'" + LOG_SHEET + "'!";
  var col = function (name) { var c = colOf_(HEADERS, name); return R + c + '2:' + c; };
  var count = function (name, label) {
    return '=QUERY({' + col(name) + '},"select Col1, count(Col1) where Col1 <> \'\' group by Col1 order by count(Col1) desc label Col1 \'' + label + '\', count(Col1) \'件数\'",0)';
  };
  var blocks = [
    ['日別件数', '=QUERY({ARRAYFORMULA(LEFT(TO_TEXT(' + col('受付日時') + '),10))},"select Col1, count(Col1) where Col1 <> \'\' group by Col1 order by Col1 desc label Col1 \'日付\', count(Col1) \'件数\'",0)'],
    ['種類別', count('種類', '種類')],
    // 商品ID は1注文で「、」区切り（カート）。分けてから数える
    ['商品別（商品ID）', '=QUERY(FLATTEN(ARRAYFORMULA(IFERROR(SPLIT(' + col('商品ID') + ',"、")))),"select Col1, count(Col1) where Col1 <> \'\' group by Col1 order by count(Col1) desc label Col1 \'商品ID\', count(Col1) \'件数\'",0)'],
    ['郵便番号上3桁別（受付）', count('郵便番号(上3桁)', '上3桁')],
    ['流入元別（utm_source）', count('utm_source', '流入元')],
    ['参照元別', count('参照元', '参照元')],
    ['メルマガ同意率', '=IFERROR(COUNTIF(' + col('メルマガ') + ',"同意")/(COUNTIF(' + col('メルマガ') + ',"同意")+COUNTIF(' + col('メルマガ') + ',"不同意")),0)'],
    ['ご紹介の件数（種類別）', '=QUERY({' + col('種類') + ',' + col('ご紹介者') + '},"select Col1, count(Col2) where Col2 <> \'\' group by Col1 label Col1 \'種類\', count(Col2) \'件数\'",0)'],
    ['配送料の計算（郵便番号上3桁別）', '=QUERY({' + L + 'C2:C},"select Col1, count(Col1) where Col1 <> \'\' group by Col1 order by count(Col1) desc label Col1 \'上3桁\', count(Col1) \'件数\'",0)']
  ];
  // 横に並べる（1ブロック＝3列）
  blocks.forEach(function (b, i) {
    var c = i * 3 + 1;
    sh.getRange(1, c).setValue(b[0]).setFontWeight('bold');
    sh.getRange(2, c).setFormula(b[1]);
  });
  sh.getRange(2, 19).setNumberFormat('0.0%');
  sh.setFrozenRows(1);
}

// ---------- 販売ページの注文（カート） ----------
// items：[{id, price}]。1注文に何点でも。重複・見つからない・売切れ／取り置き中は断る
function shopItems_(b) {
  var list = (b && b.items) || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i] && ShopCore.findItem(SHOP, list[i].id);
    out.push(it || null);
  }
  return out;
}

function validateShop_(b) {
  if (!b || !b.customer) return '内容が足りません';
  if (!b.consent) return '個人情報の取扱いへの同意が必要です';
  if (!b.items || !b.items.length) return '商品を選んでください';
  if (b.items.length > ShopCore.CART_MAX) return '一度に申し込める商品は' + ShopCore.CART_MAX + '点までです';
  var items = shopItems_(b);
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it) return '商品が見つかりません';
    if (seen[it.id]) return '同じ商品が2回入っています';
    seen[it.id] = true;
    if (!ShopCore.orderable(it)) return it.name + 'は' + (ShopCore.SHOP_STATUS[it.status] || '販売終了') + 'です';
  }
  if (!ShopCore.RECEIVE[b.receive]) return '受け取り方法を選んでください';
  if (!ShopCore.SHOP_PAYMENTS[b.payment]) return 'お支払い方法を選んでください';
  var c = b.customer;
  if (!c.name || !c.email) return 'お名前・メールは必須です';
  if (!isEmail_(c.email)) return 'メールアドレスを確かめてください';
  if (!c.tel && !c.line_name) return '電話番号か LINE の名前が必要です';
  if (c.tel && String(c.tel).replace(/[^0-9]/g, '').length < 10) return '電話番号を確かめてください';
  if (b.receive === 'delivery' && (!/^\d{7}$/.test(String(c.zip || '').replace(/[^0-9]/g, '')) || !c.address)) return 'お届け先の郵便番号と住所が必要です';
  return '';
}

// 注文の再計算（Shop.gs の価格で）。配送料は画面の計算（郵便番号の表は GAS に持たない）を1回分だけ使う。
// 店頭受け取りは 0。送料無料（0円）と送ってきたのに、カートに送料無料でない商品があれば「照合 差あり」にする
function shopRecalc_(b) {
  var items = shopItems_(b);
  var d = b.delivery || null;
  var fee = ShopCore.cartDeliveryFee(b.receive, d);
  var t = ShopCore.cartTotal(items, fee);
  var freeOk = true;
  if (b.receive === 'delivery' && d && !d.consult && d.free_shipping) freeOk = fee === 0 && ShopCore.cartFreeShipping(items);
  var match = ShopCore.sameCart(SHOP, b.items) && b.shop_updated === SHOP.updated && (b.total == null ? t.total === null : b.total === t.total) && freeOk;
  return { items: items, fee: fee, t: t, match: match };
}

function shopLine_(it) {
  var p = ShopCore.shopPrice(it);
  return it.name + '（' + it.id + '）' + (p.undetermined ? '価格は確認中' : ShopCore.yenText(p.price) + (p.sale ? '（' + Math.round(p.sale * 100) + '% OFF）' : ''));
}

function handleShop_(b, lock) {
  var err = validateShop_(b);
  if (err) return { ok: false, error: err };
  lock.waitLock(20000);
  var id = nextId_('S');
  if (!id) return { ok: false, error: '本日の受付数が上限に達しました。お電話でご連絡ください。' };
  var r = shopRecalc_(b);
  var t = r.t;
  var d = b.delivery || null;
  var ss = book_();
  var o = commonCols_(id, b);
  o['種類'] = FORM_NAMES.shop;
  o['概算(最小)'] = t.total === null ? '' : t.total;
  o['概算(最大)'] = t.total === null ? '' : t.total;
  o['要相談'] = t.total === null ? '要相談' : '';
  o['照合'] = r.match ? '一致' : '差あり';
  o['画面の概算'] = b.total == null ? '要相談' : b.total;
  o['再計算の概算'] = t.total === null ? '要相談' : t.total;
  o['価格表の版(画面)'] = b.shop_updated == null ? '(未設定)' : b.shop_updated;
  o['価格表の版(受付)'] = SHOP.updated == null ? '(未設定)' : SHOP.updated;
  o['選んだ内容'] = r.items.map(function (it) { return '商品：' + shopLine_(it); }).join('\n');
  o['商品ID'] = r.items.map(function (it) { return it.id; }).join('、');
  o['商品名'] = r.items.map(function (it) { return it.name; }).join('、');
  o['商品代'] = t.pending ? ShopCore.cartGoodsText(t) : t.goods;
  o['受け取り方法'] = ShopCore.RECEIVE[b.receive];
  o['配送区分'] = d ? (d.band || '') + (d.km != null ? '（約' + d.km + 'km）' : '') + (d.near_boundary ? '・境目' : '') + (d.free_shipping ? '・送料無料' : '') : '';
  o['配送料'] = b.receive === 'delivery' ? (r.fee === null ? '要相談' : r.fee) : '';
  o['お支払い目安'] = t.total === null ? ShopCore.cartTotalText(t) : t.total;
  o['支払い方法'] = ShopCore.SHOP_PAYMENTS[b.payment];
  o['点数'] = t.count;
  sheetWith_(ss, SHEET_NAME, HEADERS).appendRow(rowOf_(o));
  if (b.newsletter && b.newsletter.opt_in) upsertMember_(ss, id, b);
  ensureDashboard_(ss);
  lock.releaseLock();
  notifyShop_(id, b, r);
  replyShop_(id, b, r);
  return { ok: true, id: id };
}

function yenStr_(n) { return n === null ? '要相談' : n.toLocaleString() + '円'; }

function notifyShop_(id, b, r) {
  var to = props_().getProperty('OWNER_EMAIL');
  if (!to) return;
  var c = b.customer;
  var t = r.t;
  var lines = [
    '【販売】新しい注文 ' + id + '（' + t.count + '点）',
    ''
  ].concat(r.items.map(function (it) { return '・' + shopLine_(it); })).concat([
    '商品代：' + ShopCore.cartGoodsText(t) + '　照合：' + (r.match ? '一致' : '差あり（画面 ' + JSON.stringify(b.items) + '・目安 ' + b.total + '・版 ' + b.shop_updated + '）'),
    '受け取り：' + ShopCore.RECEIVE[b.receive] + (b.receive === 'delivery' ? '　配送料（1回分）：' + yenStr_(r.fee) + (b.delivery ? '（' + (b.delivery.band || '') + '）' : '') : ''),
    'お支払いの目安：' + ShopCore.cartTotalText(t) + '（' + ShopCore.SHOP_PAYMENTS[b.payment] + '・受け取り時）',
    '',
    'お名前：' + c.name,
    'メール：' + c.email + '（お知らせ ' + (b.newsletter && b.newsletter.opt_in ? '同意' : '不同意') + '）',
    '電話：' + (c.tel || 'なし') + '　LINE名：' + (c.line_name || 'なし'),
    b.receive === 'delivery' ? '届け先：〒' + c.zip + ' ' + c.address : '',
    '備考：' + (b.note || 'なし'),
    metaLine_(b),
    '',
    '→ お客様へ連絡して受け取りの日時を決め、商品を取り置いてください（' + (SHOP.hold_note || '') + '）。'
  ]);
  var first = r.items[0] ? r.items[0].name : '';
  MailApp.sendEmail({ to: to, subject: '【注文 ' + id + '】' + first + (t.count > 1 ? ' ほか' + (t.count - 1) + '点' : '') + ' ' + c.name + ' 様', body: lines.join('\n'), name: siteName_() });
}

function replyShop_(id, b, r) {
  var c = b.customer;
  var t = r.t;
  sendCustomer_(c.email, '【' + siteName_() + '】ご注文を受け付けました（' + id + '）', [
    c.name + ' 様',
    '',
    siteName_() + ' です。ご注文ありがとうございます。',
    '受付番号：' + id,
    '',
    '商品（' + t.count + '点）：'
  ].concat(r.items.map(function (it) {
    var p = ShopCore.shopPrice(it);
    return '・' + it.name + '　' + (p.undetermined ? '価格は確認中（担当者からご連絡します）' : ShopCore.yenText(p.price) + '（税込）');
  })).concat([
    '商品代：' + ShopCore.cartGoodsText(t),
    '受け取り方法：' + ShopCore.RECEIVE[b.receive] + (b.receive === 'delivery' ? '（配送料 ' + (r.fee === null ? 'ご相談' : yenStr_(r.fee)) + '・1回分）' : ''),
    'お支払いの目安：' + (t.total === null ? ShopCore.cartTotalText(t) + '（担当者からご連絡します）' : yenStr_(t.total)),
    'お支払い方法：' + ShopCore.SHOP_PAYMENTS[b.payment],
    '',
    '【ご案内】',
    '・' + (SHOP.payment_note || ''),
    '・' + (SHOP.hold_note || ''),
    '・このメールの時点では受け取りの日時は決まっていません。担当者からご連絡します。',
    '・配送料は距離の目安です。区分の境目に近い場合などは、お届けの前に確定します。'
  ]));
}

function money_(form, q) {
  if (q.undetermined) return '要相談';
  if (form === 'A') return q.max === 0 ? '0円（回収扱い）' : q.min.toLocaleString() + '円〜' + q.max.toLocaleString() + '円（買取見込み' + (q.same_day ? '・同日査定 +20%' : '') + '）';
  var f = function (n) { return n < 0 ? 'お受け取り ' + (-n).toLocaleString() + '円' : n.toLocaleString() + '円'; };
  return (q.min === q.max ? f(q.min) : f(q.min) + '〜' + f(q.max)) + '（お会計の目安）';
}

function metaLine_(b) {
  var m = b.meta || {};
  return '流入：' + [m.page, m.referrer, m.utm_source, m.device].filter(function (x) { return x; }).join(' / ');
}

function notifyOwner_(id, b, re, match) {
  var to = props_().getProperty('OWNER_EMAIL');
  if (!to) return;
  var c = b.customer;
  var lines = [
    '【' + FORM_NAMES[b.form] + '】新しい受付 ' + id,
    '',
    '概算（再計算）：' + money_(b.form, re),
    '照合：' + (match ? '画面と一致' : '差あり（画面：' + quoteStr_(b.form, b.quote) + '／再計算：' + quoteStr_(b.form, re) + '／価格表の版 画面 ' + b.prices_updated + '・受付 ' + PRICES.updated + '）'),
    '',
    detail_(b, re),
    '',
    'お名前：' + c.name_kana,
    '電話：' + c.tel,
    'メール：' + c.email + '（お知らせ ' + (b.newsletter && b.newsletter.opt_in ? '同意' : '不同意') + '）',
    'LINE名：' + (c.line_name || 'なし'),
    '住所：' + (c.zip ? '〒' + c.zip + ' ' : '') + c.address,
    '希望日時：' + (b.dates || []).map(function (d, i) { return '第' + (i + 1) + ' ' + d.date + ' ' + d.time; }).join(' ／ '),
    '写真：' + ((b.photos && b.photos.count) || 0) + '枚（本体は LINE で届く予定）',
    '支払い方法：' + (PAYMENT_NAMES[b.payment] || ''),
    '要望：' + (b.note || 'なし'),
    referrer_(b) ? 'ご紹介：あり（ご紹介者 ' + (referrer_(b).name || '名前なし') + '／連絡先 ' + (referrer_(b).contact || 'なし') + '）→ ご成約なら紹介料の対象' : 'ご紹介：なし',
    metaLine_(b),
    '',
    '→ お客様へ電話して日時を確定してください。'
  ];
  MailApp.sendEmail({ to: to, subject: '【受付 ' + id + '】' + FORM_NAMES[b.form] + ' ' + c.name_kana + ' 様', body: lines.join('\n'), name: siteName_() });
}

// 自動返信。返信先はオーナー（「停止」の返信を受けるため）
function sendCustomer_(to, subject, lines) {
  var opt = { to: to, subject: subject, body: lines.concat(['', UNSUB_LINE, 'お心当たりがない場合は、このメールを破棄してください。']).join('\n'), name: siteName_() };
  var owner = props_().getProperty('OWNER_EMAIL');
  if (owner) opt.replyTo = owner;
  MailApp.sendEmail(opt);
}

function replyCustomer_(id, b, re) {
  var c = b.customer;
  sendCustomer_(c.email, '【' + siteName_() + '】お申し込みを受け付けました（' + id + '）', [
    c.name_kana + ' 様',
    '',
    siteName_() + ' です。お申し込みありがとうございます。',
    '受付番号：' + id,
    '',
    'お申し込みの種類：' + FORM_NAMES[b.form],
    '概算：' + money_(b.form, re),
    '',
    '【ご注意】',
    '・表示した金額は目安です。最終額は訪問査定で確定します。買取見込み額が変わると、お会計も変わります。',
    '・このメールの時点では予約は確定していません。担当者からお電話して、伺う日時を相談します。',
    '・買取では、法律（古物営業法）にもとづく本人確認が必要です。運転免許証などをご用意ください。',
    '・写真は LINE で送ってください（受付番号を添えてください）。'
  ]);
}
