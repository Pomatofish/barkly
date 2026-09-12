// src/context/early.js — classic content script, runs at document_start (see manifest.json).
// Owned by the context module. Use it to inject a page-world script (like
// demos/fetch/injected.js) that passively captures the GraphQL / api/v1 JSON
// Instagram already fetches, and to relay it to the isolated world via
// window.postMessage. STUB: does nothing yet.
(() => {
  if (window.__grammyEarly) return;
  window.__grammyEarly = true;
})();
