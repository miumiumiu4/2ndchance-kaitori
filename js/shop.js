// 販売ページの注文フォーム（段階1：注文受付のみ。お支払いは受け取り時）。
// 商品を選ぶ → 受け取り方法（店頭／配送）→ 配送なら郵便番号から配送料の目安 → 確認画面 → 送信 → 受付番号。
// 金額の式は shop-core.js（商品代）と delivery-core.js（配送料）。GAS_URL が空なら送信は「準備中」。
import { CONFIG } from "./config.js";
import * as S from "./shop-core.js";
import * as D from "./delivery-core.js";
import { NEWSLETTER_TEXT, isEmail, postal3, browserMeta, newsletterRecord } from "./form-common.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (n) => "¥" + Number(n).toLocaleString("ja-JP");
const toHalf = (s) => String(s || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const LOG_KEY = "shop-delivery-log-sent";

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

const root = document.querySelector("[data-shop-root]");
if (root) init(root).catch((e) => {
  root.innerHTML = '<p class="callout">フォームを読み込めませんでした。お手数ですが LINE か電話でご相談ください。</p>';
  console.error(e);
});

async function init(root) {
  const base = root.dataset.base || "./";
  const [shop, prices] = await Promise.all([getJSON(base + "data/shop.json"), getJSON(base + "data/prices.json")]);
  const items = shop.items.filter(S.orderable);
  const want = new URLSearchParams(location.search).get("item");
  const st = { id: items.some((x) => x.id === want) ? want : "", receive: "store", zip: "", dq: null };
  const tables = {};

  // 郵便番号の表（上3桁ごと）。無ければ空の表＝要相談
  async function tableFor(zip) {
    const f = D.postalFile(zip);
    if (!f) return null;
    if (!(f in tables)) {
      try { tables[f] = await getJSON(base + f); } catch (_) { tables[f] = {}; }
    }
    return tables[f];
  }

  const priceText = (it) => {
    const p = S.shopPrice(it);
    return p.undetermined ? "価格は確認中" : yen(p.price) + (p.sale ? `（${Math.round(p.sale * 100)}% OFF）` : "");
  };

  root.innerHTML = `<form class="qform" novalidate>
<fieldset><legend>1. 商品 <span class="req">必須</span></legend>
<label class="f" for="o-item" style="margin-top:0">申し込む商品</label>
<select id="o-item" name="product"><option value="">選んでください</option>${items.map((it) => `<option value="${esc(it.id)}"${st.id === it.id ? " selected" : ""}>${esc(it.name)}｜${esc(priceText(it))}</option>`).join("")}</select>
<div id="o-item-info" class="hint"></div>
</fieldset>
<fieldset><legend>2. 受け取り方法</legend>
<div class="choices">${Object.entries(S.RECEIVE).map(([k, v], i) => `<label class="choice"><input type="radio" name="receive" value="${k}"${i === 0 ? " checked" : ""}><div><b>${esc(v)}</b><span>${k === "store" ? "お店でお渡しします（" + esc(shop.hold_note) + "）" : "郵便番号から配送料の目安を出します"}</span></div></label>`).join("")}</div>
<div id="o-delivery" hidden>
<label class="f" for="o-zip">お届け先の郵便番号<span class="req">必須</span></label>
<input type="text" id="o-zip" name="zip" autocomplete="postal-code" inputmode="numeric" style="max-width:12em" placeholder="例：861-1112">
<div id="o-dq" class="hint" aria-live="polite"></div>
<label class="f" for="o-addr">お届け先の住所<span class="req">必須</span></label>
<input type="text" id="o-addr" name="address" autocomplete="street-address">
</div>
</fieldset>
<div class="estimate" id="o-total" aria-live="polite"></div>
<fieldset><legend>3. お客様の情報</legend>
<label class="f" for="o-name">お名前<span class="req">必須</span></label>
<input type="text" id="o-name" name="name" autocomplete="name">
<label class="f" for="o-email">メールアドレス<span class="req">必須</span></label>
<input type="email" id="o-email" name="email" autocomplete="email" inputmode="email">
<p class="hint">受付番号つきの確認メールをお送りします。</p>
<label class="choice" style="margin-top:10px" for="o-news"><input type="checkbox" id="o-news" name="newsletter" checked><div><b>${esc(NEWSLETTER_TEXT)}</b><span>${esc(CONFIG.MAIL_PERK_TEXT || "")}${CONFIG.MAIL_PERK_TEXT ? "。" : ""}いつでも配信を止められます。</span></div></label>
<label class="f" for="o-tel">電話番号<span class="opt">電話か LINE の名前のどちらか</span></label>
<input type="tel" id="o-tel" name="tel" autocomplete="tel" inputmode="tel">
<label class="f" for="o-line">LINE の名前<span class="opt">任意</span></label>
<input type="text" id="o-line" name="line_name" autocomplete="off" maxlength="40">
<p class="hint">受け取りの日時を決めるため、こちらからご連絡します。</p>
</fieldset>
<fieldset><legend>4. お支払い方法（受け取り時）</legend>
<div class="choices">${Object.entries(S.SHOP_PAYMENTS).map(([k, v], i) => `<label class="choice"><input type="radio" name="payment" value="${k}"${i === 0 ? " checked" : ""}><div><b>${esc(v)}</b></div></label>`).join("")}</div>
<p class="hint">${esc(shop.payment_note)}</p>
</fieldset>
<label class="f" for="o-note">備考<span class="opt">任意</span></label>
<textarea id="o-note" name="note" placeholder="例：受け取りは土曜の午後が希望、2階に運んでほしい など"></textarea>
<div class="hp" aria-hidden="true"><label>空欄のままにしてください<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="choice" style="margin-top:16px" for="o-consent"><input type="checkbox" id="o-consent" name="consent"><div><b><a href="${base}privacy/" target="_blank" rel="noopener">個人情報の取扱い</a>に同意します</b><span>必須</span></div></label>
<div class="err-summary" id="o-errs" role="alert" hidden></div>
<button type="submit" class="btn btn-form btn-block" style="margin-top:16px">入力内容を確認する</button>
</form>
<div class="confirm card" id="o-confirm" hidden></div>
<div id="o-done" hidden></div>`;

  const form = root.querySelector("form");
  const el = form.elements;
  const item = () => S.findItem(shop, st.id);

  function renderInfo() {
    const it = item();
    const box = root.querySelector("#o-item-info");
    if (!it) { box.innerHTML = ""; return; }
    const pay = it.payment_link ? ` <a class="btn btn-ghost" href="${esc(it.payment_link)}" target="_blank" rel="noopener">カードで支払う（外部サイト）</a>` : "";
    box.innerHTML = `${esc(it.condition)}${it.free_shipping ? "・送料無料（50km以内）" : ""}　<a href="${base}shop/${esc(it.id)}/">商品の詳細</a>${pay}`;
  }

  function totalNow() {
    return S.orderTotal(item(), st.receive, st.dq);
  }
  function renderTotal() {
    const it = item();
    const box = root.querySelector("#o-total");
    if (!it) { box.innerHTML = '<p class="est-break">商品を選ぶと、お支払いの目安が出ます。</p>'; return; }
    const t = totalNow();
    const goods = t.goods === null ? "確認中" : yen(t.goods);
    const fee = st.receive === "store" ? "店頭受け取り ¥0" : st.dq ? "配送料 " + D.deliveryFeeText(st.dq) : "配送料（郵便番号を入れてください）";
    box.innerHTML = `<div class="est-row"><span class="est-label">お支払いの目安</span><span class="est-value" data-total>${t.undetermined ? "要相談" : yen(t.total)}</span><span class="est-note">税込。お支払いは受け取り時です</span></div>
<p class="est-break order-total">商品代 <b>${goods}</b> ＋ ${esc(fee)}</p>${t.note ? `<p class="est-break">${esc(t.note)}</p>` : ""}`;
  }

  // 配送料の計算ログ（郵便番号・区分・日時だけ。1つのタブで1回だけ）
  function logOnce(dq) {
    if (!CONFIG.GAS_URL || !dq || !dq.zip) return;
    try {
      if (sessionStorage.getItem(LOG_KEY)) return;
      sessionStorage.setItem(LOG_KEY, "1");
    } catch (_) { return; }
    fetch(CONFIG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ kind: "delivery_log", zip: dq.zip, band: dq.band, at: new Date().toISOString() }) }).catch(() => {});
  }

  async function updateDelivery() {
    const out = root.querySelector("#o-dq");
    const z = D.normalizeZip(st.zip);
    if (!z) { st.dq = null; out.textContent = st.zip ? "郵便番号は7桁で入れてください。" : ""; renderTotal(); return; }
    const table = await tableFor(z);
    const it = item();
    st.dq = D.deliveryQuote(z, table, prices, { store: CONFIG.STORE_LATLNG, freeShipping: !!(it && it.free_shipping) });
    out.innerHTML = `配送料の目安：<b data-delivery-fee>${esc(D.deliveryFeeText(st.dq))}</b>${st.dq.km !== null ? `（店から道のりでおよそ ${st.dq.km}km・${esc(st.dq.band)}）` : ""}${st.dq.note ? "<br>" + esc(st.dq.note) : ""}`;
    renderTotal();
    logOnce(st.dq);
  }

  renderInfo();
  renderTotal();

  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "product") { st.id = t.value; renderInfo(); if (st.receive === "delivery") updateDelivery(); else renderTotal(); }
    else if (t.name === "receive") {
      st.receive = t.value;
      root.querySelector("#o-delivery").hidden = st.receive !== "delivery";
      if (st.receive === "delivery") updateDelivery(); else renderTotal();
    }
  });
  form.addEventListener("input", (e) => {
    if (e.target.name !== "zip") return;
    st.zip = e.target.value;
    if (D.normalizeZip(st.zip) || !st.zip) updateDelivery();
  });
  el.zip.addEventListener("blur", () => { el.zip.value = toHalf(el.zip.value).replace(/[^0-9-]/g, ""); st.zip = el.zip.value; updateDelivery(); });
  el.tel.addEventListener("blur", (e) => { e.target.value = toHalf(e.target.value).trim(); });

  function validate() {
    const errs = [];
    form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    const bad = (node, msg) => { errs.push({ node, msg }); if (node && node.setAttribute) node.setAttribute("aria-invalid", "true"); };
    if (!item()) bad(el.product, "商品を選んでください。");
    if (st.receive === "delivery") {
      if (!D.normalizeZip(el.zip.value)) bad(el.zip, "お届け先の郵便番号を7桁で入れてください。");
      if (!el.address.value.trim()) bad(el.address, "お届け先の住所を入れてください。");
    }
    if (!el.name.value.trim()) bad(el.name, "お名前を入れてください。");
    const mail = el.email.value.trim();
    if (!mail) bad(el.email, "メールアドレスを入れてください。");
    else if (!isEmail(mail)) bad(el.email, "メールアドレスの形を確かめてください。");
    const tel = toHalf(el.tel.value).replace(/[^0-9]/g, "");
    if (!tel && !el.line_name.value.trim()) bad(el.tel, "電話番号か LINE の名前のどちらかを入れてください。");
    else if (tel && !/^0\d{9,10}$/.test(tel)) bad(el.tel, "電話番号の桁数を確かめてください（0から始まる10桁か11桁）。");
    if (!el.consent.checked) bad(el.consent, "個人情報の取扱いへの同意にチェックを入れてください。");
    const box = root.querySelector("#o-errs");
    if (errs.length) {
      box.hidden = false;
      box.innerHTML = "入力を確かめてください：<ul>" + errs.map((x) => `<li>${esc(x.msg)}</li>`).join("") + "</ul>";
      const first = errs[0].node;
      if (first && first.focus) { first.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => first.focus({ preventScroll: true }), 300); }
    } else box.hidden = true;
    return errs.length === 0;
  }

  async function payload() {
    const it = item();
    const t = totalNow();
    const zip = st.receive === "delivery" ? toHalf(el.zip.value).trim() : "";
    return {
      kind: "shop",
      form: "shop",
      item_id: it.id,
      item_name: it.name,
      goods_price: t.goods,
      receive: st.receive,
      delivery: st.receive === "delivery" && st.dq ? { zip: st.dq.zip, km: st.dq.km, band: st.dq.band, fee: st.dq.fee, consult: st.dq.consult, near_boundary: st.dq.near_boundary } : null,
      total: t.total,
      payment: el.payment.value,
      shop_updated: shop.updated,
      customer: {
        name: el.name.value.trim().slice(0, 60),
        tel: toHalf(el.tel.value).trim(),
        line_name: el.line_name.value.trim().slice(0, 40),
        email: el.email.value.trim(),
        zip: zip,
        address: st.receive === "delivery" ? el.address.value.trim() : ""
      },
      newsletter: await newsletterRecord(el.newsletter.checked),
      postal3: postal3(zip),
      meta: browserMeta(),
      note: el.note.value.trim().slice(0, 2000),
      consent: el.consent.checked,
      website: el.website.value,
      submitted_at: new Date().toISOString()
    };
  }

  const confirmBox = root.querySelector("#o-confirm");
  const doneBox = root.querySelector("#o-done");
  let current = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;
    current = await payload();
    const p = current;
    const rows = [
      ["商品", p.item_name],
      ["商品代", p.goods_price === null ? "確認中" : yen(p.goods_price) + "（税込）"],
      ["受け取り方法", S.RECEIVE[p.receive]],
      ...(p.receive === "delivery" ? [["お届け先", "〒" + p.customer.zip + " " + p.customer.address], ["配送料", p.delivery ? D.deliveryFeeText(p.delivery) + (p.delivery.band ? "（" + p.delivery.band + "）" : "") : "要相談"]] : []),
      ["お支払いの目安", p.total === null ? "要相談（担当者からご連絡します）" : yen(p.total) + "（受け取り時）"],
      ["お支払い方法", S.SHOP_PAYMENTS[p.payment]],
      ["お名前", p.customer.name],
      ["メールアドレス", p.customer.email],
      ["メールのお知らせ", p.newsletter.opt_in ? "受け取る" : "受け取らない"],
      ["電話番号", p.customer.tel || "（なし）"],
      ["LINE の名前", p.customer.line_name || "（なし）"],
      ["備考", p.note || "（なし）"]
    ];
    const ready = !!CONFIG.GAS_URL;
    confirmBox.innerHTML = `<h3 tabindex="-1" id="o-confirm-h">入力内容の確認</h3>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<p class="callout-warn">${esc(shop.payment_note)}${esc(shop.hold_note)}</p>
${ready ? "" : '<p class="callout" id="o-not-ready"><b>フォームの送信は準備中です。</b>お手数ですが、この内容を LINE か電話でお伝えください。</p>'}
<div class="grid-2" style="margin-top:12px">
<button type="button" class="btn btn-ghost" data-act="back">戻って直す</button>
${ready ? '<button type="button" class="btn btn-form" data-act="send">この内容で申し込む</button>' : '<button type="button" class="btn btn-form" disabled aria-disabled="true">送信は準備中</button>'}
</div>
<div id="o-msg" role="status"></div>`;
    form.hidden = true;
    confirmBox.hidden = false;
    confirmBox.querySelector("#o-confirm-h").focus();
    confirmBox.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  confirmBox.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "back") {
      confirmBox.hidden = true;
      form.hidden = false;
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (b.dataset.act !== "send" || !CONFIG.GAS_URL || !current) return;
    const msg = confirmBox.querySelector("#o-msg");
    b.disabled = true;
    b.textContent = "送信中…";
    try {
      const r = await fetch(CONFIG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(current) });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch (_) { j = { ok: r.ok, id: "" }; }
      if (!j.ok) throw new Error(j.error || "送信できませんでした");
      confirmBox.hidden = true;
      doneBox.hidden = false;
      doneBox.innerHTML = `<div class="done" role="status"><p style="margin:0">お申し込みを受け付けました。</p>
${j.id ? `<p>受付番号<span class="receipt">${esc(j.id)}</span></p>` : ""}
<p>こちらからご連絡して、受け取りの日時を決めます。確認メールもお送りしました。</p>
<p style="margin:0">${esc(shop.hold_note)}</p></div>`;
      doneBox.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      msg.innerHTML = `<p class="err-summary">送信できませんでした。少し待ってもう一度お試しいただくか、LINE か電話でご連絡ください。（${esc(err.message)}）</p>`;
      b.disabled = false;
      b.textContent = "この内容で申し込む";
    }
  });
}
