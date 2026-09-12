// src/voice/index.js — STUB. The voice subagent replaces this with the MediaRecorder push-to-talk
// (recorded in src/voice/offscreen.html on the extension origin) + TRANSCRIBE / SPEAK via bg.
// Interface: startListening(), stopListening(), transcribe(), speak() — see shared/types.js.
import { ok } from '../../shared/types.js';

let listening = false;
let startedAt = 0;

/** @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>} */
export async function startListening() {
  try {
    listening = true;
    startedAt = Date.now();
    console.log('[voice stub] startListening');
    return ok(null);
  } catch (e) {
    return { ok: false, error: { code: 'MIC_DENIED', message: e?.message || 'mic denied' } };
  }
}

/** @returns {Promise<Blob|null>} */
export async function stopListening() {
  try {
    if (!listening) return null;
    listening = false;
    const ms = Date.now() - startedAt;
    console.log(`[voice stub] stopListening after ${ms} ms`);
    return new Blob([new Uint8Array(1024)], { type: 'audio/webm' });
  } catch (e) {
    return null;
  }
}

/** @param {Blob} blob @returns {Promise<string>} '' on failure */
export async function transcribe(blob) {
  try {
    if (!blob || blob.size === 0) return '';
    await new Promise((r) => setTimeout(r, 300));
    return "what's this post about?";
  } catch (e) {
    return '';
  }
}

/** @param {string} text @returns {Promise<void>} resolves silently on failure */
export async function speak(text) {
  try {
    console.log('[voice stub] speak:', text);
    await new Promise((r) => setTimeout(r, 200));
  } catch (e) {
    /* row 12: silent */
  }
}
