// src/voice/recorder.js — offscreen-document recorder. Captures raw PCM through the Web Audio
// API and packs it as a 16-bit mono WAV (16 kHz). WAV is accepted unconditionally by the
// transcription endpoint; MediaRecorder's WebM/Opus output was rejected live as
// "Audio file might be corrupted or unsupported".
//
// startRecording() -> {ok:true} | {ok:false, error:{code,message}}
// stopRecording()  -> {ok:true, data:{audioBase64, mime:'audio/wav'}} | {ok:false, error}
import { ERR } from '../../shared/types.js';

const RATE = 16000;
let stream = null;
let ctx = null;
let source = null;
let proc = null;
let chunks = [];
let starting = false;

function fail(code, message) { return { ok: false, error: { code, message: String(message || code) } }; }

function mapError(e) {
  const name = (e && e.name) || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return fail(ERR.MIC_DENIED, (e && e.message) || 'Microphone permission denied');
  return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || 'Microphone unavailable');
}

function release() {
  try { if (proc) { proc.disconnect(); proc.onaudioprocess = null; } } catch (_) { /* ignore */ }
  try { if (source) source.disconnect(); } catch (_) { /* ignore */ }
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
  try { if (ctx) ctx.close(); } catch (_) { /* ignore */ }
  proc = null; source = null; stream = null; ctx = null;
}

export function isRecording() { return !!proc; }

export async function startRecording() {
  if (proc || starting) return { ok: true };
  starting = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail(ERR.MIC_UNAVAILABLE, 'getUserMedia not available');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ sampleRate: RATE }); } catch (_) { ctx = new AC(); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) { /* ignore */ } }
    source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    proc.onaudioprocess = (ev) => {
      try { chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); } catch (_) { /* ignore */ }
    };
    source.connect(proc);
    proc.connect(ctx.destination); // required for onaudioprocess to fire in Chromium
    return { ok: true };
  } catch (e) {
    release();
    return mapError(e);
  } finally {
    starting = false;
  }
}

export async function stopRecording() {
  try {
    if (!proc || !ctx) { release(); return fail(ERR.MIC_UNAVAILABLE, 'not recording'); }
    const rate = ctx.sampleRate || RATE;
    const parts = chunks; chunks = [];
    release();
    const total = parts.reduce((n, c) => n + c.length, 0);
    const wav = encodeWav(parts, total, rate);
    return { ok: true, data: { audioBase64: bytesToBase64(wav), mime: 'audio/wav' } };
  } catch (e) {
    chunks = [];
    release();
    return fail(ERR.MIC_UNAVAILABLE, (e && e.message) || String(e));
  }
}

function encodeWav(parts, total, rate) {
  const dataLen = total * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (const c of parts) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

function bytesToBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(bin);
}
