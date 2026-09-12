// src/main.js — content-side integration hub (owned by the orchestrator).
// Mounts the overlay and routes messages that arrive FROM the background
// (chrome.tabs.sendMessage) to the right module. Modules talk to each other
// through direct imports; they talk to the background through request().
import { MSG, ERR, ok, fail } from '../shared/types.js';
import { getPageContext } from './context/index.js';
import { mountOverlay, setStatus, highlight, clearHighlight } from './overlay/index.js';

function onMessage(msg, _sender, sendResponse) {
  if (!msg || msg.target === 'offscreen') return false;
  try {
    switch (msg.type) {
      case MSG.GET_CONTEXT:
        getPageContext()
          .then((ctx) => sendResponse(ok(ctx)))
          .catch((e) => sendResponse(fail(ERR.INTERNAL, e && e.message)));
        return true; // async
      case MSG.STATUS:
        setStatus(msg.data && msg.data.level, msg.data && msg.data.message);
        sendResponse(ok(null));
        return false;
      case MSG.HIGHLIGHT:
        if (msg.data && msg.data.target) highlight(msg.data.target);
        else clearHighlight();
        sendResponse(ok(null));
        return false;
      default:
        return false; // not for us; let other listeners answer
    }
  } catch (e) {
    sendResponse(fail(ERR.INTERNAL, e && e.message));
    return false;
  }
}

try {
  chrome.runtime.onMessage.addListener(onMessage);
} catch (e) {
  console.error('[grammy] could not register message listener', e);
}

try {
  mountOverlay();
} catch (e) {
  console.error('[grammy] overlay failed to mount', e);
}
