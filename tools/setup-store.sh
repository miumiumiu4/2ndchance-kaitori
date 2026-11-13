#!/usr/bin/env bash
# 店ごとの受け口（Apps Script）を作って出す。Mac で、受付データを持つ Google アカウントで clasp login 済みの状態で動かす。
#   tools/setup-store.sh <店のフォルダ>            … 1回目：プロジェクトを作る → コードを入れる → 次にやることを表示
#   tools/setup-store.sh <店のフォルダ> --deploy   … プロパティを入れた後：ウェブアプリとして出し、URL を表示（gh があれば CFG_GAS_URL に入れる）
# 値（スクリプト ID・デプロイ ID・シート ID・メール・合言葉）はリポジトリにもチャットにも書かない。
# スクリプト ID は gas/.clasp.json（.gitignore 済み）、デプロイ ID は ~/.config/recycle-hp/<店の id>.deploy（0600）にだけ置く。
set -euo pipefail
DIR="${1:?店のフォルダを指定してください（tools/new-store.mjs の --out）}"
MODE="${2:-}"
cd "$DIR"
command -v clasp >/dev/null || { echo "clasp がありません：npm i -g @google/clasp && clasp login"; exit 2; }
ID="$(node -p 'require("./data/store.json").id')"
NAME="$(node -p 'require("./data/store.json").name')"
REPO="$(node -p 'require("./data/store.json").repo || ""')"
node tools/build.mjs >/dev/null   # gas/Store.gs・Prices.gs などを最新に
STATE_DIR="$HOME/.config/recycle-hp"; mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
DEPLOY_FILE="$STATE_DIR/$ID.deploy"

cd gas
if [ "$MODE" != "--deploy" ]; then
  if [ -f .clasp.json ]; then
    echo "このお店の Apps Script はもうあります。中身の差を見てから入れます（clasp pull はしない。正はこのフォルダ）。"
    clasp push
  else
    clasp create --type standalone --title "$NAME 受付" --rootDir .
    clasp push -f   # 作ったばかりの空のプロジェクトなので上書きしてよい
  fi
  cat <<MSG

次にやること（人の手で、3分）：
  1. clasp open でエディタを開き、関数「setupStore」を選んで ▶ 実行（許可画面が出たら、このアカウントで許可）
     → 受付用のスプレッドシートが作られ、足りない設定の名前がログに出る
  2. プロジェクトの設定 → スクリプト プロパティ に OWNER_EMAIL（受付の通知先）を入れる
     管理画面を使うなら ADMIN_PASS_HASH（node tools/passhash.mjs の結果）と ADMIN_GITHUB_TOKEN（${REPO:-店のリポジトリ} だけ・Contents 読み書き）も
  3. もう一度 setupStore を実行して「そろっています」を確かめる
  4. tools/setup-store.sh $DIR --deploy
MSG
  exit 0
fi

# --deploy：1回目は新しいデプロイ、2回目からは同じデプロイ ID に新しい版（URL を変えない）
clasp push
if [ -f "$DEPLOY_FILE" ]; then
  DEP="$(cat "$DEPLOY_FILE")"
  clasp deploy -i "$DEP" --description "$(date +%Y-%m-%d) 更新" >/dev/null
  echo "同じデプロイに新しい版を出しました（URL は変わりません）。"
else
  OUT="$(clasp deploy --description "$(date +%Y-%m-%d) 初回")"
  DEP="$(printf '%s\n' "$OUT" | grep -oE 'AKfyc[A-Za-z0-9_-]+' | head -1)"
  [ -n "$DEP" ] || { echo "デプロイ ID が読めませんでした。clasp deployments で確かめてください"; exit 1; }
  umask 077; printf '%s' "$DEP" > "$DEPLOY_FILE"
  echo "ウェブアプリとして出しました（デプロイ ID は $DEPLOY_FILE にだけ保存）。"
fi
URL="https://script.google.com/macros/s/$DEP/exec"
if command -v gh >/dev/null && [ -n "$REPO" ]; then
  gh variable set CFG_GAS_URL --repo "$REPO" --body "$URL" && echo "GitHub の Actions Variables CFG_GAS_URL に入れました（$REPO）。"
else
  echo "GitHub の $REPO → Settings → Secrets and variables → Actions → Variables に CFG_GAS_URL を作り、次の URL を貼ってください（チャットに貼らない）："
  echo "$URL"
fi
