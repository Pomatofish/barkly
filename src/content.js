// src/content.js — classic content script. Its only job is to load the ES-module app.
// Everything else lives in src/main.js and the module folders (see shared/types.js).
(() => {
  if (window.__grammyLoaded) return;
  window.__grammyLoaded = true;
  try {
    import(chrome.runtime.getURL('src/main.js')).catch((e) => console.error('[grammy] failed to load main.js', e));
  } catch (e) {
    console.error('[grammy] loader error', e);
  }
})();
