// サイトの設定（1か所）。空の項目は画面で「準備中」と表示され、ボタンは押せない状態になる。
// 電話番号・LINE の URL・GAS の URL はリポジトリに書かない（秘密 grep が止める）。
// 公開時は GitHub の Settings → Secrets and variables → Actions → Variables に
//   CFG_SITE_URL / CFG_LINE_URL / CFG_TEL / CFG_GAS_URL / CFG_HOURS / CFG_OPENING_HOURS_SPEC
//   CFG_AIRCON_REF_PARAM / CFG_AIRCON_REF_CODE / CFG_MAIL_PERK_TEXT
// を入れると、tools/build.mjs --out が公開用の写しにだけ差し込む（README「設定手順」）。
export const CONFIG = {
  SITE_NAME: "2nd chance recycle",
  SITE_URL: "",              // 公開URL（末尾の / まで）。例の形：https://<ユーザー名>.github.io/2ndchance-kaitori/
  LINE_URL: "",              // 公式LINE の友だち追加URL
  TEL: "",                   // 携帯電話（タップで発信）。ハイフンありで可
  GAS_URL: "",               // gas/Code.gs をウェブアプリとして公開した URL
  AREA_CENTER: "熊本県合志市",
  // 店の住所（店のチラシに印刷された公開情報）。フッターと LocalBusiness の address に使う
  STORE_ADDRESS: { region: "熊本県", locality: "合志市", street: "幾久富1866-941" },
  // 店の位置（配送料の距離計算の起点）。幾久富の町域中心（Geolonia japanese-addresses 由来）
  STORE_LATLNG: [32.8872, 130.7891],
  HOURS: "10:00〜19:00",     // 人向けの営業時間（店のチラシの表記）。定休日は確認中
  OPENING_HOURS_SPEC: "",    // 任意。schema.org の形。定休日が分かるまで入れない
  // ありがとうエアコン（提携店）の予約フォームへの送客。公開URL（秘密ではない）。
  // CODE が空のあいだはパラメータ無しの素のURLでリンクする（ボタンは出す）。
  // 今は紹介ノートの紹介番号を ref で付ける。12月の凍結明けに partner＋会社番号（C0xx）へ差し替え。
  // 紹介料は 20%（紹介ノートの外部紹介者）。40% の加盟者ルートではない。
  // 入口は予約フォームの welcome ページ。src・ref・utm_* を読んで予約フォームへ引き継ぐ（? があるので ref は & でつながる）
  AIRCON_BOOKING_URL: "https://miumiumiu4.github.io/arigatou-booking/welcome/?src=2ndchance",
  AIRCON_REF_PARAM: "ref",   // 12月に "partner" へ
  AIRCON_REF_CODE: "",       // 紹介番号（12月から会社番号）。空なら付けない
  // メール会員の登録特典の文言（決まりしだい差し替え）
  MAIL_PERK_TEXT: "登録特典は準備中です",
  // 上部のお知らせ帯。LINE・電話（LINE_URL と TEL）がそろうまでだけ出る
  OPENING_NOTE: "料金は共同代表の確認を経た仮の目安です。LINE・電話は準備中です。"
};
