// src/brain/chips.js — suggested chips. STATIC table, no model call in the first build.
import { GENERIC_CHIPS } from '../../shared/types.js';
import { focusedPostOf } from './build.js';

const TABLE = {
  post: {
    casual: ["What's this post about?", 'Summarise the comments', 'Why is this doing well?'],
    influencer: ['How could this do better?', 'Break down the engagement', 'Which hashtags are pulling weight?'],
  },
  reel: {
    casual: ["What's this reel about?", 'What are people saying?', 'Is this a trend?'],
    influencer: ['How could this reel do better?', 'Break down the engagement', 'Is the hook strong enough?'],
  },
  story: {
    casual: ["What's on this story?", 'Who posted this?', 'What should I reply?'],
    influencer: ['Rate this story', 'How would I remake this?', 'What would drive replies?'],
  },
  profile: {
    casual: ['Who is this?', 'What do they post about?', "What's their vibe?"],
    influencer: ['Analyse this profile', "What's their posting pattern?", 'What works best for them?'],
  },
  feed: {
    casual: ['What am I looking at?', 'Pick the best post here', 'Anything worth saving?'],
    influencer: ['Which post here performs best?', 'Spot a trend in my feed', 'What are they all doing the same?'],
  },
  composer: {
    casual: ['Help me write a caption', 'Does this caption sound like me?'],
    influencer: ['Optimise my caption', 'Suggest hashtags', 'Best time to post this?'],
  },
};

/**
 * @param {{pageType?:string, persona?:string, pageContext?:object}} a
 * @param {object} [ctxArg]  PageContext, when passed positionally
 * @returns {string[]}
 */
export function getChips(a, ctxArg) {
  try {
    const arg = a || {};
    const pageType = arg.pageType || 'unknown';
    const persona = arg.persona === 'influencer' ? 'influencer' : 'casual';
    const ctx = arg.pageContext || ctxArg || null;

    const row = TABLE[pageType];
    const chips = row && row[persona] ? [...row[persona]] : [...GENERIC_CHIPS];

    const post = focusedPostOf(ctx);
    if (post) {
      // Row 4: the caption could not be read — offer the paste route first.
      if (post.isPrivate !== true && !post.caption) chips.unshift('Paste the caption');
      // Style advice needs something readable to describe.
      if (post.isPrivate !== true) chips.push('Match this style');
    }
    return chips.filter((c, i) => c && chips.indexOf(c) === i);
  } catch (e) {
    return [...GENERIC_CHIPS];
  }
}
