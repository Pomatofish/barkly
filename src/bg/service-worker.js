// src/bg/service-worker.js — the real background router. All model/TTS/STT
// fetches happen through src/bg/api.js (pure, no chrome.*); this file is the
// chrome.* glue: storage, tab messaging, the offscreen document, and the
// chrome.runtime.onMessage router.
//
// Top-level chrome.* access is guarded by `typeof chrome !== 'undefined'` so a
// Node test can install a fake `globalThis.chrome` shim, import this module,
// and drive the router either through the captured onMessage listener or the
// exported `handle()` directly.
import { MSG, ERR, ok, fail, STORAGE_KEYS, OFFSCREEN_URL, ONBOARDING_URL, defaultMemory } from '../../shared/types.js';
import { MODELS } from './config.js';
import { DEFAULT_API_KEY } from './secrets.js';
import { callModel, speech, transcribe } from './api.js';

/* --------------------------------------------------------------- test seam */

// Real fetch by default; tests override via _setDepsForTest({ fetchImpl }).
let deps = { fetchImpl: (...args) => globalThis.fetch(...args) };

export function _setDepsForTest(overrides) {
  deps = { ...deps, ...(overrides || {}) };
}

/* ------------------------------------------------------------------ memory */

async function readMemory() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    const m = got && got[STORAGE_KEYS.MEMORY];
    if (!m || typeof m !== 'object') return defaultMemory();
    return { ...defaultMemory(), ...m, profile: { ...defaultMemory().profile, ...(m.profile || {}) } };
  } catch (e) {
    return defaultMemory();
  }
}

async function writeMemory(partial) {
  const cur = await readMemory();
  const p = partial || {};
  const next = { ...cur, ...p, profile: { ...cur.profile, ...(p.profile || {}) } };
  await chrome.storage.local.set({ [STORAGE_KEYS.MEMORY]: next });
  return next;
}

/* --------------------------------------------------------------- API key */

async function getKey() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
    const v = got && got[STORAGE_KEYS.API_KEY];
    const saved = typeof v === 'string' ? v.trim() : '';
    return saved || (DEFAULT_API_KEY || '').trim();
  } catch (e) {
    return (DEFAULT_API_KEY || '').trim();
  }
}

/* --------------------------------------------------------- status pushes */

function pushStatus(sender, pill) {
  try {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: MSG.STATUS, data: pill }).catch(() => {});
  } catch (e) {
    /* no tab to push to (e.g. message came from the offscreen doc or a popup) */
  }
}

/* ------------------------------------------------------------- offscreen */
// Ported from demos/mic-tts-test-insta/background.js: getContexts() guard plus
// a shared in-flight promise so two near-simultaneous VOICE_START calls only
// create one offscreen document.

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Record push-to-talk audio while the user browses Instagram.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  return creatingOffscreen;
}

async function toOffscreen(type, data) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, data: data || {} });
  return res || fail(ERR.OFFSCREEN_FAILED, 'No response from offscreen document');
}

/* ------------------------------------------------------------------ router */

export async function handle(msg, sender) {
  const data = (msg && msg.data) || {};
  switch (msg && msg.type) {
    case MSG.ASK:
    case MSG.STYLE_ADVICE: {
      const apiKey = await getKey();
      const onStatus = (pill) => pushStatus(sender, pill);
      return callModel({ req: data, apiKey, fetchImpl: deps.fetchImpl, onStatus, models: MODELS });
    }
    case MSG.SPEAK: {
      const apiKey = await getKey();
      return speech({ text: data.text, apiKey, fetchImpl: deps.fetchImpl });
    }
    case MSG.TRANSCRIBE: {
      const apiKey = await getKey();
      return transcribe({ audioBase64: data.audioBase64, mime: data.mime, apiKey, fetchImpl: deps.fetchImpl });
    }
    case MSG.GET_MEMORY:
      return ok(await readMemory());
    case MSG.SAVE_MEMORY:
      return ok(await writeMemory(data.memory));
    case MSG.VOICE_START:
      return toOffscreen(MSG.VOICE_START, data);
    case MSG.VOICE_STOP:
      return toOffscreen(MSG.VOICE_STOP, data);
    case MSG.OPEN_ONBOARDING:
      try {
        await chrome.runtime.openOptionsPage();
        return ok(null);
      } catch (e) {
        try { await chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_URL) }); return ok(null); } catch (e2) { return fail(ERR.INTERNAL, (e2 && e2.message) || 'could not open settings'); }
      }
    default:
      return fail(ERR.UNKNOWN_TYPE, `Unknown message type: ${msg && msg.type}`);
  }
}

/* ------------------------------------------------------------- registration */
// Guarded so this module can be imported in Node once a fake `chrome` is
// installed on globalThis; every sub-registration is its own try/catch so one
// missing API (e.g. no chrome.action in some contexts) never blocks the rest.

if (typeof chrome !== 'undefined') {
  try {
    chrome.runtime.onInstalled.addListener((details) => {
      try {
        if (details && details.reason === 'install') chrome.runtime.openOptionsPage();
      } catch (e) {
        console.warn('[grammy/bg] openOptionsPage', e);
      }
    });
  } catch (e) {
    /* ignore */
  }

  try {
    chrome.action.onClicked.addListener(() => {
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* ignore */
      }
    });
  } catch (e) {
    /* no action API in some contexts */
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.target === 'offscreen') return false; // for the offscreen doc, not us
      handle(msg, sender)
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse(fail(ERR.INTERNAL, (e && e.message) || 'internal error')));
      return true; // async response
    });
  } catch (e) {
    /* ignore */
  }
}
