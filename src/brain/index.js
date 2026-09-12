// src/brain/index.js — STUB (Phase 1). Returns realistic fake answers and a default memory.
// The brain subagent replaces this. Keep the exports (see shared/types.js §4).
import { defaultMemory, GENERIC_CHIPS } from '../../shared/types.js';

let mem = defaultMemory();

/** @returns {Promise<import('../../shared/types.js').Memory>} */
export async function getMemory() {
  try {
    return JSON.parse(JSON.stringify(mem));
  } catch (e) {
    return defaultMemory();
  }
}

export async function saveMemory(partial) {
  try {
    const p = partial || {};
    mem = {
      ...mem,
      ...p,
      profile: { ...mem.profile, ...(p.profile || {}) },
    };
    return getMemory();
  } catch (e) {
    return getMemory();
  }
}

export async function pin(item) {
  try {
    const now = Date.now();
    mem.pinned.push({
      id: 'pin_' + now.toString(36),
      kind: item.kind || 'fact',
      content: item.content || '',
      source: item.source || {},
      score: typeof item.score === 'number' ? item.score : 10,
      savedAt: now,
      lastUsedAt: now,
    });
    return getMemory();
  } catch (e) {
    return getMemory();
  }
}

export async function unpin(id) {
  try {
    mem.pinned = mem.pinned.filter((p) => p.id !== id);
    return getMemory();
  } catch (e) {
    return getMemory();
  }
}

export async function forgetAll() {
  try {
    mem = { profile: mem.profile, pinned: [], history: [] };
    return getMemory();
  } catch (e) {
    return getMemory();
  }
}

const CHIPS = {
  post: {
    casual: ["What's this post about?", 'Summarise the comments', 'Why is this doing well?'],
    influencer: ['How could this do better?', 'Break down the engagement', 'Which hashtags are pulling weight?'],
  },
  reel: {
    casual: ["What's this reel about?", 'What are people saying?', 'Is this trending?'],
    influencer: ['How could this reel do better?', 'Hook analysis', 'Best time to post something like this?'],
  },
  story: {
    casual: ["What's on this story?", 'Who posted this?'],
    influencer: ['Rate this story', 'How would I remake this?'],
  },
  profile: {
    casual: ['Who is this?', 'What do they post about?'],
    influencer: ['Analyse this profile', 'What is their posting style?'],
  },
  feed: {
    casual: ['What am I looking at?', 'Pick the best post here'],
    influencer: ['Which post here performs best?', 'Spot a trend in my feed'],
  },
  composer: {
    casual: ['Help me write a caption'],
    influencer: ['Optimise my caption', 'Suggest hashtags'],
  },
};

/** @param {{pageType:string, persona:string}} a @returns {string[]} */
export function getChips(a) {
  try {
    const t = CHIPS[a && a.pageType];
    const list = t && t[(a && a.persona) || 'casual'];
    return list ? [...list] : [...GENERIC_CHIPS];
  } catch (e) {
    return [...GENERIC_CHIPS];
  }
}

/**
 * @param {import('../../shared/types.js').AskInput} input
 * @returns {Promise<import('../../shared/types.js').AskResult>}
 */
export async function askAssistant(input) {
  try {
    const post = (input.pageContext.posts || []).find((p) => p.id === input.pageContext.focusedPostId);
    const persona = input.persona || 'casual';
    let reply;
    if (post && persona === 'influencer') {
      reply = `This post from @${post.username} has ${post.likes} likes and ${post.commentCount} comments, with a golden-hour landscape and a question hook in the caption. Recommendation: post a follow-up reel from the same shoot within 48 hours.`;
    } else if (post) {
      reply = `It's a sunrise shot from @${post.username} at the Cliffs of Moher, shot on film. People in the comments love the light and the yellow raincoat.`;
    } else {
      reply = "I can't see a post right now, but I'm happy to answer anything you type.";
    }
    return { reply, highlightTarget: null, memoryUpdate: null, notice: null };
  } catch (e) {
    return { reply: 'Something went wrong on my side, but you can still type a question.', highlightTarget: null, memoryUpdate: null, notice: null };
  }
}

/**
 * @param {import('../../shared/types.js').StyleAdviceInput} input
 * @returns {Promise<import('../../shared/types.js').StyleAdviceResult>}
 */
export async function styleAdvice(input) {
  try {
    const post = (input.pageContext.posts || []).find((p) => p.id === input.pageContext.focusedPostId);
    if (!post && !input.attachedImage) {
      return { reply: 'Open a post or attach a photo of yours first.', needsInput: true };
    }
    return {
      reply:
        'Their style: warm golden-hour light, one bright accent colour against muted greens, subject small in a wide frame, caption opens with a time-and-place detail and ends with a question. To match: shoot within an hour of sunrise, add one saturated accent (a jacket, a bag), step back so the landscape dominates, and write a two-line caption that ends by asking your followers something.',
    };
  } catch (e) {
    return { reply: 'Open a post or attach a photo of yours first.', needsInput: true };
  }
}
