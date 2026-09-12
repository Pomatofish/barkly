// src/context/index.js — STUB. Returns a realistic fake public post. The context subagent replaces
// this file with the real DOM reader (fixtures first, live instagram.com second).
// Interface: getPageContext(), describeStatus(), onNavigate() — see shared/types.js.
import { PILL, emptyContext } from '../../shared/types.js';

const FAKE_POST = Object.freeze({
  id: 'C9xY2kLpQrS',
  username: 'wanderlust.jules',
  caption:
    'Golden hour in Lisbon never gets old 🌇 Three days of tiled streets, pastel de nata and zero plans. ' +
    'Swipe for the view from Miradouro da Graça. #lisbon #goldenhour #travelgram #portugal',
  altText: 'Photo by wanderlust.jules: a woman in a yellow dress standing on a tiled overlook at sunset with orange rooftops behind her',
  likes: 4821,
  commentCount: 137,
  postedAt: '2026-09-09T17:42:00.000Z',
  comments: [
    'maria.travels: This light is unreal 😍',
    'tomek_photo: What lens is this? The colours are insane',
    'lisboa.local: Miradouro da Graça at sunset is the move, well done',
    'ellie.k: Adding this to my list immediately',
    'nomad_dan: The yellow dress against those rooftops 👌',
  ],
  isPrivate: false,
  mediaType: 'image',
  mediaUrl: 'https://scontent.cdninstagram.com/v/t51.2885-15/fake_lisbon_golden_hour.jpg',
});

/** @returns {Promise<import('../../shared/types.js').PageContext>} */
export async function getPageContext() {
  try {
    const url = typeof location !== 'undefined' ? location.href : 'https://www.instagram.com/p/C9xY2kLpQrS/';
    return {
      pageType: 'post',
      posts: [{ ...FAKE_POST, comments: [...FAKE_POST.comments] }],
      focusedPostId: FAKE_POST.id,
      draftCaption: null,
      url,
    };
  } catch (e) {
    console.warn('[context stub] getPageContext failed', e);
    return emptyContext(typeof location !== 'undefined' ? location.href : '');
  }
}

/**
 * Pure. Rows 1–6 of failure-modes.md.
 * @param {import('../../shared/types.js').PageContext} ctx
 * @returns {import('../../shared/types.js').StatusInfo}
 */
export function describeStatus(ctx) {
  try {
    const [lvl, msg] = (() => {
      if (!ctx || ctx.pageType === 'unknown') return PILL.UNKNOWN_PAGE;           // row 3
      const post = ctx.posts?.find((p) => p.id === ctx.focusedPostId) || ctx.posts?.[0];
      if (!post) return ctx.pageType === 'feed' || ctx.pageType === 'profile' ? PILL.OK : PILL.UNKNOWN_PAGE;
      if (post.isPrivate === true) return PILL.PRIVATE;                             // row 1
      if (post.isPrivate === null) return PILL.UNCONFIRMED;                         // row 2
      if (ctx.pageType === 'story' && !post.caption && !post.altText) return PILL.STORY_NO_TEXT; // row 6
      if (['post', 'reel', 'story'].includes(ctx.pageType) && !post.caption) return PILL.NO_CAPTION; // row 4
      if (['post', 'reel'].includes(ctx.pageType) && (!post.comments || post.comments.length === 0)) return PILL.NO_COMMENTS; // row 5
      return PILL.OK;
    })();
    return { level: lvl, message: msg };
  } catch (e) {
    return { level: 'yellow', message: PILL.UNKNOWN_PAGE[1] };
  }
}

/**
 * SPA navigation observer. STUB: never fires.
 * @param {(url: string) => void} _cb @returns {() => void} unsubscribe
 */
export function onNavigate(_cb) {
  return () => {};
}
