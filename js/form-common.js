// フォーム共通の小道具（純粋関数が中心）。概算フォーム（form.js）と販売ページの注文フォーム（shop.js）が使う。
// - メールアドレスの形、メルマガ同意の記録（同意文のハッシュ先頭8桁）
// - 分析用の meta（ページ・参照元・utm・端末・言語・画面）と郵便番号の上3桁
// 個人を特定する値は meta に入れない（名前・電話・メール・住所は customer にだけ入る）。

export const NEWSLETTER_TEXT = "片付けのコツ・入荷のお知らせを月1〜2回メールで受け取る（売り込みはしません）";

export function isEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
}

// 郵便番号の上3桁（7桁で入っているときだけ）
export function postal3(zip) {
  const d = String(zip || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, "");
  return d.length === 7 ? d.slice(0, 3) : "";
}

// 参照元はドメインまで（パスや検索語は残さない）
export function referrerHost(ref) {
  try { return ref ? new URL(ref).host : ""; } catch (_) { return ""; }
}

// 分析用の meta。env: { href, referrer, userAgent, language, width, height }
export function buildMeta(env) {
  const e = env || {};
  let page = "", q = new URLSearchParams("");
  try { const u = new URL(e.href || ""); page = u.pathname; q = u.searchParams; } catch (_) {}
  const cut = (s) => String(s || "").slice(0, 60);
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(e.userAgent || "") || (Number(e.width) > 0 && Number(e.width) < 768);
  return {
    page: page,
    referrer: referrerHost(e.referrer),
    utm_source: cut(q.get("utm_source")),
    utm_medium: cut(q.get("utm_medium")),
    utm_campaign: cut(q.get("utm_campaign")),
    device: mobile ? "mobile" : "desktop",
    lang: cut(e.language),
    screen: Number(e.width) > 0 ? Math.round(e.width) + "x" + Math.round(e.height || 0) : ""
  };
}

// ブラウザの環境から meta を作る（画面側だけで使う）
export function browserMeta() {
  if (typeof window === "undefined") return buildMeta({});
  return buildMeta({ href: location.href, referrer: document.referrer, userAgent: navigator.userAgent, language: navigator.language, width: screen.width, height: screen.height });
}

// 文字列の SHA-256 の先頭8桁（同意した文面の指紋）
export async function hash8(text) {
  const c = globalThis.crypto && globalThis.crypto.subtle;
  if (!c) return "";
  const buf = await c.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// メルマガ同意の記録
export async function newsletterRecord(optIn, now) {
  return { opt_in: !!optIn, at: (now || new Date()).toISOString(), text_hash: await hash8(NEWSLETTER_TEXT) };
}
