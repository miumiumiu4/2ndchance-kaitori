// 概算の計算（純粋関数だけ）。画面・GAS の再計算・AI 向け action=quote が同じこの式を使う。
// 価格は data/prices.json だけが正。片付けは種類ごとの間取り表（cleanup_by_kind）。値が null の項目は undetermined: true（画面は「要相談」）。
// prices.provisional が true のあいだは仮の金額。quoteFromInput の返り値に provisional として載せる。
// tools/build.mjs がこのファイルから gas/QuoteCore.gs を生成する（export を外して var QuoteCore に包む）。

// 年式係数：目安年数以内は 1.0、超えていれば 0（買取見込み 0・回収扱い）
export const YEAR_FACTOR = { within_year_limit: 1.0, over: 0 };

// 価格表に無い「相談だけ」のオプション（料金は担当者から別途案内。概算には足さない）
export const CONSULT_OPTIONS = {
  sorting: "分別が多い",
  kuyou: "供養（お焚き上げ等）",
  house_cleaning: "ハウスクリーニング",
  fudosan: "不動産・空き家の相談"
};

export const CLEANUP_KINDS = {
  ihin: "遺品整理",
  seizen: "生前整理",
  gomiyashiki: "ゴミ屋敷片付け",
  akiya: "空き家片付け",
  souko: "倉庫の片付け",
  kusakari: "草刈り",
  other: "その他の片付け"
};

// 片付けの種類ごとの間取り表（prices.cleanup_by_kind[kind]）。間取りで選ばない種類は null
export function cleanupRows(kind, prices) {
  const t = (prices && prices.cleanup_by_kind) || {};
  return Object.prototype.hasOwnProperty.call(t, kind) && Array.isArray(t[kind]) ? t[kind] : null;
}

// 坪数で出す片付け（prices.other_cleanup。倉庫・草刈り）の定義。無ければ null
export function otherCleanupDef(kind, prices) {
  const list = (prices && prices.other_cleanup) || [];
  return list.find(function (d) { return d.id === kind; }) || null;
}

// 同日査定（エアコン・ハウスクリーニングと同じ日）の買取額の係数。率が決まっていなければ 1
export function sameDayFactor(prices) {
  const p = prices && prices.perks && prices.perks.same_day_up;
  return p && isNum(p.rate) && p.rate > 0 ? 1 + p.rate : 1;
}

// 量の区分の呼び名（prices.json の name が null のあいだの表示）
export const TIER_NAMES = { small: "少量", mini: "トラックミニ", basic: "ベーシック", large: "ラージ" };

export function tierName(def) {
  if (!def) return "";
  return def.name || TIER_NAMES[def.id] || def.id;
}

export const MAX_QTY = 20;
export const OFFSET_NOTE = "買取見込み額は目安。最終額は訪問査定で確定し、お会計も変わります";

function toQty(n) {
  const v = Math.floor(Number(n));
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(v, MAX_QTY);
}

function isNum(v) {
  return typeof v === "number" && isFinite(v);
}

// 10円未満は切り捨て（買取は控えめに見せる）
function floor10(n) {
  return Math.floor(n / 10) * 10;
}

// 買取の概算。items: [{ id, qty, year: "within"|"over"|"unknown", condition: "good"|"normal"|"damaged" }]
// opts: { sameDay: true } で同日査定の係数（perks.same_day_up）を掛ける。
// 返り値：{ min, max, undetermined, lines, notes, same_day }。
// 1台あたりの見込みは「上限 × 年式係数 × 状態係数」だが、最低額 min_price を下回らない（当店の方針）。
// 下限 min は「目安年数以内」と分かっている品目の最低額の合計（年式不明は 0。年式超過は 0・回収扱い）。
export function quoteBuyback(items, prices, opts) {
  const table = (prices && prices.buyback_items) || [];
  const cf = (prices && prices.condition_factor) || {};
  const sameDay = !!(opts && opts.sameDay);
  const f = sameDay ? sameDayFactor(prices) : 1;
  const lines = [];
  const notes = [];
  let undetermined = false;
  let max = 0;
  let min = 0;
  (items || []).forEach(function (it) {
    const qty = toQty(it && it.qty);
    if (!qty) return;
    const def = table.find(function (d) { return d.id === (it && it.id); });
    if (!def) { notes.push("不明な品目を除きました：" + String(it && it.id).slice(0, 30)); return; }
    const year = it.year === "over" ? "over" : (it.year === "within" ? "within" : "unknown");
    const condition = isNum(cf[it.condition]) ? it.condition : "normal";
    const line = { id: def.id, name: def.name, qty: qty, year: year, condition: condition, unit_min: 0, unit_max: null, min: 0, max: null, undetermined: false, note: "" };
    if (year === "over") {
      line.max = 0;
      line.unit_max = 0;
      line.note = "年式の目安を超えているため回収扱い（買取見込み 0円）";
    } else if (!isNum(def.max_price) || !isNum(cf[condition])) {
      line.undetermined = true;
      line.note = "要相談";
      undetermined = true;
    } else {
      const floorPrice = isNum(def.min_price) ? def.min_price : 0;
      const unit = Math.max(floor10(def.max_price * YEAR_FACTOR.within_year_limit * cf[condition]), floorPrice);
      line.unit_max = floor10(unit * f);
      line.max = line.unit_max * qty;
      if (year === "within") {
        line.unit_min = floor10(floorPrice * f);
        line.min = line.unit_min * qty;
      }
      if (year === "unknown") line.note = "年式は訪問時に確認（目安年数を超えていれば回収扱い）";
    }
    if (isNum(line.max)) max += line.max;
    min += line.min;
    lines.push(line);
  });
  if (sameDay && f !== 1) notes.push("同日査定で買取見込みを" + Math.round((f - 1) * 100) + "%アップして表示しています");
  return {
    min: undetermined ? null : min,
    max: undetermined ? null : max,
    undetermined: undetermined,
    same_day: sameDay,
    lines: lines,
    notes: notes
  };
}

// 特典の当てはまり。クオカード：買取見込みの下限が基準以上なら eligible、上限だけ届くなら possible
export function perkStatus(buyback, prices) {
  const q = prices && prices.perks && prices.perks.quo_card;
  let quo = "";
  if (q && isNum(q.threshold) && buyback && !buyback.undetermined) {
    if (isNum(buyback.min) && buyback.min >= q.threshold) quo = "eligible";
    else if (isNum(buyback.max) && buyback.max >= q.threshold) quo = "possible";
  }
  return { quo_card: quo };
}

// オプションの1点あたりの料金。price_by_form にフォーム別の料金があればそちら（例：解体は片付けでは無料）
export function optionPrice(def, form) {
  if (!def) return null;
  if (def.price_by_form && Object.prototype.hasOwnProperty.call(def.price_by_form, form)) return def.price_by_form[form];
  return def.price;
}

// オプション（共通）。options: [{ id, qty }]、form: "B"|"C"
function priceOptions(options, prices, form) {
  const table = (prices && prices.options) || [];
  const lines = [];
  const notes = [];
  let total = 0;
  let undetermined = false;
  (options || []).forEach(function (op) {
    const id = op && op.id;
    const qty = op && op.qty === undefined ? 1 : toQty(op && op.qty);
    if (!qty) return;
    const def = table.find(function (d) { return d.id === id; });
    if (def) {
      const price = optionPrice(def, form);
      if (!isNum(price)) {
        undetermined = true;
        lines.push({ id: id, name: def.name, qty: qty, unit: def.unit, amount: null, undetermined: true, note: "要相談" });
      } else {
        total += price * qty;
        lines.push({ id: id, name: def.name, qty: qty, unit: def.unit, amount: price * qty, undetermined: false, note: price === 0 ? "無料" : "" });
      }
    } else if (Object.prototype.hasOwnProperty.call(CONSULT_OPTIONS, id)) {
      lines.push({ id: id, name: CONSULT_OPTIONS[id], qty: 1, unit: "", amount: 0, undetermined: false, consult: true, note: "料金は担当者から別途ご案内" });
    } else {
      notes.push("不明なオプションを除きました：" + String(id).slice(0, 30));
    }
  });
  return { total: total, undetermined: undetermined, lines: lines, notes: notes };
}

// 費用 − 買取見込み = お会計（幅）。お会計がマイナスならお客様の受け取り。
function offset(cost, costUndetermined, buyback) {
  const bb = buyback || { min: 0, max: 0, undetermined: false };
  const und = costUndetermined || !!bb.undetermined;
  return {
    min: und ? null : cost - bb.max,
    max: und ? null : cost - bb.min,
    undetermined: und
  };
}

// 不用品回収。tier: collection_tiers の id
export function quoteCollection(tier, options, buybackEstimate, prices) {
  const tiers = (prices && prices.collection_tiers) || [];
  const def = tiers.find(function (t) { return t.id === tier; });
  const notes = [];
  const lines = [];
  let undetermined = false;
  let cost = 0;
  if (!def) {
    undetermined = true;
    notes.push("量の区分を選んでください");
  } else if (!isNum(def.price_from)) {
    undetermined = true;
    lines.push({ id: def.id, name: tierName(def), amount: null, undetermined: true, note: "要相談" });
  } else {
    cost += def.price_from;
    lines.push({ id: def.id, name: tierName(def), amount: def.price_from, undetermined: false, note: "基本料金（〜から）" });
  }
  const op = priceOptions(options, prices, "B");
  if (op.undetermined) undetermined = true;
  cost += op.total;
  const bill = offset(cost, undetermined, buybackEstimate);
  return {
    kind: "collection",
    tier: def ? def.id : null,
    cost: { amount: undetermined ? null : cost, undetermined: undetermined },
    buyback: buybackEstimate ? { min: buybackEstimate.min, max: buybackEstimate.max, undetermined: !!buybackEstimate.undetermined } : { min: 0, max: 0, undetermined: false },
    min: bill.min,
    max: bill.max,
    undetermined: bill.undetermined,
    lines: lines.concat(op.lines),
    notes: notes.concat(op.notes),
    offset_note: OFFSET_NOTE
  };
}

// 片付け。kind: CLEANUP_KINDS の id。
//   遺品整理・生前整理・ゴミ屋敷・空き家 … 種類ごとの間取り表 cleanup_by_kind[kind] の layout（例 "2DK・2LDK"）
//   倉庫・草刈り                         … other_cleanup の「10坪あたり」× 坪数 tsubo（10坪単位で切り上げ）
//   その他                               … 要相談
export function quoteCleanup(layout, kind, options, buybackEstimate, prices, tsubo) {
  const k = Object.prototype.hasOwnProperty.call(CLEANUP_KINDS, kind) ? kind : "other";
  const kindName = CLEANUP_KINDS[k];
  const rows = cleanupRows(k, prices);
  const other = rows ? null : otherCleanupDef(k, prices);
  const notes = [];
  const lines = [];
  let undetermined = false;
  let cost = 0;
  let def = null;
  let units = null;
  if (rows) {
    def = rows.find(function (r) { return r.layout === layout; }) || null;
    if (!def) {
      undetermined = true;
      notes.push("間取りを選んでください");
    } else if (!isNum(def.price_from)) {
      undetermined = true;
      lines.push({ id: def.layout, name: kindName + "（" + def.layout + "）", amount: null, undetermined: true, note: "要相談" });
    } else {
      cost += def.price_from;
      lines.push({ id: def.layout, name: kindName + "（" + def.layout + "）", amount: def.price_from, undetermined: false, note: "基本料金（〜から）" });
    }
  } else if (other) {
    const t = Math.floor(Number(tsubo));
    const per = isNum(other.per_tsubo) && other.per_tsubo > 0 ? other.per_tsubo : 10;
    if (!isFinite(t) || t <= 0) {
      undetermined = true;
      notes.push("坪数を入れてください");
    } else {
      units = Math.ceil(Math.min(t, 10000) / per);
      if (!isNum(other.price_from)) {
        undetermined = true;
        lines.push({ id: other.id, name: kindName + "（" + units * per + "坪まで）", amount: null, undetermined: true, note: "要相談" });
      } else {
        cost += other.price_from * units;
        lines.push({ id: other.id, name: kindName + "（" + units * per + "坪まで）", amount: other.price_from * units, undetermined: false, note: per + "坪あたり " + other.price_from + "円〜" });
      }
    }
  } else {
    undetermined = true;
    lines.push({ id: k, name: kindName, amount: null, undetermined: true, note: "要相談" });
  }
  const op = priceOptions(options, prices, "C");
  if (op.undetermined) undetermined = true;
  cost += op.total;
  const bill = offset(cost, undetermined, buybackEstimate);
  return {
    kind: "cleanup",
    cleanup_kind: k,
    layout: def ? def.layout : null,
    tsubo: units === null ? null : Math.floor(Number(tsubo)),
    hours: def && (isNum(def.hours) || (typeof def.hours === "string" && def.hours)) ? def.hours : null,
    includes: (prices && prices.cleanup_includes) || [],
    cost: { amount: undetermined ? null : cost, undetermined: undetermined },
    buyback: buybackEstimate ? { min: buybackEstimate.min, max: buybackEstimate.max, undetermined: !!buybackEstimate.undetermined } : { min: 0, max: 0, undetermined: false },
    min: bill.min,
    max: bill.max,
    undetermined: bill.undetermined,
    lines: lines.concat(op.lines),
    notes: notes.concat(op.notes),
    offset_note: OFFSET_NOTE
  };
}

// フォームの入力 → 概算（画面・GAS の doPost・doGet が共通で使う入口）
// input: { form: "A"|"B"|"C", items, tier, layout, kind, tsubo, options, same_day }
export function quoteFromInput(input, prices) {
  const r = quoteFromInputRaw(input, prices);
  r.provisional = !!(prices && prices.provisional);
  r.same_day = !!(input && input.same_day);
  return r;
}

// 片付けの作業時間の表示（数値なら「約N時間」、文字列ならそのまま）
export function hoursText(h) {
  if (isNum(h)) return "約" + h + "時間";
  if (typeof h === "string" && h) return h;
  return "";
}

function quoteFromInputRaw(input, prices) {
  const f = input && input.form;
  const bb = quoteBuyback((input && input.items) || [], prices, { sameDay: !!(input && input.same_day) });
  if (f === "A") return { form: "A", buyback: bb, min: bb.min, max: bb.max, undetermined: bb.undetermined, perks: perkStatus(bb, prices), offset_note: OFFSET_NOTE };
  if (f === "B") {
    const r = quoteCollection(input.tier, input.options, bb, prices);
    r.form = "B"; r.buyback_detail = bb; r.perks = perkStatus(bb, prices);
    return r;
  }
  if (f === "C") {
    const r = quoteCleanup(input.layout, input.kind, input.options, bb, prices, input.tsubo);
    r.form = "C"; r.buyback_detail = bb; r.perks = perkStatus(bb, prices);
    return r;
  }
  return { form: null, error: "form は A・B・C のどれか", undetermined: true, min: null, max: null };
}

// URL のクエリ（AI 向け action=quote）→ input。
//   form=A&items=fridge:2:within:good,washer:1:over:normal
//   form=B&tier=mini&options=stairs:1,aircon_removal:2&items=...
//   form=C&layout=2DK・2LDK&kind=ihin&options=kuyou
//   form=C&kind=souko&tsubo=25 ／ same_day=1（同日査定で買取見込み +20%）
export function parseQuoteQuery(params) {
  const p = params || {};
  function list(s) {
    return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  const items = list(p.items).map(function (s) {
    const a = s.split(":");
    return { id: a[0], qty: a[1] === undefined ? 1 : Number(a[1]), year: a[2] || "unknown", condition: a[3] || "normal" };
  });
  const options = list(p.options).map(function (s) {
    const a = s.split(":");
    return { id: a[0], qty: a[1] === undefined ? 1 : Number(a[1]) };
  });
  return {
    form: String(p.form || "A").toUpperCase(),
    items: items,
    tier: p.tier || null,
    layout: p.layout || null,
    kind: p.kind || null,
    tsubo: p.tsubo === undefined || p.tsubo === null || p.tsubo === "" ? null : Number(p.tsubo),
    options: options,
    same_day: p.same_day === true || p.same_day === "1" || p.same_day === "true"
  };
}

// 画面の額と再計算の額が一致するか（GAS の照合用）
export function sameQuote(a, b) {
  if (!a || !b) return false;
  return a.min === b.min && a.max === b.max && !!a.undetermined === !!b.undetermined && !!a.same_day === !!b.same_day;
}
