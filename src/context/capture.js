// src/context/capture.js — SECONDARY source. Reads the passive capture index that
// early.js builds from the GraphQL / api/v1 JSON Instagram ALREADY fetched
// (ported from demos/fetch). This module never issues a request of its own and is
// only used to fill gaps the rendered DOM left: owner.is_private, video/media URL,
// caption on a selector miss. Lazily touches window so Node/test pages can import it.

const GLOBAL_KEY = '__grammyCapture';

/** @returns {{ byShortcode: Record<string, any> }|null} */
function store() {
  try {
    if (typeof window === 'undefined') return null;
    const s = window[GLOBAL_KEY];
    if (!s || typeof s !== 'object' || !s.byShortcode) return null;
    return s;
  } catch (e) {
    return null;
  }
}

/** How many posts the page-world capture has seen (debug / test page). */
export function captureSize() {
  try {
    const s = store();
    return s ? Object.keys(s.byShortcode).length : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * @param {string|null} shortcode
 * @returns {{ caption?: string, author?: string, isPrivate?: boolean|null,
 *             images?: string[], videos?: string[], thumbnails?: string[] }|null}
 */
export function capturedFor(shortcode) {
  try {
    if (!shortcode) return null;
    const s = store();
    if (!s) return null;
    return s.byShortcode[shortcode] || null;
  } catch (e) {
    return null;
  }
}

/** Privacy of a username as seen in captured JSON, or null. */
export function capturedPrivacy(username) {
  try {
    if (!username) return null;
    const s = store();
    if (!s) return null;
    const want = String(username).toLowerCase();
    for (const entry of Object.values(s.byShortcode)) {
      if (entry && typeof entry.isPrivate === 'boolean'
          && String(entry.author || '').toLowerCase() === want) {
        return entry.isPrivate;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Fill gaps in a Post from the capture index. Mutates and returns the post.
 * Only ever ADDS information the DOM did not have.
 * @param {import('../../shared/types.js').Post} post
 */
export function enrichFromCapture(post) {
  try {
    if (!post) return post;
    const entry = capturedFor(post.id);
    if (!entry) {
      if (post.isPrivate == null && post.username) {
        const p = capturedPrivacy(post.username);
        if (typeof p === 'boolean') post.isPrivate = p;
      }
      return post;
    }
    if (post.caption == null && entry.caption) post.caption = String(entry.caption);
    if (post.username == null && entry.author) post.username = String(entry.author);
    if (post.isPrivate == null && typeof entry.isPrivate === 'boolean') post.isPrivate = entry.isPrivate;
    if (!post.mediaUrl) {
      if (Array.isArray(entry.videos) && entry.videos.length) {
        post.mediaType = 'video';
        post.mediaUrl = entry.thumbnails && entry.thumbnails[0] ? entry.thumbnails[0] : entry.videos[0];
      } else if (Array.isArray(entry.images) && entry.images.length) {
        post.mediaType = post.mediaType || 'image';
        post.mediaUrl = entry.images[0];
      }
    }
    // All carousel slides come from the captured sidecar (the DOM only holds the visible ones).
    if (Array.isArray(entry.images) && entry.images.length > (post.mediaUrls || []).length) {
      post.mediaUrls = entry.images.slice();
    }
    return post;
  } catch (e) {
    return post;
  }
}
