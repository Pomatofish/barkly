// src/context/early.js — classic content script, document_start (see manifest.json).
// Owned by the context module. Injects src/context/injected.js into the PAGE world and
// keeps a per-shortcode index of the GraphQL / api/v1 JSON Instagram already fetched
// (ported from demos/fetch/content.js). This is a SECONDARY source only: src/context/index.js
// reads window.__grammyCapture lazily to fill gaps the rendered DOM left.
// No request is ever sent to Instagram. Every step is wrapped: if injection is blocked by
// CSP the page and the rest of the extension keep working.
(() => {
  try {
    if (window.__grammyEarly) return;
    window.__grammyEarly = true;

    /** @type {{ byShortcode: Record<string, any> }} */
    const store = { byShortcode: Object.create(null) };
    window.__grammyCapture = store;

    // ---- inject the page-world patcher ASAP -------------------------------
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/context/injected.js');
      s.async = false;
      s.onload = function () { try { this.remove(); } catch (e) { /* noop */ } };
      s.onerror = function () { try { this.remove(); } catch (e) { /* noop */ } };
      (document.head || document.documentElement).prepend(s);
    } catch (e) {
      // blocked — the DOM reader is the primary source anyway
    }

    // ---- index the captured JSON -----------------------------------------
    const walk = (obj, fn, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 14) return;
      fn(obj);
      for (const k in obj) {
        const v = obj[k];
        if (v && typeof v === 'object') walk(v, fn, depth + 1);
      }
    };

    const isVideo = (n) => n.is_video === true || n.media_type === 2
      || typeof n.video_url === 'string'
      || (Array.isArray(n.video_versions) && n.video_versions.length > 0);

    const imagesOf = (n) => {
      const out = [];
      if (typeof n.display_url === 'string') out.push(n.display_url);
      const cands = n.image_versions2 && n.image_versions2.candidates;
      if (Array.isArray(cands) && cands.length) {
        const sorted = [...cands].sort((a, b) => (a.width || 0) - (b.width || 0));
        const pick = sorted.find((c) => (c.width || 0) >= 600) || sorted[sorted.length - 1];
        if (pick && pick.url) out.push(pick.url);
      }
      if (Array.isArray(n.display_resources)) {
        const r = n.display_resources.find((x) => (x.config_width || 0) >= 600) || n.display_resources[0];
        if (r && r.src) out.push(r.src);
      }
      return out;
    };

    const videosOf = (n) => {
      const out = [];
      if (typeof n.video_url === 'string') out.push(n.video_url);
      const vv = n.video_versions;
      if (Array.isArray(vv) && vv.length) {
        const sorted = [...vv].sort((a, b) => (a.height || 0) - (b.height || 0));
        const pick = sorted.find((v) => (v.height || 0) >= 480) || sorted[0];
        if (pick && pick.url) out.push(pick.url);
      }
      return out;
    };

    const keyOf = (u) => {
      try { return new URL(u).pathname.split('/').pop().split('?')[0].split('_')[0]; } catch (e) { return u; }
    };
    const dedup = (arr) => {
      const m = new Map();
      for (const u of arr) if (!m.has(keyOf(u))) m.set(keyOf(u), u);
      return [...m.values()];
    };

    const collect = (media) => {
      const images = []; const videos = []; const thumbnails = [];
      const children = (media.edge_sidecar_to_children && media.edge_sidecar_to_children.edges
        && media.edge_sidecar_to_children.edges.map((e) => e.node)) || media.carousel_media || null;
      const nodes = (Array.isArray(children) && children.length) ? children : [media];
      for (const n of nodes) {
        if (isVideo(n)) {
          videos.push(...videosOf(n));
          const thumb = imagesOf(n)[0];
          if (thumb) thumbnails.push(thumb);
        } else {
          images.push(...imagesOf(n));
        }
      }
      return { images, videos, thumbnails };
    };

    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window || !e.data || e.data.source !== 'grammy-capture') return;
        walk(e.data.data, (node) => {
          const code = node.code || node.shortcode;
          if (typeof code !== 'string' || code.length < 5) return;
          if (!node.display_url && !node.image_versions2 && !node.carousel_media
              && !node.edge_sidecar_to_children && !node.video_versions) return;

          const { images, videos, thumbnails } = collect(node);
          if (!images.length && !videos.length) return;

          const owner = node.owner || node.user || {};
          const entry = {
            images: dedup(images),
            videos: dedup(videos),
            thumbnails: dedup(thumbnails),
            author: owner.username || '',
            isPrivate: typeof owner.is_private === 'boolean' ? owner.is_private : null,
            caption: (node.edge_media_to_caption && node.edge_media_to_caption.edges
              && node.edge_media_to_caption.edges[0] && node.edge_media_to_caption.edges[0].node
              && node.edge_media_to_caption.edges[0].node.text)
              || (node.caption && node.caption.text) || '',
          };

          const size = (x) => x.images.length + x.videos.length;
          const existing = store.byShortcode[code];
          if (!existing || size(entry) > size(existing)) store.byShortcode[code] = entry;
        });
      } catch (err) { /* a malformed payload must never break the page */ }
    });
  } catch (e) {
    // never break instagram.com
  }
})();
