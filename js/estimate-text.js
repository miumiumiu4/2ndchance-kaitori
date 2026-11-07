// 概算の「金額の言い方」（純粋関数）。概算の箱・固定バーの概算パネル・確認画面が同じ言い方を使う。
// 計算そのものは quote-core.js（quoteFromInput の返り値 r を受け取るだけで、ここでは計算しない）。
export const yen = (n) => "¥" + Math.abs(n).toLocaleString("ja-JP");
export const fmtBill = (n) => (n < 0 ? "お受け取り " + yen(n) : yen(n));
export const fmtRange = (a, b) => (a === b ? fmtBill(a) : fmtBill(a) + " 〜 " + fmtBill(b));

// フォームごとの見出し（A は買取、B/C は回収・片付けの費用から買取見込みを差し引いたお会計）
export const ESTIMATE_LABEL = { A: "買取見込み", B: "お会計の目安", C: "お会計の目安" };

// 概算の値の文字列。form: "A"|"B"|"C"、r: quoteFromInput の返り値、
// chosen: B は量・C は間取りを選んだか（A では使わない）
export function estimateValueText(form, r, chosen) {
  if (form === "A") {
    const hasItems = r.buyback.lines.length > 0;
    if (!hasItems) return "品目を選んでください";
    if (r.undetermined) return "要相談";
    return r.max === 0 ? "0円（回収扱い）" : "0円 〜 " + yen(r.max);
  }
  if (!chosen) return form === "B" ? "量を選んでください" : "間取りを選んでください";
  return r.undetermined ? "要相談" : fmtRange(r.min, r.max);
}

// 固定バーの概算パネル用：{ label, value, provisional }
export function stickyEstimate(form, r, chosen) {
  return { label: ESTIMATE_LABEL[form], value: estimateValueText(form, r, chosen), provisional: !!r.provisional };
}
