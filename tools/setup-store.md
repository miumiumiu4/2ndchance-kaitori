# 新しい店を出す手順（量産の型）

例え話：このリポジトリは「たい焼きの型」、聞き取りの答え（`stores/<店>/answers.json`）は「あんこ」。型は変えず、あんこだけ替えて焼く。
目安は1店2時間（合格ライン。作戦メモ「進め方」1）。秘密（合言葉・トークン・シート ID・デプロイ ID・メール）はリポジトリ・Issue・PR・チャットに書かない。

## 0. 聞き取り（20分）
- 作戦メモの質問票 Q1〜Q12 を聞き、`stores/answers.template.json` を `stores/<店の id>/answers.json` に写して埋める。書き方の見本は `stores/example/answers.json`（架空の店）。
- 店の位置（`latlng`）は Googleマップで店を長押しすると出る2つの数字。
- 電話は看板・チラシに出している店の代表番号だけ。LINE の URL は書かない（4. で Actions Variables へ）。
- `node tools/new-store.mjs stores/<id>/answers.json --check` で形を確かめる。「あとで聞くこと」が出たら店主に聞き足す。

## 1. 店のサイト一式を作る（1分）
```sh
node tools/new-store.mjs stores/<id>/answers.json --out ~/claude/shops/<id>
```
- 型を写し、`data/store.json`（店の名札）・`site.json`・`areas.json`・`prices.json`・`items.json`・`faq.json`・`results.json`・`shop.json` を書き、build と test まで走らせる。
- 答えの無い金額は「要相談」で出る。見本の店（2nd chance recycle）の金額・写真・記事・商品は持ち込まない。
- 店主の「他店に負けない3点」から、記事の下書き `content/posts/<日付>-erabareru-riyuu.md`（`status: draft`）ができる。店主の言葉で書き足してから `scheduled` に。
- 見本の店の実物に頼る試験（記事・商品・郵便番号表など5件）は、量産した店では飛ばす（`tests/origin.mjs`）。

## 2. リポジトリと公開（10分・置き場所は docs/multi-store.md）
1. GitHub に店のリポジトリを作る（例 `<owner>/<id>`）。`stores/<id>/answers.json` の `repo` に入れて 1. をやり直すか、`data/store.json` の `repo` を直して `node tools/build.mjs`。
2. `git init && git add -A && git commit -m "初版" && git push`。
3. 公開先を設定（GitHub Pages なら Settings → Pages → Source: GitHub Actions。商用の店は docs/multi-store.md の注意を先に読む）。
4. Actions Variables：`CFG_SITE_URL`（公開URL）・`CFG_LINE_URL`・`CFG_TEL`（任意。store.json より優先）。

## 3. 受け口（Apps Script＋スプレッドシート＋管理画面・15分）
受付データは**店の Google アカウント**に置く（作戦メモの仮置き。こちらが個人情報を預からない）。Mac で、そのアカウントで `clasp login` してから：
```sh
tools/setup-store.sh ~/claude/shops/<id>            # プロジェクトを作ってコードを入れる
# → 表示に従って、エディタで setupStore を1回実行（シートができる）、OWNER_EMAIL などを入れる
tools/setup-store.sh ~/claude/shops/<id> --deploy   # ウェブアプリとして出す（2回目からは同じ URL のまま新しい版）
```
- `gas/Setup.gs` の `setupStore` は何度押しても同じ結果（入っている値は上書きしない。値はログに出さない）。
- 管理画面のパスコードは店主が自分で決め、`node tools/passhash.mjs` のハッシュだけを `ADMIN_PASS_HASH` に入れる（合言葉を口で伝えない）。
- GitHub のトークンは店のリポジトリ1つだけ・Contents 読み書きだけ・期限1年。
- `gh` があれば `CFG_GAS_URL` も自動で入る。無ければ表示の手順で人が貼る。

## 4. 確かめ（10分）
- 公開URLを開き、トップの店名・地域・電話・フッターを見る。
- 概算フォームから試しに1件送る（試験用の名前で）→ 店のシートに1行、通知メールが届く → その行を消す。
- `/admin/` でログイン → 「変更はありません」まで。

## まだ型になっていない所（宿題）
- パスコードの前置き（`js/admin-core.js` の `ADMIN_PASS_PREFIX`）は全店共通。店ごとのパスコードとハッシュは別なので、今は困らない。
- 配送料の郵便番号表（`data/postal/`）は見本の店の周り。販売する店（Q12 あり）は `tools/build-postal.mjs --prefs <県>` で作り直す。
- ページの文章の大部分（トップの説明・流れなど）は全店共通。検索で「写し」と見なされないよう、店の言葉（記事・FAQ・選ばれる理由）を足していく。
- 色・ロゴは全店同じ（`css/site.css`）。

## できるようになったこと（型の切り替え）
- 管理画面のログインで選ぶ名前：`data/store.json` の `admin_roles`（答えの `admin_roles`。既定は「店主」「運営」）。
- ネット販売をしない店（Q12 なし）：`data/store.json` の `shop: false` で、販売ページ・商品ページ・ナビ・トップの節・配送料の表・sitemap・llms.txt の販売を出さない。
- 手書きの文の中の店の言葉：`<!--build:t:{town}から{radius}km圏内へ伺います。-->…<!--/build:t-->`（文ごとに作り直す。字詰めが変わらない）。
