// src/voice/offscreen.js — STUB. Runs on the extension origin so it inherits the microphone grant
// made on the onboarding page. Handles ONLY messages with target === 'offscreen'.
// The voice subagent replaces this with a real MediaRecorder (port demos/mic-tts-test-insta/offscreen.js).
import { MSG, ok, fail, ERR } from '../../shared/types.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  try {
    if (msg.type === MSG.VOICE_START) {
      sendResponse(ok({ started: true }));
      return false;
    }
    if (msg.type === MSG.VOICE_STOP) {
      // 1 KB of silence, base64 — enough for the round trip to be exercised
      const silence = btoa(String.fromCharCode(...new Uint8Array(1024)));
      sendResponse(ok({ audioBase64: silence, mime: 'audio/webm' }));
      return false;
    }
    sendResponse(fail(ERR.UNKNOWN_TYPE, msg.type));
  } catch (e) {
    sendResponse(fail(ERR.OFFSCREEN_FAILED, e?.message));
  }
  return false;
});
