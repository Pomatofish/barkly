// shared/types.js — FROZEN. Every interface in the project as JSDoc typedefs + the runtime
// constants every module imports. Never edit. Request changes in your REPORT.
//
// Module loading (no bundler):
//   - content side (src/context, src/voice, src/overlay, src/brain, src/main.js) are ES modules,
//     dynamically imported by the classic content script src/content.js
//   - src/bg/service-worker.js is a module service worker ("type": "module" in manifest)
//   - onboarding + offscreen pages load their JS with <script type="module">
// RULE: never touch chrome.* / document / window at module top level — only inside functions —
// so every module can be imported by a test page or by Node without crashing.

// ---------------------------------------------------------------------------------------------
// Primitive unions
// ---------------------------------------------------------------------------------------------
/** @typedef {'feed'|'post'|'reel'|'story'|'profile'|'composer'|'unknown'} PageType */
/** @typedef {'casual'|'influencer'} Persona */
/** @typedef {'voice'|'text'} InputMode */
/** @typedef {'green'|'yellow'|'red'} StatusLevel */
/** @typedef {null|'like_button'|'save_button'|'share_button'|'comment_box'|'caption_box'} HighlightTarget */
/** @typedef {{ level: StatusLevel, message: string }} StatusInfo */

// ---------------------------------------------------------------------------------------------
// src/context — getPageContext(), describeStatus(), onNavigate()
// ---------------------------------------------------------------------------------------------
/**
 * @typedef {Object} Post
 * @property {string} id                  shortcode from the post URL/href when available, else a stable hash of username+caption
 * @property {string|null} username       owner username, no leading @
 * @property {string|null} caption
 * @property {string|null} altText
 * @property {number|null} likes
 * @property {number|null} commentCount
 * @property {string|null} postedAt       ISO 8601 from <time datetime>, else null
 * @property {string[]} comments          loaded comments only, "username: text"; never auto-load more
 * @property {boolean|null} isPrivate     true / false / null = unknown (owner profile never visited)
 * @property {'image'|'video'|null} mediaType
 * @property {string|null} mediaUrl       thumbnail URL: img src for images, poster (or first frame img) for video
 */
/**
 * @typedef {Object} PageContext
 * @property {PageType} pageType
 * @property {Post[]} posts
 * @property {string|null} focusedPostId  open modal > story on screen > post nearest viewport centre
 * @property {string|null} draftCaption   composer only (stretch)
 * @property {string} url
 */
// getPageContext() -> Promise<PageContext>                 never throws; worst case pageType 'unknown', posts []
// describeStatus(pageContext) -> StatusInfo                 pure; rows 1–6 of failure-modes.md; PILL.OK when fine
// onNavigate(cb: (url: string) => void) -> () => void       SPA observer (pushState/replaceState/popstate + <title>
//                                                           MutationObserver); returns an unsubscribe function

// ---------------------------------------------------------------------------------------------
// src/brain — askAssistant(), styleAdvice(), memory store, getChips()
// ---------------------------------------------------------------------------------------------
/** @typedef {{ role: 'user'|'assistant', text: string, ts?: number }} ChatTurn */
/** @typedef {{ persona: Persona, brandVoice: string, niche: string }} MemoryProfile */
/**
 * @typedef {Object} PinnedItem
 * @property {string} id
 * @property {'post_style'|'fact'|'preference'|'post_ref'} kind
 * @property {string} content             model-written summary, <= 60 words
 * @property {{ username?: string, postId?: string, url?: string }} source
 * @property {number} score               explicit pin starts 10, auto-pin 5, +1 every time it is used in a prompt
 * @property {number} savedAt             epoch ms
 * @property {number} lastUsedAt          epoch ms
 */
/** @typedef {{ role: 'user'|'assistant', text: string, inputMode: InputMode, pageType: PageType, postId?: string|null, ts: number }} HistoryEntry */
/** @typedef {{ profile: MemoryProfile, pinned: PinnedItem[], history: HistoryEntry[] }} Memory */
/** @typedef {{ pin?: { kind: PinnedItem['kind'], content: string, source: PinnedItem['source'] }, profile?: Partial<MemoryProfile> }} MemoryUpdate */
/**
 * @typedef {Object} AskInput
 * @property {ChatTurn[]} messages        this session's chat turns; the LAST one is the new user message
 * @property {PageContext} pageContext
 * @property {Memory} memory
 * @property {Persona} persona
 * @property {InputMode} inputMode
 * @property {string} [attachedImage]     data URL (data:image/jpeg;base64,...), <= 1024 px; vision INPUT only
 */
/**
 * @typedef {Object} AskResult
 * @property {string} reply               THE single reply string: bubble, chat log and TTS all use it verbatim
 * @property {HighlightTarget} highlightTarget
 * @property {MemoryUpdate|null} memoryUpdate
 * @property {string} [notice]            optional one-line system note for the chat log only (e.g. row 16 "memory was reset")
 */
/** @typedef {{ pageContext: PageContext, attachedImage?: string, memory: Memory }} StyleAdviceInput */
/** @typedef {{ reply: string, needsInput?: boolean }} StyleAdviceResult */
// askAssistant(AskInput) -> Promise<AskResult>              never throws; brain APPLIES memoryUpdate itself
//                                                           (pin / history append / score bumps) before returning
// styleAdvice(StyleAdviceInput) -> Promise<StyleAdviceResult>   needsInput === true is row 14 (overlay pulses attach)
// getMemory() -> Promise<Memory>                            row 16: on parse/quota error reset pinned+history, keep profile
// saveMemory(Partial<Memory>) -> Promise<Memory>            shallow merge of top-level keys; profile merged one level deeper
// pin(item: Omit<PinnedItem,'id'|'savedAt'|'lastUsedAt'>) -> Promise<PinnedItem>   row 17 eviction
// unpin(id) -> Promise<void> ; forgetAll() -> Promise<void> (clears pinned + history, keeps profile)
// getChips({ pageType, persona }) -> string[]              static table, no model call

// ---------------------------------------------------------------------------------------------
// src/voice — startListening(), stopListening(), transcribe(), speak()
// ---------------------------------------------------------------------------------------------
// startListening() -> Promise<{ ok: true } | { ok: false, error: BusError }>   never throws; ERR.MIC_DENIED = row 7
// stopListening()  -> Promise<Blob|null>                    null if nothing was recorded
// transcribe(blob) -> Promise<string>                       '' on ANY failure (row 8 handled by overlay: < 3 words)
// speak(text)      -> Promise<void>                         resolves silently on failure (row 12)
// Recording happens in the offscreen document (extension origin, inherits the onboarding mic grant):
//   content VOICE_START -> bg (ensures offscreen doc) -> offscreen MediaRecorder
//   content VOICE_STOP  -> bg -> offscreen returns { audioBase64, mime }; voice turns it back into a Blob

// ---------------------------------------------------------------------------------------------
// src/overlay — mountOverlay(), deliverReply(), setStatus(), highlight(), clearHighlight()
// ---------------------------------------------------------------------------------------------
/** @typedef {{ reply: string, inputMode: InputMode, menuOpen: boolean }} DeliverReplyInput */
// mountOverlay() -> void                                    idempotent; injects the Shadow DOM host
// deliverReply(DeliverReplyInput) -> Promise<void>          bubble if menu closed, chat log always, THEN speak() if voice
// setStatus(level, message) -> void
// highlight(target) -> void ; clearHighlight() -> void      stubs in first build
// The overlay is the controller: it imports context / voice / brain directly and wires them.

// ---------------------------------------------------------------------------------------------
// Message bus (chrome.runtime.sendMessage / chrome.tabs.sendMessage)
// ---------------------------------------------------------------------------------------------
/**
 * Envelope. `target` defaults to 'bg'. bg IGNORES messages whose target is 'offscreen';
 * the offscreen page ONLY handles messages whose target is 'offscreen'.
 * @typedef {{ type: MessageType, data?: any, target?: 'bg'|'offscreen'|'content' }} BusRequest
 */
/** @typedef {{ code: string, message: string }} BusError */
/** @typedef {{ ok: true, data: any } | { ok: false, error: BusError }} BusResponse */

/** @typedef {{ type: 'text', text: string } | { type: 'image', dataUrl?: string, url?: string }} ContentPart */
/** @typedef {{ role: 'system'|'user'|'assistant', content: string|ContentPart[] }} ModelMessage */
/**
 * @typedef {Object} ModelRequest
 * @property {ModelMessage[]} messages
 * @property {number} [maxOutputTokens]   default LIMITS.TEXT_MAX_TOKENS
 * @property {'json'|'text'} [responseFormat]   default 'text'
 * @property {'brain'|'side'} [task]      default 'brain' (brain model + fallback); 'side' = side-task model
 */
/** @typedef {{ text: string, model: string }} ModelResponse */

/** @typedef {keyof typeof MSG} MessageType */
export const MSG = Object.freeze({
  GET_CONTEXT:     'GET_CONTEXT',     // bg/any page -> content tab   {}                        -> PageContext
  ASK:             'ASK',             // content -> bg                 ModelRequest              -> ModelResponse
  STYLE_ADVICE:    'STYLE_ADVICE',    // content -> bg                 ModelRequest              -> ModelResponse
  SPEAK:           'SPEAK',           // content -> bg                 { text }                  -> { audioBase64, mime }
  TRANSCRIBE:      'TRANSCRIBE',      // content -> bg                 { audioBase64, mime }     -> { text }
  STATUS:          'STATUS',          // bg -> content tab             StatusInfo                -> null   (rows 9, 13)
  HIGHLIGHT:       'HIGHLIGHT',       // bg -> content tab             { target: HighlightTarget } -> null
  GET_MEMORY:      'GET_MEMORY',      // any -> bg                     {}                        -> Memory
  SAVE_MEMORY:     'SAVE_MEMORY',     // any -> bg                     { memory: Partial<Memory> } -> Memory (merged)
  VOICE_START:     'VOICE_START',     // content -> bg -> offscreen    {}                        -> { started: true }
  VOICE_STOP:      'VOICE_STOP',      // content -> bg -> offscreen    {}                        -> { audioBase64, mime }
  OPEN_ONBOARDING: 'OPEN_ONBOARDING', // content -> bg                 {}                        -> null
});

export const ERR = Object.freeze({
  NO_KEY: 'NO_KEY',                   // row 13: empty key
  BAD_KEY: 'BAD_KEY',                 // row 13: 401
  TIMEOUT: 'TIMEOUT',                 // row 9
  HTTP_ERROR: 'HTTP_ERROR',           // row 9
  NETWORK: 'NETWORK',                 // row 9
  BAD_RESPONSE: 'BAD_RESPONSE',       // model answered with nothing usable
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',       // bus type not handled
  MIC_DENIED: 'MIC_DENIED',           // row 7
  MIC_UNAVAILABLE: 'MIC_UNAVAILABLE', // row 7 (no device)
  STT_FAILED: 'STT_FAILED',           // row 8
  TTS_FAILED: 'TTS_FAILED',           // row 12
  OFFSCREEN_FAILED: 'OFFSCREEN_FAILED',
  INTERNAL: 'INTERNAL',
});

/** Build a success envelope. */
export const ok = (data) => ({ ok: true, data });
/** Build a failure envelope. */
export const fail = (code, message) => ({ ok: false, error: { code, message: String(message ?? code) } });

/**
 * Send a bus message and ALWAYS resolve to a BusResponse (never throws — covers
 * "Extension context invalidated" after a reload and missing receivers).
 * @param {MessageType} type @param {any} [data] @param {'bg'|'offscreen'} [target]
 * @returns {Promise<BusResponse>}
 */
export async function send(type, data = {}, target = 'bg') {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return fail(ERR.INTERNAL, 'no chrome.runtime');
    const res = await chrome.runtime.sendMessage({ type, data, target });
    if (!res || typeof res.ok !== 'boolean') return fail(ERR.BAD_RESPONSE, `no response for ${type}`);
    return res;
  } catch (e) {
    return fail(ERR.INTERNAL, e?.message || String(e));
  }
}

// ---------------------------------------------------------------------------------------------
// Constants shared by everyone
// ---------------------------------------------------------------------------------------------
/** chrome.storage.local keys */
export const STORAGE_KEYS = Object.freeze({
  API_KEY: 'apiKey',             // string
  MEMORY: 'memory',              // Memory
  ONBOARDED: 'onboarded',        // boolean
  PRIVACY_CACHE: 'privacyCache', // { [username]: { isPrivate: boolean, checkedAt: number } }  (context)
});

export const LIMITS = Object.freeze({
  PINNED_CAP: 25,
  HISTORY_CAP: 30,
  PROMPT_PINNED: 8,
  PROMPT_HISTORY: 10,
  PROMPT_OTHER_POSTS: 5,
  PIN_CONTENT_WORDS: 60,
  IMAGE_MAX_PX: 1024,
  IMAGE_MAX_BYTES: 4 * 1024 * 1024,
  MODEL_TIMEOUT_MS: 12000,
  MODEL_RETRIES: 1,
  VOICE_MAX_TOKENS: 150,
  TEXT_MAX_TOKENS: 400,
  VOICE_MAX_SENTENCES: 2,
  TEXT_MAX_WORDS: 120,
  BUBBLE_MS: 8000,
  MIN_TRANSCRIPT_WORDS: 3,
  AUTO_PIN_MESSAGES: 3,
  SCORE_EXPLICIT: 10,
  SCORE_AUTO: 5,
});

/** Extension-relative paths (use chrome.runtime.getURL(PATHS.X)) */
export const PATHS = Object.freeze({
  ONBOARDING: 'src/onboarding/index.html',
  OFFSCREEN: 'src/voice/offscreen.html',
});

/** Pill copy from failure-modes.md — use these exact strings so every surface agrees. [level, message] */
export const PILL = Object.freeze({
  OK:            ['green',  'Public post — reading'],
  PRIVATE:       ['red',    'Private account — not reading'],          // row 1
  UNCONFIRMED:   ['yellow', "Can't confirm this account is public"],   // row 2
  UNKNOWN_PAGE:  ['yellow', 'Not sure what page this is'],             // row 3
  NO_CAPTION:    ['yellow', "Can't read this post"],                   // row 4
  NO_COMMENTS:   ['yellow', 'Caption only, no comments'],              // row 5
  STORY_NO_TEXT: ['yellow', 'Story has no text I can read'],           // row 6
  MIC_OFF:       ['yellow', 'Mic off — type instead'],                 // row 7
  STT_MISS:      ['yellow', "Didn't catch that"],                      // row 8
  MODEL_RETRY:   ['yellow', 'Assistant slow — retrying'],              // row 9
  MODEL_DOWN:    ['red',    'Assistant unavailable'],                  // row 9
  NO_KEY:        ['red',    'Add your API key in settings'],           // row 13
});

/** @returns {Memory} */
export function defaultMemory() {
  return { profile: { persona: 'casual', brandVoice: '', niche: '' }, pinned: [], history: [] };
}

/** @returns {PageContext} */
export function emptyContext(url = '') {
  return { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url };
}
