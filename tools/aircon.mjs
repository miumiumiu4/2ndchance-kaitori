// ありがとうエアコン（提携店）の予約フォームへの送客リンク（純粋関数。build とテストが使う）。
// 設定は js/config.js の AIRCON_* だけ（公開時は Actions Variables の CFG_AIRCON_* で上書きできる）。
//   CODE が空 … BOOKING_URL をそのまま（ボタンは出す）
//   CODE あり … BOOKING_URL?<PARAM>=<CODE>（どちらも encodeURIComponent）
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const AIRCON_LABEL = "エアコンクリーニング・取付取外しの予約（ありがとうエアコン）";
export const AIRCON_NOTE = "提携店のページが開きます";

export function airconHref(cfg) {
  const url = String(cfg.AIRCON_BOOKING_URL || "");
  const param = String(cfg.AIRCON_REF_PARAM || "");
  const code = String(cfg.AIRCON_REF_CODE || "");
  if (!code || !param) return url;
  return url + (url.includes("?") ? "&" : "?") + encodeURIComponent(param) + "=" + encodeURIComponent(code);
}

// 関連サービスの並び（ul.related）の1項目
export function airconItem(cfg, title = AIRCON_LABEL, note = AIRCON_NOTE) {
  return `<li><a href="${esc(airconHref(cfg))}" target="_blank" rel="noopener"><b>${esc(title)}</b><br><small>${esc(note)}</small></a></li>`;
}

// ボタン＋小さな注記。自社フォームのボタン（btn-form）と並ぶので、提携店側は btn-ghost で控えめに
export function airconLink(cfg) {
  return `<p><a class="btn btn-ghost" href="${esc(airconHref(cfg))}" target="_blank" rel="noopener">${esc(AIRCON_LABEL)}</a></p>
<p class="muted" style="margin-top:6px">${esc(AIRCON_NOTE)}</p>`;
}
