# 2nd chance recycle 買取・片付けサイト

熊本県合志市のリサイクル店「2nd chance recycle」の買取・片付けサイトです。素の HTML・CSS・JS の静的サイトで、GitHub Pages で公開します。設計は `DESIGN.md`（4-1 の6ページ・6-1 の概算フォーム・8章 段階1）。

## 構成
| 場所 | 中身 |
|---|---|
| `index.html` | トップ（8項目を「何を売れる？→いくらで？→どうやって？→何が要る？→いつお金？→申し込む」の順に） |
| `kaitori/` | 買取：品目・可否・年式の目安・出張エリア・**フォームA（出張買取の概算）** |
| `kataduke/` | 不用品回収・片付け：量の4区分・間取り別・**フォームB／C（タブ切替の1フォーム）** |
| `seiri/` | 遺品整理・生前整理・ゴミ屋敷・空き家（申込は `kataduke/#form-c`） |
| `flow/` | 流れ・必要なもの（本人確認）・お金の受け取り方・FAQ |
| `price/` | 料金目安・買取実績 |
| `shop/` | 販売中の商品の一覧と**注文フォーム**（`#order`）。商品ごとのページ `shop/<id>/` は build が `data/shop.json` から作る（コミットする） |
| `privacy/` | 個人情報の取扱い（**仮**。オーナー確定前） |
| `404.html` | 見つからないページ |
| `css/site.css` | 見た目（モバイル優先・文字大きめ・コントラスト 4.5 以上） |
| `js/config.js` | 設定 1か所（サイト名・URL・LINE・電話・GAS・営業時間・エアコン送客） |
| `tools/aircon.mjs` | ありがとうエアコンの予約フォームへのリンク（紹介番号のパラメータ）を作る純粋関数 |
| `js/quote-core.js` | 概算の式（純粋関数）。画面・GAS・AI 向け API が同じ式を使う |
| `js/form.js` | フォームの画面（入力→確認→送信→受付番号）。フォームが見えたら固定バーの上段に概算パネル |
| `js/shop.js`・`js/shop-core.js` | 注文フォームの画面と、商品代（割引）・カート（`cartTotal` など：商品代の合計＋配送料1回分）の式。GAS は `gas/ShopCore.gs` で照合 |
| `js/cart.js` | カート（`sessionStorage` に商品 id の配列）。一覧・商品ページの「カートに入れる」と、固定バーの上の「カートを見る（n点）」 |
| `js/form-common.js` | フォーム共通：メールの形・メルマガ同意の記録（同意文のハッシュ先頭8桁）・分析用の `meta`（ページ・参照元・utm・端末・言語・画面）と郵便番号の上3桁 |
| `js/delivery-core.js` | 郵便番号 → 配送料の式（純粋関数）。店からの直線距離 × 1.3 を道のりの目安にして `delivery_tiers` に当てはめる |
| `data/postal/` | 郵便番号（7桁）→ 緯度経度の表（上3桁ごと）。`tools/build-postal.mjs` が作る生成物（コミットする） |
| `js/estimate-text.js` | 概算の金額の言い方（純粋関数）。概算の箱と固定バーの概算パネルが同じ文字列を使う |
| `data/*.json` | 価格表・品目・エリア・FAQ・実績（公開。個人情報は入れない） |
| `assets/icons/` | 品目9つ＋トラック4サイズの線画アイコン（仮置き） |
| `assets/items/` | 写真の置き場（`assets/items/README.md`） |
| `gas/` | フォームの受け口（Apps Script）。`gas/README.md` |
| `content/posts/` | ブログ記事の倉庫（`YYYY-MM-DD-<slug>.md`）。書き方は `content/README.md` |
| `blog/` | 記事一覧・記事ページ・RSS（`blog/feed.xml`）。**build が毎回作る。コミットしない**（`.gitignore`） |
| `assets/blog/` | 記事の写真の置き場 |
| `llms.txt`・`sitemap.xml`・`robots.txt` | AI・検索向け（build が生成） |
| `tools/build.mjs` | 組み立て。`<!--build:名前-->` の差し込み、生成ファイルの作成、ブログ（`--today=YYYY-MM-DD` で日付を差し替え） |
| `tools/md.mjs`・`tools/blog.mjs` | 記事の Markdown 変換（依存なし）と、公開してよい記事の選び出し |
| `tools/new-post.mjs` | 記事のひな形を作る |
| `tools/screens.mjs` | 画面の確認（Playwright があるときだけ。`screens/` に撮影） |
| `tests/` | `npm test`（式・生成物が最新か・data の妥当性・秘密 grep・相対リンク・ブログの予約公開） |

## 毎回の作業
```sh
node tools/build.mjs   # data や config、ページの差し込み口を変えたら必ず
npm test               # 全部緑になってからコミット
```
ページ内の `<!--build:…-->` 〜 `<!--/build:…-->` の間は build が書き換えるので、手で直さない（直すのは `tools/build.mjs` か `data/`）。

## 記事の予約公開（ブログ）
- 記事は `content/posts/YYYY-MM-DD-<slug>.md` に積んでおく。`status: scheduled` で、`date` が今日（日本時間）以前のものだけが公開される。未来日と `draft` は `blog/` にも公開用の写し（`_site`）にも出ない。書き方は `content/README.md`。
- ひな形：`node tools/new-post.mjs "タイトル" --date 2026-11-10 --tags 片付け,遺品整理 --slug katazuke-junban`
- 毎朝 **UTC 22:00（日本時間 07:00）** に `.github/workflows/publish-daily.yml` が組み立て→テスト→公開を行い、その日の記事が出る（手で動かすときは Actions → Publish daily → Run workflow）。中身は `pages.yml` と同じ。
- **GitHub の schedule は混み具合で数十分〜1時間ほど遅れることがある**。7時ちょうどに出る約束はしない。
- **リポジトリに 60日間 push が無いと、GitHub が schedule を自動で止める**。月1回は何か push する（記事を1本足すなど）か、止まったら Actions の画面で Publish daily を開いて「Enable workflow」で有効化し直す。
- トップ・`sitemap.xml`・`llms.txt` の記事の部分は `<!--live-->`〜`<!--/live-->` で囲まれ、日付で変わるので `build --check` はそこを比べない（コミットした時点の内容のままでよい。公開のときに作り直される）。
- 手元で「その日に何が出るか」を見る：`node tools/build.mjs --today=2026-11-10`（`blog/` が作られる）。最後は日付なしで `node tools/build.mjs` に戻してからコミットする。

## 設定手順
### 1. `js/config.js`
| 項目 | 中身 | 空のとき |
|---|---|---|
| `SITE_NAME` | サイト名 | — |
| `SITE_URL` | 公開 URL（末尾 `/`）。sitemap・canonical・JSON-LD に使う | 相対パスで出力 |
| `LINE_URL` | 公式 LINE の友だち追加 URL | ボタンは「準備中」で押せない |
| `TEL` | 電話（タップで発信） | ボタンは「準備中」で押せない |
| `GAS_URL` | GAS ウェブアプリの URL | 確認画面の送信ボタンが「準備中」。入力と概算は画面に残る |
| `AREA_CENTER` | `熊本県合志市` | — |
| `STORE_ADDRESS` | 店の住所（チラシに印刷された公開情報）。フッターと LocalBusiness の `address` | 中心の市町村名だけ |
| `STORE_LATLNG` | 店の位置 `[緯度, 経度]`。配送料の距離の起点（幾久富の町域中心） | — |
| `HOURS` | 人向けの営業時間。既定 `10:00〜19:00`（チラシの表記） | 「準備中」 |
| `OPENING_HOURS_SPEC` | 任意。schema.org の形。定休日が分かるまで入れない | JSON-LD から省略 |
| `MAIL_PERK_TEXT` | メール会員の登録特典の文言（既定「登録特典は準備中です」） | — |
| `OPENING_NOTE` | 上部のお知らせ帯。`LINE_URL` と `TEL` が両方入るまでだけ出る | 帯を出さない |

**電話・LINE・GAS の URL はリポジトリに書かない**（`tests/secret-grep.mjs` が止める）。GitHub の Settings → Secrets and variables → Actions → **Variables** に `CFG_SITE_URL`・`CFG_LINE_URL`・`CFG_TEL`・`CFG_GAS_URL`・`CFG_HOURS`・`CFG_OPENING_HOURS_SPEC`・`CFG_OPENING_NOTE`（エアコン送客は `CFG_AIRCON_REF_PARAM`・`CFG_AIRCON_REF_CODE`）として入れると、公開のときに `node tools/build.mjs --out _site` が公開用の写しにだけ差し込む。

### エアコン送客の設定（ありがとうエアコン）
`seiri/` の4か所・`kataduke/` の「片付けの後のエアコン」・トップの「6. 申し込む」に、提携店「ありがとうエアコン」の予約フォームへのリンクを出す。リンクは `js/config.js` の3項目から `tools/aircon.mjs` が作り、build が差し込み口（`aircon-item`・`aircon-card`・`aircon-link`）に入れる。ページに href を手で書かない。

| 項目 | 中身 | 空のとき |
|---|---|---|
| `AIRCON_BOOKING_URL` | 予約フォームの入口（welcome ページ・`?src=2ndchance` 付き）の公開 URL（秘密ではない） | — |
| `AIRCON_REF_PARAM` | 流入経路のパラメータ名。今は `ref` | — |
| `AIRCON_REF_CODE` | 紹介番号（12月から会社番号） | パラメータ無しの素の URL でリンク（ボタンは出す） |

1. 紹介番号が来たら `AIRCON_REF_CODE` に入れる（または Actions Variables の `CFG_AIRCON_REF_CODE`）。
2. `node tools/build.mjs` → `npm test` → push。リンクは `…/arigatou-booking/welcome/?src=2ndchance&ref=<紹介番号>` になる（welcome ページが src・ref・utm_* を予約フォームへ引き継ぐ）。
3. **12月の凍結明け**：`AIRCON_REF_PARAM` を `partner`、`AIRCON_REF_CODE` を会社番号（`C0xx`）にして、同じく build → test → push。

### 2. `data/prices.json`
- 金額は共同代表が決めたものだけ入れる。`null` の間は画面・料金表・AI 向けが「要相談」と出す。
- 今は**仮の金額**（2026-11-09 共同代表との打合せで決めた目安。それ以前は 2026-11-07 オーナー指示の一般的な相場）。`provisional: true` のあいだ、料金ページ・トップの料金要約・フォームの概算の上に「仮の目安（調整中）」の帯と `provisional_note` を出し、llms.txt・JSON-LD・概算 API の返り値にも仮の旨が載る。正式な金額が来たら値を差し替え、`provisional` を `false` にする（帯は自動で消える）。
- 片付けは種類ごとの間取り表 `cleanup_by_kind`（`ihin`・`seizen`・`gomiyashiki`・`akiya`。どれも同じ間取りの並び）。倉庫・草刈りは `other_cleanup`（`per_tsubo` 坪あたり `price_from`。10坪単位で切り上げ）。
- 買取は `min_price`（最低額。年式の目安以内なら下回らない）〜 `max_price`。オプションの `price_by_form` はフォーム別の料金（解体は片付け C で 0 円）。
- 特典 `perks`（クオカード `quo_card.threshold`・同日査定 `same_day_up.rate`）と配送料も同じ表に持つ。配送料は2つ：`delivery_tiers`＝**ネット注文**（販売ページの郵便番号の計算が使う。無料の区分なし）、`delivery_tiers_store`＝**店頭でご購入の場合**（店のチラシの表。3km以内は無料。料金ページに並べて出すだけ）。どちらも `max_km` の小さい順、最後は `null`＝要相談。
- 片付けの作業時間 `hours` は数値（「約N時間」と表示）か「1〜2時間」のような文字列。
- 形は `prices.template.json` と同じに保つ（テストが確かめる）。金額を入れたら `updated` を `YYYY-MM-DD` にする。
- 変えたら `node tools/build.mjs` → `gas/Prices.gs` も作り直されるので、GAS 側も更新する（`gas/README.md`）。

### 3. GAS（フォームの送信先）
`gas/README.md` の手順で、プロパティ `SHEET_ID`・`OWNER_EMAIL`（任意で `SITE_NAME`・`MAX_PER_DAY`）を入れ、ウェブアプリ（実行：自分／アクセス：全員）として公開し、URL を `CFG_GAS_URL` に入れる。

## 公開手順（GitHub Pages）
1. GitHub にリポジトリを作り、push する。
2. Settings → Pages → Build and deployment の Source を **GitHub Actions** にする。
3. 上の Variables を入れる。
4. main に push すると `.github/workflows/pages.yml` が「組み立て → テスト → 公開用の写し → 公開」を行う。PR では `.github/workflows/ci.yml` がテストだけ行う。

## 後から自社ドメインへ移す
- リンク・画像はすべて相対パスなので、フォルダごとどこに置いても動く。
- GitHub Pages のままドメインだけ変える：リポジトリの直下に `CNAME`（中身はドメイン名1行）を置き、DNS を設定する（DNS はオーナー判断）。`CFG_SITE_URL` を新しい URL にする。
- 自社サーバーに置く：`node tools/build.mjs --out _site`（`CFG_*` を環境変数で渡す）で作った `_site/` の中身をそのまま置く。
- 404 ページはプロジェクトサイト（`/リポジトリ名/`）を想定して入口を推し量る。独自ドメインの直下なら `/` を使う。

## 販売ページ（段階1：注文受付のみ）
- 商品は `data/shop.json`（`id`・`name`・`price`（税込、`null`＝確認中）・`sale`（割引率）・`year`・`condition`・`size`・`free_shipping`・`status`（`available`／`reserved`／`sold`）・`photos`・`note`・`payment_link`）。写真は `tools/photos.py` で作る（`assets/shop/README.md`）。
- 入れ替え・売切れは `data/shop.json` を直して `node tools/build.mjs` → `npm test` → push。GAS の `Shop.gs` も更新する（`gas/README.md`）。
- **カート**：一覧の各商品と商品ページに「カートに入れる」（押すと「カートから外す」。中古品は1点ものなので数量なし。売切れ・取り置き中は押せない）。カートは `sessionStorage`（タブを閉じると消える）で一覧と商品ページが共有し、1点以上あると固定バーの上に「カートを見る（n点）」が出る。注文フォームの「申し込む商品」に写真つきの行・「外す」・合計。空なら送信ボタンは押せない。
- 金額：商品代の合計＝各商品の価格の和（確認中の商品は「＋確認中の商品」）。配送料は1注文で1回分：カートが全部送料無料なら 50km 以内は無料、1点でも送料無料でなければ郵便番号の通常の配送料。式は `js/shop-core.js` の `cartTotal` など（GAS も `ShopCore.gs` で同じ式）。
- お支払いは受け取り時（現金・クレジットカード・PayPay）。取り置きは3日（仮）。**ネット決済は後から**：外部の決済ページ（PayPal・Stripe Payment Links など。業者の選定と契約はオーナー判断）の URL を商品の `payment_link` に入れると、その商品にだけ「カードで支払う（外部サイト）」ボタンが出る（商品ページと、注文の確認画面のその商品の行）。

## 配送料（郵便番号 → 距離 → 料金）
- 料金は `data/prices.json` の `delivery_tiers`（ネット注文の表。店頭でご購入の場合の表 `delivery_tiers_store` は料金ページに並べて出すだけで、計算には使わない）。式は `js/delivery-core.js`：店（`STORE_LATLNG`）からの直線距離（haversine）× 1.3 を道のりの目安にし、区分の境目 ±1km は「お届けの前に確定」と出す。表に無い番号・50km 超は要相談。送料無料の商品は 50km 以内なら 0 円。
- 郵便番号 → 緯度経度の表 `data/postal/<上3桁>.json`（`{ "8611112": [32.8872, 130.7891] }`）は生成物。熊本・福岡・大分・佐賀・長崎・宮崎・鹿児島の郵便番号のうち、店から直線 60km 以内だけを入れている。
- 作り直し（郵便番号の改定時など）：
  ```sh
  pip download posuto --no-deps -d /tmp/posuto && (cd /tmp/posuto && unzip -o -q posuto-*.whl)
  node tools/build-postal.mjs --db /tmp/posuto/posuto/postaldata.db --cache /tmp/geolonia
  npm test
  ```
- 突合：町域名が一致する行（小字なしを優先）→ 町域名で始まる行（丁目違い）の平均 → 市区町村の平均座標。海を挟む地域（島原・天草など）は直線距離が道のりより大きく短くなるため、区分は目安。
- **出典・ライセンス**
  - 郵便番号 → 住所：日本郵便「郵便番号データ」（Python パッケージ [posuto](https://pypi.org/project/posuto/) に同梱の SQLite を使用）
  - 町域 → 緯度経度：[Geolonia 住所データ（japanese-addresses）](https://github.com/geolonia/japanese-addresses)（CC BY 4.0）。座標は小数4桁に丸めて加工しています。
- 計算のたびに、郵便番号・区分・日時だけを GAS に送ってシート「配送料ログ」に残す（名前は送らない。1つのタブで1回だけ）。

## 写真の置き方
`assets/items/<品目>-<番号>.webp`（例 `fridge-01.webp`）。`data/results.json` の `photo` で参照する。人の顔・名前・住所が写った写真は使わない。詳しくは `assets/items/README.md`。

## AI エージェント向け（段階1：読める）
- 各ページに JSON-LD（`LocalBusiness`・`Service`、流れページに `FAQPage`、料金ページに `OfferCatalog`）。
- `llms.txt` に要約・データの場所・概算の式・`action=quote` の使い方・注意。
- `data/*.json` は公開のまま。
