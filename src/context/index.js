// src/context/index.js — page context for Grammy.
// Reads the RENDERED DOM only: no Instagram endpoint is ever called, nothing is
// clicked, nothing is auto-loaded. A passive capture index (src/context/early.js +
// injected.js, ported from demos/fetch) is used ONLY as a gap filler.
// No chrome.* and no DOM access at module top level — everything is guarded inside
// functions so this file imports cleanly in Node and in plain test pages.
import { PILL, emptyContext } from '../../shared/types.js';
import {
  detectPageType, openModalArticle, shortcodeFromUrl, usernameFromUrl,
} from './pagetype.js';
import {
  readArticle, readStory, readDraftCaption, blankPost, textOf,
} from './readers.js';
import {
  loadPrivacyCache, lookupPrivacy, rememberPrivacy, detectProfilePrivacy,
} from './privacy.js';
import { enrichFromCapture } from './capture.js';

export { detectPageType, pageTypeFromUrl } from './pagetype.js';
export { loadPrivacyCache, lookupPrivacy, privacySnapshot, resetPrivacyCache } from './privacy.js';

/* ---------------------------------------------------------------- helpers */

function theDoc(o) {
  if (o && o.doc) return o.doc;
  return typeof document !== 'undefined' ? document : null;
}
function theWin(o) {
  if (o && o.win) return o.win;
  return typeof window !== 'undefined' ? window : null;
}
function theUrl(o) {
  if (o && typeof o.url === 'string' && o.url) return o.url;
  try {
    if (typeof location !== 'undefined' && location.href) return location.href;
  } catch (e) { /* noop */ }
  return '';
}

/** Never read content owned by a private account (row 1). */
function stripPrivate(post) {
  post.caption = null;
  post.comments = [];
  post.altText = null;
  post.mediaType = null;
  post.mediaUrl = null;
  return post;
}

/** Profile handle from the profile header, when the URL did not give one. */
function profileUsername(doc, url) {
  const fromUrl = usernameFromUrl(url);
  if (fromUrl) return fromUrl;
  try {
    const header = doc.querySelector('main header, header');
    const h = header && header.querySelector('h1, h2');
    const t = textOf(h);
    if (t && /^[A-Za-z0-9._]{1,30}$/.test(t)) return t;
  } catch (e) { /* noop */ }
  return null;
}

/** Rect area guard — DOMParser documents report all zeros. */
function rectOf(el, win) {
  try {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r) return null;
    if (!r.width && !r.height && !r.top && !r.bottom) return null;
    return r;
  } catch (e) {
    return null;
  }
}

/** open modal > story on screen > article nearest the viewport centre. */
function pickFocusedId(posts, articles, doc, win, url, pageType) {
  try {
    if (!posts.length) return null;
    const modal = openModalArticle(doc);
    if (modal) {
      const i = articles.indexOf(modal);
      if (i >= 0) return posts[i].id;
      const inside = articles.findIndex((a) => modal.contains && modal.contains(a));
      if (inside >= 0) return posts[inside].id;
    }
    if (pageType === 'story') return posts[0].id;

    const viewportH = (win && win.innerHeight)
      || (doc.documentElement && doc.documentElement.clientHeight)
      || 0;
    if (viewportH) {
      const centre = viewportH / 2;
      let bestId = null;
      let bestDist = Infinity;
      for (let i = 0; i < articles.length; i++) {
        const r = rectOf(articles[i], win);
        if (!r) continue;
        const dist = Math.abs((r.top + r.bottom) / 2 - centre);
        if (dist < bestDist) { bestDist = dist; bestId = posts[i].id; }
      }
      if (bestId) return bestId;
    }
    // No layout (DOMParser / hidden tab): fall back to the URL, then the first post.
    const code = shortcodeFromUrl(url);
    if (code) {
      const match = posts.find((p) => p.id === code);
      if (match) return match.id;
    }
    return posts[0].id;
  } catch (e) {
    return posts.length ? posts[0].id : null;
  }
}

function dedupeIds(posts) {
  const seen = new Set();
  for (const p of posts) {
    let id = p.id;
    let n = 2;
    while (seen.has(id)) id = `${p.id}#${n++}`;
    p.id = id;
    seen.add(id);
  }
  return posts;
}


/** Instagram only renders a private account's posts to its followers, so a "Follow" button in the
 *  post header proves the owner is public (row 2 → green). Caches the result per username. */
function publicByFollowButton(article, post) {
  try {
    if (!article || post.isPrivate !== null) return;
    const btns = article.querySelectorAll('header button, header [role="button"]');
    for (const b of btns) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'follow' || t === 'follow back') {
        post.isPrivate = false;
        if (post.username) rememberPrivacy(post.username, false).catch(() => {});
        return;
      }
    }
  } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------ getPageContext */

/**
 * @param {{ doc?: Document, url?: string, win?: Window }} [overrides]
 *        optional and additive — test pages pass a DOMParser document.
 * @returns {Promise<import('../../shared/types.js').PageContext>} never throws
 */
export async function getPageContext(overrides) {
  const url = theUrl(overrides);
  try {
    const doc = theDoc(overrides);
    const win = theWin(overrides);
    if (!doc || !doc.querySelector) return emptyContext(url);

    await loadPrivacyCache();

    const pageType = detectPageType(doc, url);
    const ctx = { pageType, posts: [], focusedPostId: null, draftCaption: null, url };

    if (pageType === 'unknown') return emptyContext(url);                     // row 3

    if (pageType === 'composer') {
      ctx.draftCaption = readDraftCaption(doc);
      return ctx;
    }

    if (pageType === 'profile') {
      const username = profileUsername(doc, url);
      const isPrivate = detectProfilePrivacy(doc);                            // rows 1 / 2
      if (typeof isPrivate === 'boolean' && username) await rememberPrivacy(username, isPrivate);
      const owner = blankPost(`profile:${username || 'unknown'}`);
      owner.username = username;
      owner.isPrivate = typeof isPrivate === 'boolean' ? isPrivate : lookupPrivacy(username);
      ctx.posts = [owner];
      ctx.focusedPostId = owner.id;
      return ctx;
    }

    if (pageType === 'story') {
      const story = readStory(doc, url, 0);   // one story is on screen at a time -> :0
      story.isPrivate = lookupPrivacy(story.username);
      enrichFromCapture(story);
      if (story.isPrivate === true) stripPrivate(story);
      ctx.posts = [story];
      ctx.focusedPostId = story.id;
      return ctx;
    }

    // feed / post / reel — every rendered <article>
    const articles = Array.from(doc.querySelectorAll('article'));
    const posts = [];
    for (let i = 0; i < articles.length; i++) {
      const post = readArticle(articles[i], { url, index: i });
      post.isPrivate = lookupPrivacy(post.username);
      enrichFromCapture(post);
      publicByFollowButton(articles[i], post);
      // Home feed: Instagram only serves it to the logged-in user, so an owner whose privacy is still
      // unknown here is treated as public (row 2 stays for permalinks, reels and stories).
      if (pageType === 'feed' && post.isPrivate === null) post.isPrivate = false;
      if (post.isPrivate === true) stripPrivate(post);
      posts.push(post);
    }
    dedupeIds(posts);
    ctx.posts = posts;
    ctx.focusedPostId = pickFocusedId(posts, articles, doc, win, url, pageType);
    return ctx;
  } catch (e) {
    try { console.warn('[grammy/context] getPageContext failed', e); } catch (_) { /* noop */ }
    return emptyContext(url);
  }
}

/* ---------------------------------------------------------------- onNavigate */

const nav = { patched: false, timer: 0, last: '', subs: new Set(), mo: null };

function fireNav() {
  try {
    if (typeof clearTimeout === 'function') clearTimeout(nav.timer);
    nav.timer = setTimeout(() => {
      let now = '';
      try { now = location.href; } catch (e) { return; }
      if (now === nav.last) return;
      nav.last = now;
      for (const cb of Array.from(nav.subs)) {
        try { cb(now); } catch (e) { console.warn('[grammy/context] onNavigate cb', e); }
      }
    }, 300);
  } catch (e) { /* noop */ }
}

function ensurePatched() {
  if (nav.patched) return;
  nav.patched = true;
  try {
    nav.last = location.href;
    if (!window.__grammyNavPatched) {
      window.__grammyNavPatched = true;
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (...a) {
        const r = origPush.apply(this, a);
        try { window.dispatchEvent(new Event('grammy:navigate')); } catch (e) { /* noop */ }
        return r;
      };
      history.replaceState = function (...a) {
        const r = origReplace.apply(this, a);
        try { window.dispatchEvent(new Event('grammy:navigate')); } catch (e) { /* noop */ }
        return r;
      };
    }
    window.addEventListener('grammy:navigate', fireNav);
    window.addEventListener('popstate', fireNav);
    const titleEl = document.querySelector('title');
    if (titleEl && typeof MutationObserver !== 'undefined') {
      nav.mo = new MutationObserver(fireNav);
      nav.mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  } catch (e) {
    // navigation observation is best effort; getPageContext still works on demand
  }
}

/**
 * SPA navigation observer. Debounced ~300 ms. Idempotent patching.
 * @param {(url: string) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onNavigate(cb) {
  try {
    if (typeof cb !== 'function') return () => {};
    if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};
    nav.subs.add(cb);
    ensurePatched();
    return () => { try { nav.subs.delete(cb); } catch (e) { /* noop */ } };
  } catch (e) {
    return () => {};
  }
}

/* --------------------------------------------------------- pure derivations */

/**
 * @param {import('../../shared/types.js').PageContext} ctx
 * @returns {import('../../shared/types.js').Post|null}
 */
export function focusedPost(ctx) {
  try {
    if (!ctx || !Array.isArray(ctx.posts)) return null;
    return ctx.posts.find((p) => p && p.id === ctx.focusedPostId) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Failure rows 1–6 → the status pill. Pure; safe after every getPageContext().
 * @param {import('../../shared/types.js').PageContext} ctx
 * @returns {import('../../shared/types.js').StatusInfo}
 */
export function describeStatus(ctx) {
  try {
    if (!ctx || !ctx.pageType || ctx.pageType === 'unknown') return PILL.UNKNOWN_PAGE;   // row 3
    if (ctx.pageType === 'composer') return PILL.READY;

    if (ctx.pageType === 'profile') {
      const owner = focusedPost(ctx) || ctx.posts[0];
      if (owner && owner.isPrivate === true) return PILL.PRIVATE;                        // row 1
      return PILL.READY;
    }

    const post = focusedPost(ctx);
    if (!post) return ctx.pageType === 'feed' ? PILL.READY : PILL.NO_CAPTION;            // row 4
    if (post.isPrivate === true) return PILL.PRIVATE;                                    // row 1
    if (ctx.pageType === 'story' && post.caption == null && post.altText == null) {
      return PILL.STORY_NO_TEXT;                                                         // row 6
    }
    if (post.isPrivate === null) return PILL.UNCONFIRMED;                                // row 2
    if (post.caption == null) return PILL.NO_CAPTION;                                    // row 4
    if (!Array.isArray(post.comments) || post.comments.length === 0) return PILL.NO_COMMENTS; // row 5
    return PILL.PUBLIC_POST;
  } catch (e) {
    return PILL.UNKNOWN_PAGE;
  }
}
