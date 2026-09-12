// src/voice/index.js — content-script-side voice API (shared/types.js §5).
// No chrome.* or DOM access at module top level: everything touches
// chrome/Audio/FileReader lazily inside functions so this imports cleanly in
// plain test pages and in Node.
import { request, MSG, ERR } from '../../shared/types.js';

let listening = false;
let currentAudio = null;
let lastError = null;
/** Last voice failure (stop/transcribe), for the overlay's row-8 reason line. */
export function lastVoiceError() { return lastError; }

/** @returns {Promise<{ok:true}|{ok:false,error:{code:string,message:string}}>} */
export async function startListening() {
  try {
    const res = await request(MSG.VOICE_START, {});
    if (res && res.ok) {
      listening = true;
      return { ok: true };
    }
    listening = false;
    const err = (res && res.error) || { code: ERR.MIC_UNAVAILABLE, message: 'could not start listening' };
    return { ok: false, error: err };
  } catch (e) {
    listening = false;
    return { ok: false, error: { code: ERR.MIC_UNAVAILABLE, message: (e && e.message) || String(e) } };
  }
}

/** @returns {Promise<Blob|null>} */
export async function stopListening() {
  try {
    const res = await request(MSG.VOICE_STOP, {});
    listening = false;
    if (!res || !res.ok || !res.data || !res.data.audioBase64) { lastError = (res && res.error) || { code: 'NO_AUDIO', message: 'no audio returned' }; console.warn('[grammy/voice] stopListening', lastError); return null; }
    lastError = null;
    const { audioBase64, mime } = res.data;
    const bytes = base64ToUint8Array(audioBase64);
    return new Blob([bytes], { type: mime || 'audio/webm' });
  } catch (e) {
    listening = false;
    return null;
  }
}

/** @param {Blob} blob @returns {Promise<string>} */
export async function transcribe(blob) {
  try {
    if (!blob) return '';
    const audioBase64 = await blobToBase64(blob);
    const res = await request(MSG.TRANSCRIBE, { audioBase64, mime: blob.type || 'audio/webm' });
    if (!res || !res.ok || !res.data) { lastError = (res && res.error) || { code: 'STT_FAILED', message: 'empty response' }; console.warn('[grammy/voice] transcribe', lastError); return ''; }
    lastError = null;
    return String(res.data.text || '').trim();
  } catch (e) {
    return '';
  }
}

/** @param {string} text @returns {Promise<void>} never rejects (row 12) */
export async function speak(text) {
  try {
    if (!text) return;
    const res = await request(MSG.SPEAK, { text });
    if (!res || !res.ok || !res.data || !res.data.audioBase64) return; // row 12: silent
    const { audioBase64, mime } = res.data;
    const url = `data:${mime || 'audio/mpeg'};base64,${audioBase64}`;
    await playAudio(url);
  } catch (e) {
    /* row 12: silent */
  }
}

export function stopSpeaking() {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  } catch (e) {
    /* noop */
  }
}

export function isListening() {
  return listening;
}

/* ---------------------------------------------------------------------- */

/** Plays a data: URL and resolves on end/error/rejected-play. Never rejects. */
function playAudio(url) {
  return new Promise((resolve) => {
    let done = false;
    let timeoutId = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve();
    };
    try {
      const audio = new Audio(url);
      currentAudio = audio;
      audio.addEventListener('ended', () => {
        if (currentAudio === audio) currentAudio = null;
        finish();
      }, { once: true });
      audio.addEventListener('error', () => {
        if (currentAudio === audio) currentAudio = null;
        finish();
      }, { once: true });
      // Safety net: some environments (autoplay quirks, headless browsers)
      // never fire ended/error. speak() must resolve regardless (row 12/19).
      timeoutId = setTimeout(finish, 2500);
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => finish());
      }
    } catch (e) {
      finish();
    }
  });
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {Blob} blob @returns {Promise<string>} base64 (no data: prefix) */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || '');
        const idx = dataUrl.indexOf(',');
        resolve(idx >= 0 ? dataUrl.slice(idx + 1) : '');
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
      return;
    }
    blob
      .arrayBuffer()
      .then((buf) => resolve(arrayBufferToBase64(buf)))
      .catch(reject);
  });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
