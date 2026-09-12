// src/voice/offscreen.js — runs on the extension origin so it inherits the
// microphone grant made on the onboarding page. Handles
// { target:'offscreen', type: MSG.VOICE_START | MSG.VOICE_STOP } and wraps
// recorder.js's results as bus responses (ok()/fail()).
import { MSG, ok, fail, ERR } from '../../shared/types.js';
import { startRecording, stopRecording } from './recorder.js';

async function handleStart() {
  const res = await startRecording();
  if (res && res.ok) return ok({ started: true });
  const err = (res && res.error) || {};
  return fail(err.code || ERR.MIC_UNAVAILABLE, err.message || 'could not start recording');
}

async function handleStop() {
  const res = await stopRecording();
  if (res && res.ok) return ok(res.data);
  const err = (res && res.error) || {};
  return fail(err.code || ERR.MIC_UNAVAILABLE, err.message || 'could not stop recording');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  try {
    if (msg.type === MSG.VOICE_START) {
      handleStart()
        .then(sendResponse)
        .catch((e) => sendResponse(fail(ERR.OFFSCREEN_FAILED, e && e.message)));
      return true;
    }
    if (msg.type === MSG.VOICE_STOP) {
      handleStop()
        .then(sendResponse)
        .catch((e) => sendResponse(fail(ERR.OFFSCREEN_FAILED, e && e.message)));
      return true;
    }
    sendResponse(fail(ERR.UNKNOWN_TYPE, msg.type));
  } catch (e) {
    sendResponse(fail(ERR.OFFSCREEN_FAILED, e && e.message));
  }
  return false;
});
