// 自動生成：tools/build.mjs が data/prices.json から作る。手で直さない。
// 価格を変えたら build → このファイルを Apps Script に反映（gas/README.md）。
var PRICES = {
  "_note": "概算フォーム・料金ページ・AI向けJSON・GAS再計算が共通で読む価格表。金額は共同代表が決めたものだけ入れる。null は「要相談」表示。",
  "currency": "JPY",
  "tax": "included",
  "updated": null,
  "disclaimer": "表示額は目安です。最終額は訪問査定で確定します。",
  "collection_tiers": [
    {
      "id": "small",
      "name": null,
      "price_from": null,
      "note": "例：少量（袋数個）"
    },
    {
      "id": "mini",
      "name": null,
      "price_from": null,
      "note": "例：軽トラック1台分"
    },
    {
      "id": "basic",
      "name": null,
      "price_from": null,
      "note": "例：1.5t〜2tトラック"
    },
    {
      "id": "large",
      "name": null,
      "price_from": null,
      "note": "例：2t以上"
    }
  ],
  "cleanup_by_layout": [
    {
      "layout": "1K",
      "hours": null,
      "price_from": null
    },
    {
      "layout": "1DK・1LDK",
      "hours": null,
      "price_from": null
    },
    {
      "layout": "2DK・2LDK",
      "hours": null,
      "price_from": null
    },
    {
      "layout": "3DK・3LDK",
      "hours": null,
      "price_from": null
    },
    {
      "layout": "4LDK",
      "hours": null,
      "price_from": null
    },
    {
      "layout": "5LDK",
      "hours": null,
      "price_from": null
    }
  ],
  "cleanup_includes": [
    "分別・仕分け",
    "回収・処分",
    "人件費",
    "車両・運搬",
    "貴重品の捜索",
    "買取品の査定",
    "建物の養生",
    "作業後の清掃"
  ],
  "buyback_items": [
    {
      "id": "fridge",
      "name": "冷蔵庫",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "washer",
      "name": "洗濯機",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "microwave",
      "name": "電子レンジ",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "gas_stove",
      "name": "ガスコンロ",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "sofa",
      "name": "ソファ・ソファベッド",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "table",
      "name": "ダイニングテーブル",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "cupboard",
      "name": "食器棚",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "carpet",
      "name": "カーペット",
      "max_price": null,
      "year_limit": null
    },
    {
      "id": "curtain",
      "name": "カーテン",
      "max_price": null,
      "year_limit": null
    }
  ],
  "condition_factor": {
    "good": 1,
    "normal": 0.6,
    "damaged": 0.2,
    "_note": "状態係数の初期案。共同代表の確認待ち"
  },
  "options": [
    {
      "id": "stairs",
      "name": "階段での運び出し",
      "price": null,
      "unit": "回"
    },
    {
      "id": "dismantle",
      "name": "解体が必要な場合",
      "price": null,
      "unit": "点"
    },
    {
      "id": "aircon_removal",
      "name": "エアコン取外し",
      "price": null,
      "unit": "台"
    }
  ]
};
