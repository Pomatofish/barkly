// src/context/readers.js — DOM readers. Rendered DOM only: never fetches, never clicks,
// never expands "View all comments". Semantic selectors first (article, [role], aria-label,
// img[alt], time[datetime], video); obfuscated class names are deliberately not used.
import { usernameFromUrl, shortcodeFromUrl, pathSegments } from './pagetype.js';

/** Max comments kept per post so a prompt cannot blow up. */
export const MAX_COMMENTS = 40;

/** @param {Element|null} el */
export function textOf(el) {
  try {
    if (!el) return '';
    return String(el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  } catch (e) {
    return '';
  }
}

/** "12,483" -> 12483 ; "41.2K" -> 41200 ; "1.2M" -> 1200000 ; no digits -> null */
export function parseCount(str) {
  try {
    const s = String(str || '').replace(/ /g, ' ').trim();
    if (!s) return null;
    const m = s.match(/(\d[\d.,\s]*)\s*([KkMmBb])?/);
    if (!m) return null;
    const digits = m[1].replace(/[\s,]/g, '');
    let n = parseFloat(digits);
    if (!isFinite(n)) return null;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') n *= 1e3;
    else if (suffix === 'm') n *= 1e6;
    else if (suffix === 'b') n *= 1e9;
    return Math.round(n);
  } catch (e) {
    return null;
  }
}

/** djb2 — stable id for posts with no shortcode in the DOM. */
export function stableHash(str) {
  try {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  } catch (e) {
    return '0';
  }
}

function attr(el, name) {
  try { return (el && el.getAttribute && el.getAttribute(name)) || ''; } catch (e) { return ''; }
}

/** Username of a profile anchor, or null. */
export function usernameFromAnchor(a) {
  try {
    const href = attr(a, 'href');
    if (!href || href.startsWith('http') === false && href.startsWith('/') === false) return null;
    return usernameFromUrl(href);
  } catch (e) {
    return null;
  }
}

/** Shortcode from any anchor inside the article. */
export function shortcodeFromArticle(article) {
  try {
    if (!article || !article.querySelectorAll) return null;
    const links = article.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    for (const a of links) {
      const code = shortcodeFromUrl(attr(a, 'href'));
      if (code) return code;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Owner handle of an article. */
export function ownerOf(article, fallbackUsername) {
  try {
    if (!article || !article.querySelector) return fallbackUsername || null;
    const header = article.querySelector('header') || article;
    const anchors = header.querySelectorAll('a[href^="/"]');
    for (const a of anchors) {
      const name = usernameFromAnchor(a);
      if (!name) continue;
      const label = textOf(a);
      if (label && label.toLowerCase() === name.toLowerCase()) return name;
    }
    for (const a of anchors) {
      const name = usernameFromAnchor(a);
      if (name) return name;
    }
    // last resort: "Photo by <name> on ..." alt text, then the page URL
    const img = article.querySelector('img[alt]');
    const m = attr(img, 'alt').match(/^Photo by ([A-Za-z0-9._]+)/i);
    if (m) return m[1];
    return fallbackUsername || null;
  } catch (e) {
    return fallbackUsername || null;
  }
}

/**
 * Comment-shaped rows inside an article: an author link plus a [dir="auto"] body.
 * Innermost rows only (a reply list nested in a comment must not double count).
 * @returns {{ username: string, text: string, el: Element }[]}
 */
export function commentRows(article) {
  try {
    if (!article || !article.querySelectorAll) return [];
    const lis = Array.from(article.querySelectorAll('li'));
    const rows = [];
    for (const li of lis) {
      const a = li.querySelector('a[href^="/"]');
      const name = usernameFromAnchor(a);
      if (!name) continue;
      const body = Array.from(li.querySelectorAll('[dir="auto"]')).find((el) => textOf(el));
      if (!body) continue;
      rows.push({ username: name, text: textOf(body), el: li, body });
    }
    // drop outer rows that contain another qualifying row
    return rows.filter((r) => !rows.some((o) => o !== r && r.el.contains && r.el.contains(o.el)));
  } catch (e) {
    return [];
  }
}

/**
 * Caption = the owner's own text row (h1[dir="auto"] on permalinks, first li on feed).
 * @returns {{ text: string|null, el: Element|null }}
 */
export function captionOf(article, owner) {
  try {
    if (!article || !article.querySelector) return { text: null, el: null };
    const rows = commentRows(article);
    const own = owner ? String(owner).toLowerCase() : null;

    // 1. an h1[dir="auto"] is always the caption on a permalink
    const h1 = Array.from(article.querySelectorAll('h1[dir="auto"], h1')).find((el) => textOf(el));
    if (h1) {
      const row = rows.find((r) => r.el.contains && r.el.contains(h1));
      return { text: textOf(h1), el: row ? row.el : h1 };
    }
    // 2. otherwise the first row written by the owner
    if (own) {
      const row = rows.find((r) => r.username.toLowerCase() === own);
      if (row) return { text: row.text, el: row.el };
    }
    return { text: null, el: null };                                        // row 4: selector miss
  } catch (e) {
    return { text: null, el: null };
  }
}

/** Already-loaded comments as "username: text". Never loads more (row 5 when empty). */
export function commentsOf(article, owner, captionEl) {
  try {
    const rows = commentRows(article);
    const out = [];
    for (const r of rows) {
      if (captionEl && (r.el === captionEl || (captionEl.contains && captionEl.contains(r.el)))) continue;
      if (!r.text) continue;
      if (/^view (all )?replies/i.test(r.text) || /^hide replies/i.test(r.text)) continue;
      out.push(`${r.username}: ${r.text}`);
      if (out.length >= MAX_COMMENTS) break;
    }
    return out;
  } catch (e) {
    return [];
  }
}

/** Like count, or null. Handles "12,483 likes", "41.2K", "Liked by x and 3,204 others". */
export function likesOf(article) {
  try {
    if (!article || !article.querySelector) return null;
    const link = article.querySelector('a[href$="/liked_by/"], a[href*="/liked_by/"]');
    if (link) {
      const direct = parseCount(textOf(link));
      if (direct != null) return direct;
      const parentText = textOf(link.parentElement);
      const viaParent = parseCount(parentText);
      if (viaParent != null) return viaParent;
    }
    const sections = Array.from(article.querySelectorAll('section'));
    for (const s of sections) {
      if (s.querySelector && s.querySelector('li')) continue;      // comment list, not the like bar
      const t = textOf(s);
      if (/be the first to like this/i.test(t)) return 0;
      const m = t.match(/([\d][\d.,]*\s*[KkMm]?)\s*likes/i) || t.match(/and\s+([\d][\d.,]*\s*[KkMm]?)\s+others/i);
      if (m) return parseCount(m[1]);
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Total comment count from "View all 214 comments", or null. */
export function commentCountOf(article) {
  try {
    if (!article || !article.querySelectorAll) return null;
    const links = Array.from(article.querySelectorAll('a[href*="/comments/"]'));
    for (const a of links) {
      const t = textOf(a);
      const m = t.match(/([\d][\d.,]*\s*[KkMm]?)\s*comments?/i);
      if (m) return parseCount(m[1]);
    }
    const t = textOf(article);
    const m = t.match(/view all ([\d][\d.,]*\s*[KkMm]?)\s*comments/i);
    if (m) return parseCount(m[1]);
    return null;
  } catch (e) {
    return null;
  }
}

/** ISO timestamp from the first <time datetime>, or null. */
export function postedAtOf(article) {
  try {
    const t = article && article.querySelector && article.querySelector('time[datetime]');
    const raw = attr(t, 'datetime');
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toISOString();
  } catch (e) {
    return null;
  }
}

function isAvatar(img) {
  try {
    const alt = attr(img, 'alt');
    const src = attr(img, 'src');
    if (/profile picture/i.test(alt)) return true;
    if (/t51\.2885-19/.test(src)) return true;
    let el = img.parentElement;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      if (el.tagName === 'HEADER') return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/** Largest candidate of a srcset, else src. */
export function bestImageUrl(img) {
  try {
    const srcset = attr(img, 'srcset');
    if (srcset) {
      let bestUrl = null;
      let bestW = -1;
      for (const part of srcset.split(',')) {
        const bits = part.trim().split(/\s+/);
        if (!bits[0]) continue;
        const w = parseInt((bits[1] || '').replace(/[^\d]/g, ''), 10);
        const width = isFinite(w) ? w : 0;
        if (width >= bestW) { bestW = width; bestUrl = bits[0]; }
      }
      if (bestUrl) return bestUrl;
    }
    const src = attr(img, 'src');
    return src || null;
  } catch (e) {
    return null;
  }
}

/** The main media of an article (never fetched — row 11 just leaves mediaUrl null). */
export function mediaOf(root) {
  try {
    if (!root || !root.querySelector) return { mediaType: null, mediaUrl: null, altText: null };
    const video = root.querySelector('video');
    if (video) {
      const poster = attr(video, 'poster');
      const src = attr(video, 'src');
      const url = poster || src || null;
      const img = Array.from(root.querySelectorAll('img[alt]')).find((i) => !isAvatar(i));
      const alt = img ? textFromAlt(img) : null;
      return { mediaType: 'video', mediaUrl: url || null, altText: alt };
    }
    const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !isAvatar(i));
    if (!imgs.length) return { mediaType: null, mediaUrl: null, altText: null };
    const main = imgs.find((i) => attr(i, 'srcset')) || imgs[0];
    return { mediaType: 'image', mediaUrl: bestImageUrl(main), altText: textFromAlt(main) };
  } catch (e) {
    return { mediaType: null, mediaUrl: null, altText: null };
  }
}

function textFromAlt(img) {
  const alt = attr(img, 'alt').replace(/\s+/g, ' ').trim();
  return alt ? alt : null;
}

/** A Post with everything nulled out — the shape is always complete. */
export function blankPost(id) {
  return {
    id: id || 'unknown',
    username: null,
    caption: null,
    altText: null,
    likes: null,
    commentCount: null,
    postedAt: null,
    comments: [],
    isPrivate: null,
    mediaType: null,
    mediaUrl: null,
  };
}

/**
 * Read one <article> into a Post.
 * @param {Element} article
 * @param {{ url?: string, index?: number }} [opts]
 * @returns {import('../../shared/types.js').Post}
 */
export function readArticle(article, opts = {}) {
  const url = opts.url || '';
  try {
    const owner = ownerOf(article, usernameFromUrl(url));
    const caption = captionOf(article, owner);
    const media = mediaOf(article);
    const code = shortcodeFromArticle(article) || shortcodeFromUrl(url);
    const id = code || `ig_${stableHash(`${owner || ''}|${caption.text || ''}|${opts.index || 0}`)}`;
    return {
      id,
      username: owner || null,
      caption: caption.text || null,
      altText: media.altText,
      likes: likesOf(article),
      commentCount: commentCountOf(article),
      postedAt: postedAtOf(article),
      comments: commentsOf(article, owner, caption.el),
      isPrivate: null,
      mediaType: media.mediaType,
      mediaUrl: media.mediaUrl,
    };
  } catch (e) {
    const fallback = blankPost(shortcodeFromUrl(url) || `ig_${stableHash(url + String(opts.index || 0))}`);
    fallback.username = usernameFromUrl(url);
    return fallback;
  }
}

/**
 * Read the story currently on screen (row 6 when it has no readable text).
 * @param {Document} doc @param {string} url @returns {import('../../shared/types.js').Post}
 */
export function readStory(doc, url, index = 0) {
  const segs = pathSegments(url);
  const username = (segs[0] === 'stories' && segs[1]) ? segs[1] : (usernameFromUrl(url) || null);
  const post = blankPost(`story:${username || 'unknown'}:${index}`);
  try {
    post.username = username;
    const root = doc.querySelector('section') || doc.body || doc;
    const media = mediaOf(root);
    post.mediaType = media.mediaType;
    post.mediaUrl = media.mediaUrl;
    post.altText = media.altText;
    post.postedAt = postedAtOf(root);

    // Text overlay / sticker text, if the story has any.
    const texts = Array.from(root.querySelectorAll('[dir="auto"]'))
      .map((el) => textOf(el))
      .filter((t) => t && t.toLowerCase() !== String(username || '').toLowerCase());
    post.caption = texts.length ? texts.join(' ') : null;
    return post;
  } catch (e) {
    return post;
  }
}

/**
 * Composer draft caption (stretch — only read when it is trivially available).
 * @param {Document} doc @returns {string|null}
 */
export function readDraftCaption(doc) {
  try {
    if (!doc || !doc.querySelector) return null;
    const ta = doc.querySelector('textarea[aria-label*="caption" i], textarea[placeholder*="caption" i]');
    if (ta) {
      const v = (ta.value != null && ta.value !== '') ? ta.value : textOf(ta);
      return v ? String(v).trim() : null;
    }
    const box = doc.querySelector('[contenteditable="true"][aria-label*="caption" i]');
    const t = textOf(box);
    return t || null;
  } catch (e) {
    return null;
  }
}
