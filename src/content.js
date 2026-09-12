// src/content.js — the only classic (non-module) content script.
// Its single job is to load src/main.js as an ES module inside the content
// script's isolated world so every folder can be a real module with imports.
(() => {
  if (window.__grammyLoaded) return;
  window.__grammyLoaded = true;
  try {
    import(chrome.runtime.getURL('src/main.js')).catch((e) => {
      console.error('[grammy] failed to load main.js', e);
    });
  } catch (e) {
    console.error('[grammy] loader error', e);
  }
})();
