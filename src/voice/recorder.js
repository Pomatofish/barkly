// src/voice/recorder.js — runs inside the offscreen document (extension
// origin), which inherits the microphone grant made on the onboarding page.
// Owns the actual MediaRecorder instance. No chrome.* here at all: this file
// is plain getUserMedia/MediaRecorder so it can be imported and driven from a
// plain test page too (see test.html).
//
// Contract (called by offscreen.js):
//   startRecording() -> Promise<{ok:true} | {ok:false,error:{code,message}}>
//   stopRecording()  -> Promise<{ok:true,data:{audioBase64,mime}} | {ok:false,error}>
import { ERR, fail } from '../../shared/types.js';

let stream = null;
let recorder = null;
let chunks = [];
let starting = false; // guards overlapping startRecording() calls

function pickMimeType() {
  try {
    if (
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ) {
      return 'audio/webm;codecs=opus';
    }
  } catch (e) {
    /* fall through to browser default */
  }
  return undefined; // let MediaRecorder pick its own default
}

function releaseStream() {
  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      /* noop */
    }
    stream = null;
  }
}

function mapGetUserMediaError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return fail(ERR.MIC_DENIED, (e && e.message) || name);
  }
  if (name === 'NotFoundError' || name === 'NotReadableError') {
    return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || name);
  }
  return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || String(e));
}

/** @returns {Promise<{ok:true}|{ok:false,error:{code:string,message:string}}>} */
export async function startRecording() {
  try {
    // guard double-start: already recording, or a start already in flight
    if (starting) return { ok: true };
    if (recorder && recorder.state === 'recording') return { ok: true };

    if (typeof MediaRecorder === 'undefined') {
      return fail(ERR.MIC_UNAVAILABLE, 'MediaRecorder is not available in this document');
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return fail(ERR.MIC_UNAVAILABLE, 'getUserMedia is not available in this document');
    }

    starting = true;
    // Any previous stream should already be released by stopRecording(), but
    // guard against a stray one before opening a new one.
    releaseStream();

    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      starting = false;
      return mapGetUserMediaError(e);
    }

    stream = newStream;
    chunks = [];
    const mimeType = pickMimeType();
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      releaseStream();
      recorder = null;
      starting = false;
      return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || 'could not create MediaRecorder');
    }

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });

    recorder.start();
    starting = false;
    return { ok: true };
  } catch (e) {
    starting = false;
    releaseStream();
    recorder = null;
    return mapGetUserMediaError(e);
  }
}

/** @returns {Promise<{ok:true,data:{audioBase64:string,mime:string}}|{ok:false,error:{code:string,message:string}}>} */
export async function stopRecording() {
  try {
    if (!recorder || recorder.state === 'inactive') {
      releaseStream();
      recorder = null;
      return fail(ERR.MIC_UNAVAILABLE, 'not recording');
    }

    const rec = recorder;
    const mime = rec.mimeType || 'audio/webm';

    const stopped = new Promise((resolve) => {
      rec.addEventListener('stop', resolve, { once: true });
    });
    try {
      rec.requestData(); // flush any buffered audio into a final dataavailable
    } catch (e) {
      /* not fatal — stop() below still fires a final dataavailable before stop */
    }
    rec.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mime });
    chunks = [];
    recorder = null;
    releaseStream();

    const audioBase64 = await blobToBase64(blob);
    return { ok: true, data: { audioBase64, mime } };
  } catch (e) {
    chunks = [];
    recorder = null;
    releaseStream();
    return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || String(e));
  }
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
    // Fallback: arrayBuffer + chunked btoa (no FileReader in this context).
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

/** test/debug only: true while a recording is in progress */
export function isRecording() {
  return !!recorder && recorder.state === 'recording';
}
