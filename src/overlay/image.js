// src/overlay/image.js — "attach my image" pipeline (row 15).
// Always downscales client-side so the longest edge is <= LIMITS.IMAGE_MAX_PX, then re-encodes
// as JPEG, lowering quality until the payload is <= LIMITS.IMAGE_MAX_BYTES. Uses Image + canvas,
// which only exist once this runs inside a real (or headless) browser — never touched at import
// time, so this module still imports cleanly under Node.

/** @param {File|Blob} file @returns {Promise<string>} data:*;base64,... */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(file);
  });
}

/** @param {string} src @returns {Promise<HTMLImageElement>} */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.ceil((b64.length * 3) / 4);
}

/**
 * @param {File|Blob} file
 * @param {{ maxPx?: number, maxBytes?: number, quality?: number }} [opts]
 * @returns {Promise<string>} JPEG data URL, longest edge <= maxPx, size <= maxBytes (best effort)
 */
export async function downscaleImageFile(file, opts = {}) {
  const maxPx = opts.maxPx || 1024;
  const maxBytes = opts.maxBytes || 4 * 1024 * 1024;
  const startQuality = opts.quality || 0.85;

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxPx / Math.max(srcW, srcH, 1));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  let quality = startQuality;
  let out = canvas.toDataURL('image/jpeg', quality);
  let tries = 0;
  while (dataUrlBytes(out) > maxBytes && quality > 0.35 && tries < 8) {
    quality -= 0.1;
    out = canvas.toDataURL('image/jpeg', quality);
    tries++;
  }
  return out;
}

export function isDataUrlWithinBytes(dataUrl, maxBytes) {
  return dataUrlBytes(dataUrl) <= maxBytes;
}
