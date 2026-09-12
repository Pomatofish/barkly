// src/bg/service-worker.js — STUB. Routes every bus message and returns fake data.
// The bg subagent replaces this with real fetches (all network calls happen HERE and only here).
import { MSG, ok, fail, ERR, STORAGE_KEYS, PATHS, defaultMemory } from '../../shared/types.js';
import { MODELS } from './config.js';

// Open onboarding on first install.
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') chrome.runtime.openOptionsPage();
  } catch (e) {
    console.warn('[bg] openOptionsPage failed', e);
  }
});

// Toolbar icon → onboarding/settings.
try {
  chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
} catch (e) { /* no action in manifest */ }

async function getMemory() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    return got?.[STORAGE_KEYS.MEMORY] || defaultMemory();
  } catch (e) {
    return defaultMemory();
  }
}

async function saveMemory(partial) {
  const m = await getMemory();
  if (partial?.profile) m.profile = { ...m.profile, ...partial.profile };
  if (partial?.pinned) m.pinned = partial.pinned;
  if (partial?.history) m.history = partial.history;
  await chrome.storage.local.set({ [STORAGE_KEYS.MEMORY]: m });
  return m;
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen
    .createDocument({ url: PATHS.OFFSCREEN, reasons: ['USER_MEDIA'], justification: 'Record push-to-talk voice questions while the user browses Instagram.' })
    .finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

async function handle(msg, sender) {
  const data = msg.data || {};
  switch (msg.type) {
    case MSG.ASK:
    case MSG.STYLE_ADVICE: {
      const key = (await chrome.storage.local.get(STORAGE_KEYS.API_KEY))?.[STORAGE_KEYS.API_KEY];
      if (!key) return fail(ERR.NO_KEY, 'No API key saved');
      const text = msg.type === MSG.ASK
        ? JSON.stringify({ reply: 'Stub reply from the background worker.', highlightTarget: null, memoryUpdate: null })
        : 'Stub style advice from the background worker.';
      return ok({ text, model: MODELS.brain });
    }
    case MSG.SPEAK:
      return ok({ audioBase64: '', mime: 'audio/mpeg' });
    case MSG.TRANSCRIBE:
      return ok({ text: "what's this post about?" });
    case MSG.GET_MEMORY:
      return ok(await getMemory());
    case MSG.SAVE_MEMORY:
      return ok(await saveMemory(data.memory || {}));
    case MSG.VOICE_START:
    case MSG.VOICE_STOP: {
      await ensureOffscreen();
      const res = await chrome.runtime.sendMessage({ type: msg.type, data, target: 'offscreen' });
      return res && typeof res.ok === 'boolean' ? res : fail(ERR.OFFSCREEN_FAILED, 'no answer from offscreen');
    }
    case MSG.OPEN_ONBOARDING:
      await chrome.runtime.openOptionsPage();
      return ok(null);
    case MSG.GET_CONTEXT: {
      // Ask the content script of the sender's tab (or the active tab).
      const tabId = sender?.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id;
      if (tabId == null) return fail(ERR.INTERNAL, 'no tab');
      return chrome.tabs.sendMessage(tabId, { type: MSG.GET_CONTEXT, data: {}, target: 'content' });
    }
    default:
      return fail(ERR.UNKNOWN_TYPE, `bg does not handle ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.target === 'offscreen' || msg.target === 'content') return false; // not for bg
  handle(msg, sender)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse(fail(ERR.INTERNAL, e?.message || String(e))));
  return true; // async
});
