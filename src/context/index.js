// src/context/index.js — STUB (Phase 1). Returns a realistic fake public post.
// The context subagent replaces this with real DOM reading. Keep the exports.
import { PILL } from '../../shared/types.js';

const FAKE_POST = {
  id: 'C9xY2kLpQ7a',
  username: 'lena.explores',
  caption:
    'Golden hour on the cliffs of Moher — 6am, zero wind, and the sea was glass. Shot on 35mm, no filter. Would you wake up this early for a view? #ireland #goldenhour #35mm #travelphotography #cliffsofmoher',
  altText: 'Photo by lena.explores: a person in a yellow raincoat standing on green cliffs above a calm sea at sunrise.',
  likes: 12483,
  commentCount: 214,
  postedAt: '2026-09-10T06:42:00.000Z',
  comments: [
    'marco.b: this light is unreal 😍',
    'saraflynn: ok the raincoat against the green is such a good colour choice',
    'hikewithtom: what lens? the compression looks like a 50',
    'ava_shoots: I was there last week and it was FOG. jealous.',
    'nina.k: 6am?? respect. worth it though',
  ],
  isPrivate: false,
  mediaType: 'image',
  mediaUrl: 'https://scontent.cdninstagram.com/v/fake/cliffs_1080.jpg',
};

/** @returns {Promise<import('../../shared/types.js').PageContext>} */
export async function getPageContext() {
  try {
    const url = typeof location !== 'undefined' ? location.href : 'https://www.instagram.com/p/C9xY2kLpQ7a/';
    return {
      pageType: 'post',
      posts: [{ ...FAKE_POST, comments: [...FAKE_POST.comments] }],
      focusedPostId: FAKE_POST.id,
      draftCaption: null,
      url,
    };
  } catch (e) {
    return {
      pageType: 'unknown',
      posts: [],
      focusedPostId: null,
      draftCaption: null,
      url: typeof location !== 'undefined' ? location.href : '',
    };
  }
}

/**
 * Minimal SPA observer: patched pushState/replaceState + popstate + <title> mutations.
 * @param {(url: string) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onNavigate(cb) {
  let last = typeof location !== 'undefined' ? location.href : '';
  let timer = 0;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = location.href;
      if (now !== last) {
        last = now;
        try { cb(now); } catch (e) { console.warn('[grammy/context] onNavigate cb', e); }
      }
    }, 300);
  };
  try {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...a) { const r = origPush.apply(this, a); fire(); return r; };
    history.replaceState = function (...a) { const r = origReplace.apply(this, a); fire(); return r; };
    window.addEventListener('popstate', fire);
    const titleEl = document.querySelector('title');
    const mo = titleEl ? new MutationObserver(fire) : null;
    if (mo) mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', fire);
      if (mo) mo.disconnect();
    };
  } catch (e) {
    return () => {};
  }
}

/** @param {import('../../shared/types.js').PageContext} ctx */
export function focusedPost(ctx) {
  try {
    if (!ctx || !ctx.posts) return null;
    return ctx.posts.find((p) => p.id === ctx.focusedPostId) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Rows 1–6 → pill. Pure.
 * @param {import('../../shared/types.js').PageContext} ctx
 * @returns {import('../../shared/types.js').StatusInfo}
 */
export function describeStatus(ctx) {
  try {
    if (!ctx || ctx.pageType === 'unknown') return PILL.UNKNOWN_PAGE;            // row 3
    const post = focusedPost(ctx);
    if (ctx.pageType === 'profile') {
      const p = ctx.posts[0];
      if (p && p.isPrivate === true) return PILL.PRIVATE;                         // row 1
      return PILL.READY;
    }
    if (ctx.pageType === 'feed' && !post) return PILL.READY;
    if (!post) return ctx.pageType === 'feed' ? PILL.READY : PILL.NO_CAPTION;    // row 4
    if (post.isPrivate === true) return PILL.PRIVATE;                             // row 1
    if (ctx.pageType === 'story' && post.caption == null && post.altText == null) return PILL.STORY_NO_TEXT; // row 6
    if (post.isPrivate === null) return PILL.UNCONFIRMED;                         // row 2
    if (post.caption == null) return PILL.NO_CAPTION;                             // row 4
    if (!post.comments || post.comments.length === 0) return PILL.NO_COMMENTS;    // row 5
    return PILL.PUBLIC_POST;
  } catch (e) {
    return PILL.UNKNOWN_PAGE;
  }
}
