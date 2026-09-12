// src/brain/parse.js — strict-ish JSON parsing of the model reply + reply length rules.
// Row 10: when nothing parses, the WHOLE trimmed text becomes `reply` and the other two
// fields are null. Pure functions, never throw.
import { HIGHLIGHT_TARGETS, LIMITS } from '../../shared/types.js';

const PIN_KINDS = ['post_style', 'fact', 'preference', 'post_ref'];

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Strip ```json fences and stray leading labels. */
export function stripFences(text) {
  let s = String(text == null ? '' : text).trim();
  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1].trim()) s = fence[1].trim();
  return s;
}

/**
 * Find the first balanced {...} in the text that parses as JSON, preferring one that has
 * a "reply" key. String literals and escapes are respected while scanning.
 * @returns {object|null}
 */
export function extractJsonObject(text) {
  const s = String(text == null ? '' : text);
  let firstAny = null;
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i += 1) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          let parsed = null;
          try { parsed = JSON.parse(s.slice(start, i + 1)); } catch (e) { parsed = null; }
          if (isObj(parsed)) {
            if (typeof parsed.reply === 'string') return parsed;
            if (!firstAny) firstAny = parsed;
          }
          break;
        }
      }
    }
  }
  return firstAny;
}

function cleanPin(pin) {
  if (!isObj(pin)) return null;
  const content = typeof pin.content === 'string' ? pin.content.trim() : '';
  if (!content) return null;
  const src = isObj(pin.source) ? pin.source : {};
  const source = {};
  if (typeof src.username === 'string' && src.username) source.username = src.username.replace(/^@/, '');
  if (typeof src.postId === 'string' && src.postId) source.postId = src.postId;
  if (typeof src.url === 'string' && src.url) source.url = src.url;
  return {
    kind: PIN_KINDS.indexOf(pin.kind) >= 0 ? pin.kind : 'fact',
    content,
    source,
  };
}

function cleanProfile(profile) {
  if (!isObj(profile)) return null;
  const out = {};
  if (typeof profile.brandVoice === 'string' && profile.brandVoice.trim()) out.brandVoice = profile.brandVoice.trim();
  if (typeof profile.niche === 'string' && profile.niche.trim()) out.niche = profile.niche.trim();
  if (profile.persona === 'casual' || profile.persona === 'influencer') out.persona = profile.persona;
  return Object.keys(out).length ? out : null;
}

/** @returns {{pin?:object, profile?:object}|null} */
export function cleanMemoryUpdate(update) {
  if (!isObj(update)) return null;
  const out = {};
  const pin = cleanPin(update.pin);
  if (pin) out.pin = pin;
  const profile = cleanProfile(update.profile);
  if (profile) out.profile = profile;
  return Object.keys(out).length ? out : null;
}

/**
 * Parse a model reply into { reply, highlightTarget, memoryUpdate }.
 * Row 10: if no usable JSON object with a non-empty string `reply` is found, the whole
 * trimmed text becomes the reply and the other fields are null.
 * @param {string} text
 */
export function parseModelReply(text) {
  const raw = String(text == null ? '' : text).trim();
  const stripped = stripFences(raw);
  let obj = null;
  try {
    const direct = JSON.parse(stripped);
    if (isObj(direct)) obj = direct;
  } catch (e) {
    obj = null;
  }
  if (!obj || typeof obj.reply !== 'string') {
    const found = extractJsonObject(stripped);
    if (found && typeof found.reply === 'string') obj = found;
    else if (!obj) obj = null;
  }

  if (!obj || typeof obj.reply !== 'string' || !obj.reply.trim()) {
    return { reply: raw, highlightTarget: null, memoryUpdate: null, parsed: false };
  }
  const target = HIGHLIGHT_TARGETS.indexOf(obj.highlightTarget) >= 0 ? obj.highlightTarget : null;
  return {
    reply: obj.reply.trim(),
    highlightTarget: target,
    memoryUpdate: cleanMemoryUpdate(obj.memoryUpdate),
    parsed: true,
  };
}

/** Split into sentences, keeping their terminal punctuation. */
export function splitSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const m = s.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g);
  return (m || [s]).map((x) => x.trim()).filter(Boolean);
}

/** Voice: at most LIMITS.VOICE_MAX_SENTENCES sentences, cut at a sentence boundary. */
export function clampSentences(text, max) {
  const parts = splitSentences(text);
  if (parts.length <= max) return String(text || '').trim();
  return parts.slice(0, max).join(' ').trim();
}

/** Text: at most LIMITS.TEXT_MAX_WORDS words, cut at a word boundary + "…". */
export function clampWordCount(text, max) {
  const s = String(text || '').trim().replace(/[ \t]+/g, ' ');
  const words = s.split(/\s+/);
  if (words.length <= max) return s;
  return words.slice(0, max).join(' ').replace(/[,;:.\-—]$/, '') + '…';
}

/**
 * Apply the reply length rule for the input mode.
 * @param {string} reply
 * @param {'voice'|'text'} inputMode
 */
export function clampReply(reply, inputMode) {
  const s = String(reply || '').trim();
  if (!s) return s;
  if (inputMode === 'voice') {
    // Spoken: no markdown, no bullets, at most 2 sentences.
    const flat = s.replace(/[*_`#]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s*\n+\s*/g, ' ').trim();
    return clampSentences(flat, LIMITS.VOICE_MAX_SENTENCES);
  }
  return clampWordCount(s, LIMITS.TEXT_MAX_WORDS);
}
