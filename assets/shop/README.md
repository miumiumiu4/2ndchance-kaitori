# 販売商品の写真

- `tools/photos.py` が元写真から作る（`python3 tools/photos.py <元写真のフォルダ>`）。**元写真はリポジトリに入れない。**
- `<商品id>.jpg`（長辺 1200px）と `<商品id>-480.jpg`（サムネ 480px）、JPEG 品質 80。商品 id は `data/shop.json` の `id`。
- 1品ずつトリミングし、外しきれない値札・掲示はぼかす。冷蔵庫（`aqua-fridge-355`）は扉のチラシ（電話番号・QR）を塗りつぶしてある。
- EXIF・GPS・ICC は残さない（画素だけを新しい画像に貼り直して保存）。`tests/photos.test.mjs` が確かめる。
- 電話番号・QR・人の顔・他社のロゴが写った写真は使わない。`*_DO_NOT_PUBLISH*` の写真は読まない。
