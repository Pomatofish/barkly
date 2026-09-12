// src/bg/router.test.js — node --test src/bg/
// Installs a fake `chrome` on globalThis BEFORE importing service-worker.js
// (top-level registration in that file is guarded on `typeof chrome !== 'undefined'`,
// so it only runs once this shim exists), then drives the router either through
// the captured onMessage listener or the exported handle() directly.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ok } from '../../shared/types.js';

/* --------------------------------------------------------------- chrome shim */

function makeChromeShim() {
  const store = {}; // fake chrome.storage.local backing store
  const tabsSent = []; // { tabId, message }
  let captured = null; // the onMessage listener the service worker registers
  const offscreenCreateCalls = [];
  let onInstalledHandler = null;
  let onClickedHandler = null;

  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          if (Array.isArray(key)) {
            const out = {};
            for (const k of key) out[k] = store[k];
            return out;
          }
          return { ...store };
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          captured = fn;
        },
      },
      onInstalled: {
        addListener(fn) {
          onInstalledHandler = fn;
        },
      },
      getContexts: async () => [],
      sendMessage: async () => ok({ started: true }),
      openOptionsPage() {},
    },
    offscreen: {
      createDocument: async (opts) => {
        offscreenCreateCalls.push(opts);
      },
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        tabsSent.push({ tabId, message });
      },
    },
    action: {
      onClicked: {
        addListener(fn) {
          onClickedHandler = fn;
        },
      },
    },
  };

  return {
    chrome,
    store,
    tabsSent,
    offscreenCreateCalls,
    getCaptured: () => captured,
    getOnInstalled: () => onInstalledHandler,
    getOnClicked: () => onClickedHandler,
  };
}

// Install the shim once, before the very first import of service-worker.js.
// node --test runs each file in its own process/module registry, so this is safe.
const shim = makeChromeShim();
globalThis.chrome = shim.chrome;

const { handle, _setDepsForTest } = await import('./service-worker.js');
const { MSG, ERR, STORAGE_KEYS, PILL } = await import('../../shared/types.js');
const { MODELS, API } = await import('./config.js');

function responsesBody(text) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}
function jsonRes(status, body) {
  return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
}

function queueFetch(steps) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    calls.push({ url, init });
    if (step.err) throw step.err;
    return jsonRes(step.status ?? 200, step.body);
  };
  fn.calls = calls;
  return fn;
}

function abortLikeError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

const fakeSender = { tab: { id: 42 } };

/* --------------------------------------------------------------------- ASK */

test('router: onMessage listener was captured at import time', () => {
  assert.equal(typeof shim.getCaptured(), 'function');
});

test('router: ASK round-trips through the captured onMessage listener', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-router-test';
  _setDepsForTest({ fetchImpl: queueFetch([{ status: 200, body: responsesBody('hello from the model') }]) });

  const listener = shim.getCaptured();
  const result = await new Promise((resolve) => {
    const r = listener(
      { type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 150, responseFormat: 'json' } },
      fakeSender,
      resolve
    );
    assert.equal(r, true); // async response
  });

  assert.deepEqual(result, { ok: true, data: { text: 'hello from the model', model: MODELS.brain } });
});

test('router: ASK via handle() directly, same result shape', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-router-test-2';
  _setDepsForTest({ fetchImpl: queueFetch([{ status: 200, body: responsesBody('direct handle reply') }]) });

  const res = await handle(
    { type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }] } },
    fakeSender
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.text, 'direct handle reply');
});

test('router: forced 500 twice -> HTTP_ERROR, pushes RETRYING then UNAVAILABLE to the sender tab', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-router-test-3';
  shim.tabsSent.length = 0;
  const fetchImpl = queueFetch([
    { status: 500, body: { error: { message: 'boom' } } },
    { status: 500, body: { error: { message: 'boom again' } } },
  ]);
  _setDepsForTest({ fetchImpl });

  const res = await handle({ type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }] } }, fakeSender);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.HTTP_ERROR);

  const pushed = shim.tabsSent.filter((s) => s.tabId === 42).map((s) => s.message.data);
  assert.deepEqual(pushed, [PILL.RETRYING, PILL.UNAVAILABLE]);
});

test('router: missing key -> NO_KEY, no fetch call, pushes PILL.NO_KEY to the sender tab', async () => {
  delete shim.store[STORAGE_KEYS.API_KEY];
  shim.tabsSent.length = 0;
  let fetchCalled = false;
  _setDepsForTest({ fetchImpl: async () => { fetchCalled = true; return jsonRes(200, {}); } });

  const res = await handle({ type: MSG.ASK, data: { messages: [] } }, fakeSender);
  assert.equal(fetchCalled, false);
  assert.equal(res.error.code, ERR.NO_KEY);
  const pushed = shim.tabsSent.filter((s) => s.tabId === 42).map((s) => s.message.data);
  assert.deepEqual(pushed, [PILL.NO_KEY]);
});

test('router: 401 -> BAD_KEY, no retry, pushes PILL.NO_KEY', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-bad';
  shim.tabsSent.length = 0;
  const fetchImpl = queueFetch([{ status: 401, body: { error: { message: 'nope' } } }]);
  _setDepsForTest({ fetchImpl });

  const res = await handle({ type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }] } }, fakeSender);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(res.error.code, ERR.BAD_KEY);
  const pushed = shim.tabsSent.filter((s) => s.tabId === 42).map((s) => s.message.data);
  assert.deepEqual(pushed, [PILL.NO_KEY]);
});

test('router: aborted fetch -> TIMEOUT after the retry', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-abort';
  const fetchImpl = queueFetch([{ err: abortLikeError() }, { err: abortLikeError() }]);
  _setDepsForTest({ fetchImpl });

  const res = await handle({ type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }] } }, fakeSender);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.error.code, ERR.TIMEOUT);
});

test('router: 400 mentioning image_url on a request with an image retries once without images', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-img';
  const fetchImpl = queueFetch([
    { status: 400, body: { error: { message: 'cannot fetch image_url' } } },
    { status: 200, body: responsesBody('ok without image') },
  ]);
  _setDepsForTest({ fetchImpl });

  const res = await handle(
    {
      type: MSG.ASK,
      data: { messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', url: 'https://cdn/y.jpg' }] }] },
    },
    fakeSender
  );
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(res.ok, true);
  const secondInput = JSON.parse(fetchImpl.calls[1].init.body).input;
  assert.equal(secondInput.some((m) => m.content.some((p) => p.type === 'input_image')), false);
});

test('router: STYLE_ADVICE routes through the same callModel path', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-style';
  _setDepsForTest({ fetchImpl: queueFetch([{ status: 200, body: responsesBody('style notes') }]) });
  const res = await handle({ type: MSG.STYLE_ADVICE, data: { messages: [{ role: 'user', content: 'style?' }] } }, fakeSender);
  assert.equal(res.ok, true);
  assert.equal(res.data.text, 'style notes');
});

/* ------------------------------------------------------------------- SPEAK */

test('router: SPEAK builds correct request and returns audio', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-speak';
  const bytes = new Uint8Array([9, 8, 7]);
  const fetchImpl = async (url, init) => {
    fetchImpl.calls.push({ url, init });
    return new Response(bytes.buffer, { status: 200 });
  };
  fetchImpl.calls = [];
  _setDepsForTest({ fetchImpl });

  const res = await handle({ type: MSG.SPEAK, data: { text: 'read this' } }, fakeSender);
  assert.equal(res.ok, true);
  assert.equal(res.data.mime, 'audio/mpeg');
  assert.equal(fetchImpl.calls[0].url, API.speech);
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.voice, 'coral');
  assert.equal(body.model, MODELS.tts);
});

/* -------------------------------------------------------------- TRANSCRIBE */

test('router: TRANSCRIBE posts a file and returns text', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-stt';
  let captured;
  _setDepsForTest({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonRes(200, { text: 'what a nice post' });
    },
  });
  const res = await handle(
    { type: MSG.TRANSCRIBE, data: { audioBase64: Buffer.from('fake').toString('base64'), mime: 'audio/webm' } },
    fakeSender
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.text, 'what a nice post');
  assert.equal(captured.url, API.transcriptions);
  assert.ok(captured.init.body instanceof FormData);
  assert.equal(captured.init.body.get('model'), MODELS.stt);
});

/* --------------------------------------------------------------- MEMORY */

test('router: SAVE_MEMORY merges profile one level deep, GET_MEMORY returns it', async () => {
  delete shim.store[STORAGE_KEYS.MEMORY];

  const save1 = await handle({ type: MSG.SAVE_MEMORY, data: { memory: { profile: { persona: 'influencer' } } } }, fakeSender);
  assert.equal(save1.ok, true);
  assert.equal(save1.data.profile.persona, 'influencer');
  assert.equal(save1.data.profile.brandVoice, ''); // default preserved, not clobbered

  const save2 = await handle({ type: MSG.SAVE_MEMORY, data: { memory: { profile: { niche: 'travel' } } } }, fakeSender);
  assert.equal(save2.data.profile.persona, 'influencer'); // still there
  assert.equal(save2.data.profile.niche, 'travel');

  const got = await handle({ type: MSG.GET_MEMORY, data: {} }, fakeSender);
  assert.equal(got.ok, true);
  assert.equal(got.data.profile.persona, 'influencer');
  assert.equal(got.data.profile.niche, 'travel');
  assert.deepEqual(got.data.pinned, []);
  assert.deepEqual(got.data.history, []);
});

test('router: GET_MEMORY with nothing stored returns defaultMemory shape', async () => {
  delete shim.store[STORAGE_KEYS.MEMORY];
  const res = await handle({ type: MSG.GET_MEMORY, data: {} }, fakeSender);
  assert.equal(res.ok, true);
  assert.equal(res.data.profile.persona, 'casual');
  assert.deepEqual(res.data.pinned, []);
  assert.deepEqual(res.data.history, []);
});

/* --------------------------------------------------------------- OFFSCREEN */

test('router: VOICE_START calls ensureOffscreen once even when invoked twice concurrently, relays offscreen response', async () => {
  shim.offscreenCreateCalls.length = 0;
  _setDepsForTest({ fetchImpl: async () => jsonRes(200, {}) });

  const [r1, r2] = await Promise.all([
    handle({ type: MSG.VOICE_START, data: {} }, fakeSender),
    handle({ type: MSG.VOICE_START, data: {} }, fakeSender),
  ]);

  assert.equal(shim.offscreenCreateCalls.length, 1);
  assert.deepEqual(r1, { ok: true, data: { started: true } });
  assert.deepEqual(r2, { ok: true, data: { started: true } });
});

test('router: VOICE_STOP relays the offscreen response unchanged', async () => {
  const res = await handle({ type: MSG.VOICE_STOP, data: {} }, fakeSender);
  assert.deepEqual(res, { ok: true, data: { started: true } }); // shim's sendMessage always returns this
});

test('router: VOICE_START/STOP -> undefined offscreen response becomes OFFSCREEN_FAILED', async () => {
  const originalSendMessage = shim.chrome.runtime.sendMessage;
  shim.chrome.runtime.sendMessage = async () => undefined;
  try {
    const res = await handle({ type: MSG.VOICE_START, data: {} }, fakeSender);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, ERR.OFFSCREEN_FAILED);
  } finally {
    shim.chrome.runtime.sendMessage = originalSendMessage;
  }
});

/* ------------------------------------------------------------- ONBOARDING */

test('router: OPEN_ONBOARDING calls openOptionsPage and returns ok(null)', async () => {
  let called = false;
  shim.chrome.runtime.openOptionsPage = () => { called = true; };
  const res = await handle({ type: MSG.OPEN_ONBOARDING, data: {} }, fakeSender);
  assert.equal(called, true);
  assert.deepEqual(res, { ok: true, data: null });
});

/* ------------------------------------------------------------------ MISC */

test('router: unknown type -> UNKNOWN_TYPE', async () => {
  const res = await handle({ type: 'NOT_A_REAL_TYPE', data: {} }, fakeSender);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.UNKNOWN_TYPE);
});

test('router: message with target "offscreen" is ignored by the onMessage listener (returns false)', () => {
  const listener = shim.getCaptured();
  const r = listener({ target: 'offscreen', type: 'anything' }, fakeSender, () => {});
  assert.equal(r, false);
});

test('router: onInstalled with reason "install" opens the onboarding page', () => {
  let called = false;
  shim.chrome.runtime.openOptionsPage = () => { called = true; };
  const onInstalled = shim.getOnInstalled();
  assert.equal(typeof onInstalled, 'function');
  onInstalled({ reason: 'install' });
  assert.equal(called, true);
});

test('router: onInstalled with reason "update" does not open onboarding', () => {
  let called = false;
  shim.chrome.runtime.openOptionsPage = () => { called = true; };
  const onInstalled = shim.getOnInstalled();
  onInstalled({ reason: 'update' });
  assert.equal(called, false);
});

test('router: action.onClicked opens the onboarding page', () => {
  let called = false;
  shim.chrome.runtime.openOptionsPage = () => { called = true; };
  const onClicked = shim.getOnClicked();
  assert.equal(typeof onClicked, 'function');
  onClicked();
  assert.equal(called, true);
});

test('router: never logs or returns the API key', async () => {
  shim.store[STORAGE_KEYS.API_KEY] = 'sk-super-secret-value';
  _setDepsForTest({ fetchImpl: queueFetch([{ status: 200, body: responsesBody('fine') }]) });
  const res = await handle({ type: MSG.ASK, data: { messages: [{ role: 'user', content: 'hi' }] } }, fakeSender);
  assert.equal(JSON.stringify(res).includes('sk-super-secret-value'), false);
});
