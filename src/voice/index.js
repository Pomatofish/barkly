// src/voice/index.js — STUB (Phase 1). The voice subagent ports demos/mic-tts-test-insta/.
// Keep the exports and their never-throw contracts (see shared/types.js §5).
import { ERR } from '../../shared/types.js';

let listening = false;

/** @returns {Promise<{ok:true}|{ok:false,error:{code:string,message:string}}>} */
export async function startListening() {
  try {
    listening = true;
    console.log('[grammy/voice] (stub) startListening');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: { code: ERR.MIC_UNAVAILABLE, message: String(e && e.message) } };
  }
}

/** @returns {Promise<Blob|null>} */
export async function stopListening() {
  try {
    listening = false;
    console.log('[grammy/voice] (stub) stopListening');
    return new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'audio/webm' });
  } catch (e) {
    return null;
  }
}

/** @param {Blob} blob @returns {Promise<string>} */
export async function transcribe(blob) {
  try {
    console.log('[grammy/voice] (stub) transcribe', blob && blob.size, 'bytes');
    return "what's this post about";
  } catch (e) {
    return '';
  }
}

/** @param {string} text @returns {Promise<void>} */
export async function speak(text) {
  try {
    console.log('[grammy/voice] (stub) speak:', text);
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) {
    /* row 12: silent */
  }
}

export function stopSpeaking() {
  /* stub */
}

export function isListening() {
  return listening;
}
