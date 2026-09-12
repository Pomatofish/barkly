// tools/probe-model.js — checks that the key in GRAMMY_TEST_KEY works and that every model id
// in src/bg/config.js is accepted by the API. Prints one line per model. Never prints the key.
//   GRAMMY_TEST_KEY=sk-...  node tools/probe-model.js
import { MODELS, TTS_VOICE, API } from '../src/bg/config.js';

const key = (process.env.GRAMMY_TEST_KEY || '').trim();
if (!key) { console.error('GRAMMY_TEST_KEY is not set in this shell'); process.exit(1); }
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function probeText(label, model) {
  const t0 = Date.now();
  try {
    const res = await fetch(API.responses, {
      method: 'POST', headers,
      body: JSON.stringify({ model, input: 'Reply with the single word OK.', max_output_tokens: 16 }),
    });
    const body = await res.text();
    let note = '';
    if (!res.ok) { try { note = JSON.parse(body).error.message; } catch { note = body; } }
    else { try { const j = JSON.parse(body); note = (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join(' ').trim() || '(no text)'; } catch { note = '(unparsable)'; } }
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${label.padEnd(14)} ${model.padEnd(22)} HTTP ${res.status}  ${Date.now() - t0} ms  ${note.slice(0, 120)}`);
  } catch (e) {
    console.log(`FAIL ${label.padEnd(14)} ${model.padEnd(22)} ${e.message}`);
  }
}

async function probeTTS() {
  const t0 = Date.now();
  try {
    const res = await fetch(API.speech, {
      method: 'POST', headers,
      body: JSON.stringify({ model: MODELS.tts, voice: TTS_VOICE, input: 'ok', response_format: 'mp3' }),
    });
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    const note = res.ok ? `${bytes} bytes of audio` : (await res.text()).slice(0, 120);
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${'tts'.padEnd(14)} ${MODELS.tts.padEnd(22)} HTTP ${res.status}  ${Date.now() - t0} ms  ${note}`);
  } catch (e) {
    console.log(`FAIL tts            ${MODELS.tts}  ${e.message}`);
  }
}

async function probeSTT() {
  // 0.2 s of silent 16-bit mono PCM WAV — enough to check the model id and the key.
  const t0 = Date.now();
  try {
    const rate = 16000, n = rate / 5, dataLen = n * 2;
    const buf = Buffer.alloc(44 + dataLen);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
    const fd = new FormData();
    fd.append('file', new File([buf], 'silence.wav', { type: 'audio/wav' }));
    fd.append('model', MODELS.stt);
    fd.append('response_format', 'json');
    const res = await fetch(API.transcriptions, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
    const body = await res.text();
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${'stt'.padEnd(14)} ${MODELS.stt.padEnd(22)} HTTP ${res.status}  ${Date.now() - t0} ms  ${body.slice(0, 120)}`);
  } catch (e) {
    console.log(`FAIL stt            ${MODELS.stt}  ${e.message}`);
  }
}

console.log(`probing ${API.base} with a key ending in …${key.slice(-4)}`);
await probeText('brain', MODELS.brain);
await probeText('brainFallback', MODELS.brainFallback);
await probeText('side', MODELS.side);
await probeTTS();
await probeSTT();
console.log('\nIf a brain/fallback line says the model does not exist, change the id in src/bg/config.js only.');
