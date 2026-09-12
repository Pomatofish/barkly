// src/context/injected.js — PAGE WORLD. Injected by src/context/early.js at document_start.
// Ported from demos/fetch/injected.js. It patches fetch/XHR so it can read the JSON
// Instagram ALREADY requested and relays it to the extension's isolated world.
// It NEVER issues a request of its own. If anything fails, the page must keep working.
(() => {
  try {
    if (window.__grammyInjected) return;
    window.__grammyInjected = true;

    const send = (url, data) => {
      try { window.postMessage({ source: 'grammy-capture', url, data }, '*'); } catch (e) { /* noop */ }
    };
    const interesting = (u) => typeof u === 'string' && (u.includes('/graphql') || u.includes('/api/v1/'));

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (...args) {
        const p = origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (interesting(url)) {
            p.then((res) => {
              try { res.clone().json().then((d) => send(url, d)).catch(() => {}); } catch (e) { /* noop */ }
              return res;
            }).catch(() => {});
          }
        } catch (e) { /* noop */ }
        return p;
      };
    }

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      try {
        this.addEventListener('load', () => {
          try {
            const u = this.responseURL || '';
            if (interesting(u)) send(u, JSON.parse(this.responseText));
          } catch (e) { /* noop */ }
        });
      } catch (e) { /* noop */ }
      return origSend.apply(this, args);
    };
  } catch (e) {
    // Instagram CSP or an unexpected page shape — stay silent, the DOM reader still works.
  }
})();
