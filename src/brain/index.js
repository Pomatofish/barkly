// src/brain/index.js — Grammy's brain.
// askAssistant() / styleAdvice() build the prompt, call bg through request(), parse the
// reply, apply memory updates and hand the overlay ONE reply string.
// No chrome.* and no DOM access at module top level (so this imports in Node).
//
// Failure rows owned here: 10 (malformed JSON), 14 (style advice with nothing to describe),
// 16 (corrupt/full memory notice), 17 (pinned cap) + the canned replies for rows 9 and 13.
import { MSG, LIMITS, ERR, request } from '../../shared/types.js';
import {
  getMemory, saveMemory, pin, appendHistory,
  isValidMemory, takeNotice, clearNotice, queueNotice, clampWords,
} from './memory.js';
import { buildAskRequest, buildStyleRequest, focusedPostOf, hashtagsOf } from './build.js';
import { parseModelReply, clampReply, clampWordCount } from './parse.js';

export { getMemory, saveMemory, pin, unpin, forgetAll } from './memory.js';
export { getChips } from './chips.js';
export { buildAskRequest, buildStyleRequest, buildContextBlock, buildMemoryBlock, focusedPostOf } from './build.js';
export { parseModelReply, clampReply } from './parse.js';
export { buildSystemPrompt, buildStyleSystemPrompt } from './prompts.js';

/* ------------------------------------------------------------ canned text */

/** Row 13: no key / bad key. */
export const CANNED_NO_KEY =
  'Add your API key in settings to start chatting — open the 🐶 menu and tap the gear.';

/** Row 9: timeout / HTTP error / bus unreachable — the menu of what still works. */
export const CANNED_UNAVAILABLE =
  'The assistant is unavailable right now. While you wait you can: read the caption yourself, '
  + 'tap a chip to retry, or type a question and try again in a minute.';

export const AUTO_PIN_CLAUSE = " (I'll remember this one)";

const KEY_CODES = [ERR.NO_KEY, ERR.BAD_KEY];

function cannedFor(error) {
  const code = (error && error.code) || '';
  return KEY_CODES.indexOf(code) >= 0 ? CANNED_NO_KEY : CANNED_UNAVAILABLE;
}

/* --------------------------------------------------------- session memory */

/** postId -> how many user messages this session. Module-level, cleared on reload. */
const sessionPostCounts = new Map();
/** postIds already auto-pinned this session (so the clause is appended exactly once). */
const sessionAutoPinned = new Set();

/** Test helper: forget the per-session counters and any queued notice. */
export function _resetSession() {
  sessionPostCounts.clear();
  sessionAutoPinned.clear();
  clearNotice();
}

const REFERS_BACK = [
  /\b(like|same as|similar to)\s+(the|that)\s+(one|post|reel|story|photo)\b/i,
  /\bthe one (earlier|before|from before|previous|you saw)\b/i,
  /\b(that|the) (post|reel|one) (earlier|before|from before|from earlier)\b/i,
];

function refersToEarlierPost(text) {
  const s = String(text || '');
  return REFERS_BACK.some((re) => re.test(s));
}

/* ------------------------------------------------------------- small bits */

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.role !== 'assistant' && typeof m.text === 'string' && m.text.trim()) return m.text.trim();
  }
  return '';
}

/** A post_style summary written from the context (no model call needed). */
function autoPinContent(post) {
  const bits = [];
  bits.push(`@${post.username || 'unknown'}`);
  bits.push(`${post.mediaType || 'post'}`);
  const cap = String(post.caption || '').replace(/\s+/g, ' ').trim();
  if (cap) bits.push(`caption opens "${cap.slice(0, 80)}"`);
  else if (post.altText) bits.push(`shows ${String(post.altText).replace(/\s+/g, ' ').slice(0, 80)}`);
  const tags = hashtagsOf(post.caption);
  if (tags.length) bits.push(`${tags.length} hashtags (${tags.slice(0, 5).join(' ')})`);
  const nums = [];
  if (post.likes !== null && post.likes !== undefined) nums.push(`${post.likes} likes`);
  if (post.commentCount !== null && post.commentCount !== undefined) nums.push(`${post.commentCount} comments`);
  if (nums.length) bits.push(nums.join(', '));
  return clampWords(`Style of ${bits.join('; ')}.`, LIMITS.PIN_CONTENT_MAX_WORDS);
}

function sourceFor(post, ctx, given) {
  const source = {};
  const g = given || {};
  const username = g.username || (post && post.username) || '';
  const postId = g.postId || (post && post.id) || '';
  const url = g.url || (ctx && ctx.url) || '';
  if (username) source.username = String(username).replace(/^@/, '');
  if (postId) source.postId = String(postId);
  if (url) source.url = String(url);
  return source;
}

const EMPTY_CTX = { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: '' };

/* -------------------------------------------------------------- askAssistant */

/**
 * @param {import('../../shared/types.js').AskInput} input
 * @returns {Promise<import('../../shared/types.js').AskResult>}
 */
export async function askAssistant(input) {
  const i = input || {};
  const ctx = i.pageContext || EMPTY_CTX;
  const inputMode = i.inputMode === 'voice' ? 'voice' : 'text';
  const pageType = ctx.pageType || 'unknown';
  const userText = lastUserText(i.messages);
  let memoryUpdate = null;

  try {
    const memory = isValidMemory(i.memory) ? i.memory : await getMemory();
    const persona = i.persona === 'influencer' || i.persona === 'casual'
      ? i.persona
      : ((memory.profile && memory.profile.persona) || 'casual');
    const post = focusedPostOf(ctx);

    // High-interest counter: this user turn is about the focused post.
    if (post && post.id && userText) {
      sessionPostCounts.set(post.id, (sessionPostCounts.get(post.id) || 0) + 1);
    }

    const askRequest = await buildAskRequest({
      messages: i.messages, pageContext: ctx, memory, persona, inputMode, attachedImage: i.attachedImage || null,
    });

    const res = await request(MSG.ASK, askRequest);

    let reply;
    let highlightTarget = null;
    let succeeded = false;
    if (!res || res.ok !== true) {
      reply = cannedFor(res && res.error);
      try { const er = res && res.error; if (er && er.code) queueNotice(`${er.code}: ${String(er.message || '').slice(0, 160)}`); } catch (e) { /* ignore */ }
    } else {
      const text = (res.data && (res.data.text || res.data.reply)) || '';
      const parsed = parseModelReply(text);           // row 10 handled inside
      reply = parsed.reply;
      highlightTarget = parsed.highlightTarget;
      memoryUpdate = parsed.memoryUpdate;
      succeeded = true;
      if (!reply || !reply.trim()) {
        reply = CANNED_UNAVAILABLE;
        succeeded = false;
        highlightTarget = null;
        memoryUpdate = null;
      }
    }

    reply = clampReply(reply, inputMode);

    // --- apply the model's memory update (explicit pin scores EXPLICIT_PIN_SCORE) ---
    if (succeeded && memoryUpdate && memoryUpdate.pin) {
      const p = memoryUpdate.pin;
      const source = sourceFor(post, ctx, p.source);
      memoryUpdate.pin = { kind: p.kind, content: clampWords(p.content, LIMITS.PIN_CONTENT_MAX_WORDS), source };
      await pin({ ...memoryUpdate.pin, score: LIMITS.EXPLICIT_PIN_SCORE });
    }
    if (succeeded && memoryUpdate && memoryUpdate.profile) {
      await saveMemory({ profile: memoryUpdate.profile });
    }

    // --- high-interest auto-pin (row: memory section) ---
    if (succeeded && post && post.id && post.isPrivate !== true && !sessionAutoPinned.has(post.id)) {
      const count = sessionPostCounts.get(post.id) || 0;
      const hot = count >= LIMITS.AUTO_PIN_MESSAGES || refersToEarlierPost(userText);
      const alreadyPinnedHere = memoryUpdate && memoryUpdate.pin
        && memoryUpdate.pin.source && memoryUpdate.pin.source.postId === post.id;
      if (hot && !alreadyPinnedHere) {
        const stored = await getMemory();
        const exists = stored.pinned.some((x) => x.source && x.source.postId === post.id);
        if (!exists) {
          const autoPin = {
            kind: 'post_style',
            content: autoPinContent(post),
            source: sourceFor(post, ctx, null),
          };
          await pin({ ...autoPin, score: LIMITS.AUTO_PIN_SCORE });
          sessionAutoPinned.add(post.id);
          if (reply.indexOf(AUTO_PIN_CLAUSE.trim()) < 0) reply = `${reply}${AUTO_PIN_CLAUSE}`;
          memoryUpdate = { ...(memoryUpdate || {}), pin: autoPin };
        } else {
          sessionAutoPinned.add(post.id);
        }
      }
    }

    // --- history (both turns) ---
    const ts = Date.now();
    const turns = [];
    if (userText) turns.push({ role: 'user', text: userText, inputMode, pageType, postId: post ? post.id : undefined, ts });
    turns.push({ role: 'assistant', text: reply, inputMode, pageType, postId: post ? post.id : undefined, ts: ts + 1 });
    await appendHistory(turns);

    return { reply, highlightTarget, memoryUpdate, notice: takeNotice() };
  } catch (e) {
    // Never throw at the caller: the overlay always gets a usable reply string.
    try { console.warn('[grammy/brain] askAssistant', e && e.message); } catch (e2) { /* no console */ }
    return {
      reply: clampReply(CANNED_UNAVAILABLE, inputMode),
      highlightTarget: null,
      memoryUpdate: null,
      notice: takeNotice(),
    };
  }
}

/* --------------------------------------------------------------- styleAdvice */

const STYLE_NEEDS_INPUT = 'Open a post or attach a photo of yours first.';

/**
 * Text-only style advice. The attached photo is vision INPUT; nothing is ever generated.
 * @param {import('../../shared/types.js').StyleAdviceInput} input
 * @returns {Promise<import('../../shared/types.js').StyleAdviceResult>}
 */
export async function styleAdvice(input) {
  const i = input || {};
  try {
    const ctx = i.pageContext || EMPTY_CTX;
    const post = focusedPostOf(ctx);
    const usablePost = !!post && post.isPrivate !== true;

    // Row 14: nothing to describe.
    if (!usablePost && !i.attachedImage) {
      return { reply: STYLE_NEEDS_INPUT, needsInput: true };
    }

    const memory = isValidMemory(i.memory) ? i.memory : await getMemory();
    const styleRequest = await buildStyleRequest({ pageContext: ctx, attachedImage: i.attachedImage || null, memory });
    const res = await request(MSG.STYLE_ADVICE, styleRequest);

    if (!res || res.ok !== true) return { reply: cannedFor(res && res.error) };

    const text = String((res.data && (res.data.text || res.data.reply)) || '').trim();
    if (!text) return { reply: CANNED_UNAVAILABLE };
    // The model is told to answer in plain text; if it wrapped it in JSON anyway, unwrap.
    const parsed = parseModelReply(text);
    return { reply: clampWordCount(parsed.parsed ? parsed.reply : text, 160) };
  } catch (e) {
    try { console.warn('[grammy/brain] styleAdvice', e && e.message); } catch (e2) { /* no console */ }
    return { reply: CANNED_UNAVAILABLE };
  }
}
