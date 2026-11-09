#!/usr/bin/env python3
"""販売商品の写真を公開用に加工する（元写真はリポジトリに入れない）。

  python3 tools/photos.py <元写真のフォルダ> [--out assets/shop]

- 1品ずつトリミング（値札・周りの商品・人をなるべく外す）。外しきれない値札・掲示はぼかす。
- 冷蔵庫（aqua-fridge-355）の扉に貼られたチラシ（電話番号・LINE の QR）は扉の色で塗りつぶしてからぼかす。
- 長辺 1200px（<id>.jpg）とサムネ 480px（<id>-480.jpg）、JPEG 品質 80。
- EXIF・GPS・ICC などのメタデータは一切残さない（画素だけを新しい画像に貼り直して保存）。
- 座標は向きを直した元写真に対する割合（0〜1）で (左, 上, 右, 下)。
- ファイル名に *_DO_NOT_PUBLISH* を含む写真は読まない。
"""
import os
import sys
from PIL import Image, ImageFilter, ImageOps, ImageStat

# id: (元写真のファイル名, トリミング枠, ぼかす枠のリスト, 塗りつぶす枠のリスト)
PHOTOS = {
    "figurine-children": ("figurine_2280.jpg", (0.17, 0.15, 0.78, 0.92), [(0.34, 0.46, 0.56, 0.59)], []),
    "bronze-vase": ("bronze_vase_2800.jpg", (0.19, 0.08, 0.82, 1.0), [(0.45, 0.39, 0.56, 0.46)], []),
    "wood-statue": ("wood_statue_5650.jpg", (0.15, 0.02, 0.72, 1.0), [(0.43, 0.09, 0.57, 0.16)], []),
    "citizen-wall-clock": ("citizen_clock_3300.jpg", (0.10, 0.085, 0.84, 0.99), [(0.76, 0.68, 0.86, 0.77)], []),
    "cupboard-white": ("cupboard_white_price_unclear.jpg", (0.02, 0.0, 0.93, 0.80), [(0.17, 0.04, 0.28, 0.14)], []),
    "rice-cooker-2024": ("rice_cooker_new_2024_8200.jpg", (0.12, 0.15, 0.93, 0.92), [(0.47, 0.32, 0.63, 0.51)], []),
    "drum-washer": ("drum_washer_45000.jpg", (0.21, 0.06, 0.92, 0.92), [(0.57, 0.28, 0.79, 0.49)], []),
    "aqua-fridge-355": ("aqua_fridge_355L_2024_65000_HAS_POSTER_QR.jpg", (0.26, 0.03, 0.70, 0.97), [], [(0.29, 0.04, 0.75, 0.47)]),
    "fitness-bike": ("fitness_bike_price_unknown.jpg", (0.22, 0.02, 0.68, 0.99), [(0.44, 0.13, 0.52, 0.19)], []),
    "industrial-fan": ("industrial_fan_5500.jpg", (0.18, 0.04, 0.76, 1.0), [(0.41, 0.26, 0.53, 0.34)], []),
    "dresser-mirror": ("dresser_price_unknown.jpg", (0.02, 0.02, 0.80, 0.88), [(0.08, 0.02, 0.22, 0.09)], []),
    "electric-heater": ("electric_heater_soldout.jpg", (0.13, 0.18, 0.855, 0.85), [], []),
    "acoustic-guitar": ("acoustic_guitar_price_unknown.jpg", (0.20, 0.0, 0.80, 0.99), [], []),
    # 商品ではない紹介用（衣類の店頭販売）
    "clothes-rack": ("clothes_rack_sale10.jpg", (0.10, 0.08, 0.90, 1.0), [], []),
}

SIZES = [("", 1200), ("-480", 480)]
QUALITY = 80


def box_px(im, b):
    w, h = im.size
    return (round(b[0] * w), round(b[1] * h), round(b[2] * w), round(b[3] * h))


def fill(im, b):
    """枠の中を、すぐ下の帯（扉の地の色）の平均色で塗りつぶし、境目をぼかす。"""
    x0, y0, x1, y1 = box_px(im, b)
    band = im.crop((x0, y1, x1, min(im.size[1], y1 + max(8, (y1 - y0) // 20))))
    color = tuple(int(v) for v in ImageStat.Stat(band).median)
    im.paste(color, (x0, y0, x1, y1))
    pad = max(6, (x1 - x0) // 40)
    region = (max(0, x0 - pad), max(0, y0 - pad), min(im.size[0], x1 + pad), min(im.size[1], y1 + pad))
    im.paste(im.crop(region).filter(ImageFilter.GaussianBlur(pad)), region[:2])


def blur(im, b):
    x0, y0, x1, y1 = box_px(im, b)
    r = max(12, (x1 - x0) // 4)
    im.paste(im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(r)), (x0, y0))


def clean_copy(im):
    """画素だけを新しい画像に貼り直す（EXIF・GPS・ICC を持ち越さない）。"""
    out = Image.new("RGB", im.size)
    out.paste(im.convert("RGB"))
    return out


def process(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for pid, (fname, crop, blurs, fills) in PHOTOS.items():
        if "DO_NOT_PUBLISH" in fname:
            raise SystemExit("公開しない写真は使わない：" + fname)
        im = ImageOps.exif_transpose(Image.open(os.path.join(src_dir, fname))).convert("RGB")
        for b in fills:
            fill(im, b)
        for b in blurs:
            blur(im, b)
        im = clean_copy(im.crop(box_px(im, crop)))
        for suffix, size in SIZES:
            t = im.copy()
            t.thumbnail((size, size), Image.LANCZOS)
            t = clean_copy(t)
            path = os.path.join(out_dir, pid + suffix + ".jpg")
            t.save(path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            print(path, t.size)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    out = "assets/shop"
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i:i + 2]
    process(args[0], out)
