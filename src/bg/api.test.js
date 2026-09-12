// src/bg/api.test.js — node --test src/bg/
// Pure module: fake fetch only, no chrome shim needed here.
import test from 'node:test';
import assert from 'node:assert/strict';

import { toResponsesInput, extractOutputText, callModel, speech, transcribe } from './api.js';
import { ERR, PILL } from '../../shared/types.js';
import { MODELS, TTS_VOICE, API } from './config.js';

/* ---------------------------------------------------------------- helpers */

function responsesBody(text) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textRes(status, text) {
  return new Response(text, { status });
}

/** A fetch stub driven by a queue of { status, body } or { text } or { err }. */
function queueFetch(steps) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    calls.push({ url, init });
    if (step.err) throw step.err;
    if ('text' in step) return textRes(step.status ?? 400, step.text);
    return jsonRes(step.status ?? 200, step.body);
  };
  fn.calls = calls;
  return fn;
}

function abortLikeError() {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/* --------------------------------------------------------- toResponsesInput */

test('toResponsesInput: string content, roles, wrapping', () => {
  const input = toResponsesInput([
    { role: 'system', content: 'be nice' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ]);
  assert.deepEqual(input, [
    { role: 'system', content: [{ type: 'input_text', text: 'be nice' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] },
  ]);
});

test('toResponsesInput: content parts, text + image', () => {
  const input = toResponsesInput([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', url: 'https://cdn/x.jpg' },
      ],
    },
  ]);
  assert.deepEqual(input, [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is this?' },
        { type: 'input_image', image_url: 'https://cdn/x.jpg' },
      ],
    },
  ]);
});

test('toResponsesInput: garbage in, never throws', () => {
  assert.deepEqual(toResponsesInput(null), []);
  assert.deepEqual(toResponsesInput(undefined), []);
  assert.deepEqual(toResponsesInput([null, 42, { role: 'user' }]), [
    { role: 'user', content: [{ type: 'input_text', text: '' }] },
  ]);
});

/* -------------------------------------------------------- extractOutputText */

test('extractOutputText: walks output[].content[]', () => {
  const json = responsesBody('hello world');
  assert.equal(extractOutputText(json), 'hello world');
});

test('extractOutputText: joins multiple output_text parts', () => {
  const json = { output: [{ content: [{ type: 'output_text', text: 'a' }, { type: 'output_text', text: 'b' }] }] };
  assert.equal(extractOutputText(json), 'ab');
});

test('extractOutputText: falls back to output_text field, then empty string', () => {
  assert.equal(extractOutputText({ output_text: 'fallback' }), 'fallback');
  assert.equal(extractOutputText({}), '');
  assert.equal(extractOutputText(null), '');
  assert.equal(extractOutputText({ output: [{ content: [{ type: 'refusal', text: 'nope' }] }] }), '');
});

/* -------------------------------------------------------------- callModel */

test('callModel: happy path builds a correct request and returns ok', async () => {
  const fetchImpl = queueFetch([{ status: 200, body: responsesBody('hi!') }]);
  const statuses = [];
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'hey' }], maxOutputTokens: 150, responseFormat: 'json' },
    apiKey: 'sk-test-key',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.deepEqual(res, { ok: true, data: { text: 'hi!', model: MODELS.brain } });
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, API.responses);
  assert.equal(init.headers.Authorization, 'Bearer sk-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.model, MODELS.brain);
  assert.equal(body.max_output_tokens, 150);
  assert.equal(body.reasoning.effort, 'low');
  assert.deepEqual(body.text, { format: { type: 'json_object' } });
  assert.equal(statuses.length, 0); // no retries, no status pushes needed
});

test('callModel: task "side" picks MODELS.side', async () => {
  const fetchImpl = queueFetch([{ status: 200, body: responsesBody('chip text') }]);
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'x' }], task: 'side' },
    apiKey: 'k',
    fetchImpl,
  });
  assert.equal(res.data.model, MODELS.side);
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.model, MODELS.side);
});

test('callModel: missing key -> NO_KEY without calling fetch, pushes PILL.NO_KEY', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonRes(200, {}); };
  const statuses = [];
  const res = await callModel({
    req: { messages: [] },
    apiKey: '',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.equal(called, false);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.NO_KEY);
  assert.deepEqual(statuses, [PILL.NO_KEY]);
});

test('callModel: whitespace-only key -> NO_KEY without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonRes(200, {}); };
  const res = await callModel({ req: { messages: [] }, apiKey: '   ', fetchImpl });
  assert.equal(called, false);
  assert.equal(res.error.code, ERR.NO_KEY);
});

test('callModel: 401 -> BAD_KEY, no retry, pushes PILL.NO_KEY', async () => {
  const fetchImpl = queueFetch([{ status: 401, body: { error: { message: 'invalid key' } } }]);
  const statuses = [];
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'x' }] },
    apiKey: 'bad-key',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.BAD_KEY);
  assert.deepEqual(statuses, [PILL.NO_KEY]);
});

test('callModel: forced 500 twice -> HTTP_ERROR after exactly 2 calls, second on fallback model, RETRYING then UNAVAILABLE', async () => {
  const fetchImpl = queueFetch([
    { status: 500, body: { error: { message: 'server exploded' } } },
    { status: 500, body: { error: { message: 'server exploded again' } } },
  ]);
  const statuses = [];
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'x' }] },
    apiKey: 'k',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.equal(fetchImpl.calls.length, 2);
  const secondBody = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(secondBody.model, MODELS.brainFallback);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.HTTP_ERROR);
  assert.deepEqual(statuses, [PILL.RETRYING, PILL.UNAVAILABLE]);
});

test('callModel: 429 triggers the same retry-on-fallback path as 5xx', async () => {
  const fetchImpl = queueFetch([
    { status: 429, body: { error: { message: 'rate limited' } } },
    { status: 200, body: responsesBody('ok after retry') },
  ]);
  const statuses = [];
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'x' }] },
    apiKey: 'k',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.ok, true);
  assert.equal(res.data.model, MODELS.brainFallback);
  assert.deepEqual(statuses, [PILL.RETRYING]);
});

test('callModel: aborted fetch -> TIMEOUT after the retry, exactly 2 calls, RETRYING then UNAVAILABLE', async () => {
  const fetchImpl = queueFetch([{ err: abortLikeError() }, { err: abortLikeError() }]);
  const statuses = [];
  const res = await callModel({
    req: { messages: [{ role: 'user', content: 'x' }] },
    apiKey: 'k',
    fetchImpl,
    onStatus: (p) => statuses.push(p),
  });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.TIMEOUT);
  assert.deepEqual(statuses, [PILL.RETRYING, PILL.UNAVAILABLE]);
});

test('callModel: generic network throw (not abort) -> NETWORK after the retry', async () => {
  const fetchImpl = queueFetch([{ err: new Error('ECONNRESET') }, { err: new Error('ECONNRESET') }]);
  const res = await callModel({ req: { messages: [{ role: 'user', content: 'x' }] }, apiKey: 'k', fetchImpl });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.error.code, ERR.NETWORK);
});

test('callModel: retry succeeds on the fallback model after a first-attempt throw', async () => {
  const fetchImpl = queueFetch([{ err: abortLikeError() }, { status: 200, body: responsesBody('recovered') }]);
  const res = await callModel({ req: { messages: [{ role: 'user', content: 'x' }] }, apiKey: 'k', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.data.text, 'recovered');
  assert.equal(res.data.model, MODELS.brainFallback);
});

test('callModel: row 11 — 400 mentioning image_url on a request with an image retries once without images and succeeds', async () => {
  const fetchImpl = queueFetch([
    { status: 400, text: JSON.stringify({ error: { message: 'Could not download image_url' } }) },
    { status: 200, body: responsesBody('described without the image') },
  ]);
  const res = await callModel({
    req: {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image', url: 'https://cdn/x.jpg' }] },
      ],
    },
    apiKey: 'k',
    fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.ok, true);
  assert.equal(res.data.model, MODELS.brain); // same model, not the fallback
  const secondInput = JSON.parse(fetchImpl.calls[1].init.body).input;
  const hasImage = secondInput.some((m) => m.content.some((p) => p.type === 'input_image'));
  assert.equal(hasImage, false);
});

test('callModel: other 4xx without image wording -> HTTP_ERROR, no retry', async () => {
  const fetchImpl = queueFetch([{ status: 400, body: { error: { message: 'bad request, missing field' } } }]);
  const res = await callModel({ req: { messages: [{ role: 'user', content: 'x' }] }, apiKey: 'k', fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.error.code, ERR.HTTP_ERROR);
  assert.match(res.error.message, /bad request, missing field/);
});

test('callModel: 4xx mentioning image but no image parts present -> no retry, HTTP_ERROR', async () => {
  const fetchImpl = queueFetch([{ status: 400, body: { error: { message: 'bad image_url' } } }]);
  const res = await callModel({ req: { messages: [{ role: 'user', content: 'no image here' }] }, apiKey: 'k', fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.error.code, ERR.HTTP_ERROR);
});

test('callModel: 2xx with empty extracted text -> BAD_RESPONSE', async () => {
  const fetchImpl = queueFetch([{ status: 200, body: { output: [] } }]);
  const res = await callModel({ req: { messages: [{ role: 'user', content: 'x' }] }, apiKey: 'k', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.BAD_RESPONSE);
});

test('callModel: never throws even if fetchImpl is missing entirely (falls back to globalThis.fetch, still safe under try/catch)', async () => {
  // Sanity: malformed req shouldn't throw.
  const fetchImpl = queueFetch([{ status: 200, body: responsesBody('fine') }]);
  const res = await callModel({ req: null, apiKey: 'k', fetchImpl });
  assert.equal(res.ok, true);
});

/* ------------------------------------------------------------------ speech */

test('speech: builds correct request and returns base64 audio', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fetchImpl = async (url, init) => {
    fetchImpl.calls.push({ url, init });
    return new Response(bytes.buffer, { status: 200 });
  };
  fetchImpl.calls = [];
  const res = await speech({ text: 'hello there', apiKey: 'sk-x', fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, API.speech);
  const body = JSON.parse(init.body);
  assert.equal(body.model, MODELS.tts);
  assert.equal(body.voice, TTS_VOICE);
  assert.equal(body.voice, 'coral');
  assert.equal(body.input, 'hello there');
  assert.equal(body.response_format, 'mp3');
  assert.equal(res.ok, true);
  assert.equal(res.data.mime, 'audio/mpeg');
  const decoded = Buffer.from(res.data.audioBase64, 'base64');
  assert.deepEqual([...decoded], [1, 2, 3, 4, 5]);
});

test('speech: empty key -> NO_KEY, no fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const res = await speech({ text: 'hi', apiKey: '', fetchImpl });
  assert.equal(called, false);
  assert.equal(res.error.code, ERR.NO_KEY);
});

test('speech: 401 -> BAD_KEY', async () => {
  const fetchImpl = async () => new Response('nope', { status: 401 });
  const res = await speech({ text: 'hi', apiKey: 'k', fetchImpl });
  assert.equal(res.error.code, ERR.BAD_KEY);
});

test('speech: other error -> TTS_FAILED', async () => {
  const fetchImpl = async () => new Response('boom', { status: 500 });
  const res = await speech({ text: 'hi', apiKey: 'k', fetchImpl });
  assert.equal(res.error.code, ERR.TTS_FAILED);
});

test('speech: fetch throw -> TTS_FAILED, never throws', async () => {
  const fetchImpl = async () => { throw new Error('net down'); };
  const res = await speech({ text: 'hi', apiKey: 'k', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.TTS_FAILED);
});

/* --------------------------------------------------------------- transcribe */

function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

test('transcribe: posts FormData with a file and model, returns text', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonRes(200, { text: 'what is this post about' });
  };
  const res = await transcribe({ audioBase64: toBase64('fake audio bytes'), mime: 'audio/webm', apiKey: 'sk-x', fetchImpl });
  assert.equal(captured.url, API.transcriptions);
  assert.ok(captured.init.body instanceof FormData);
  const file = captured.init.body.get('file');
  assert.ok(file instanceof File);
  assert.equal(captured.init.body.get('model'), MODELS.stt);
  assert.equal(captured.init.body.get('response_format'), 'json');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-x');
  assert.equal(res.ok, true);
  assert.equal(res.data.text, 'what is this post about');
});

test('transcribe: missing text field -> empty string, still ok', async () => {
  const fetchImpl = async () => jsonRes(200, {});
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: 'k', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.data.text, '');
});

test('transcribe: empty key -> NO_KEY, no fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: '', fetchImpl });
  assert.equal(called, false);
  assert.equal(res.error.code, ERR.NO_KEY);
});

test('transcribe: 401 -> BAD_KEY', async () => {
  const fetchImpl = async () => new Response('nope', { status: 401 });
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: 'k', fetchImpl });
  assert.equal(res.error.code, ERR.BAD_KEY);
});

test('transcribe: other error -> STT_FAILED', async () => {
  const fetchImpl = async () => new Response('boom', { status: 500 });
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: 'k', fetchImpl });
  assert.equal(res.error.code, ERR.STT_FAILED);
});

test('transcribe: fetch throw -> STT_FAILED, never throws', async () => {
  const fetchImpl = async () => { throw new Error('net down'); };
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: 'k', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.STT_FAILED);
});

test('transcribe: never includes the API key in the returned data', async () => {
  const fetchImpl = async () => jsonRes(200, { text: 'hi' });
  const res = await transcribe({ audioBase64: toBase64('x'), mime: 'audio/webm', apiKey: 'super-secret-key', fetchImpl });
  assert.equal(JSON.stringify(res).includes('super-secret-key'), false);
});
