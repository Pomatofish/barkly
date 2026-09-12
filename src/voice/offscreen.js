// src/voice/offscreen.js — STUB (Phase 1). Runs on the extension origin so it
// inherits the microphone grant made on the onboarding page.
// Handles { target:'offscreen', type: VOICE_START | VOICE_STOP }.
import { MSG, ok, fail, ERR } from '../../shared/types.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  try {
    if (msg.type === MSG.VOICE_START) {
      sendResponse(ok({ started: true }));
      return false;
    }
    if (msg.type === MSG.VOICE_STOP) {
      // 4 fake bytes, base64: AAECAw==
      sendResponse(ok({ audioBase64: 'AAECAw==', mime: 'audio/webm' }));
      return false;
    }
    sendResponse(fail(ERR.UNKNOWN_TYPE, msg.type));
  } catch (e) {
    sendResponse(fail(ERR.OFFSCREEN_FAILED, e && e.message));
  }
  return false;
});
