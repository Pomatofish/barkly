// src/brain/index.js — STUB. The brain subagent replaces this with real prompts, JSON parsing,
// the memory store + pinning rules, and styleAdvice().
// Interface: askAssistant, styleAdvice, getMemory, saveMemory, pin, unpin, forgetAll, getChips — see shared/types.js.
import { LIMITS, STORAGE_KEYS, defaultMemory } from '../../shared/types.js';

// ---- memory (chrome.storage.local when available, else in-memory so tests can import this) ----
let mem = null;

async function load() {
  if (mem) return mem;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const got = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
      mem = got?.[STORAGE_KEYS.MEMORY] || defaultMemory();
    } else {
      mem = defaultMemory();
    }
  } catch (e) {
    mem = defaultMemory(); // row 16
  }
  return mem;
}

async function persist() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEYS.MEMORY]: mem });
    }
  } catch (e) {
    /* row 16: ignore quota errors in the stub */
  }
  return mem;
}

/** @returns {Promise<import('../../shared/types.js').Memory>} */
export async function getMemory() {
  try {
    const m = await load();
    if (m.pinned.length === 0) {
      m.pinned.push({
        id: 'stub-pin-1',
        kind: 'post_style',
        content: 'wanderlust.jules: warm golden-hour travel shots, one bold colour pop, short caption + 4 hashtags.',
        source: { username: 'wanderlust.jules', postId: 'C9xY2kLpQrS', url: 'https://www.instagram.com/p/C9xY2kLpQrS/' },
        score: 10,
        savedAt: Date.now() - 86400000,
        lastUsedAt: Date.now() - 3600000,
      });
    }
    return m;
  } catch (e) {
    return defaultMemory();
  }
}

/** @param {Partial<import('../../shared/types.js').Memory>} partial */
export async function saveMemory(partial) {
  try {
    const m = await load();
    if (partial?.profile) m.profile = { ...m.profile, ...partial.profile };
    if (partial?.pinned) m.pinned = partial.pinned;
    if (partial?.history) m.history = partial.history;
    return persist();
  } catch (e) {
    return mem || defaultMemory();
  }
}

export async function pin(item) {
  try {
    const m = await load();
    const full = { id: 'pin-' + Math.random().toString(36).slice(2, 9), savedAt: Date.now(), lastUsedAt: Date.now(), score: LIMITS.SCORE_EXPLICIT, ...item };
    m.pinned.push(full);
    if (m.pinned.length > LIMITS.PINNED_CAP) {
      m.pinned.sort((a, b) => b.score - a.score);
      m.pinned = m.pinned.filter((p, i) => i < LIMITS.PINNED_CAP || p.id === full.id).slice(0, LIMITS.PINNED_CAP); // row 17
    }
    await persist();
    return full;
  } catch (e) {
    return null;
  }
}

export async function unpin(id) {
  try {
    const m = await load();
    m.pinned = m.pinned.filter((p) => p.id !== id);
    await persist();
  } catch (e) { /* ignore */ }
}

export async function forgetAll() {
  try {
    const m = await load();
    m.pinned = [];
    m.history = [];
    await persist();
  } catch (e) { /* ignore */ }
}

// ---- chips (static table) ----
const CHIPS = {
  casual: {
    post: ["What's this post about?", 'Summarise the comments', 'Why is this popular?'],
    reel: ["What's happening in this reel?", 'Summarise the comments', 'Is this trending?'],
    story: ["What's this story about?", 'Who posted this?'],
    profile: ['What does this account post about?', 'Is this account public?'],
    feed: ["What's on my feed right now?", 'Explain the post in front of me'],
    composer: ['Help me write a caption', 'Suggest hashtags'],
    unknown: ['What can you do?', 'Paste the caption'],
  },
  influencer: {
    post: ['How could this do better?', 'Why did this get engagement?', 'Best time to post this?'],
    reel: ['What hook is this reel using?', 'How could this do better?', 'Engagement breakdown'],
    story: ['What is this story doing well?', 'Rate this story'],
    profile: ['Analyse this account', 'Posting cadence?'],
    feed: ["What's performing on my feed?", 'Spot a trend'],
    composer: ['Optimise my caption', 'Hashtag strategy'],
    unknown: ['What can you do?', 'Paste the caption'],
  },
};

/** @param {{ pageType: string, persona: string }} p @returns {string[]} */
export function getChips({ pageType, persona } = {}) {
  try {
    const table = CHIPS[persona] || CHIPS.casual;
    return [...(table[pageType] || table.unknown)];
  } catch (e) {
    return ['What can you do?'];
  }
}

// ---- askAssistant / styleAdvice ----
/** @param {import('../../shared/types.js').AskInput} input @returns {Promise<import('../../shared/types.js').AskResult>} */
export async function askAssistant(input) {
  try {
    const last = input?.messages?.[input.messages.length - 1]?.text || '';
    const post = input?.pageContext?.posts?.find((p) => p.id === input.pageContext.focusedPostId) || input?.pageContext?.posts?.[0];
    const persona = input?.persona || 'casual';
    const voice = input?.inputMode === 'voice';
    await new Promise((r) => setTimeout(r, 400));
    let reply;
    if (post?.isPrivate === true) {
      reply = "That account is private, so I'm not reading it. Happy to answer general Instagram questions though.";
    } else if (persona === 'influencer') {
      reply = `${post?.username || 'This account'} pulled ${post?.likes ?? '?'} likes and ${post?.commentCount ?? '?'} comments on a golden-hour travel shot with 4 hashtags. ` +
        (voice ? 'Post at the same hour and lead with a stronger first line.' : 'Recommendations: 1) post at the same evening hour, 2) lead the caption with a hook instead of the location, 3) add 2–3 niche hashtags like #lisbonphotography.');
    } else {
      reply = voice
        ? `It's ${post?.username || 'someone'} sharing a golden-hour shot from Lisbon with a laid-back travel vibe. People in the comments love the light and the yellow dress.`
        : `It's ${post?.username || 'someone'} sharing a golden-hour photo from a viewpoint in Lisbon — tiled streets, pastel de nata, no plans. The comments are mostly about the light and the yellow dress. Want me to summarise the comments?`;
    }
    const wantsPin = /\b(remember|keep this in mind|save this)\b/i.test(last);
    return {
      reply: wantsPin ? reply + " (I'll remember this one)" : reply,
      highlightTarget: null,
      memoryUpdate: wantsPin
        ? { pin: { kind: 'post_style', content: 'Warm golden-hour travel photo, one bold colour accent, short caption + location hashtags.', source: { username: post?.username, postId: post?.id, url: input?.pageContext?.url } } }
        : null,
    };
  } catch (e) {
    return { reply: "Sorry — I couldn't think that one through. Try again?", highlightTarget: null, memoryUpdate: null };
  }
}

/** @param {import('../../shared/types.js').StyleAdviceInput} input @returns {Promise<import('../../shared/types.js').StyleAdviceResult>} */
export async function styleAdvice(input) {
  try {
    const post = input?.pageContext?.posts?.find((p) => p.id === input.pageContext.focusedPostId) || input?.pageContext?.posts?.[0];
    if (!post && !input?.attachedImage) {
      return { reply: 'Open a post or attach a photo of yours first.', needsInput: true }; // row 14
    }
    await new Promise((r) => setTimeout(r, 400));
    return {
      reply:
        'This post leans on warm golden-hour light, a single bold colour (the yellow dress) against muted rooftops, and a short caption that opens with a feeling before the hashtags. ' +
        'To match it: shoot 30–45 min before sunset, put one saturated item in frame, warm the white balance slightly, crop 4:5, and write one sensory line + location + 3–4 hashtags.',
    };
  } catch (e) {
    return { reply: 'Open a post or attach a photo of yours first.', needsInput: true };
  }
}
