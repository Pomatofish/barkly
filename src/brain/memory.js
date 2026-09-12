// src/brain/memory.js — the memory store (chrome.storage.local[STORAGE_KEYS.MEMORY]).
// Owned by the brain. Never throws: every exported function has a defined fallback.
// No chrome.* and no DOM access at module top level (so this imports in Node).
//
// Failure rows implemented here:
//   16  storage full / corrupt  → reset pinned + history, keep profile, tell the user once
//   17  pinned store full (25)  → evict the lowest-score item, never the one just pinned
import { STORAGE_KEYS, LIMITS, PERSONAS, defaultMemory } from '../../shared/types.js';

/* ------------------------------------------------------------------ state */

/** In-memory fallback used when chrome.storage is unavailable (Node, test pages). */
const fallbackStore = Object.create(null);

/** Row 16: one-time note handed to the NEXT askAssistant() and then cleared. */
export const CORRUPT_NOTICE =
  'Your saved memories were reset because the store was corrupt';
let pendingNotice = null;

/** Set the one-time notice (idempotent — the same note is never queued twice). */
export function setNotice(text) {
  if (text && pendingNotice !== text) pendingNotice = text;
}

/** Read and clear the one-time notice. @returns {string|null} */
export function takeNotice() {
  const n = pendingNotice;
  pendingNotice = null;
  return n;
}

/** Test/reset helper: drop a queued notice without returning it. */
export function clearNotice() {
  pendingNotice = null;
}

/* ---------------------------------------------------------------- storage */

function localStorageArea() {
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
  } catch (e) {
    /* chrome not defined in this realm */
  }
  return null;
}

/**
 * Call a chrome.storage method that may be promise-based (MV3) or callback-based.
 * Never resolves twice; rejects on a synchronous throw or on runtime.lastError.
 */
function callStorage(fn, thisArg, arg) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const bad = (e) => { if (!settled) { settled = true; reject(e instanceof Error ? e : new Error(String(e))); } };
    let maybe;
    try {
      maybe = fn.call(thisArg, arg, (v) => {
        let lastError = null;
        try { lastError = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) || null; } catch (e) { /* ignore */ }
        if (lastError) bad(new Error(lastError.message || 'storage error'));
        else done(v);
      });
    } catch (e) {
      bad(e);
      return;
    }
    if (maybe && typeof maybe.then === 'function') maybe.then(done, bad);
  });
}

/** @returns {Promise<any>} the raw stored value (may be undefined). Throws on a storage error. */
async function storageGet(key) {
  const area = localStorageArea();
  if (!area) return fallbackStore[key];
  const bag = await callStorage(area.get, area, key);
  return bag ? bag[key] : undefined;
}

/** Throws on a storage error (quota) so callers can run the row-16 fallback. */
async function storageSet(key, value) {
  const area = localStorageArea();
  if (!area) { fallbackStore[key] = value; return; }
  await callStorage(area.set, area, { [key]: value });
}

/* -------------------------------------------------------------- normalise */

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return typeof v === 'string' ? v : ''; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

const PIN_KINDS = ['post_style', 'fact', 'preference', 'post_ref'];

let idSeq = 0;
/** Unique-enough id without any dependency. */
export function newId(prefix) {
  idSeq += 1;
  return `${prefix || 'pin'}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Clamp a model-written summary to LIMITS.PIN_CONTENT_MAX_WORDS words. */
export function clampWords(text, maxWords) {
  const s = str(text).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const words = s.split(' ');
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(' ').replace(/[,;:.\-—]$/, '') + '…';
}

function normaliseProfile(p) {
  const base = defaultMemory().profile;
  if (!isObj(p)) return base;
  return {
    persona: PERSONAS.indexOf(p.persona) >= 0 ? p.persona : base.persona,
    brandVoice: str(p.brandVoice),
    niche: str(p.niche),
  };
}

function normalisePin(item) {
  if (!isObj(item)) return null;
  const content = clampWords(item.content, LIMITS.PIN_CONTENT_MAX_WORDS);
  if (!content) return null;
  const now = Date.now();
  const src = isObj(item.source) ? item.source : {};
  const source = {};
  if (str(src.username)) source.username = str(src.username);
  if (str(src.postId)) source.postId = str(src.postId);
  if (str(src.url)) source.url = str(src.url);
  return {
    id: str(item.id) || newId('pin'),
    kind: PIN_KINDS.indexOf(item.kind) >= 0 ? item.kind : 'fact',
    content,
    source,
    score: num(item.score, LIMITS.EXPLICIT_PIN_SCORE),
    savedAt: num(item.savedAt, now),
    lastUsedAt: num(item.lastUsedAt, now),
  };
}

function normaliseHistoryEntry(h) {
  if (!isObj(h)) return null;
  const text = str(h.text).trim();
  if (!text) return null;
  const entry = {
    role: h.role === 'assistant' ? 'assistant' : 'user',
    text,
    inputMode: h.inputMode === 'voice' ? 'voice' : 'text',
    pageType: str(h.pageType) || 'unknown',
    ts: num(h.ts, Date.now()),
  };
  if (str(h.postId)) entry.postId = str(h.postId);
  return entry;
}

/** Trim pinned to the cap (keep the highest scores) and history to the last N. */
function enforceCaps(memory) {
  if (memory.pinned.length > LIMITS.PINNED_CAP) {
    memory.pinned = [...memory.pinned]
      .sort((a, b) => b.score - a.score || b.lastUsedAt - a.lastUsedAt)
      .slice(0, LIMITS.PINNED_CAP);
  }
  if (memory.history.length > LIMITS.HISTORY_CAP) {
    memory.history = memory.history.slice(memory.history.length - LIMITS.HISTORY_CAP);
  }
  return memory;
}

/** True when the value has the right top-level shape (row 16 detector). */
export function isValidMemory(m) {
  return isObj(m) && isObj(m.profile) && Array.isArray(m.pinned) && Array.isArray(m.history);
}

function normaliseMemory(m) {
  return enforceCaps({
    profile: normaliseProfile(m.profile),
    pinned: m.pinned.map(normalisePin).filter(Boolean),
    history: m.history.map(normaliseHistoryEntry).filter(Boolean),
  });
}

function clone(m) {
  try { return JSON.parse(JSON.stringify(m)); } catch (e) { return defaultMemory(); }
}

/* ------------------------------------------------------------------- API */

/**
 * Read the memory. Row 16: on a parse error, an invalid shape or a storage error the
 * pinned + history lists are reset (the profile is kept when it is readable), the reset
 * is persisted and a one-time notice is queued for the next askAssistant().
 * @returns {Promise<import('../../shared/types.js').Memory>}
 */
export async function getMemory() {
  let raw;
  try {
    raw = await storageGet(STORAGE_KEYS.MEMORY);
  } catch (e) {
    return repair(defaultMemory().profile);
  }
  if (raw === undefined || raw === null) return defaultMemory();

  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch (e) { return repair(defaultMemory().profile); }
  }
  if (!isValidMemory(value)) {
    // Salvage the profile if there is one; everything else goes.
    const profile = normaliseProfile(isObj(value) ? value.profile : null);
    return repair(profile);
  }
  try {
    return normaliseMemory(value);
  } catch (e) {
    return repair(defaultMemory().profile);
  }
}

/** Row 16 recovery: keep the profile, drop pinned + history, persist, queue the notice. */
async function repair(profile) {
  const fixed = { profile: normaliseProfile(profile), pinned: [], history: [] };
  setNotice(CORRUPT_NOTICE);
  try { await storageSet(STORAGE_KEYS.MEMORY, fixed); } catch (e) { /* best effort */ }
  return clone(fixed);
}

/** Persist. On a quota/storage error run the row-16 fallback instead of throwing. */
async function persist(memory) {
  const next = enforceCaps(memory);
  try {
    await storageSet(STORAGE_KEYS.MEMORY, next);
    return clone(next);
  } catch (e) {
    return repair(next.profile);
  }
}

/**
 * Shallow merge; profile is merged one level deeper. Caps are enforced.
 * @param {Partial<import('../../shared/types.js').Memory>} partial
 */
export async function saveMemory(partial) {
  try {
    const current = await getMemory();
    const p = isObj(partial) ? partial : {};
    const merged = {
      profile: normaliseProfile({ ...current.profile, ...(isObj(p.profile) ? p.profile : {}) }),
      pinned: Array.isArray(p.pinned) ? p.pinned.map(normalisePin).filter(Boolean) : current.pinned,
      history: Array.isArray(p.history) ? p.history.map(normaliseHistoryEntry).filter(Boolean) : current.history,
    };
    return await persist(merged);
  } catch (e) {
    return defaultMemory();
  }
}

function sameSource(a, b) {
  const ap = (a && a.postId) || '';
  const bp = (b && b.postId) || '';
  return !!ap && ap === bp;
}

function sameContent(a, b) {
  return str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
}

/**
 * Add a pinned item.
 * Dedupe: same kind + same source.postId (or identical content) bumps the existing item's
 * score by 1 and refreshes lastUsedAt instead of adding a second copy.
 * Row 17: at LIMITS.PINNED_CAP the lowest-score item that is NOT the new one is evicted.
 * @param {{kind:string, content:string, source?:object, score?:number}} item
 */
export async function pin(item) {
  try {
    const memory = await getMemory();
    const candidate = normalisePin({
      ...item,
      score: typeof (item && item.score) === 'number' ? item.score : LIMITS.EXPLICIT_PIN_SCORE,
    });
    if (!candidate) return memory;

    const now = Date.now();
    const dupe = memory.pinned.find(
      (p) => p.kind === candidate.kind
        && (sameSource(p.source, candidate.source) || sameContent(p.content, candidate.content)),
    );
    if (dupe) {
      dupe.score += 1;
      dupe.lastUsedAt = now;
      return await persist(memory);
    }

    candidate.savedAt = now;
    candidate.lastUsedAt = now;
    memory.pinned.push(candidate);

    // Row 17: evict the lowest-score item(s), never the one just pinned.
    while (memory.pinned.length > LIMITS.PINNED_CAP) {
      let worstIdx = -1;
      for (let i = 0; i < memory.pinned.length; i += 1) {
        const p = memory.pinned[i];
        if (p.id === candidate.id) continue;
        if (worstIdx === -1) { worstIdx = i; continue; }
        const w = memory.pinned[worstIdx];
        if (p.score < w.score || (p.score === w.score && p.lastUsedAt < w.lastUsedAt)) worstIdx = i;
      }
      if (worstIdx === -1) break;
      memory.pinned.splice(worstIdx, 1);
    }
    return await persist(memory);
  } catch (e) {
    return defaultMemory();
  }
}

/** Permanent delete. */
export async function unpin(id) {
  try {
    const memory = await getMemory();
    memory.pinned = memory.pinned.filter((p) => p.id !== id);
    return await persist(memory);
  } catch (e) {
    return defaultMemory();
  }
}

/** Clears pinned + history, keeps the profile. */
export async function forgetAll() {
  try {
    const memory = await getMemory();
    return await persist({ profile: memory.profile, pinned: [], history: [] });
  } catch (e) {
    return defaultMemory();
  }
}

/**
 * Append turns to the rolling history (cap LIMITS.HISTORY_CAP).
 * @param {Array<object>} entries
 */
export async function appendHistory(entries) {
  try {
    const list = (Array.isArray(entries) ? entries : [entries]).map(normaliseHistoryEntry).filter(Boolean);
    if (!list.length) return await getMemory();
    const memory = await getMemory();
    memory.history = memory.history.concat(list);
    return await persist(memory);
  } catch (e) {
    return defaultMemory();
  }
}

/**
 * Every pinned item that actually went into a prompt gets score += 1 and a fresh lastUsedAt.
 * @param {string[]} ids
 */
export async function bumpPinned(ids) {
  try {
    const wanted = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!wanted.length) return await getMemory();
    const memory = await getMemory();
    const now = Date.now();
    let touched = false;
    for (const p of memory.pinned) {
      if (wanted.indexOf(p.id) >= 0) { p.score += 1; p.lastUsedAt = now; touched = true; }
    }
    if (!touched) return memory;
    return await persist(memory);
  } catch (e) {
    return defaultMemory();
  }
}

/** Test helper: wipe the in-memory fallback store (no effect on chrome.storage). */
export function _resetFallbackStore() {
  for (const k of Object.keys(fallbackStore)) delete fallbackStore[k];
}

/** Queue a one-line system note for the NEXT askAssistant() result (e.g. the real bus error). */
export function queueNotice(msg) { pendingNotice = msg ? String(msg) : null; }
