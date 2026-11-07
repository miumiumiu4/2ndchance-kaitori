// 概算フォーム（A 出張買取／B 不用品回収／C 片付け）の画面側。計算は quote-core.js に任せる。
// 入力 → 確認画面 → 送信 → 受付番号。GAS_URL が空なら送信ボタンは「準備中」で押せず、入力と概算は画面に残す。
import { CONFIG } from "./config.js";
import * as Q from "./quote-core.js";
import { yen, fmtRange, estimateValueText, stickyEstimate } from "./estimate-text.js";

const FORM_NAMES = { A: "出張買取", B: "不用品回収", C: "片付け（遺品整理・生前整理など）" };
const YEAR_LABELS = { within: "目安年数以内", over: "目安年数を超えている", unknown: "わからない" };
const COND_LABELS = { good: "良い（きれい・不具合なし）", normal: "普通（使用感あり）", damaged: "難あり（傷・汚れ・不具合）" };
const TIME_SLOTS = ["午前（9時〜12時）", "午後（12時〜15時）", "夕方（15時〜18時）", "時間はいつでもよい"];
const PAYMENTS = [
  { id: "cash", label: "現金" },
  { id: "paypay", label: "PayPay" },
  { id: "invoice", label: "請求リンク（後日 LINE かメールでお送りします）" }
];
const OPTIONS_FOR = {
  B: { priced: ["stairs", "dismantle", "aircon_removal"], consult: ["sorting"] },
  C: { priced: ["stairs", "dismantle", "aircon_removal"], consult: ["kuyou", "house_cleaning", "fudosan"] }
};

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => typeof v === "number" && isFinite(v);
const toHalf = (s) => String(s || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const toKata = (s) => String(s || "").replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// 希望日は明後日以降（日本時間）
function minDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

const root = document.querySelector("[data-quote-root]");
if (root) init(root).catch((e) => {
  root.innerHTML = '<p class="callout">フォームを読み込めませんでした。お手数ですが LINE か電話でご相談ください。</p>';
  console.error(e);
});

async function init(root) {
  const base = root.dataset.base || "./";
  const forms = root.dataset.forms === "BC" ? ["B", "C"] : ["A"];
  const [prices, itemsData] = await Promise.all([getJSON(base + "data/prices.json"), getJSON(base + "data/items.json")]);
  const iconOf = {};
  itemsData.items.forEach((it) => { iconOf[it.id] = it.icon; });
  const optDef = (id) => (prices.options || []).find((o) => o.id === id);

  const params = new URLSearchParams(location.search);
  const st = {
    form: forms.includes("C") && location.hash === "#form-c" ? "C" : forms[0],
    items: {},
    tier: "",
    layout: "",
    kind: Object.prototype.hasOwnProperty.call(Q.CLEANUP_KINDS, params.get("kind")) ? params.get("kind") : "ihin",
    options: {}
  };
  (prices.buyback_items || []).forEach((b) => { st.items[b.id] = { qty: 0, year: "unknown", condition: "normal" }; });

  // ---------- 入力 → 計算 ----------
  function currentInput() {
    const items = Object.keys(st.items).filter((id) => st.items[id].qty > 0).map((id) => ({ id, qty: st.items[id].qty, year: st.items[id].year, condition: st.items[id].condition }));
    const input = { form: st.form, items };
    if (st.form !== "A") {
      const allow = OPTIONS_FOR[st.form];
      input.options = Object.keys(st.options).filter((id) => st.options[id] > 0 && (allow.priced.includes(id) || allow.consult.includes(id))).map((id) => ({ id, qty: st.options[id] }));
    }
    if (st.form === "B") input.tier = st.tier || null;
    if (st.form === "C") { input.layout = st.layout || null; input.kind = st.kind; }
    return input;
  }
  const calc = () => Q.quoteFromInput(currentInput(), prices);

  // ---------- 部品 ----------
  function stepper(key, label, qty) {
    return `<div class="stepper"><button type="button" data-step="${key}" data-d="-1" aria-label="${esc(label)}を1つ減らす"${qty <= 0 ? " disabled" : ""}>−</button><output data-out="${key}" aria-live="polite">${qty}</output><button type="button" data-step="${key}" data-d="1" aria-label="${esc(label)}を1つ増やす"${qty >= Q.MAX_QTY ? " disabled" : ""}>＋</button></div>`;
  }
  function itemRows() {
    return (prices.buyback_items || []).map((b) => {
      const s = st.items[b.id];
      const sub = isNum(b.year_limit) ? `製造からおおむね${b.year_limit}年以内が目安` : "年式の目安は確認中";
      const price = isNum(b.max_price) ? `最大 ¥${b.max_price.toLocaleString("ja-JP")}` : "要相談";
      const yearOpts = Object.keys(YEAR_LABELS).map((k) => `<option value="${k}"${s.year === k ? " selected" : ""}>${YEAR_LABELS[k]}</option>`).join("");
      const condOpts = Object.keys(COND_LABELS).map((k) => `<option value="${k}"${s.condition === k ? " selected" : ""}>${COND_LABELS[k]}</option>`).join("");
      return `<div class="qrow" data-item="${b.id}">
<div class="qrow-head"><img src="${base}assets/icons/${esc(iconOf[b.id] || "truck-small.svg")}" alt="" width="48" height="48"><div><b>${esc(b.name)}</b><span>${price}｜${sub}</span></div>${stepper("item:" + b.id, b.name, s.qty)}</div>
<div class="qrow-sub"${s.qty > 0 ? "" : " hidden"}>
<div><label for="y-${b.id}">年式</label><select id="y-${b.id}" data-item-year="${b.id}">${yearOpts}</select></div>
<div><label for="c-${b.id}">状態</label><select id="c-${b.id}" data-item-cond="${b.id}">${condOpts}</select></div>
</div></div>`;
    }).join("");
  }
  function optionRows(form) {
    const allow = OPTIONS_FOR[form];
    const priced = allow.priced.map((id) => {
      const d = optDef(id);
      if (!d) return "";
      const q = st.options[id] || 0;
      return `<div class="qrow"><div class="qrow-head" style="grid-template-columns:1fr auto"><div><b>${esc(d.name)}</b><span>${isNum(d.price) ? "¥" + d.price.toLocaleString("ja-JP") + "／" + esc(d.unit) : "要相談"}</span></div>${stepper("opt:" + id, d.name, q)}</div></div>`;
    }).join("");
    const consult = allow.consult.map((id) => `<label class="choice"><input type="checkbox" data-consult="${id}"${st.options[id] ? " checked" : ""}><div><b>${esc(Q.CONSULT_OPTIONS[id])}</b><span>料金は担当者から別途ご案内</span></div></label>`).join("");
    return `<fieldset><legend>オプション（任意）</legend>${priced}<div class="choices" style="margin-top:10px">${consult}</div></fieldset>`;
  }
  function buybackBlock() {
    const any = Object.keys(st.items).some((id) => st.items[id].qty > 0);
    return `<details class="card"${any ? " open" : ""} style="margin-bottom:18px"><summary style="cursor:pointer;font-weight:900">買い取れそうな物もあれば選ぶ（任意）</summary>
<p class="hint">選んだ物の買取見込み額を、費用から差し引いて表示します。</p>${itemRows()}</details>`;
  }
  function panelHTML() {
    if (st.form === "A") {
      return `<fieldset><legend>1. 売りたい物を選ぶ</legend><p class="hint">台数を「＋」で増やすと、年式と状態を選べます。製造年は本体のシールで確認できます。</p>${itemRows()}</fieldset>`;
    }
    if (st.form === "B") {
      const tiers = (prices.collection_tiers || []).map((t) => `<label class="choice"><input type="radio" name="tier" value="${t.id}"${st.tier === t.id ? " checked" : ""}><img src="${base}assets/icons/truck-${esc(t.id)}.svg" alt="" width="44" height="44"><div><b>${esc(Q.tierName(t))}</b><span>${esc(t.note || "")}｜${isNum(t.price_from) ? "¥" + t.price_from.toLocaleString("ja-JP") + "〜" : "要相談"}</span></div></label>`).join("");
      return `<fieldset><legend>1. 回収する量を選ぶ <span class="req">必須</span></legend><div class="choices" data-group="tier">${tiers}</div></fieldset>${optionRows("B")}${buybackBlock()}`;
    }
    const kinds = Object.keys(Q.CLEANUP_KINDS).map((k) => `<label class="choice"><input type="radio" name="kind" value="${k}"${st.kind === k ? " checked" : ""}><div><b>${esc(Q.CLEANUP_KINDS[k])}</b></div></label>`).join("");
    const layouts = (prices.cleanup_by_layout || []).map((r) => `<label class="choice"><input type="radio" name="layout" value="${esc(r.layout)}"${st.layout === r.layout ? " checked" : ""}><div><b>${esc(r.layout)}</b><span>${Q.hoursText(r.hours) ? "作業 " + esc(Q.hoursText(r.hours)) : "作業時間は確認中"}｜${isNum(r.price_from) ? "¥" + r.price_from.toLocaleString("ja-JP") + "〜" : "要相談"}</span></div></label>`).join("");
    const inc = (prices.cleanup_includes || []).map((s) => `<li>${esc(s)}</li>`).join("");
    return `<fieldset><legend>1. 片付けの種類</legend><div class="choices">${kinds}</div></fieldset>
<fieldset><legend>2. 間取りを選ぶ <span class="req">必須</span></legend><div class="choices" data-group="layout">${layouts}</div>
<p class="hint" style="margin-top:8px">料金に含まれるもの：</p><ul class="check" style="font-size:.95rem">${inc}</ul></fieldset>
${optionRows("C")}${buybackBlock()}`;
  }

  // 仮の金額（prices.provisional）のあいだ、概算の上に出す帯
  const band = prices.provisional
    ? `<div class="provisional-band" role="note"><b>仮の目安（調整中）</b><span>${esc(prices.provisional_note || "現在の金額は仮の目安です。")}</span></div>`
    : "";

  // B は量・C は間取りを選んだか（A は品目の有無を r から見る）
  const chosenNow = () => (st.form === "B" ? !!st.tier : st.form === "C" ? !!st.layout : true);
  function estimateHTML(r) {
    return band + estimateBody(r);
  }
  function estimateBody(r) {
    const bb = st.form === "A" ? r.buyback : r.buyback_detail;
    const hasItems = bb.lines.length > 0;
    const lines = bb.lines.map((l) => `<li>${esc(l.name)} ×${l.qty}（${YEAR_LABELS[l.year]}・${esc((COND_LABELS[l.condition] || "").replace(/（.*/, ""))}）：${l.undetermined ? "要相談" : l.year === "over" ? "0円（回収扱い）" : "最大 " + yen(l.max)}${l.note && !l.undetermined && l.year !== "over" ? "　※" + esc(l.note) : ""}</li>`).join("");
    const und = '<p class="est-break">金額が決まるまで「要相談」と表示しています。LINEで写真を送っていただければ目安をお伝えします。</p>';
    if (st.form === "A") {
      const val = estimateValueText("A", r);
      return `<div class="est-row"><span class="est-label">買取見込み（目安）</span><span class="est-value" data-est-value>${val}</span><span class="est-note">買取見込み額は目安。最終額は訪問査定で確定します</span></div>
${hasItems ? `<ul>${lines}</ul>` : ""}${hasItems && r.undetermined ? und : ""}${bb.lines.some((l) => l.year === "over") ? '<p class="est-break">年式の目安を超えた家電は買取ではなく回収扱いです。回収費用は<a href="../kataduke/#form-b">不用品回収</a>でご確認ください。</p>' : ""}`;
    }
    const chosen = chosenNow();
    const val = estimateValueText(st.form, r, chosen);
    const cost = r.cost.undetermined ? "要相談" : yen(r.cost.amount) + "〜";
    const bbText = !hasItems ? "¥0" : bb.undetermined ? "要相談" : bb.max === 0 ? "¥0" : "¥0〜" + yen(bb.max).slice(1);
    const opLines = r.lines.filter((l) => l.consult || l.unit !== undefined).map((l) => `<li>${esc(l.name)}${l.qty > 1 ? " ×" + l.qty : ""}：${l.consult ? "別途ご案内" : l.undetermined ? "要相談" : yen(l.amount)}</li>`).join("");
    const hours = st.form === "C" && r.layout ? `<p class="est-break">作業時間の目安：${esc(Q.hoursText(r.hours) || "確認中")}</p>` : "";
    return `<div class="est-row"><span class="est-label">お会計の目安</span><span class="est-value" data-est-value>${val}</span><span class="est-note">${esc(Q.OFFSET_NOTE)}</span></div>
<p class="est-break"><b>${st.form === "B" ? "回収費用" : "片付け費用"} ${cost}</b> − <b>買取見込み ${bbText}</b> ＝ お会計</p>${hours}
${opLines ? `<ul>${opLines}</ul>` : ""}${hasItems ? `<ul>${lines}</ul>` : ""}${chosen && r.undetermined ? und : ""}`;
  }

  // ---------- 画面の骨組み ----------
  const min = minDate();
  const dateBlock = (n) => `<div class="card" style="margin-top:10px"><label class="f" for="date${n}" style="margin-top:0">第${n}希望${n === 1 ? ' <span class="req">必須</span>' : ' <span class="opt">任意</span>'}</label>
<div class="grid-2"><input type="date" id="date${n}" name="date${n}" min="${min}"${n === 1 ? " required" : ""}><select name="time${n}" aria-label="第${n}希望の時間帯">${TIME_SLOTS.map((t) => `<option>${t}</option>`).join("")}</select></div></div>`;
  const tabs = forms.length > 1
    ? `<div class="tabs" role="tablist" aria-label="フォームの種類">${forms.map((f) => `<button type="button" role="tab" id="tab-${f}" aria-controls="q-panel" aria-selected="${st.form === f}" tabindex="${st.form === f ? 0 : -1}" data-tab="${f}">${f === "B" ? "不用品回収" : "片付け<br><small>遺品整理・生前整理など</small>"}</button>`).join("")}</div>`
    : "";
  root.innerHTML = `${tabs}
<form class="qform" novalidate>
<div id="q-panel"${forms.length > 1 ? ` role="tabpanel" aria-labelledby="tab-${st.form}"` : ""}></div>
<div class="estimate" id="q-est" aria-live="polite"></div>
<fieldset><legend>お客様の情報</legend>
<label class="f" for="f-name">お名前（カナ）<span class="req">必須</span></label>
<input type="text" id="f-name" name="name_kana" autocomplete="name" placeholder="例：ヤマダ ハナコ">
<p class="hint">カタカナで。ひらがなで入れると自動でカタカナにします。</p>
<label class="f" for="f-tel">電話番号<span class="req">必須</span></label>
<input type="tel" id="f-tel" name="tel" autocomplete="tel" inputmode="tel">
<p class="hint">日時の相談のため、こちらからお電話します。</p>
<label class="f" for="f-email">メールアドレス<span class="opt">任意</span></label>
<input type="email" id="f-email" name="email" autocomplete="email" inputmode="email">
<p class="hint">入れると、受付番号つきの確認メールが届きます。</p>
<label class="f" for="f-zip">郵便番号<span class="opt">任意</span></label>
<input type="text" id="f-zip" name="zip" autocomplete="postal-code" inputmode="numeric" style="max-width:12em">
<label class="f" for="f-addr">ご住所<span class="req">必須</span></label>
<input type="text" id="f-addr" name="address" autocomplete="street-address">
<p class="hint">伺う場所の住所。建物名・部屋番号もお願いします。</p>
</fieldset>
<fieldset><legend>ご希望の日時</legend>
<p class="hint">明後日（${min.replace(/-/g, "/")}）以降でお選びください。お電話で相談して決めます。</p>
${dateBlock(1)}${dateBlock(2)}${dateBlock(3)}
</fieldset>
<fieldset><legend>写真<span class="opt">任意</span></legend>
<label class="f" for="f-photos" style="margin-top:0">品物やお部屋の写真</label>
<input type="file" id="f-photos" name="photos" accept="image/*" multiple>
<p class="hint" id="f-photos-info">このフォームで送るのはファイル名と枚数だけです。<b>写真そのものは LINE で送ってください。</b></p>
</fieldset>
<fieldset><legend>費用が出た場合のお支払い方法</legend>
<div class="choices">${PAYMENTS.map((p, i) => `<label class="choice"><input type="radio" name="payment" value="${p.id}"${i === 0 ? " checked" : ""}><div><b>${esc(p.label)}</b></div></label>`).join("")}</div>
<p class="hint">買取代金のお受け取りは、その場で現金が基本です（方針確認中）。</p>
</fieldset>
<label class="f" for="f-note">ご要望・伝えたいこと<span class="opt">任意</span></label>
<textarea id="f-note" name="note" placeholder="例：2階から降ろしたい、駐車場がない、平日の夕方が都合がよい など"></textarea>
<div class="hp" aria-hidden="true"><label>空欄のままにしてください<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="choice" style="margin-top:16px" for="f-consent"><input type="checkbox" id="f-consent" name="consent"><div><b><a href="${base}privacy/" target="_blank" rel="noopener">個人情報の取扱い</a>に同意します</b><span>必須</span></div></label>
<div class="err-summary" id="q-errs" role="alert" hidden></div>
<button type="submit" class="btn btn-form btn-block" style="margin-top:16px">入力内容を確認する</button>
</form>
<div class="confirm card" id="q-confirm" hidden></div>
<div id="q-done" hidden></div>`;

  // ---------- 固定バーの概算パネル ----------
  // フォームが画面に入ったら固定バーの上段に「買取見込み／お会計の目安：金額（仮の目安）」を1行で出す。
  // タップで概算の箱（内訳）へ。確認画面・受付後も金額は残す。
  function setupSticky() {
    const bar = document.querySelector(".cta-bar");
    if (!bar) return { update() {} };
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cta-est";
    btn.id = "cta-est";
    btn.hidden = true;
    btn.setAttribute("aria-controls", "q-est");
    btn.innerHTML = '<span class="cta-est-label" data-sticky-label></span><span class="cta-est-value" data-sticky-value></span><span class="cta-est-prov" data-sticky-prov hidden>（仮の目安）</span>';
    bar.insertBefore(btn, bar.firstChild);
    document.body.classList.add("has-cta-est");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    btn.addEventListener("click", () => {
      // 入力中は概算の箱、確認画面・受付後はそれぞれの箱へ
      const target = [root.querySelector("#q-done"), root.querySelector("#q-confirm"), root.querySelector("#q-est")].find((x) => x && !x.hidden && !(x.closest("form") || {}).hidden) || root;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    if ("IntersectionObserver" in window) {
      // フォームが見え始めたら出す。フォームより下（フッターなど）までスクロールしても出したままにする
      new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        btn.hidden = !(e.isIntersecting || e.boundingClientRect.bottom < 0);
      }).observe(root);
    } else btn.hidden = false;
    const lbl = btn.querySelector("[data-sticky-label]");
    const val = btn.querySelector("[data-sticky-value]");
    const prov = btn.querySelector("[data-sticky-prov]");
    return {
      update(s) {
        lbl.textContent = s.label + "：";
        val.textContent = s.value;
        prov.hidden = !s.provisional;
        btn.setAttribute("aria-label", `${s.label} ${s.value}${s.provisional ? "（仮の目安）" : ""}。タップで内訳へ`);
      }
    };
  }

  const form = root.querySelector("form");
  const panel = root.querySelector("#q-panel");
  const est = root.querySelector("#q-est");
  const renderPanel = () => { panel.innerHTML = panelHTML(); };
  // 概算は1回だけ計算し、概算の箱と固定バーの概算パネルに同じ結果を渡す（二重計算のズレを作らない）
  const sticky = setupSticky();
  const renderEst = () => {
    const r = calc();
    est.innerHTML = estimateHTML(r);
    sticky.update(stickyEstimate(st.form, r, chosenNow()));
  };
  renderPanel();
  renderEst();

  // ---------- タブ ----------
  function selectTab(f, focus) {
    if (!forms.includes(f) || st.form === f) return;
    st.form = f;
    root.querySelectorAll("[role=tab]").forEach((b) => {
      const on = b.dataset.tab === f;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panel.setAttribute("aria-labelledby", "tab-" + f);
    renderPanel();
    renderEst();
  }
  root.querySelectorAll("[role=tab]").forEach((b) => {
    b.addEventListener("click", () => selectTab(b.dataset.tab, false));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = forms.indexOf(st.form);
      selectTab(forms[(i + (e.key === "ArrowRight" ? 1 : forms.length - 1)) % forms.length], true);
    });
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#form-c") selectTab("C");
    if (location.hash === "#form-b") selectTab("B");
  });

  // ---------- 入力の反映 ----------
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const [kind, id] = b.dataset.step.split(":");
    const d = Number(b.dataset.d);
    let q;
    if (kind === "item") { q = st.items[id].qty = Math.max(0, Math.min(Q.MAX_QTY, st.items[id].qty + d)); }
    else { q = st.options[id] = Math.max(0, Math.min(Q.MAX_QTY, (st.options[id] || 0) + d)); }
    const wrap = b.closest(".stepper");
    wrap.querySelector("output").textContent = q;
    wrap.querySelector('[data-d="-1"]').disabled = q <= 0;
    wrap.querySelector('[data-d="1"]').disabled = q >= Q.MAX_QTY;
    if (kind === "item") b.closest(".qrow").querySelector(".qrow-sub").hidden = q <= 0;
    renderEst();
  });
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.itemYear) st.items[t.dataset.itemYear].year = t.value;
    else if (t.dataset.itemCond) st.items[t.dataset.itemCond].condition = t.value;
    else if (t.dataset.consult) st.options[t.dataset.consult] = t.checked ? 1 : 0;
    else if (t.name === "tier") st.tier = t.value;
    else if (t.name === "layout") st.layout = t.value;
    else if (t.name === "kind") st.kind = t.value;
    else if (t.name === "photos") {
      const n = t.files ? t.files.length : 0;
      root.querySelector("#f-photos-info").innerHTML = (n ? `<b>${n}枚</b>選択中。` : "") + "このフォームで送るのはファイル名と枚数だけです。<b>写真そのものは LINE で送ってください。</b>";
      return;
    } else return;
    renderEst();
  });
  form.elements.name_kana.addEventListener("blur", (e) => { e.target.value = toKata(e.target.value).trim(); });
  form.elements.tel.addEventListener("blur", (e) => { e.target.value = toHalf(e.target.value).trim(); });
  form.elements.zip.addEventListener("blur", (e) => { e.target.value = toHalf(e.target.value).replace(/[^0-9-]/g, ""); });

  // ---------- 確かめ ----------
  function validate() {
    const errs = [];
    const el = form.elements;
    form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    const bad = (node, msg) => { errs.push({ node, msg }); if (node && node.setAttribute) node.setAttribute("aria-invalid", "true"); };
    const input = currentInput();
    if (st.form === "A" && !input.items.length) bad(panel.querySelector("[data-step]"), "売りたい物を1つ以上選んでください。");
    if (st.form === "B" && !st.tier) bad(panel.querySelector("input[name=tier]"), "回収する量を選んでください。");
    if (st.form === "C" && !st.layout) bad(panel.querySelector("input[name=layout]"), "間取りを選んでください。");
    el.name_kana.value = toKata(el.name_kana.value).trim();
    if (!el.name_kana.value) bad(el.name_kana, "お名前（カナ）を入れてください。");
    else if (!/^[゠-ヿ\s　]+$/.test(el.name_kana.value)) bad(el.name_kana, "お名前はカタカナで入れてください。");
    const tel = toHalf(el.tel.value).replace(/[^0-9]/g, "");
    if (!tel) bad(el.tel, "電話番号を入れてください。");
    else if (!/^0\d{9,10}$/.test(tel)) bad(el.tel, "電話番号の桁数を確かめてください（0から始まる10桁か11桁）。");
    const mail = el.email.value.trim();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) bad(el.email, "メールアドレスの形を確かめてください。");
    const zip = toHalf(el.zip.value).replace(/[^0-9]/g, "");
    if (zip && zip.length !== 7) bad(el.zip, "郵便番号は7桁で入れてください。");
    if (!el.address.value.trim()) bad(el.address, "ご住所を入れてください。");
    [1, 2, 3].forEach((n) => {
      const v = el["date" + n].value;
      if (n === 1 && !v) bad(el.date1, "第1希望の日付を選んでください。");
      else if (v && v < min) bad(el["date" + n], `第${n}希望は ${min.replace(/-/g, "/")} 以降にしてください。`);
    });
    if (!el.consent.checked) bad(el.consent, "個人情報の取扱いへの同意にチェックを入れてください。");
    const box = root.querySelector("#q-errs");
    if (errs.length) {
      box.hidden = false;
      box.innerHTML = "入力を確かめてください：<ul>" + errs.map((x) => `<li>${esc(x.msg)}</li>`).join("") + "</ul>";
      const first = errs[0].node;
      if (first && first.focus) { first.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => first.focus({ preventScroll: true }), 300); }
    } else box.hidden = true;
    return errs.length === 0;
  }

  // ---------- 送る中身 ----------
  function payload() {
    const el = form.elements;
    const input = currentInput();
    const files = el.photos.files ? Array.from(el.photos.files) : [];
    return {
      form: st.form,
      form_name: FORM_NAMES[st.form],
      input,
      quote: calc(),
      prices_updated: prices.updated,
      customer: {
        name_kana: el.name_kana.value.trim(),
        tel: toHalf(el.tel.value).trim(),
        email: el.email.value.trim(),
        zip: toHalf(el.zip.value).trim(),
        address: el.address.value.trim()
      },
      dates: [1, 2, 3].map((n) => ({ date: el["date" + n].value, time: el["date" + n].value ? el["time" + n].value : "" })).filter((d) => d.date),
      photos: { count: files.length, names: files.map((f) => f.name.slice(0, 80)).slice(0, 20) },
      payment: (PAYMENTS.find((p) => p.id === el.payment.value) || PAYMENTS[0]).id,
      note: el.note.value.trim().slice(0, 2000),
      consent: el.consent.checked,
      website: el.website.value,
      submitted_at: new Date().toISOString(),
      page: location.href.split("#")[0].split("?")[0]
    };
  }

  function quoteText(p) {
    const r = p.quote;
    const pv = r.provisional ? "・仮の目安" : "";
    if (p.form === "A") return r.undetermined ? "要相談" : r.max === 0 ? "0円（回収扱い）" : "0円 〜 " + yen(r.max) + "（買取見込み" + pv + "）";
    return r.undetermined ? "要相談" : fmtRange(r.min, r.max) + "（お会計の目安" + pv + "）";
  }
  function detailText(p) {
    const r = p.quote;
    const bb = p.form === "A" ? r.buyback : r.buyback_detail;
    const out = [];
    if (p.form === "B") out.push("量：" + (r.lines[0] ? r.lines[0].name : "—"));
    if (p.form === "C") out.push("種類：" + Q.CLEANUP_KINDS[r.cleanup_kind] + "／間取り：" + (r.layout || "—"));
    if (p.form !== "A") r.lines.slice(1).forEach((l) => out.push("オプション：" + l.name + (l.qty > 1 ? " ×" + l.qty : "")));
    bb.lines.forEach((l) => out.push("買取：" + l.name + " ×" + l.qty + "（" + YEAR_LABELS[l.year] + "・" + COND_LABELS[l.condition].replace(/（.*/, "") + "）"));
    return out.join("\n") || "—";
  }

  // ---------- 確認画面 ----------
  const confirmBox = root.querySelector("#q-confirm");
  const doneBox = root.querySelector("#q-done");
  const tabsEl = root.querySelector(".tabs");
  let current = null;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validate()) return;
    current = payload();
    const p = current;
    const rows = [
      ["お申し込みの種類", FORM_NAMES[p.form]],
      ["選んだ内容", detailText(p)],
      ["概算", quoteText(p)],
      ["お名前（カナ）", p.customer.name_kana],
      ["電話番号", p.customer.tel],
      ["メールアドレス", p.customer.email || "（なし）"],
      ["郵便番号", p.customer.zip || "（なし）"],
      ["ご住所", p.customer.address],
      ["ご希望の日時", p.dates.map((d, i) => `第${i + 1}希望 ${d.date.replace(/-/g, "/")} ${d.time}`).join("\n")],
      ["写真", p.photos.count ? p.photos.count + "枚（ファイル名だけ送ります。写真は LINE で）" : "（なし）"],
      ["お支払い方法", PAYMENTS.find((x) => x.id === p.payment).label],
      ["ご要望", p.note || "（なし）"]
    ];
    const ready = !!CONFIG.GAS_URL;
    confirmBox.innerHTML = `<h3 tabindex="-1" id="q-confirm-h">入力内容の確認</h3>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<p class="callout-warn">${esc(p.form === "A" ? "買取見込み額は目安。最終額は訪問査定で確定します" : Q.OFFSET_NOTE)}</p>
${ready ? "" : '<p class="callout" id="q-not-ready"><b>フォームの送信は準備中です。</b>入力内容と概算はこの画面に残っています。お手数ですが、この内容を LINE か電話でお伝えください。</p>'}
<div class="grid-2" style="margin-top:12px">
<button type="button" class="btn btn-ghost" data-act="back">戻って直す</button>
${ready ? '<button type="button" class="btn btn-form" data-act="send">この内容で申し込む</button>' : '<button type="button" class="btn btn-form" disabled aria-disabled="true">送信は準備中</button>'}
</div>
<p class="hint" style="margin-top:10px">送信のあと、こちらから電話で日時を相談して予約が確定します。</p>
<div id="q-msg" role="status"></div>`;
    form.hidden = true;
    if (tabsEl) tabsEl.hidden = true;
    confirmBox.hidden = false;
    confirmBox.querySelector("#q-confirm-h").focus();
    confirmBox.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  confirmBox.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "back") {
      confirmBox.hidden = true;
      form.hidden = false;
      if (tabsEl) tabsEl.hidden = false;
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (b.dataset.act !== "send" || !CONFIG.GAS_URL || !current) return;
    const msg = confirmBox.querySelector("#q-msg");
    b.disabled = true;
    b.textContent = "送信中…";
    try {
      // text/plain で送ると CORS のプリフライトが起きない（GAS は e.postData.contents で受ける）
      const r = await fetch(CONFIG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(current) });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch (_) { j = { ok: r.ok, id: "" }; }
      if (!j.ok) throw new Error(j.error || "送信できませんでした");
      confirmBox.hidden = true;
      doneBox.hidden = false;
      doneBox.innerHTML = `<div class="done" role="status"><p style="margin:0">お申し込みを受け付けました。</p>
${j.id ? `<p>受付番号<span class="receipt">${esc(j.id)}</span></p>` : "<p>受付番号は確認のご連絡でお伝えします。</p>"}
<p>こちらからお電話して、伺う日時を相談します。${current.customer.email ? "確認メールもお送りしました。" : ""}</p>
<p style="margin:0">写真は LINE で送ってください（受付番号を添えてください）。</p></div>`;
      doneBox.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      msg.innerHTML = `<p class="err-summary">送信できませんでした。少し待ってもう一度お試しいただくか、LINE か電話でご連絡ください。（${esc(err.message)}）</p>`;
      b.disabled = false;
      b.textContent = "この内容で申し込む";
    }
  });
}
