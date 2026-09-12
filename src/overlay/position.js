// src/overlay/position.js — pure geometry helpers for floating the bubble/panel next to the
// draggable mascot, and for row 18 (flip on overflow, truncate if still too long).
// No chrome.* / DOM globals are touched here except getBoundingClientRect-shaped plain objects
// the caller passes in, plus a couple of DOM measurements inside fitBubbleText (which only runs
// once mountOverlay() has created real elements). Safe to import from a Node test file.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Choose the best side to float `size` next to `anchor` (a DOMRect-like {left,top,right,bottom}),
 * preferring left-of-anchor (classic mascot-bubble position), falling back to right/top/bottom,
 * and finally clamping into the viewport if nothing fits cleanly (row 18: flip on overflow).
 * @param {{left:number,top:number,right:number,bottom:number}} anchor
 * @param {{width:number,height:number}} size
 * @param {number} margin
 * @param {{innerWidth:number, innerHeight:number}} [viewport]
 */
export function computeFloatPosition(anchor, size, margin = 12, viewport) {
  const vw = (viewport && viewport.innerWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = (viewport && viewport.innerHeight) || (typeof window !== 'undefined' ? window.innerHeight : 800);
  const w = Math.max(0, size.width || 0);
  const h = Math.max(0, size.height || 0);
  const candidates = [
    { side: 'left', x: anchor.left - margin - w, y: anchor.bottom - h },
    { side: 'right', x: anchor.right + margin, y: anchor.bottom - h },
    { side: 'top', x: anchor.right - w, y: anchor.top - margin - h },
    { side: 'bottom', x: anchor.right - w, y: anchor.bottom + margin },
  ];
  for (const c of candidates) {
    if (c.x >= margin && c.x + w <= vw - margin && c.y >= margin && c.y + h <= vh - margin) {
      return { side: c.side, x: c.x, y: c.y };
    }
  }
  const c = candidates[0];
  return {
    side: c.side,
    x: clamp(c.x, margin, Math.max(margin, vw - w - margin)),
    y: clamp(c.y, margin, Math.max(margin, vh - h - margin)),
  };
}

/**
 * Row 18 last resort: the bubble still overflows the viewport height even after flipping sides.
 * Binary-search the longest prefix of `fullText` (plus "…") whose rendered height fits `maxH`.
 * Mutates `el.textContent` as a side effect of measuring; leaves it set to the chosen string.
 * @param {HTMLElement} el   the bubble element (already in the layout tree, max-width set)
 * @param {string} fullText
 * @param {number} maxH
 * @returns {string} the text actually left on the element
 */
export function fitBubbleText(el, fullText, maxH) {
  el.textContent = fullText;
  if (el.scrollHeight <= maxH) return fullText;
  let lo = 0;
  let hi = fullText.length;
  let best = '…';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = fullText.slice(0, mid).trimEnd() + '…';
    el.textContent = candidate;
    if (el.scrollHeight <= maxH) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.textContent = best;
  return best;
}
