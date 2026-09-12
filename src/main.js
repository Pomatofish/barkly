// src/main.js — content-side entry (orchestrator-owned). Mounts the overlay and routes
// messages that arrive FROM the background (STATUS, HIGHLIGHT, GET_CONTEXT).
// Module folders never register their own chrome.runtime.onMessage listeners on the content side.
import { MSG, ok, fail, ERR } from '../shared/types.js';
import { mountOverlay, setStatus, highlight, clearHighlight } from './overlay/index.js';
import { getPageContext } from './context/index.js';

function route(msg, _sender, sendResponse) {
  try {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case MSG.STATUS: {
        const { level, message } = msg.data || {};
        setStatus(level || 'yellow', message || '');
        sendResponse(ok(null));
        return false;
      }
      case MSG.HIGHLIGHT: {
        const target = msg.data?.target ?? null;
        if (target) highlight(target); else clearHighlight();
        sendResponse(ok(null));
        return false;
      }
      case MSG.GET_CONTEXT: {
        Promise.resolve(getPageContext())
          .then((ctx) => sendResponse(ok(ctx)))
          .catch((e) => sendResponse(fail(ERR.INTERNAL, e?.message)));
        return true; // async
      }
      default:
        return false; // not for us (bg / offscreen traffic also passes through here)
    }
  } catch (e) {
    try { sendResponse(fail(ERR.INTERNAL, e?.message)); } catch {}
    return false;
  }
}

try {
  chrome.runtime.onMessage.addListener(route);
} catch (e) {
  console.warn('[grammy] could not attach message listener', e);
}

try {
  mountOverlay();
} catch (e) {
  console.error('[grammy] overlay failed to mount', e);
}
