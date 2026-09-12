// ---- inject the page-context patcher ASAP ----
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = function () { this.remove(); };
(document.head || document.documentElement).prepend(s);

// ---- capture store: shortcode -> { images, videos, thumbnails, isPrivate, author } ----
const postIndex = new Map();

function walk(obj, fn, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return;
  fn(obj);
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === 'object') walk(v, fn, depth + 1);
  }
}

function isVideo(node) {
  return node.is_video === true
      || node.media_type === 2
      || typeof node.video_url === 'string'
      || (Array.isArray(node.video_versions) && node.video_versions.length > 0);
}

function urlsFromNode(node) {
  const out = [];
  if (typeof node.display_url === 'string') out.push(node.display_url);
  const cands = node.image_versions2?.candidates;
  if (Array.isArray(cands) && cands.length) {
    const sorted = [...cands].sort((a, b) => (a.width || 0) - (b.width || 0));
    const pick = sorted.find(c => (c.width || 0) >= 600) || sorted[sorted.length - 1];
    if (pick?.url) out.push(pick.url);
  }
  if (Array.isArray(node.display_resources)) {
    const r = node.display_resources.find(x => (x.config_width || 0) >= 600)
           || node.display_resources[0];
    if (r?.src) out.push(r.src);
  }
  return out;
}

function videosFromNode(node) {
  const out = [];
  if (typeof node.video_url === 'string') out.push(node.video_url);
  const vv = node.video_versions;
  if (Array.isArray(vv) && vv.length) {
    const sorted = [...vv].sort((a, b) => (a.height || 0) - (b.height || 0));
    const pick = sorted.find(v => (v.height || 0) >= 480) || sorted[0];
    if (pick?.url) out.push(pick.url);
  }
  return out;
}

function collectMedia(media) {
  const images = [], videos = [], thumbnails = [];
  const children = media.edge_sidecar_to_children?.edges?.map(e => e.node)
                || media.carousel_media
                || null;
  const nodes = (Array.isArray(children) && children.length) ? children : [media];

  for (const n of nodes) {
    if (isVideo(n)) {
      videos.push(...videosFromNode(n));
      const thumb = urlsFromNode(n)[0];
      if (thumb) thumbnails.push(thumb);
    } else {
      images.push(...urlsFromNode(n));
    }
  }
  return { images, videos, thumbnails };
}

function key(url) {
  try {
    const f = new URL(url).pathname.split('/').pop();
    return f.split('?')[0].split('_')[0];
  } catch { return url; }
}

const dedup = (arr) => {
  const m = new Map();
  for (const u of arr) if (!m.has(key(u))) m.set(key(u), u);
  return [...m.values()];
};

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'ig-buddy') return;
  walk(e.data.data, (node) => {
    const code = node.code || node.shortcode;
    if (typeof code !== 'string' || code.length < 5) return;
    if (!node.display_url && !node.image_versions2 && !node.carousel_media
        && !node.edge_sidecar_to_children && !node.video_versions) return;

    const { images, videos, thumbnails } = collectMedia(node);
    if (!images.length && !videos.length) return;

    const owner = node.owner || node.user || {};
    const entry = {
      images: dedup(images),
      videos: dedup(videos),
      thumbnails: dedup(thumbnails),
      author: owner.username ?? '',
      isPrivate: owner.is_private === true,
      caption: node.edge_media_to_caption?.edges?.[0]?.node?.text
            ?? node.caption?.text ?? '',
    };

    const existing = postIndex.get(code);
    const size = (x) => x.images.length + x.videos.length;
    if (!existing || size(entry) > size(existing)) postIndex.set(code, entry);
  });
});

// ---- which post is on screen ----
function currentArticle() {
  const articles = [...document.querySelectorAll('article')];
  let best = null, bestScore = 0;
  for (const a of articles) {
    const r = a.getBoundingClientRect();
    const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (visible > bestScore) { bestScore = visible; best = a; }
  }
  return bestScore > 0 ? best : null;
}

function shortcodeFor(article) {
  if (article) {
    const link = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    const m = link?.getAttribute('href')?.match(/\/(?:p|reel)\/([^/]+)/);
    if (m) return m[1];
  }
  const m2 = location.pathname.match(/\/(?:p|reel)\/([^/]+)/);
  return m2 ? m2[1] : null;
}

const EMPTY = { images: [], videos: [], thumbnails: [], author: '', isPrivate: false, caption: '' };

function readPost() {
  const article = currentArticle();
  const domAuthor = article?.querySelector('a[href^="/"]')?.textContent ?? '';

  let captured = null, matchedCode = null;

  // match by visible image URL — survives DOM changes
  if (article) {
    const imgs = [...article.querySelectorAll('img')]
      .filter(i => i.naturalWidth > 200 && i.height > 200);
    const visibleKeys = new Set(imgs.map(i => key(i.src)));

    for (const [code, entry] of postIndex) {
      const pool = [...entry.images, ...entry.thumbnails];
      if (pool.some(u => visibleKeys.has(key(u)))) {
        captured = entry; matchedCode = code; break;
      }
    }
  }

  // fallback for reels / permalinks with no matchable image
  if (!captured) {
    const code = shortcodeFor(article);
    if (code && postIndex.has(code)) {
      captured = postIndex.get(code); matchedCode = code;
    }
  }

  const e = captured || EMPTY;
  return {
    shortcode: matchedCode ?? shortcodeFor(article),
    author: e.author || domAuthor,
    isPrivate: e.isPrivate,
    images: e.images.length,
    videos: e.videos.length,
    thumbnails: e.thumbnails.length,
    caption: e.caption.slice(0, 120),
    indexSize: postIndex.size,
    _entry: e,
  };
}

// ---- overlay ----
const box = document.createElement('div');
box.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;
  background:#111;color:#0f0;font:11px monospace;padding:12px;
  max-width:340px;max-height:420px;overflow:auto;border-radius:8px`;

function mount() { if (document.body && !box.isConnected) document.body.appendChild(box); }
mount();
addEventListener('DOMContentLoaded', mount);

let current = null;

function mkBtn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'margin:8px 4px 0 0;padding:4px 8px;cursor:pointer';
  b.disabled = disabled;
  b.onclick = onClick;
  return b;
}

setInterval(() => {
  mount();
  current = readPost();
  box.innerHTML = '';

  const { _entry, ...display } = current;
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;color:#0f0';
  pre.textContent = JSON.stringify(display, null, 2);
  box.appendChild(pre);

  box.appendChild(mkBtn(`images (${current.images})`, !current.images,
    () => openBlobs(_entry.images)));
  box.appendChild(mkBtn(`videos (${current.videos})`, !current.videos,
    () => _entry.videos.forEach(u => window.open(u, '_blank'))));
  box.appendChild(mkBtn(`thumbs (${current.thumbnails})`, !current.thumbnails,
    () => openBlobs(_entry.thumbnails)));
}, 1000);

async function openBlobs(urls) {
  console.log('[ig-buddy] urls:', urls);
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const bu = URL.createObjectURL(blob);
      window.open(bu, '_blank');
      setTimeout(() => URL.revokeObjectURL(bu), 60000);
    } catch (err) { console.warn('failed', url, err.message); }
  }
}