// カート（販売ページの一覧・商品ページ・注文フォームで共有）。中身は sessionStorage の id の配列だけ。
// - [data-cart-add="<id>"] のボタン：押すと入れる／外す（文字は「カートに入れる」⇔「カートから外す」）
// - 固定バーの上に「カートを見る（n点）」（1点以上のとき）。注文フォームのあるページは #order、ほかは shop/#order へ
// 金額・可否の式は shop-core.js（純粋関数）。売切れの判定は注文フォームが data/shop.json で行う。
import { parseCart, toggleCart, inCart } from "./shop-core.js";

const KEY = "shop-cart";
const EVENT = "shop-cart-change";
let memory = "[]"; // sessionStorage が使えないときの控え

export function getCart() {
  try { return parseCart(sessionStorage.getItem(KEY)); } catch (_) { return parseCart(memory); }
}

export function setCart(ids) {
  const text = JSON.stringify(parseCart(JSON.stringify(ids || [])));
  memory = text;
  try { sessionStorage.setItem(KEY, text); } catch (_) {}
  render();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: getCart() }));
}

export function toggle(id) {
  setCart(toggleCart(getCart(), id));
}

export function onCartChange(fn) {
  window.addEventListener(EVENT, (e) => fn(e.detail));
}

function orderHref() {
  return document.getElementById("order") ? "#order" : new URL("../shop/#order", import.meta.url).href;
}

let badge = null;
function ensureBadge() {
  if (badge) return badge;
  const bar = document.querySelector(".cta-bar");
  if (!bar) return null;
  badge = document.createElement("a");
  badge.className = "cta-cart";
  badge.id = "cta-cart";
  badge.href = orderHref();
  badge.hidden = true;
  bar.insertBefore(badge, bar.firstChild);
  return badge;
}

function render() {
  const ids = getCart();
  document.querySelectorAll("[data-cart-add]").forEach((b) => {
    const on = inCart(ids, b.dataset.cartAdd);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "カートから外す" : "カートに入れる";
  });
  const el = ensureBadge();
  if (el) {
    el.textContent = `カートを見る（${ids.length}点）`;
    el.hidden = ids.length === 0;
    document.body.classList.toggle("has-cta-cart", ids.length > 0);
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-cart-add]");
  if (!b || b.disabled) return;
  e.preventDefault();
  toggle(b.dataset.cartAdd);
});
// ほかのタブではなく、戻る・進むで戻ってきたとき（bfcache）にも表示を合わせる
window.addEventListener("pageshow", render);
render();
