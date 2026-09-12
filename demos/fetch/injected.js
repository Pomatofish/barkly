(() => {
  const send = (url, data) => {
    try { window.postMessage({ source: 'ig-buddy', url, data }, '*'); } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (url.includes('/graphql') || url.includes('/api/v1/')) {
      res.clone().json().then(d => send(url, d)).catch(() => {});
    }
    return res;
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      const u = this.responseURL || '';
      if (u.includes('/graphql') || u.includes('/api/v1/')) {
        try { send(u, JSON.parse(this.responseText)); } catch {}
      }
    });
    return origSend.apply(this, args);
  };
})();