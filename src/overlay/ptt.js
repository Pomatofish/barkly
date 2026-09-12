// src/overlay/ptt.js — pure gesture wiring, no mic/model calls of its own. index.js supplies the
// callbacks; this module only tells it "tap", "long-press started/ended", "drag started/moved/ended".
// Every attach* function does its DOM/listener work only when called (from mountOverlay()), never
// at module top level, so this file still imports cleanly in Node/test pages.

/**
 * Distinguishes tap / drag / long-press on a single pointer-driven element (the mascot).
 * @param {HTMLElement} el
 * @param {{
 *   dragThreshold?: number, longPressMs: number,
 *   onTap: () => void,
 *   onLongPressStart: () => void, onLongPressEnd: () => void,
 *   onDragStart: () => void, onDragMove: (dx:number, dy:number) => void, onDragEnd: () => void,
 * }} opts
 * @returns {() => void} detach
 */
export function attachMascotGestures(el, opts) {
  const dragThreshold = opts.dragThreshold == null ? 6 : opts.dragThreshold;
  let s = null; // { startX, startY, moved, longPressFired, pointerId, timer }

  function onDown(e) {
    if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    s = { startX: e.clientX, startY: e.clientY, moved: false, longPressFired: false, pointerId: e.pointerId, timer: 0 };
    s.timer = setTimeout(() => {
      if (s && !s.moved) {
        s.longPressFired = true;
        try { opts.onLongPressStart(); } catch (err) { console.warn('[grammy/overlay] onLongPressStart', err); }
      }
    }, opts.longPressMs);
  }

  function onMove(e) {
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) > dragThreshold) {
      s.moved = true;
      clearTimeout(s.timer);
      if (s.longPressFired) {
        s.longPressFired = false;
        try { opts.onLongPressEnd(); } catch (err) { console.warn('[grammy/overlay] onLongPressEnd', err); }
      }
      try { opts.onDragStart(); } catch (err) { console.warn('[grammy/overlay] onDragStart', err); }
    }
    if (s.moved) {
      try { opts.onDragMove(dx, dy); } catch (err) { console.warn('[grammy/overlay] onDragMove', err); }
    }
  }

  function onUp(e) {
    if (!s || s.pointerId !== e.pointerId) return;
    clearTimeout(s.timer);
    if (s.longPressFired) {
      try { opts.onLongPressEnd(); } catch (err) { console.warn('[grammy/overlay] onLongPressEnd', err); }
    } else if (!s.moved) {
      try { opts.onTap(); } catch (err) { console.warn('[grammy/overlay] onTap', err); }
    }
    if (s.moved) {
      try { opts.onDragEnd(); } catch (err) { console.warn('[grammy/overlay] onDragEnd', err); }
    }
    s = null;
  }

  function onCancel(e) {
    if (!s || s.pointerId !== e.pointerId) return;
    clearTimeout(s.timer);
    if (s.longPressFired) { try { opts.onLongPressEnd(); } catch (_) { /* ignore */ } }
    else if (s.moved) { try { opts.onDragEnd(); } catch (_) { /* ignore */ } }
    s = null;
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}

/** Simple press-and-hold (no drag) for the panel's PTT button. */
export function attachHoldToTalk(el, { onStart, onEnd }) {
  let down = false;
  function start(e) {
    if (down) return;
    down = true;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    try { onStart(); } catch (err) { console.warn('[grammy/overlay] ptt onStart', err); }
  }
  function end() {
    if (!down) return;
    down = false;
    try { onEnd(); } catch (err) { console.warn('[grammy/overlay] ptt onEnd', err); }
  }
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  return () => {
    el.removeEventListener('pointerdown', start);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('lostpointercapture', end);
  };
}

/** Holding Space triggers PTT when no Instagram/own input is focused. */
export function attachSpacebarHoldToTalk({ isBlocked, onStart, onEnd }) {
  let active = false;
  function onKeydown(e) {
    if (e.code !== 'Backquote' || e.repeat || active) return;
    if (isBlocked()) return;
    active = true;
    try { e.preventDefault(); } catch (_) { /* ignore */ }
    try { onStart(); } catch (err) { console.warn('[grammy/overlay] space onStart', err); }
  }
  function onKeyup(e) {
    if (e.code !== 'Backquote' || !active) return;
    active = false;
    try { onEnd(); } catch (err) { console.warn('[grammy/overlay] space onEnd', err); }
  }
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keyup', onKeyup, true);
  return () => {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('keyup', onKeyup, true);
  };
}
