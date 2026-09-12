// src/context/pagetype.js — page-type detection. Pure: URL first, DOM landmarks second.
// No chrome.* and no DOM access at module top level (Node-importable).

/** First path segments that are never usernames. */
export const RESERVED_SEGMENTS = new Set([
  'p', 'reel', 'reels', 'stories', 'story', 'tv', 'explore', 'accounts', 'direct', 'create',
  'about', 'legal', 'developer', 'developers', 'api', 'graphql', 'ajax', 'oauth', 'session',
  'challenge', 'emails', 'privacy', 'terms', 'your_activity', 'settings', 'lite', 'web', 'push',
  'notifications', 'inbox', 'archive', 'qr', 'nametag', 'download', 'press', 'jobs', 'blog',
  'help', 'topics', 'locations', 'sms', 'invites', 'igtv', 'directory', 'business', 'ads',
  'accounts_center', 'fragment', 'static', 'data', 'favicon.ico', 'robots.txt',
]);

/** Instagram handles: letters, digits, dots and underscores, up to 30 chars. */
export const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Profile sub-tabs: /<username>/<tab>/ is still the profile page. */
const PROFILE_TABS = new Set(['tagged', 'reels', 'saved', 'channel', 'feed', 'guides']);

/** @param {string} url @returns {string[]} path segments, empty strings dropped */
export function pathSegments(url) {
  try {
    const path = typeof url === 'string' && url.includes('://')
      ? new URL(url).pathname
      : String(url || '').split('?')[0].split('#')[0];
    return path.split('/').filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Shortcode of a /p/<code>/ or /reel/<code>/ or /tv/<code>/ URL (or href).
 * @param {string} url @returns {string|null}
 */
export function shortcodeFromUrl(url) {
  try {
    const m = String(url || '').match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{4,})/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Username of a /<username>/ style URL or href. null for reserved paths.
 * @param {string} url @returns {string|null}
 */
export function usernameFromUrl(url) {
  try {
    const segs = pathSegments(url);
    if (!segs.length) return null;
    if (segs[0] === 'stories' && segs[1]) return segs[1];
    const first = segs[0].toLowerCase();
    if (RESERVED_SEGMENTS.has(first)) return null;
    if (!USERNAME_RE.test(segs[0])) return null;
    if (segs.length === 1) return segs[0];
    if (segs.length === 2 && PROFILE_TABS.has(segs[1].toLowerCase())) return segs[0];
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Page type from the URL alone.
 * @param {string} url
 * @returns {import('../../shared/types.js').PageType}
 */
export function pageTypeFromUrl(url) {
  try {
    const segs = pathSegments(url);
    if (!segs.length) return 'feed';                         // "/" or "/?variant=..."
    const first = segs[0].toLowerCase();
    if (first === 'p') return 'post';
    if (first === 'reel' || first === 'reels') return 'reel';
    if (first === 'tv') return 'post';
    if (first === 'stories') return 'story';
    if (first === 'create') return 'composer';
    if (first === 'direct' || first === 'explore' || first === 'accounts') return 'unknown';
    if (RESERVED_SEGMENTS.has(first)) return 'unknown';
    if (!USERNAME_RE.test(segs[0])) return 'unknown';
    if (segs.length === 1) return 'profile';
    if (segs.length === 2 && PROFILE_TABS.has(segs[1].toLowerCase())) return 'profile';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/** The open modal dialog that contains a post, if any. @returns {Element|null} */
export function openModalArticle(doc) {
  try {
    if (!doc || !doc.querySelectorAll) return null;
    const dialogs = doc.querySelectorAll('div[role="dialog"], [role="dialog"]');
    for (const d of dialogs) {
      if (d.getAttribute && d.getAttribute('aria-hidden') === 'true') continue;
      const art = d.querySelector && d.querySelector('article');
      if (art) return art;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** True when an open dialog is the "Create new post" composer. */
export function isComposerDoc(doc) {
  try {
    if (!doc || !doc.querySelector) return false;
    if (doc.querySelector('textarea[aria-label*="caption" i], textarea[placeholder*="caption" i]')) return true;
    const dialogs = doc.querySelectorAll('[role="dialog"]');
    for (const d of dialogs) {
      const label = (d.getAttribute && d.getAttribute('aria-label')) || '';
      if (/create new (post|reel)/i.test(label)) return true;
      const heading = d.querySelector && d.querySelector('h1, h2, [role="heading"]');
      if (heading && /create new (post|reel)/i.test(heading.textContent || '')) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/** True when the document shows a "This account is private" profile header. */
export function isPrivateProfileDoc(doc) {
  try {
    if (!doc || !doc.querySelector) return false;
    const main = doc.querySelector('main[role="main"], main') || doc.body;
    if (!main) return false;
    const text = main.textContent || '';
    if (/this account is private/i.test(text)) return true;
    const lock = doc.querySelector('svg[aria-label="Private"], svg[aria-label*="private" i]');
    return !!lock;
  } catch (e) {
    return false;
  }
}

/** True when the document is rendering a story surface. */
export function isStoryDoc(doc) {
  try {
    if (!doc || !doc.querySelector) return false;
    if (doc.querySelector('[aria-label="Pause"], [aria-label="Play"]')
        && doc.querySelector('[aria-label*="reply" i]')) return true;
    return !!doc.querySelector('section [role="menu"] [aria-label="Story"]');
  } catch (e) {
    return false;
  }
}

/**
 * Page type from URL, confirmed / overridden by DOM landmarks.
 * @param {Document|null} doc
 * @param {string} url
 * @returns {import('../../shared/types.js').PageType}
 */
export function detectPageType(doc, url) {
  try {
    const fromUrl = pageTypeFromUrl(url);
    if (!doc || !doc.querySelector) return fromUrl;

    // 1. composer dialog beats everything (it sits on top of feed/profile)
    if (isComposerDoc(doc)) return 'composer';

    // 2. an open post modal on any page => post (or reel when the media is a video)
    const modal = openModalArticle(doc);
    if (modal) {
      if (modal.querySelector('video')) return 'reel';
      return 'post';
    }

    // 3. story surface
    if (fromUrl === 'story' || isStoryDoc(doc)) return 'story';

    // 4. private profile header confirms a profile page
    if (isPrivateProfileDoc(doc)) return 'profile';

    if (fromUrl !== 'unknown') return fromUrl;

    // 5. unknown URL but the feed is clearly rendered
    const articles = doc.querySelectorAll('article');
    if (articles && articles.length >= 2) return 'feed';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}
