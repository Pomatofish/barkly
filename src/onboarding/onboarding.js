// src/onboarding/onboarding.js — STUB. Saves persona + key, requests the mic on this (extension) origin.
// The onboarding subagent replaces this with the full 3-step flow (port demos/mic-tts-test-insta/app.js grant part).
import { STORAGE_KEYS, defaultMemory } from '../../shared/types.js';

const $ = (id) => document.getElementById(id);

async function init() {
  try {
    const got = await chrome.storage.local.get([STORAGE_KEYS.API_KEY, STORAGE_KEYS.MEMORY]);
    const persona = got[STORAGE_KEYS.MEMORY]?.profile?.persona || 'casual';
    const radio = document.querySelector(`input[name="persona"][value="${persona}"]`);
    if (radio) radio.checked = true;
    if (got[STORAGE_KEYS.API_KEY]) $('key').value = got[STORAGE_KEYS.API_KEY];
  } catch (e) {
    console.warn('[onboarding stub] init failed', e);
  }
}

$('mic').addEventListener('click', async () => {
  $('micState').textContent = 'asking…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    $('micState').textContent = 'granted ✓';
  } catch (e) {
    $('micState').textContent = `not granted (${e.name})`;
  }
});

$('done').addEventListener('click', async () => {
  try {
    const persona = document.querySelector('input[name="persona"]:checked')?.value || 'casual';
    const got = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    const memory = got[STORAGE_KEYS.MEMORY] || defaultMemory();
    memory.profile = { ...memory.profile, persona };
    await chrome.storage.local.set({
      [STORAGE_KEYS.MEMORY]: memory,
      [STORAGE_KEYS.API_KEY]: $('key').value.trim(),
      [STORAGE_KEYS.ONBOARDED]: true,
    });
    $('note').textContent = 'Saved. You can close this tab.';
    setTimeout(() => window.close(), 600);
  } catch (e) {
    $('note').textContent = `Could not save: ${e.message}`;
  }
});

init();
