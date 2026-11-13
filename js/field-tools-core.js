// 現場の道具（/admin/tools/）の計算と文面（純粋関数。画面は js/field-tools.js）。
// お客様の名前・住所はこの画面の中だけで使い、どこにも送らず、保存もしない。
import { yen } from "./estimate-text.js";

// 業種の型を引く。知らない業種は recycle（今の見本と同じ）
export function industryOf(key, industries) {
  const k = key && industries[key] && !key.startsWith("_") ? key : "recycle";
  return { key: k, ...industries[k] };
}

// その業種で出す道具：[{ id, name, why, ready }]
export function toolsFor(key, industries) {
  const ind = industryOf(key, industries);
  const meta = industries._tools || {};
  return (ind.tools || []).filter((id) => meta[id]).map((id) => ({ id, ...meta[id] }));
}

const int = (v) => {
  const n = Number(String(v ?? "").replace(/[,，円\s]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// 内訳つき見積書の合計。lines: [{ name, qty, unit }]、travel: 出張費、buyback: 買取の差し引き（正の数で渡す）
export function sheetTotals({ lines = [], travel = 0, buyback = 0 } = {}) {
  const rows = lines
    .filter((l) => String(l.name || "").trim())
    .map((l) => {
      const qty = Math.max(1, int(l.qty) || 1);
      const unit = Math.max(0, int(l.unit));
      return { name: String(l.name).trim(), qty, unit, amount: qty * unit };
    });
  const work = rows.reduce((s, r) => s + r.amount, 0);
  const t = Math.max(0, int(travel));
  const b = Math.max(0, int(buyback));
  const total = work + t - b;
  return { rows, work, travel: t, buyback: b, total };
}

const money = (n) => (n < 0 ? "お受け取り " + yen(n) : yen(n));

// 見積書の文面（LINE やメールに貼る）。店名・業種の決まり・キャンセルの決まりを付ける
export function sheetText({ storeName, customer = "", date = "", totals, terms = [], cancel = "", validDays = 14 }) {
  const out = [];
  out.push("【お見積書】" + (storeName ? " " + storeName : ""));
  if (customer) out.push(customer + " 様");
  if (date) out.push("作成日 " + date);
  out.push("");
  out.push("■ 内訳");
  for (const r of totals.rows) out.push(`・${r.name}${r.qty > 1 ? ` ×${r.qty}` : ""}　${yen(r.amount)}`);
  if (totals.travel) out.push(`・出張費　${yen(totals.travel)}`);
  if (totals.buyback) out.push(`・買取の差し引き　−${yen(totals.buyback)}`);
  out.push("");
  out.push(`■ 合計（税込）　${money(totals.total)}`);
  out.push("");
  out.push("■ 決まり");
  for (const t of terms.filter(Boolean)) out.push("・" + t);
  if (cancel) out.push("・" + cancel);
  out.push(`・このお見積りの有効期限は、作成日から${validDays}日です。`);
  return out.join("\n");
}

// "2026-11-20" "10:00" → "11月20日（金）10:00"
const WD = ["日", "月", "火", "水", "木", "金", "土"];
export function jaDate(date, time = "") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return date || "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${+m[2]}月${+m[3]}日（${WD[d.getUTCDay()]}）${time ? time : ""}`;
}

// 訪問日の確定連絡
export function visitText({ storeName, customer = "", date, time, minutes = 60, tel = "", bring = [] }) {
  const when = jaDate(date, time);
  const out = [];
  out.push(`${customer ? customer + " 様\n" : ""}${storeName}です。お見積りの訪問日が決まりましたので、お知らせします。`);
  out.push("");
  out.push(`■ 日時　${when}（${minutes}分ほど）`);
  if (bring.length) out.push("■ ご用意いただく物　" + bring.join("、"));
  out.push("");
  out.push("ご都合が悪くなったときは、前日までにこのメッセージへ返信" + (tel ? `か、お電話（${tel}）` : "") + "でお知らせください。");
  out.push("前日に、もう一度ご連絡します。");
  return out.join("\n");
}

// 前日の知らせ
export function dayBeforeText({ storeName, customer = "", date, time, tel = "" }) {
  return `${customer ? customer + " 様\n" : ""}${storeName}です。明日 ${jaDate(date, time)} にお伺いします。\nご都合が変わったときは、このメッセージへ返信${tel ? `か、お電話（${tel}）` : ""}でお知らせください。`;
}

// 口コミのお願い。お礼と引き換えにはしない（ステマ規制・Google の決まり）
export function reviewText({ storeName, customer = "", url = "" }) {
  return `${customer ? customer + " 様\n" : ""}${storeName}です。先日はご利用ありがとうございました。\nよろしければ、感じたことをそのまま口コミに書いていただけると、次のお客様の参考になります。${url ? "\n" + url : ""}\n良いことも、直してほしいことも、どちらも歓迎です。`;
}

// 店の予定表に入れる .ics（お客様の名前は入れず、受付番号などの短いメモだけ）
const pad = (n) => String(n).padStart(2, "0");
export function icsEvent({ title, date, time, minutes = 60, note = "", uid = "" }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  if (!m || !t) return "";
  const start = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]));
  const end = new Date(start.getTime() + minutes * 60000);
  const f = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//store-template//field-tools//JA", "BEGIN:VEVENT",
    `UID:${uid || f(start) + "-visit"}@field-tools`,
    `DTSTART;TZID=Asia/Tokyo:${f(start)}`, `DTEND;TZID=Asia/Tokyo:${f(end)}`,
    `SUMMARY:${esc(title)}`, note ? `DESCRIPTION:${esc(note)}` : null,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:前日の知らせを送る", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].filter(Boolean).join("\r\n") + "\r\n";
}
