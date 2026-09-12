// src/onboarding/onboarding.js — STUB (Phase 1). The onboarding subagent builds the real flow.
import { STORAGE_KEYS, MSG, request } from '../../shared/types.js';

const $ = (id) => document.getElementById(id);

$('mic').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    $('micState').textContent = 'granted';
  } catch (e) {
    $('micState').textContent = 'denied (' + e.name + ')';
  }
});

$('done').addEventListener('click', async () => {
  try {
    const persona = document.querySelector('input[name=persona]:checked').value;
    const key = $('key').value.trim();
    await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: key, [STORAGE_KEYS.ONBOARDED]: true });
    await request(MSG.SAVE_MEMORY, { memory: { profile: { persona } } });
    $('note').textContent = 'Saved. You can close this tab.';
    window.close();
  } catch (e) {
    $('note').textContent = 'Could not save: ' + (e && e.message);
  }
});
