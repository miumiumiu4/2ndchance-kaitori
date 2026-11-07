# GAS 受け口（gas/）のデプロイ手順

フォームの送信先です。デプロイは人が行います（Apps Script のエディタでコードを書かない。コードは必ずこのリポジトリで直す）。

## ファイル
| ファイル | 中身 | 直し方 |
|---|---|---|
| `Code.gs` | `doPost`（受付）・`doGet`（`action=quote`／`action=prices`） | このリポジトリで直す |
| `QuoteCore.gs` | 概算の式。`js/quote-core.js` から自動生成 | `node tools/build.mjs`（手で直さない） |
| `Prices.gs` | 価格表。`data/prices.json` から自動生成 | `node tools/build.mjs`（手で直さない） |

## 初回の手順
1. 受付用の Google スプレッドシートを新しく作る（シート「受付」は最初の受付で自動で作られる）。
2. Apps Script のプロジェクトを新しく作り、`Code.gs`・`QuoteCore.gs`・`Prices.gs` の3つを同じ名前で置く（clasp を使う場合は `.clasp.json` をコミットしない）。
3. 「プロジェクトの設定」→「スクリプト プロパティ」に次を入れる。**値はこのリポジトリ・Issue・PR に書かない。**

   | プロパティ名 | 中身 | 必須 |
   |---|---|---|
   | `SHEET_ID` | 受付用スプレッドシートの ID | 必須 |
   | `OWNER_EMAIL` | 受付の通知を受け取るアドレス（共同代表） | 必須 |
   | `SITE_NAME` | メールの差出人名（既定 `2nd chance recycle`） | 任意 |
   | `MAX_PER_DAY` | 1日の受付上限（既定 50） | 任意 |

   `SEQ_DATE`・`SEQ_N` は受付番号の連番用に自動で作られる（手で入れない）。
4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」。
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**
5. 初回だけ許可画面（スプレッドシート・メール送信）が出るので、オーナーのアカウントで許可する。
6. 出てきたウェブアプリの URL（`/exec` で終わる）を、GitHub の Actions Variables `CFG_GAS_URL` に入れる（README「設定手順」）。リポジトリの `js/config.js` には書かない。

## 更新の手順
- 価格表（`data/prices.json`）や式（`js/quote-core.js`）を変えたら、`node tools/build.mjs` で `QuoteCore.gs`・`Prices.gs` を作り直し、Apps Script に反映する。
- 反映は「デプロイを管理」→ 今のデプロイを編集 →「新バージョン」。**新しいデプロイを作らない**（URL が変わり、フォームが送れなくなる）。
- 画面と受付で価格表の版がずれると、シートの「照合」列が「差あり」になる。`data/prices.json` の `updated` を変えたら、必ず GAS 側も更新する。

## 動作確認
- `<URL>?action=prices` で価格表の JSON が返る。
- `<URL>?action=quote&form=A&items=fridge:2:within:good` で概算の JSON が返る（金額が null の間は `undetermined: true`）。
- 送信の試験は、試験用のスプレッドシートとアドレスを入れたプロパティで行う（本番のシートを汚さない）。
