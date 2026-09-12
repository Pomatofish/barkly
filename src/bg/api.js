// src/bg/api.js — pure functions, no chrome.*. Takes fetchImpl explicitly so this
// module imports cleanly in Node (`node --test src/bg/`) as well as in the MV3
// service worker. All provider wire-format translation lives here; routing and
// chrome.* glue live in service-worker.js.
//
// Decision (documented per the task): system ModelMessages are folded into the
// Responses API `input` array as { role:'system', content:[{type:'input_text'}] }
// rather than the top-level `instructions` field. Simpler: one code path builds
// every role the same way, and multiple system turns (rare, but memory/profile
// could add more than one) are preserved in order instead of being collapsed.

import { ok, fail, ERR, PILL, LIMITS } from '../../shared/types.js';
import { WEB_SEARCH, WEB_SEARCH_TOOL, MODELS, TTS_VOICE, REASONING_EFFORT, API } from './config.js';

/* ------------------------------------------------------------------ helpers */

function isAbortError(e) {
  if (!e) return false;
  if (e.name === 'AbortError') return true;
  if (typeof e.message === 'string' && /abort/i.test(e.message)) return true;
  return false;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (e) {
    return '';
  }
}

/** Best-effort human message out of a provider error body (JSON or plain text). */
function providerMessageFrom(bodyText) {
  if (!bodyText) return 'Request failed';
  try {
    const j = JSON.parse(bodyText);
    if (j && j.error && j.error.message) return String(j.error.message);
    if (j && j.message) return String(j.message);
  } catch (e) {
    /* not JSON, fall through */
  }
  return String(bodyText).slice(0, 300);
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000; // avoid blowing the call stack on String.fromCharCode.apply
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extensionForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  return 'webm';
}

/* -------------------------------------------------------- Responses API wire */

/**
 * ModelMessage[] -> Responses API `input` array.
 * @param {import('../../shared/types.js').ModelMessage[]} messages
 */
export function toResponsesInput(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
    const textType = role === 'assistant' ? 'output_text' : 'input_text';
    const parts = [];
    const content = m.content;
    if (typeof content === 'string') {
      parts.push({ type: textType, text: content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'image' && part.url) {
          parts.push({ type: 'input_image', image_url: part.url });
        } else if (part.type === 'text') {
          parts.push({ type: textType, text: part.text || '' });
        }
      }
    }
    if (parts.length === 0) parts.push({ type: textType, text: '' });
    out.push({ role, content: parts });
  }
  return out;
}

/** Row 11 fallback: drop every input_image part (used on a stripped retry). */
function stripImages(input) {
  return input
    .map((m) => ({
      ...m,
      content: Array.isArray(m.content) ? m.content.filter((p) => p.type !== 'input_image') : m.content,
    }))
    .filter((m) => (Array.isArray(m.content) ? m.content.length > 0 : true));
}

/** Walk output[].content[] for output_text, falling back to output_text, then ''. */
export function extractOutputText(json) {
  try {
    if (json && Array.isArray(json.output)) {
      const parts = [];
      for (const item of json.output) {
        if (item && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c && c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
          }
        }
      }
      if (parts.length) return parts.join('');
    }
    if (json && typeof json.output_text === 'string' && json.output_text) return json.output_text;
    return '';
  } catch (e) {
    return '';
  }
}

/**
 * POST the Responses API once, with its own AbortController timeout.
 * Never throws: returns { res } on any HTTP response, { err } on abort/network throw.
 */
async function postResponses({ fetchFn, apiKey, model, input, req }) {
  const body = {
    model,
    input,
    max_output_tokens: req && req.maxOutputTokens,
    reasoning: { effort: REASONING_EFFORT },
  };
  const useTools = WEB_SEARCH && (!req || req.task !== 'side');
  if (useTools) {
    body.tools = [WEB_SEARCH_TOOL];
    body.tool_choice = 'auto';
  } else if (req && req.responseFormat === 'json') {
    // strict JSON mode is not combined with tools; the prompt asks for JSON and brain parses tolerantly
    body.text = { format: { type: 'json_object' } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), useTools ? LIMITS.TIMEOUT_MS * 2.5 : LIMITS.TIMEOUT_MS);
  try {
    const res = await fetchFn(API.responses, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { res };
  } catch (e) {
    return { err: e };
  } finally {
    clearTimeout(timer);
  }
}

async function toAskResult(res, model) {
  const json = await safeJson(res);
  const text = extractOutputText(json);
  if (!text) return fail(ERR.BAD_RESPONSE, 'Empty response from model');
  return ok({ text, model });
}

/**
 * @param {{ req: import('../../shared/types.js').AskRequest, apiKey: string,
 *           fetchImpl: Function, onStatus?: (pill: any) => void, models?: any }} args
 */
export async function callModel({ req, apiKey, fetchImpl, onStatus, models = MODELS }) {
  const notify = typeof onStatus === 'function' ? onStatus : () => {};
  const fetchFn = fetchImpl || globalThis.fetch;
  try {
    const key = (apiKey || '').trim();
    if (!key) {
      notify(PILL.NO_KEY);
      return fail(ERR.NO_KEY, 'No API key set. Add one in settings.');
    }

    const task = req && req.task === 'side' ? 'side' : 'brain';
    const primaryModel = task === 'side' ? models.side : models.brain;
    const fallbackModel = models.brainFallback;
    const baseInput = toResponsesInput(req && req.messages);
    const hasImages = baseInput.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'input_image')
    );

    async function finishAfterRetry(r2, modelUsed) {
      if (r2.err) {
        notify(PILL.UNAVAILABLE);
        return fail(isAbortError(r2.err) ? ERR.TIMEOUT : ERR.NETWORK, (r2.err && r2.err.message) || 'Network error');
      }
      const res2 = r2.res;
      if (res2.status === 401) {
        notify(PILL.NO_KEY);
        return fail(ERR.BAD_KEY, '401: Invalid API key');
      }
      if (res2.ok) return toAskResult(res2, modelUsed);
      notify(PILL.UNAVAILABLE);
      const bodyText2 = await safeText(res2);
      return fail(ERR.HTTP_ERROR, `${res2.status}: ${providerMessageFrom(bodyText2)}`);
    }

    const r1 = await postResponses({ fetchFn, apiKey: key, model: primaryModel, input: baseInput, req });

    if (r1.err) {
      // row 9: fetch threw (abort/network) -> retry once on the fallback model
      notify(PILL.RETRYING);
      const r2 = await postResponses({ fetchFn, apiKey: key, model: fallbackModel, input: baseInput, req });
      return finishAfterRetry(r2, fallbackModel);
    }

    const res1 = r1.res;
    if (res1.status === 401) {
      notify(PILL.NO_KEY);
      return fail(ERR.BAD_KEY, '401: Invalid API key');
    }
    if (res1.ok) return toAskResult(res1, primaryModel);

    if (res1.status === 429 || res1.status >= 500) {
      // row 9: retryable HTTP status -> retry once on the fallback model
      notify(PILL.RETRYING);
      const r2 = await postResponses({ fetchFn, apiKey: key, model: fallbackModel, input: baseInput, req });
      return finishAfterRetry(r2, fallbackModel);
    }

    // Other 4xx. Row 11: if the provider is complaining about the image URL, retry
    // once, same model, with every image part stripped.
    const bodyText1 = await safeText(res1);
    if (hasImages && /image|url|download|fetch/i.test(bodyText1)) {
      const stripped = stripImages(baseInput);
      const r2 = await postResponses({ fetchFn, apiKey: key, model: primaryModel, input: stripped, req });
      if (r2.err) {
        return fail(isAbortError(r2.err) ? ERR.TIMEOUT : ERR.NETWORK, (r2.err && r2.err.message) || 'Network error');
      }
      const res2 = r2.res;
      if (res2.status === 401) {
        notify(PILL.NO_KEY);
        return fail(ERR.BAD_KEY, '401: Invalid API key');
      }
      if (res2.ok) return toAskResult(res2, primaryModel);
      const bodyText2 = await safeText(res2);
      return fail(ERR.HTTP_ERROR, `${res2.status}: ${providerMessageFrom(bodyText2)}`);
    }

    return fail(ERR.HTTP_ERROR, `${res1.status}: ${providerMessageFrom(bodyText1)}`);
  } catch (e) {
    return fail(ERR.INTERNAL, (e && e.message) || 'callModel failed');
  }
}

/* --------------------------------------------------------------------- TTS */

export async function speech({ text, apiKey, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  try {
    const key = (apiKey || '').trim();
    if (!key) return fail(ERR.NO_KEY, 'No API key set. Add one in settings.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.TIMEOUT_MS);
    let res;
    try {
      res = await fetchFn(API.speech, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODELS.tts, voice: TTS_VOICE, input: text, response_format: 'mp3' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) return fail(ERR.BAD_KEY, '401: Invalid API key');
    if (!res.ok) {
      const bodyText = await safeText(res);
      return fail(ERR.TTS_FAILED, `${res.status}: ${providerMessageFrom(bodyText)}`);
    }
    const buf = await res.arrayBuffer();
    return ok({ audioBase64: arrayBufferToBase64(buf), mime: 'audio/mpeg' });
  } catch (e) {
    return fail(ERR.TTS_FAILED, (e && e.message) || 'TTS failed');
  }
}

/* --------------------------------------------------------------------- STT */

export async function transcribe({ audioBase64, mime, apiKey, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  try {
    const key = (apiKey || '').trim();
    if (!key) return fail(ERR.NO_KEY, 'No API key set. Add one in settings.');

    const bytes = base64ToUint8Array(audioBase64);
    const blob = new Blob([bytes], { type: mime || 'audio/webm' });
    const filename = `audio.${extensionForMime(mime)}`;
    const form = new FormData();
    form.append('file', new File([blob], filename, { type: mime || 'audio/webm' }));
    form.append('model', MODELS.stt);
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.TIMEOUT_MS);
    let res;
    try {
      res = await fetchFn(API.transcriptions, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) return fail(ERR.BAD_KEY, '401: Invalid API key');
    if (!res.ok) {
      const bodyText = await safeText(res);
      return fail(ERR.STT_FAILED, `${res.status}: ${providerMessageFrom(bodyText)}`);
    }
    const json = await safeJson(res);
    return ok({ text: (json && json.text) || '' });
  } catch (e) {
    return fail(ERR.STT_FAILED, (e && e.message) || 'Transcription failed');
  }
}
