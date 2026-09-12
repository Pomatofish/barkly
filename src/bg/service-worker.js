// src/bg/service-worker.js — STUB (Phase 1). Routes every bus type and returns fake data.
// The bg subagent replaces the handlers with real fetches (see shared/types.js §6).
import { MSG, ERR, ok, fail, STORAGE_KEYS, OFFSCREEN_URL, defaultMemory } from '../../shared/types.js';
import { MODELS } from './config.js';

// Open onboarding on first install.
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') chrome.runtime.openOptionsPage();
  } catch (e) {
    console.warn('[grammy/bg] openOptionsPage', e);
  }
});

// Toolbar icon → settings.
try {
  chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
} catch (e) {
  /* no action API in some contexts */
}

async function readMemory() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    const m = got[STORAGE_KEYS.MEMORY];
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
    .finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

async function toOffscreen(type, data) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, data: data || {} });
  return res || fail(ERR.OFFSCREEN_FAILED, 'No response from offscreen document');
}

async function handle(msg, sender) {
  const data = (msg && msg.data) || {};
  switch (msg.type) {
    case MSG.ASK:
    case MSG.STYLE_ADVICE: {
      const got = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
      if (!got[STORAGE_KEYS.API_KEY]) {
        // Stub still answers so the UI can be exercised without a key.
        console.log('[grammy/bg] (stub) no API key set; returning fake reply');
      }
      const fakeJson = JSON.stringify({
        reply: "It's a sunrise shot from the Cliffs of Moher on 35mm film, and the comments are all about that light.",
        highlightTarget: null,
        memoryUpdate: null,
      });
      return ok({ text: data.responseFormat === 'text' ? 'Warm golden-hour light, one accent colour, wide frame.' : fakeJson, model: MODELS.brain });
    }
    case MSG.SPEAK:
      return ok({ audioBase64: '', mime: 'audio/mpeg' });
    case MSG.TRANSCRIBE:
      return ok({ text: "what's this post about" });
    case MSG.GET_MEMORY:
      return ok(await readMemory());
    case MSG.SAVE_MEMORY:
      return ok(await writeMemory(data.memory));
    case MSG.VOICE_START:
      return toOffscreen(MSG.VOICE_START, data);
    case MSG.VOICE_STOP:
      return toOffscreen(MSG.VOICE_STOP, data);
    case MSG.OPEN_ONBOARDING:
      await chrome.runtime.openOptionsPage();
      return ok(null);
    default:
      return fail(ERR.UNKNOWN_TYPE, `Unknown message type: ${msg && msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false; // for the offscreen doc, not us
  handle(msg, sender)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse(fail(ERR.INTERNAL, e && e.message)));
  return true; // async
});
