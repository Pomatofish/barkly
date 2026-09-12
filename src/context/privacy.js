// src/context/privacy.js — per-username public/private cache (failure rows 1 and 2).
// chrome.storage.local[STORAGE_KEYS.PRIVACY_CACHE] when chrome exists, an in-memory
// Map otherwise (test pages, Node). Never throws.
import { STORAGE_KEYS } from '../../shared/types.js';

/** @type {Map<string, { isPrivate: boolean, seenAt: number }>} */
const mem = new Map();
let loaded = false;

function hasChromeStorage() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
  } catch (e) {
    return false;
  }
}

/** Load the persisted cache into memory once (cheap no-op afterwards). */
export async function loadPrivacyCache() {
  if (loaded) return;
  loaded = true;
  try {
    if (!hasChromeStorage()) return;
    const got = await chrome.storage.local.get(STORAGE_KEYS.PRIVACY_CACHE);
    const raw = got && got[STORAGE_KEYS.PRIVACY_CACHE];
    if (raw && typeof raw === 'object') {
      for (const [name, entry] of Object.entries(raw)) {
        if (entry && typeof entry.isPrivate === 'boolean') {
          mem.set(name, { isPrivate: entry.isPrivate, seenAt: Number(entry.seenAt) || 0 });
        }
      }
    }
  } catch (e) {
    // storage unavailable / corrupt — the in-memory map still works
  }
}

/** @param {string} username @returns {boolean|null} */
export function lookupPrivacy(username) {
  try {
    if (!username) return null;
    const entry = mem.get(String(username).toLowerCase());
    return entry ? entry.isPrivate : null;
  } catch (e) {
    return null;
  }
}

/** Remember what we saw on a profile page. @returns {Promise<void>} */
export async function rememberPrivacy(username, isPrivate) {
  try {
    if (!username || typeof isPrivate !== 'boolean') return;
    const key = String(username).toLowerCase();
    const prev = mem.get(key);
    if (prev && prev.isPrivate === isPrivate) return;
    mem.set(key, { isPrivate, seenAt: Date.now() });
    if (!hasChromeStorage()) return;
    const got = await chrome.storage.local.get(STORAGE_KEYS.PRIVACY_CACHE);
    const cache = (got && got[STORAGE_KEYS.PRIVACY_CACHE]) || {};
    cache[key] = { isPrivate, seenAt: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEYS.PRIVACY_CACHE]: cache });
  } catch (e) {
    // best effort only
  }
}

/** Test/debug helper: wipe the in-memory cache. */
export function resetPrivacyCache() {
  try {
    mem.clear();
    loaded = false;
  } catch (e) { /* noop */ }
}

/** Snapshot of the in-memory cache (debugging / test page). */
export function privacySnapshot() {
  try {
    return Object.fromEntries(mem);
  } catch (e) {
    return {};
  }
}

/**
 * Read a profile page's privacy marker.
 * true  = "This account is private" / lock icon
 * false = the profile rendered normally (a posts grid is present)
 * null  = cannot tell
 * @param {Document} doc
 * @returns {boolean|null}
 */
export function detectProfilePrivacy(doc) {
  try {
    if (!doc || !doc.querySelector) return null;
    const main = doc.querySelector('main[role="main"]') || doc.querySelector('main') || doc.body;
    const text = (main && main.textContent) || '';
    if (/this account is private/i.test(text)) return true;
    if (doc.querySelector('svg[aria-label="Private"]')) return true;

    // A normally rendered profile: a grid of post links, or the header stats row.
    const gridLinks = (main || doc).querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    if (gridLinks && gridLinks.length >= 1) return false;
    if (/\bposts\b/i.test(text) && /\bfollowers\b/i.test(text)) return false;
    return null;
  } catch (e) {
    return null;
  }
}
