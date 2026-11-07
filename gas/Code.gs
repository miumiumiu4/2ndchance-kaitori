/**
 * 2nd chance recycle 概算フォームの受け口（Google Apps Script）。
 * - doPost：フォームの JSON を受け取り、QuoteCore で再計算して画面の額と照合し、
 *           スプレッドシートの「受付」シートに追記、オーナー宛メール、お客様宛の自動返信（メールがある時だけ）。
 * - doGet ：action=quote で概算（読み取り専用・AI エージェント向け）、action=prices で価格表。
 * 値（シート ID・メールアドレス）はスクリプトプロパティだけに置く。このファイルに書かない。
 *   SHEET_ID     … 受付を書くスプレッドシートの ID
 *   OWNER_EMAIL  … 受付の通知先
 *   SITE_NAME    … 任意。メールの差出人名（既定 2nd chance recycle）
 *   MAX_PER_DAY  … 任意。1日の受付上限（既定 50。超えたら受け付けずにエラー）
 * 同じフォルダの QuoteCore.gs と Prices.gs は tools/build.mjs が生成する（手で直さない）。
 */

var SHEET_NAME = '受付';
var HEADERS = [
  '受付番号', '受付日時', '種類', '概算(最小)', '概算(最大)', '要相談', '照合', '画面の概算', '再計算の概算',
  '価格表の版(画面)', '価格表の版(受付)', '選んだ内容', 'お名前(カナ)', '電話', 'メール', '郵便番号', '住所',
  '第1希望', '第2希望', '第3希望', '写真(枚)', '写真(ファイル名)', '支払い方法', '要望', 'ページ'
];
var FORM_NAMES = { A: '出張買取', B: '不用品回収', C: '片付け' };
var PAYMENT_NAMES = { cash: '現金', paypay: 'PayPay', invoice: '請求リンク' };

function props_() { return PropertiesService.getScriptProperties(); }
function siteName_() { return props_().getProperty('SITE_NAME') || '2nd chance recycle'; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 読み取り（AI 向け） ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
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
    if (body.website) return json_({ ok: true, id: '' }); // ロボット対策の空欄に何か入っていたら黙って捨てる
    var err = validate_(body);
    if (err) return json_({ ok: false, error: err });

    lock.waitLock(20000);
    var id = nextId_();
    if (!id) return json_({ ok: false, error: '本日の受付数が上限に達しました。お電話でご連絡ください。' });

    // 画面の額と、同じ式・同じ価格表での再計算を照合（改ざん・古いキャッシュ対策）
    var re = QuoteCore.quoteFromInput(body.input, PRICES);
    var match = QuoteCore.sameQuote(body.quote, re) && body.prices_updated === PRICES.updated;

    appendRow_(id, body, re, match);
    lock.releaseLock();

    notifyOwner_(id, body, re, match);
    if (body.customer.email) replyCustomer_(id, body, re);
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
  if (!c.name_kana || !c.tel || !c.address) return 'お名前・電話・住所は必須です';
  if (String(c.tel).replace(/[^0-9]/g, '').length < 10) return '電話番号を確かめてください';
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return 'メールアドレスを確かめてください';
  if (!b.dates || !b.dates.length) return '第1希望の日付が必要です';
  return '';
}

// 受付番号：R + 日付(yyyyMMdd) + '-' + その日の連番(3桁)
function nextId_() {
  var p = props_();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var n = p.getProperty('SEQ_DATE') === today ? Number(p.getProperty('SEQ_N') || 0) : 0;
  var max = Number(p.getProperty('MAX_PER_DAY') || 50);
  if (n >= max) return '';
  n += 1;
  p.setProperties({ SEQ_DATE: today, SEQ_N: String(n) });
  return 'R' + today + '-' + ('00' + n).slice(-3);
}

// シートの式として解釈されないように（= + - @ で始まる文字は先頭に ' を付ける）
function cell_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function quoteStr_(form, q) {
  if (!q) return '';
  if (q.undetermined) return '要相談';
  return form === 'A' ? ('0〜' + q.max) : (q.min + '〜' + q.max);
}

function detail_(body, re) {
  var out = [];
  var bb = body.form === 'A' ? re.buyback : re.buyback_detail;
  if (body.form === 'B') out.push('量：' + (re.tier || '—'));
  if (body.form === 'C') out.push('種類：' + (QuoteCore.CLEANUP_KINDS[re.cleanup_kind] || '') + '／間取り：' + (re.layout || '—'));
  if (body.form !== 'A') re.lines.forEach(function (l) { if (l.unit !== undefined || l.consult) out.push('オプション：' + l.name + ' ×' + l.qty); });
  (bb ? bb.lines : []).forEach(function (l) { out.push('買取：' + l.name + ' ×' + l.qty + '（年式 ' + l.year + '・状態 ' + l.condition + '）'); });
  return out.join('\n');
}

function appendRow_(id, b, re, match) {
  var ss = SpreadsheetApp.openById(props_().getProperty('SHEET_ID'));
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  var d = b.dates || [];
  var dt = function (i) { return d[i] ? d[i].date + ' ' + (d[i].time || '') : ''; };
  var c = b.customer;
  sh.appendRow([
    id,
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    FORM_NAMES[b.form],
    re.undetermined ? '' : re.min,
    re.undetermined ? '' : re.max,
    re.undetermined ? '要相談' : '',
    match ? '一致' : '差あり',
    quoteStr_(b.form, b.quote),
    quoteStr_(b.form, re),
    b.prices_updated == null ? '(未設定)' : b.prices_updated,
    PRICES.updated == null ? '(未設定)' : PRICES.updated,
    detail_(b, re),
    c.name_kana, c.tel, c.email || '', c.zip || '', c.address,
    dt(0), dt(1), dt(2),
    (b.photos && b.photos.count) || 0,
    ((b.photos && b.photos.names) || []).join(', '),
    PAYMENT_NAMES[b.payment] || '',
    b.note || '',
    b.page || ''
  ].map(cell_));
}

function money_(form, q) {
  if (q.undetermined) return '要相談';
  if (form === 'A') return q.max === 0 ? '0円（回収扱い）' : '0円〜' + q.max.toLocaleString() + '円（買取見込み）';
  var f = function (n) { return n < 0 ? 'お受け取り ' + (-n).toLocaleString() + '円' : n.toLocaleString() + '円'; };
  return (q.min === q.max ? f(q.min) : f(q.min) + '〜' + f(q.max)) + '（お会計の目安）';
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
    'メール：' + (c.email || 'なし'),
    '住所：' + (c.zip ? '〒' + c.zip + ' ' : '') + c.address,
    '希望日時：' + (b.dates || []).map(function (d, i) { return '第' + (i + 1) + ' ' + d.date + ' ' + d.time; }).join(' ／ '),
    '写真：' + ((b.photos && b.photos.count) || 0) + '枚（本体は LINE で届く予定）',
    '支払い方法：' + (PAYMENT_NAMES[b.payment] || ''),
    '要望：' + (b.note || 'なし'),
    '',
    '→ お客様へ電話して日時を確定してください。'
  ];
  MailApp.sendEmail({ to: to, subject: '【受付 ' + id + '】' + FORM_NAMES[b.form] + ' ' + c.name_kana + ' 様', body: lines.join('\n'), name: siteName_() });
}

function replyCustomer_(id, b, re) {
  var c = b.customer;
  var body = [
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
    '・写真は LINE で送ってください（受付番号を添えてください）。',
    '',
    'このメールは送信専用です。お心当たりがない場合は、このメールを破棄してください。'
  ].join('\n');
  MailApp.sendEmail({ to: c.email, subject: '【' + siteName_() + '】お申し込みを受け付けました（' + id + '）', body: body, name: siteName_() });
}
