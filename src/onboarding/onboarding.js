// src/onboarding/onboarding.js — real onboarding flow.
//
// No chrome.* or DOM access at module top level: everything below is inside
// initOnboarding() (or helpers it calls), so this file imports cleanly from
// src/onboarding/test.html (a plain browser test page) without a live
// extension around it.
//
// initOnboarding({ chrome, doc }) is the only export that matters at runtime.
// `chrome` is injected (not read off the global) so a test page can pass a
// shim; `doc` is the Document to query against — in production it is the
// real `document`, in tests it is also `document` but scoped to a freshly
// cloned copy of the <template id="onboardTemplate"> markup from index.html
// (see src/onboarding/test.html), so each scenario starts from a clean DOM.
import { ok, fail, ERR, MSG, STORAGE_KEYS, defaultMemory } from '../../shared/types.js';
import { DEFAULT_API_KEY } from '../bg/secrets.js';

const BUILT_IN_KEY = !!(DEFAULT_API_KEY && DEFAULT_API_KEY.trim());

/**
 * @param {{ chrome: any, doc: Document }} deps
 */
export async function initOnboarding({ chrome, doc }) {
  const els = queryEls(doc);
  if (!els.root) {
    // Template was not cloned into #mount yet, or markup is missing. Nothing
    // to wire up; fail quietly rather than throwing at import/init time.
    return;
  }

  const state = {
    step: 1,
    persona: 'casual',
  };

  // ------------------------------------------------------------------ init
  let onboarded = false;
  let existingPersona = 'casual';
  let existingKey = '';

  try {
    const stored = await storageGet(chrome, [STORAGE_KEYS.ONBOARDED, STORAGE_KEYS.API_KEY, STORAGE_KEYS.MEMORY]);
    onboarded = !!stored[STORAGE_KEYS.ONBOARDED];
    existingKey = String(stored[STORAGE_KEYS.API_KEY] || '');

    // Prefer the bus (GET_MEMORY) since brain owns the memory store; fall
    // back to the raw storage object it also lives at.
    let memory = null;
    try {
      const res = await send(chrome, MSG.GET_MEMORY, {});
      if (res && res.ok && res.data) memory = res.data;
    } catch (e) {
      /* fall through to the direct read below */
    }
    if (!memory) memory = stored[STORAGE_KEYS.MEMORY] || null;
    if (memory && memory.profile && memory.profile.persona) {
      existingPersona = memory.profile.persona;
    }
  } catch (e) {
    setStatus(els, 'Could not read saved settings — starting fresh. (' + describeErr(e) + ')');
  }

  state.persona = existingPersona === 'influencer' ? 'influencer' : 'casual';

  if (onboarded) {
    await renderSummary(els, chrome, { persona: existingPersona, hasKey: !!existingKey || BUILT_IN_KEY });
  } else {
    els.apiKeyInput.value = existingKey;
    selectPersonaCard(els, state.persona);
    showStepFlow(els);
    goToStep(els, state, 1, { animate: false });
  }

  // --------------------------------------------------------------- events
  els.personaCasual.addEventListener('click', () => {
    state.persona = 'casual';
    selectPersonaCard(els, state.persona);
  });
  els.personaInfluencer.addEventListener('click', () => {
    state.persona = 'influencer';
    selectPersonaCard(els, state.persona);
  });

  els.micGrantBtn.addEventListener('click', () => runGuarded(els, () => handleMicGrant(els)));
  els.micSkipBtn.addEventListener('click', () => runGuarded(els, () => {
    if (BUILT_IN_KEY) return handleDone(els, chrome, state);
    goToStep(els, state, 3);
  }));

  els.toggleKeyBtn.addEventListener('click', () => {
    try {
      const showing = els.apiKeyInput.type === 'text';
      els.apiKeyInput.type = showing ? 'password' : 'text';
      els.toggleKeyBtn.textContent = showing ? 'Show' : 'Hide';
    } catch (e) {
      setStatus(els, describeErr(e));
    }
  });

  els.testKeyBtn.addEventListener('click', () => runGuarded(els, () => handleTestKey(els, chrome)));

  els.backBtn.addEventListener('click', () => runGuarded(els, () => {
    if (state.step > 1) goToStep(els, state, state.step - 1);
  }));
  els.nextBtn.addEventListener('click', () => runGuarded(els, () => {
    if (BUILT_IN_KEY && state.step === 2) return handleDone(els, chrome, state); // key is built in: no step 3
    if (state.step < 3) goToStep(els, state, state.step + 1);
  }));
  if (BUILT_IN_KEY) {
    try { const d3 = els.dots.querySelector('[data-dot="3"]'); if (d3) d3.hidden = true; } catch (e) { /* ignore */ }
    els.micSkipBtn.textContent = 'Skip for now — you can type instead';
  }
  els.doneBtn.addEventListener('click', () => runGuarded(els, () => handleDone(els, chrome, state)));

  els.summaryView.addEventListener('click', (evt) => runGuarded(els, () => {
    const target = evt.target;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('[data-change]');
    if (!btn) return;
    const stepNum = Number(btn.getAttribute('data-change')) || 1;
    els.summaryView.hidden = true;
    showStepFlow(els);
    els.apiKeyInput.value = existingKey;
    selectPersonaCard(els, state.persona);
    goToStep(els, state, stepNum, { animate: false });
  }));

  els.summaryCloseBtn.addEventListener('click', () => runGuarded(els, () => {
    attemptClose(els);
  }));
}

/* =========================================================================
 * DOM wiring
 * ========================================================================= */

function queryEls(doc) {
  const q = (id) => doc.getElementById(id);
  return {
    doc,
    root: q('onboardRoot'),
    dots: q('dots'),
    stepViewport: q('stepViewport'),
    navRow: q('navRow'),
    step1: q('step1'),
    step2: q('step2'),
    step3: q('step3'),
    personaCasual: q('personaCasual'),
    personaInfluencer: q('personaInfluencer'),
    micGrantBtn: q('micGrantBtn'),
    micStatus: q('micStatus'),
    micSkipBtn: q('micSkipBtn'),
    apiKeyInput: q('apiKeyInput'),
    toggleKeyBtn: q('toggleKeyBtn'),
    testKeyBtn: q('testKeyBtn'),
    testKeyResult: q('testKeyResult'),
    backBtn: q('backBtn'),
    nextBtn: q('nextBtn'),
    doneBtn: q('doneBtn'),
    statusLine: q('statusLine'),
    summaryView: q('summaryView'),
    summaryPersona: q('summaryPersona'),
    summaryMic: q('summaryMic'),
    summaryKey: q('summaryKey'),
    summaryCloseBtn: q('summaryCloseBtn'),
    closeFallback: q('closeFallback'),
  };
}

function showStepFlow(els) {
  els.dots.hidden = false;
  els.stepViewport.hidden = false;
  els.navRow.hidden = false;
  els.summaryView.hidden = true;
  els.closeFallback.hidden = true;
}

function selectPersonaCard(els, persona) {
  els.personaCasual.setAttribute('aria-pressed', String(persona === 'casual'));
  els.personaInfluencer.setAttribute('aria-pressed', String(persona === 'influencer'));
}

function goToStep(els, state, stepNum, opts) {
  const animate = !opts || opts.animate !== false;
  state.step = stepNum;
  const panels = [els.step1, els.step2, els.step3];
  panels.forEach((panel, idx) => {
    const isTarget = idx + 1 === stepNum;
    panel.hidden = !isTarget;
    if (isTarget && animate) {
      panel.classList.add('step-enter');
      // Force a reflow so the browser registers the "before" state, then
      // remove the class on the next frame so the transition actually runs.
      // eslint-disable-next-line no-unused-expressions
      panel.offsetWidth;
      requestAnimationFrame(() => panel.classList.remove('step-enter'));
    } else {
      panel.classList.remove('step-enter');
    }
  });

  const dotEls = els.dots.querySelectorAll('.dot');
  dotEls.forEach((dot) => {
    const n = Number(dot.getAttribute('data-dot'));
    dot.classList.toggle('active', n === stepNum);
    dot.classList.toggle('done', n < stepNum);
  });

  els.backBtn.hidden = stepNum === 1;
  els.nextBtn.hidden = stepNum === 3;
  els.doneBtn.hidden = stepNum !== 3;
  setStatus(els, '');
}

function setStatus(els, message) {
  els.statusLine.textContent = message || '';
}

function setMicState(els, stateName, message) {
  els.micStatus.dataset.state = stateName;
  els.micStatus.textContent = message;
  els.micStatus.className = 'mic-status ' + stateName;
}

function setTestKeyResult(els, kind, message) {
  els.testKeyResult.textContent = message;
  els.testKeyResult.className = 'test-result ' + (kind || '');
}

/** Runs a (possibly async) handler and surfaces any thrown error on the status line. */
async function runGuarded(els, fn) {
  try {
    await fn();
  } catch (e) {
    setStatus(els, describeErr(e));
  }
}

function describeErr(e) {
  return (e && e.message) || String(e || 'Something went wrong');
}

/* =========================================================================
 * Step 2 — microphone (ported from demos/mic-tts-test-insta/app.js
 * requestMicPermission: call getUserMedia on THIS page/origin, release every
 * track immediately, surface NotAllowedError / NotFoundError distinctly).
 * ========================================================================= */

async function handleMicGrant(els) {
  setMicState(els, 'pending', 'Asking Chrome for microphone access — click Allow in the prompt at the top of the window.');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicState(els, 'denied', 'This browser cannot expose the microphone to extensions.');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release immediately: we only came here for the permission grant. A
    // held track would leave the recording indicator on for no reason, and
    // the offscreen recorder (src/voice/) opens its own stream later.
    stream.getTracks().forEach((t) => t.stop());
    setMicState(els, 'granted', 'Microphone granted.');
  } catch (err) {
    const name = (err && err.name) || '';
    if (name === 'NotAllowedError') {
      setMicState(
        els,
        'denied',
        'Microphone blocked. Open chrome://settings/content/microphone, remove this extension ' +
          'from the block list, then reload this page.'
      );
    } else if (name === 'NotFoundError') {
      setMicState(els, 'denied', 'No microphone found — check that an input device is plugged in and enabled.');
    } else {
      setMicState(els, 'denied', 'Could not open the microphone — ' + (name || 'unknown error') + '.');
    }
  }
}

/* =========================================================================
 * Step 3 — API key
 * ========================================================================= */

async function handleTestKey(els, chrome) {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    setTestKeyResult(els, 'err', 'Enter a key first.');
    return;
  }
  setTestKeyResult(els, '', 'Testing…');
  // "saves the key first" — so the background worker (which reads the key
  // from storage, never from this message) picks up the one being tested.
  await storageSet(chrome, { [STORAGE_KEYS.API_KEY]: key });

  const res = await send(chrome, MSG.ASK, {
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    maxOutputTokens: 16, // API minimum — 5 was rejected live: "integer below minimum value ... >= 16"
    responseFormat: 'text',
  });

  if (res && res.ok) {
    setTestKeyResult(els, 'ok', 'Key works.');
    return;
  }
  const code = res && res.error && res.error.code;
  if (code === ERR.NO_KEY || code === ERR.BAD_KEY) {
    setTestKeyResult(els, 'err', 'That key was rejected — check it and try again.');
  } else {
    // Not a key problem (timeout/network/bad response/etc.) — the key itself
    // was already saved above, so say so rather than implying it was lost.
    const message = (res && res.error && res.error.message) || 'could not reach the assistant';
    setTestKeyResult(els, 'err', 'Key saved, but the test call failed: ' + message);
  }
}

/* =========================================================================
 * Done — persist everything, then try to close the tab.
 * ========================================================================= */

async function handleDone(els, chrome, state) {
  setStatus(els, 'Saving…');
  const persona = state.persona === 'influencer' ? 'influencer' : 'casual';
  const key = els.apiKeyInput.value.trim();

  await storageSet(chrome, { [STORAGE_KEYS.API_KEY]: key });
  await savePersona(chrome, persona);
  await storageSet(chrome, { [STORAGE_KEYS.ONBOARDED]: true });

  setStatus(els, '');
  attemptClose(els);
}

/** SAVE_MEMORY via the bus; falls back to a direct merged storage write if the bus fails. */
async function savePersona(chrome, persona) {
  const res = await send(chrome, MSG.SAVE_MEMORY, { memory: { profile: { persona } } });
  if (res && res.ok) return;

  // Bus unreachable / bg not ready — merge directly into storage so persona
  // is never lost just because the service worker was not listening yet.
  try {
    const stored = await storageGet(chrome, [STORAGE_KEYS.MEMORY]);
    const prev = stored[STORAGE_KEYS.MEMORY] || defaultMemory();
    const merged = { ...prev, profile: { ...prev.profile, persona } };
    await storageSet(chrome, { [STORAGE_KEYS.MEMORY]: merged });
  } catch (e) {
    /* best effort — persona will fall back to its default elsewhere */
  }
}

/**
 * window.close() only succeeds for windows/tabs opened by script; an options
 * page opened by Chrome itself often cannot close itself. There is no
 * exception to catch for that case, so: try to close, and if we are still
 * around a moment later, show the "you can close this tab" fallback.
 */
function attemptClose(els) {
  try {
    window.close();
  } catch (e) {
    /* ignore — fallback below covers it */
  }
  setTimeout(() => {
    els.closeFallback.hidden = false;
  }, 400);
}

/* =========================================================================
 * Already-onboarded summary view
 * ========================================================================= */

async function renderSummary(els, chrome, { persona, hasKey }) {
  els.dots.hidden = true;
  els.stepViewport.hidden = true;
  els.navRow.hidden = true;
  els.closeFallback.hidden = true;
  els.summaryView.hidden = false;

  els.summaryPersona.textContent = persona === 'influencer' ? 'Influencer' : 'Casual';
  els.summaryKey.textContent = BUILT_IN_KEY && !hasKey ? 'Built in' : (hasKey ? 'Saved' : 'Not set');
  els.summaryMic.textContent = await describeMicPermission();
}

async function describeMicPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'Unknown';
    const status = await navigator.permissions.query({ name: 'microphone' });
    if (status.state === 'granted') return 'Granted';
    if (status.state === 'denied') return 'Blocked — reset in Chrome settings';
    return 'Not yet granted';
  } catch (e) {
    return 'Unknown';
  }
}

/* =========================================================================
 * Storage + bus helpers (parametrised on the injected `chrome`, never the
 * global — see the file banner. Mirrors shared/types.js request() exactly,
 * just against the injected object instead of globalThis.chrome.)
 * ========================================================================= */

async function storageGet(chrome, keys) {
  try {
    const res = await chrome.storage.local.get(keys);
    return res || {};
  } catch (e) {
    return {};
  }
}

async function storageSet(chrome, obj) {
  try {
    await chrome.storage.local.set(obj);
    return true;
  } catch (e) {
    return false;
  }
}

async function send(chrome, type, data) {
  try {
    const res = await chrome.runtime.sendMessage({ type, data: data === undefined ? {} : data });
    if (!res || typeof res.ok !== 'boolean') return fail(ERR.BAD_RESPONSE, 'Empty response from background');
    return res;
  } catch (e) {
    return fail(ERR.NETWORK, (e && e.message) || 'Could not reach the extension background');
  }
}

// Re-export so a caller can build a matching shim without importing
// shared/types.js twice (test.html imports it separately anyway, but this
// keeps the pair available from one place if that changes).
export { ok, fail };
