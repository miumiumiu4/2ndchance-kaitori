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
| `privacy/` | 個人情報の取扱い（**仮**。オーナー確定前） |
| `404.html` | 見つからないページ |
| `css/site.css` | 見た目（モバイル優先・文字大きめ・コントラスト 4.5 以上） |
| `js/config.js` | 設定 1か所（サイト名・URL・LINE・電話・GAS・営業時間） |
| `js/quote-core.js` | 概算の式（純粋関数）。画面・GAS・AI 向け API が同じ式を使う |
| `js/form.js` | フォームの画面（入力→確認→送信→受付番号）。フォームが見えたら固定バーの上段に概算パネル |
| `js/estimate-text.js` | 概算の金額の言い方（純粋関数）。概算の箱と固定バーの概算パネルが同じ文字列を使う |
| `data/*.json` | 価格表・品目・エリア・FAQ・実績（公開。個人情報は入れない） |
| `assets/icons/` | 品目9つ＋トラック4サイズの線画アイコン（仮置き） |
| `assets/items/` | 写真の置き場（`assets/items/README.md`） |
| `gas/` | フォームの受け口（Apps Script）。`gas/README.md` |
| `llms.txt`・`sitemap.xml`・`robots.txt` | AI・検索向け（build が生成） |
| `tools/build.mjs` | 組み立て。`<!--build:名前-->` の差し込み、生成ファイルの作成 |
| `tools/screens.mjs` | 画面の確認（Playwright があるときだけ。`screens/` に撮影） |
| `tests/` | `npm test`（式・生成物が最新か・data の妥当性・秘密 grep・相対リンク） |

## 毎回の作業
```sh
node tools/build.mjs   # data や config、ページの差し込み口を変えたら必ず
npm test               # 全部緑になってからコミット
```
ページ内の `<!--build:…-->` 〜 `<!--/build:…-->` の間は build が書き換えるので、手で直さない（直すのは `tools/build.mjs` か `data/`）。

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
| `HOURS` | 人向けの受付時間 | 「準備中」 |
| `OPENING_HOURS_SPEC` | 任意。schema.org の形（例の形 `Mo-Sa 09:00-18:00`） | JSON-LD から省略 |
| `OPENING_NOTE` | 上部のお知らせ帯 | 帯を出さない |

**電話・LINE・GAS の URL はリポジトリに書かない**（`tests/secret-grep.mjs` が止める）。GitHub の Settings → Secrets and variables → Actions → **Variables** に `CFG_SITE_URL`・`CFG_LINE_URL`・`CFG_TEL`・`CFG_GAS_URL`・`CFG_HOURS`・`CFG_OPENING_HOURS_SPEC`・`CFG_OPENING_NOTE` として入れると、公開のときに `node tools/build.mjs --out _site` が公開用の写しにだけ差し込む。

### 2. `data/prices.json`
- 金額は共同代表が決めたものだけ入れる。`null` の間は画面・料金表・AI 向けが「要相談」と出す。
- 今は**仮の一般的な金額**（2026-11-07 オーナー指示）。`provisional: true` のあいだ、料金ページ・トップの料金要約・フォームの概算の上に「仮の目安（調整中）」の帯と `provisional_note` を出し、llms.txt・JSON-LD・概算 API の返り値にも仮の旨が載る。正式な金額が来たら値を差し替え、`provisional` を `false` にする（帯は自動で消える）。
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

## 写真の置き方
`assets/items/<品目>-<番号>.webp`（例 `fridge-01.webp`）。`data/results.json` の `photo` で参照する。人の顔・名前・住所が写った写真は使わない。詳しくは `assets/items/README.md`。

## AI エージェント向け（段階1：読める）
- 各ページに JSON-LD（`LocalBusiness`・`Service`、流れページに `FAQPage`、料金ページに `OfferCatalog`）。
- `llms.txt` に要約・データの場所・概算の式・`action=quote` の使い方・注意。
- `data/*.json` は公開のまま。
