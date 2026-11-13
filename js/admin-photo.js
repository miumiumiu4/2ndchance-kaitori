// 管理画面の写真：端末の中で縮めて JPEG にし直す（EXIF・位置情報・色の記録は残らない）。
// /admin/（js/admin.js）と /admin/quick/（js/admin-quick.js）が同じ式を使う。大きさの上限は admin-core.js。
import * as A from "./admin-core.js";

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function toJpeg(src, max) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const { w, h } = A.fitSize(w0, h0, max);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", 0.82);
  // ブラウザが付ける色の記録（ICC）なども落として、画素だけの JPEG にする
  const raw = atob(url.slice(url.indexOf(",") + 1));
  const bytes = A.stripJpegMeta(Array.from(raw, (ch) => ch.charCodeAt(0)));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
  return { url, base64: btoa(bin), w, h };
}
// 1枚の写真 → { big: 長辺 1200px, thumb: 長辺 480px }（どちらも { url, base64, w, h }）
export async function makePhotos(file) {
  const src = await decode(file);
  return { big: toJpeg(src, A.PHOTO_MAX), thumb: toJpeg(src, A.THUMB_MAX) };
}
