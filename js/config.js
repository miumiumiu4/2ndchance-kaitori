// サイトの設定（1か所）。空の項目は画面で「準備中」と表示され、ボタンは押せない状態になる。
// 電話番号・LINE の URL・GAS の URL はリポジトリに書かない（秘密 grep が止める）。
// 公開時は GitHub の Settings → Secrets and variables → Actions → Variables に
//   CFG_SITE_URL / CFG_LINE_URL / CFG_TEL / CFG_GAS_URL / CFG_HOURS / CFG_OPENING_HOURS_SPEC
//   CFG_AIRCON_REF_PARAM / CFG_AIRCON_REF_CODE
// を入れると、tools/build.mjs --out が公開用の写しにだけ差し込む（README「設定手順」）。
export const CONFIG = {
  SITE_NAME: "2nd chance recycle",
  SITE_URL: "",              // 公開URL（末尾の / まで）。例の形：https://<ユーザー名>.github.io/2ndchance-kaitori/
  LINE_URL: "",              // 公式LINE の友だち追加URL
  TEL: "",                   // 携帯電話（タップで発信）。ハイフンありで可
  GAS_URL: "",               // gas/Code.gs をウェブアプリとして公開した URL
  AREA_CENTER: "熊本県合志市",
  HOURS: "",                 // 人向けの表示。例の形：9:00〜18:00（日曜定休）
  OPENING_HOURS_SPEC: "",    // 任意。schema.org の形。例の形：Mo-Sa 09:00-18:00
  // ありがとうエアコン（提携店）の予約フォームへの送客。公開URL（秘密ではない）。
  // CODE が空のあいだはパラメータ無しの素のURLでリンクする（ボタンは出す）。
  // 今は紹介ノートの紹介番号を ref で付ける。12月の凍結明けに partner＋会社番号（C0xx）へ差し替え。
  AIRCON_BOOKING_URL: "https://miumiumiu4.github.io/arigatou-booking/",
  AIRCON_REF_PARAM: "ref",   // 12月に "partner" へ
  AIRCON_REF_CODE: "",       // 紹介番号（12月から会社番号）。空なら付けない
  OPENING_NOTE: "このサイトは公開準備中です。料金・買取の目安・出張エリアは共同代表の確認後に確定します。"
};
