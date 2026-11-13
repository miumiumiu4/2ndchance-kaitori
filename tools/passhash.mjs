#!/usr/bin/env node
// 管理画面のパスコード → スクリプト プロパティ ADMIN_PASS_HASH に入れる値（SHA-256 の16進64桁）。
//   node tools/passhash.mjs            … パスコードを2回たずねる（画面に文字は出ない）
//   printf '%s' 'パスコード' | node tools/passhash.mjs --stdin
// 出てきた値は GAS のスクリプト プロパティにだけ貼る。パスコードもハッシュもリポジトリ・Issue・チャットに書かない。
// 計算は GAS と同じ：sha256(ADMIN_PASS_PREFIX + パスコード)（js/admin-core.js）。
import { createHash } from "node:crypto";
import readline from "node:readline";
import { ADMIN_PASS_PREFIX } from "../js/admin-core.js";

export function passHash(pass) {
  return createHash("sha256").update(ADMIN_PASS_PREFIX + pass, "utf8").digest("hex");
}

function ask(q) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); ok(a); });
  });
}

async function main() {
  let pass;
  if (process.argv.includes("--stdin") || !process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    pass = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  } else {
    pass = await ask("新しいパスコード（10文字以上）：");
    const again = await ask("もう一度：");
    if (pass !== again) { console.error("2回の入力が違います。やり直してください。"); process.exit(1); }
  }
  if (pass.length < 10) { console.error("パスコードは10文字以上にしてください（英数字・記号を混ぜると安全）。"); process.exit(1); }
  console.log(passHash(pass));
  console.error("↑ この64桁を Apps Script の「プロジェクトの設定」→「スクリプト プロパティ」の ADMIN_PASS_HASH に貼ってください（ほかの所には書かない）。");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
