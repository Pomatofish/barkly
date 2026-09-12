// src/brain/build.js — turns an AskInput into the model-agnostic AskRequest that bg sends.
// Pure except for one side effect: pinned items that actually go into the prompt get
// score += 1 / lastUsedAt = now, persisted through memory.js.
import { LIMITS, MSG } from '../../shared/types.js';
import { bumpPinned } from './memory.js';
import { buildSystemPrompt, buildStyleSystemPrompt } from './prompts.js';

const MAX_PROMPT_COMMENTS = 30;

/** Up to 4 distinct image URLs for a post: every carousel slide when known, else the main media. */
export function imageUrlsOf(post) {
  const list = Array.isArray(post.mediaUrls) && post.mediaUrls.length ? post.mediaUrls : [post.mediaUrl];
  const out = [];
  for (const u of list) { if (u && out.indexOf(u) < 0) out.push(u); if (out.length >= 4) break; }
  if (!out.length && post.mediaUrl) out.push(post.mediaUrl);
  return out;
}

/* ---------------------------------------------------------------- helpers */

/** posts.find(p => p.id === focusedPostId) — local copy so brain never imports src/context. */
export function focusedPostOf(ctx) {
  try {
    const posts = (ctx && Array.isArray(ctx.posts)) ? ctx.posts : [];
    if (!posts.length) return null;
    const id = ctx && ctx.focusedPostId;
    if (!id) return null;
    return posts.find((p) => p && p.id === id) || null;
  } catch (e) {
    return null;
  }
}

function val(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback === undefined ? 'unknown' : fallback;
  return v;
}

/** "3 days ago" from an ISO string, for the influencer's "post age" number. */
export function ageOf(iso) {
  try {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return `${mins} minutes old`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} hours old`;
    return `${Math.round(hours / 24)} days old`;
  } catch (e) {
    return null;
  }
}

/** Hashtags in a caption, in order, deduped. */
export function hashtagsOf(caption) {
  try {
    const m = String(caption || '').match(/#[\p{L}\p{N}_]+/gu);
    if (!m) return [];
    const seen = [];
    for (const h of m) if (seen.indexOf(h) < 0) seen.push(h);
    return seen;
  } catch (e) {
    return [];
  }
}

/* ----------------------------------------------------------- context block */

function focusedPostLines(post) {
  const lines = [];
  lines.push('FOCUSED POST (this is what the user is looking at)');
  lines.push(`id: ${val(post.id)}`);
  lines.push(`username: ${post.username ? '@' + post.username : 'unknown'}`);
  lines.push(`isPrivate: ${post.isPrivate === true ? 'true' : post.isPrivate === false ? 'false' : 'null'}`);

  if (post.isPrivate === true) {
    // Row 1: nothing from a private account ever reaches the model.
    lines.push('This owner is PRIVATE. Caption, comments, alt text and media are NOT available and');
    lines.push('must never be guessed. Refuse content questions about this post in one friendly');
    lines.push('sentence and still answer anything general.');
    return lines;
  }

  lines.push(`likes: ${post.likes === null || post.likes === undefined ? 'unknown' : post.likes}`);
  lines.push(`commentCount: ${post.commentCount === null || post.commentCount === undefined ? 'unknown' : post.commentCount}`);
  lines.push(`postedAt: ${val(post.postedAt, 'unknown')}${ageOf(post.postedAt) ? ` (${ageOf(post.postedAt)})` : ''}`);
  lines.push(`mediaType: ${val(post.mediaType, 'unknown')}`);

  const tags = hashtagsOf(post.caption);
  lines.push(`hashtagCount: ${tags.length}${tags.length ? ` (${tags.slice(0, 15).join(' ')})` : ''}`);

  if (post.isPrivate === null || post.isPrivate === undefined) {
    // Row 2: caption only, no comments, no media.
    lines.push('PRIVACY UNCONFIRMED for this owner: use the caption only, ignore comments and media.');
    lines.push('Only mention this if the user asks about comments or privacy.');
    lines.push(`caption: ${post.caption ? `"""${post.caption}"""` : 'null (could not be read)'}`);
    return lines;
  }

  lines.push(`altText: ${post.altText ? `"""${post.altText}"""` : 'null'}`);
  lines.push(`caption: ${post.caption ? `"""${post.caption}"""` : 'null (unreadable; only ask the user to paste it if you have nothing else to go on)'}`);

  const comments = Array.isArray(post.comments) ? post.comments.slice(0, MAX_PROMPT_COMMENTS) : [];
  if (!comments.length) {
    // Row 5.
    lines.push('comments: none loaded (do not mention this unless asked about the comments).');
  } else {
    lines.push(`comments (${comments.length} loaded of ${val(post.commentCount, 'unknown')}; never auto-loaded):`);
    for (const c of comments) lines.push(`- ${String(c)}`);
  }
  return lines;
}

function otherPostLine(p) {
  if (p.isPrivate === true) return `- ${p.username ? '@' + p.username : 'unknown'} (private — not read)`;
  const cap = String(p.caption || '').replace(/\s+/g, ' ').slice(0, 90);
  const bits = [];
  if (p.likes !== null && p.likes !== undefined) bits.push(`${p.likes} likes`);
  if (p.commentCount !== null && p.commentCount !== undefined) bits.push(`${p.commentCount} comments`);
  return `- ${p.username ? '@' + p.username : 'unknown'}: ${cap || '(no caption read)'}${bits.length ? ` [${bits.join(', ')}]` : ''}`;
}

/**
 * The PAGE CONTEXT text block.
 * @param {object} ctx PageContext
 * @returns {string}
 */
export function buildContextBlock(ctx) {
  const c = ctx || {};
  const lines = [];
  lines.push('PAGE CONTEXT (read-only snapshot of the user\'s screen)');
  lines.push(`pageType: ${val(c.pageType, 'unknown')}`);
  lines.push(`url: ${val(c.url, 'unknown')}`);

  const post = focusedPostOf(c);
  if (post) {
    lines.push('');
    lines.push(...focusedPostLines(post));
  } else if (c.pageType === 'unknown') {
    lines.push('');
    lines.push('No page could be identified (row 3). Work from the user\'s own words only and say so.');
  } else {
    lines.push('');
    lines.push('No post is in focus right now. Answer from the user\'s words and the posts listed below.');
  }

  if (c.draftCaption) {
    lines.push('');
    lines.push(`DRAFT CAPTION the user is writing: """${c.draftCaption}"""`);
  }

  const others = (Array.isArray(c.posts) ? c.posts : [])
    .filter((p) => p && (!post || p.id !== post.id))
    .slice(0, LIMITS.PROMPT_OTHER_POSTS);
  if (others.length) {
    lines.push('');
    lines.push(`OTHER POSTS ON SCREEN (${others.length}, one line each)`);
    for (const p of others) lines.push(otherPostLine(p));
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------ memory block */

/**
 * Choose which pinned items go into the prompt: every post_style item whose
 * source.username matches the focused post's owner is always included, then the
 * highest-scoring others up to LIMITS.PROMPT_PINNED.
 * @returns {Array<object>}
 */
export function selectPinned(pinned, focusedUsername) {
  const list = Array.isArray(pinned) ? pinned.filter(Boolean) : [];
  const forced = focusedUsername
    ? list.filter((p) => p.kind === 'post_style' && p.source && p.source.username === focusedUsername)
    : [];
  const chosen = [...forced];
  const rest = list
    .filter((p) => chosen.indexOf(p) < 0)
    .sort((a, b) => (b.score - a.score) || (b.lastUsedAt - a.lastUsedAt));
  for (const p of rest) {
    if (chosen.length >= LIMITS.PROMPT_PINNED) break;
    chosen.push(p);
  }
  return chosen;
}

/**
 * The MEMORY text block. Returns { text, usedIds }.
 * @param {object} memory
 * @param {string|null} focusedUsername
 */
export function buildMemoryBlock(memory, focusedUsername) {
  const m = memory || {};
  const profile = m.profile || {};
  const lines = [];
  lines.push('MEMORY (private to this browser — never read it back verbatim unless asked)');
  lines.push(`profile: persona=${val(profile.persona, 'casual')}; brandVoice=${val(profile.brandVoice, '(not set)')}; niche=${val(profile.niche, '(not set)')}`);

  const chosen = selectPinned(m.pinned, focusedUsername);
  if (!chosen.length) {
    lines.push('remembered items: none yet.');
  } else {
    lines.push(`REMEMBERED ITEMS (${chosen.length}, most useful first)`);
    for (const p of chosen) {
      const src = p.source || {};
      const tag = [src.username ? '@' + src.username : null, src.postId || null].filter(Boolean).join(' ');
      lines.push(`- [${p.kind}${tag ? ' ' + tag : ''}] ${p.content}`);
    }
  }

  const history = Array.isArray(m.history) ? m.history.slice(-LIMITS.PROMPT_HISTORY) : [];
  if (history.length) {
    lines.push('');
    lines.push(`EARLIER IN THIS CONVERSATION (last ${history.length} turns)`);
    for (const h of history) {
      lines.push(`- ${h.role} (${h.inputMode}, ${h.pageType}${h.postId ? ', ' + h.postId : ''}): ${String(h.text).replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  return { text: lines.join('\n'), usedIds: chosen.map((p) => p.id).filter(Boolean) };
}

/* --------------------------------------------------------- request builders */

function sessionTurns(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .slice(-LIMITS.PROMPT_HISTORY)
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: String(t.text).trim() }));
}

/**
 * Build the AskRequest for MSG.ASK. Bumps the score of every pinned item it includes.
 * @param {import('../../shared/types.js').AskInput} input
 * @returns {Promise<import('../../shared/types.js').AskRequest>}
 */
export async function buildAskRequest(input) {
  const i = input || {};
  const ctx = i.pageContext || { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: '' };
  const memory = i.memory || { profile: {}, pinned: [], history: [] };
  const persona = i.persona === 'influencer' ? 'influencer' : 'casual';
  const inputMode = i.inputMode === 'voice' ? 'voice' : 'text';
  const post = focusedPostOf(ctx);

  const system = buildSystemPrompt({ persona, inputMode, profile: memory.profile });
  const mem = buildMemoryBlock(memory, post ? post.username : null);

  /** @type {Array<object>} */
  const contextContent = [{ type: 'text', text: buildContextBlock(ctx) }];
  // Row 11: the media URL only — the brain never fetches it. Never for a private owner.
  if (post && post.mediaUrl && post.isPrivate === false) {
    for (const u of imageUrlsOf(post)) contextContent.push({ type: 'image', url: u });
  }
  contextContent.push({ type: 'text', text: mem.text });

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: contextContent },
    ...sessionTurns(i.messages),
  ];

  // The attached photo rides on the LAST user turn, as vision input only.
  if (i.attachedImage) {
    let lastUserIdx = -1;
    for (let k = messages.length - 1; k > 1; k -= 1) {
      if (messages[k].role === 'user') { lastUserIdx = k; break; }
    }
    const part = { type: 'image', url: i.attachedImage };
    if (lastUserIdx === -1) {
      contextContent.push(part);
    } else {
      const m = messages[lastUserIdx];
      m.content = Array.isArray(m.content)
        ? [...m.content, part]
        : [{ type: 'text', text: String(m.content) }, part];
    }
  }

  // Persist the "this pin was useful" bump. Never throws.
  await bumpPinned(mem.usedIds);

  return {
    messages,
    maxOutputTokens: inputMode === 'voice' ? LIMITS.VOICE_MAX_TOKENS : LIMITS.TEXT_MAX_TOKENS,
    responseFormat: 'json',
    task: 'brain',
  };
}

/**
 * Build the AskRequest for MSG.STYLE_ADVICE. Text out, vision in.
 * @param {import('../../shared/types.js').StyleAdviceInput} input
 * @returns {Promise<import('../../shared/types.js').AskRequest>}
 */
export async function buildStyleRequest(input) {
  const i = input || {};
  const ctx = i.pageContext || { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: '' };
  const memory = i.memory || { profile: {}, pinned: [], history: [] };
  const persona = (memory.profile && memory.profile.persona) === 'influencer' ? 'influencer' : 'casual';
  const post = focusedPostOf(ctx);

  const mem = buildMemoryBlock(memory, post ? post.username : null);
  const content = [{ type: 'text', text: buildContextBlock(ctx) }];
  if (post && post.mediaUrl && post.isPrivate === false) for (const u of imageUrlsOf(post)) content.push({ type: 'image', url: u });
  content.push({ type: 'text', text: mem.text });
  content.push({
    type: 'text',
    text: i.attachedImage
      ? 'The image that follows is the USER\'S OWN photo, attached by them as input. Describe the post\'s style, then give numbered steps that move THIS photo and its caption towards that style. Text only — never an image.'
      : 'The user attached no photo of their own. Describe the post\'s style, then give numbered steps they can follow with their own camera and caption. Text only — never an image.',
  });
  if (i.attachedImage) content.push({ type: 'image', url: i.attachedImage });

  await bumpPinned(mem.usedIds);

  return {
    messages: [
      { role: 'system', content: buildStyleSystemPrompt({ persona, profile: memory.profile }) },
      { role: 'user', content },
    ],
    maxOutputTokens: LIMITS.TEXT_MAX_TOKENS,
    responseFormat: 'text',
    task: 'brain',
  };
}

export const MESSAGES = { ASK: MSG.ASK, STYLE_ADVICE: MSG.STYLE_ADVICE };
