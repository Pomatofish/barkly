// shared/types.js — FROZEN. The single source of truth for every interface.
// Subagents: NEVER edit this file. Request changes in the REPORT for your task.
//
// This is a real ES module. It is imported by:
//   - content-script modules (src/main.js loads them via dynamic import)
//   - the background service worker (manifest "type": "module")
//   - the offscreen document (src/voice/offscreen.html)
//   - the onboarding page (src/onboarding/index.html, <script type="module">)
// Rule for THIS file and for every module's top level: no chrome.* and no DOM
// access at import time. Touch them lazily inside functions so modules can be
// imported by test pages and by Node (`node --test`).

/* =========================================================================
 * 0. Small shared helpers (bus envelope)
 * ========================================================================= */

/**
 * @typedef {Object} BusError
 * @property {string} code     one of ERR
 * @property {string} message  human-readable, safe to show the user
 */

/**
 * @template T
 * @typedef {{ ok: true, data: T } | { ok: false, error: BusError }} BusResponse
 */

/** @returns {{ ok: true, data: any }} */
export function ok(data) { return { ok: true, data: data === undefined ? null : data }; }

/** @returns {{ ok: false, error: BusError }} */
export function fail(code, message) { return { ok: false, error: { code, message: String(message || code) } }; }

/**
 * Send a bus message to the background service worker and never throw.
 * Returns a BusResponse. Use this from content scripts, offscreen and pages.
 * @param {string} type   one of MSG
 * @param {any} [data]
 * @returns {Promise<BusResponse<any>>}
 */
export async function request(type, data) {
  try {
    const res = await chrome.runtime.sendMessage({ type, data: data === undefined ? {} : data });
    if (!res || typeof res.ok !== 'boolean') return fail(ERR.BAD_RESPONSE, 'Empty response from background');
    return res;
  } catch (e) {
    // Typical cause: the extension was reloaded while the tab stayed open.
    return fail(ERR.NETWORK, (e && e.message) || 'Could not reach the extension background');
  }
}

/* =========================================================================
 * 1. Enums and constants
 * ========================================================================= */

/** @typedef {'feed'|'post'|'reel'|'story'|'profile'|'composer'|'unknown'} PageType */
/** @typedef {'casual'|'influencer'} Persona */
/** @typedef {'voice'|'text'} InputMode */
/** @typedef {'green'|'yellow'|'red'} StatusLevel */
/** @typedef {null|'like_button'|'save_button'|'share_button'|'comment_box'|'caption_box'} HighlightTarget */

export const PERSONAS = ['casual', 'influencer'];
export const PAGE_TYPES = ['feed', 'post', 'reel', 'story', 'profile', 'composer', 'unknown'];
export const HIGHLIGHT_TARGETS = ['like_button', 'save_button', 'share_button', 'comment_box', 'caption_box'];

/** chrome.storage.local keys. Everything the extension persists lives under these. */
export const STORAGE_KEYS = {
  API_KEY: 'apiKey',             // string — written by onboarding, read by bg only
  MEMORY: 'memory',              // Memory — owned by brain; onboarding writes memory.profile via SAVE_MEMORY
  ONBOARDED: 'onboarded',        // boolean — set true when the onboarding flow completes
  PRIVACY_CACHE: 'privacyCache', // { [username]: { isPrivate: boolean, seenAt: number } } — owned by context
  MASCOT_POS: 'grammy_mascot_pos', // { x, y } — owned by overlay (accepted from reports/overlay-1.md)
};

export const LIMITS = {
  PINNED_CAP: 25,          // row 17: evict lowest score, never the one just pinned
  HISTORY_CAP: 30,         // rolling
  PROMPT_PINNED: 8,        // top 8 pinned by score go into the prompt
  PROMPT_HISTORY: 10,      // last 10 history turns go into the prompt
  PROMPT_OTHER_POSTS: 5,   // up to 5 non-focused posts as one-line summaries
  VOICE_MAX_TOKENS: 450,   // output budget incl. JSON wrapper and any reasoning tokens; the prompt keeps the reply short
  TEXT_MAX_TOKENS: 900,
  VOICE_MAX_SENTENCES: 2,
  VOICE_MAX_WORDS: 45,
  TEXT_MAX_WORDS: 120,
  PIN_CONTENT_MAX_WORDS: 60,
  TIMEOUT_MS: 12000,       // row 9: AbortController timeout per attempt
  RETRIES: 1,              // row 9: one retry (on the fallback model)
  IMAGE_MAX_PX: 1024,      // row 15: client-side downscale longest edge
  IMAGE_MAX_BYTES: 4 * 1024 * 1024,
  BUBBLE_MS: 8000,         // bubble auto-dismiss
  MIN_TRANSCRIPT_WORDS: 3, // row 8
  LONG_PRESS_MS: 350,      // mascot long-press threshold for PTT
  MENU_ANIM_MS: 200,
  EXPLICIT_PIN_SCORE: 10,
  AUTO_PIN_SCORE: 5,
  AUTO_PIN_MESSAGES: 3,    // same postId gets >= 3 user messages in a session
};

/** Extension-relative URLs. Resolve with chrome.runtime.getURL(...) where needed. */
export const OFFSCREEN_URL = 'src/voice/offscreen.html';
export const ONBOARDING_URL = 'src/onboarding/index.html';

/** Error codes carried in BusError.code */
export const ERR = {
  NO_KEY: 'NO_KEY',                   // row 13: empty key in storage
  BAD_KEY: 'BAD_KEY',                 // row 13: HTTP 401
  TIMEOUT: 'TIMEOUT',                 // row 9: > 12 s, after the retry
  HTTP_ERROR: 'HTTP_ERROR',           // row 9: non-2xx after the retry
  NETWORK: 'NETWORK',                 // fetch threw / bus unreachable
  BAD_RESPONSE: 'BAD_RESPONSE',       // 2xx but unparsable body
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',       // bus: unrecognised msg.type
  MIC_DENIED: 'MIC_DENIED',           // row 7: NotAllowedError
  MIC_UNAVAILABLE: 'MIC_UNAVAILABLE', // row 7: NotFoundError / no MediaRecorder
  OFFSCREEN_FAILED: 'OFFSCREEN_FAILED',
  STT_FAILED: 'STT_FAILED',           // row 8
  TTS_FAILED: 'TTS_FAILED',           // row 12
  INTERNAL: 'INTERNAL',
};

/**
 * Status pill strings. Every module uses THESE objects so the pill reads the
 * same everywhere. Row numbers refer to failure-modes.md.
 * @type {Record<string, StatusInfo>}
 */
export const PILL = {
  READY:         { level: 'green',  message: 'Ready' },
  PUBLIC_POST:   { level: 'green',  message: 'Public post — reading' },
  LISTENING:     { level: 'green',  message: 'Listening…' },
  THINKING:      { level: 'green',  message: 'Thinking…' },
  PRIVATE:       { level: 'red',    message: 'Private account — not reading' },        // row 1
  UNCONFIRMED:   { level: 'yellow', message: "Can't confirm this account is public" },  // row 2
  UNKNOWN_PAGE:  { level: 'yellow', message: 'Not sure what page this is' },            // row 3
  NO_CAPTION:    { level: 'yellow', message: "Can't read this post" },                  // row 4
  NO_COMMENTS:   { level: 'yellow', message: 'Caption only, no comments' },             // row 5
  STORY_NO_TEXT: { level: 'yellow', message: 'Story has no text I can read' },          // row 6
  MIC_OFF:       { level: 'yellow', message: 'Mic off — type instead' },                // row 7
  DIDNT_CATCH:   { level: 'yellow', message: "Didn't catch that" },                     // row 8
  RETRYING:      { level: 'yellow', message: 'Assistant slow — retrying' },             // row 9
  UNAVAILABLE:   { level: 'red',    message: 'Assistant unavailable' },                 // row 9
  NO_KEY:        { level: 'red',    message: 'Add your API key in settings' },          // row 13
};

/** Chips shown when pageType is unknown (row 3) and the generic fallback set. */
export const GENERIC_CHIPS = ['What can you do?', 'Paste the caption', 'Explain Instagram basics'];

/* =========================================================================
 * 2. Page context  (src/context/)
 * ========================================================================= */

/**
 * @typedef {Object} Post
 * @property {string} id                  stable id: shortcode from /p/<code>/ or /reel/<code>/; story: 'story:<username>:<n>'; else a stable hash of username+caption
 * @property {string|null} username       owner handle without '@'
 * @property {string|null} caption        full caption incl. hashtags; null on selector miss (row 4)
 * @property {string|null} altText        img[alt] of the main media
 * @property {number|null} likes
 * @property {number|null} commentCount
 * @property {string|null} postedAt       ISO 8601 from <time datetime>
 * @property {string[]} comments          ALREADY LOADED comments only, "username: text"; never auto-load more (row 5 when empty)
 * @property {boolean|null} isPrivate     from the owner's profile page, cached per username; null if never seen (row 2)
 * @property {'image'|'video'|null} mediaType
 * @property {string|null} mediaUrl       img src or video poster; context never fetches it (row 11)
 * @property {string[]} [mediaUrls]       additive: every carousel slide known (DOM slides, or all sidecar images from capture); brain sends up to 4
 */

/**
 * @typedef {Object} PageContext
 * @property {PageType} pageType
 * @property {Post[]} posts               posts currently rendered; for a private owner, caption/comments/media are null/[]
 * @property {string|null} focusedPostId  open modal > story on screen > post nearest viewport centre
 * @property {string|null} draftCaption   composer only (stretch); null otherwise
 * @property {string} url
 */

/** @typedef {{ level: StatusLevel, message: string }} StatusInfo */

/** The row-3 fallback context. @param {string} [url] @returns {PageContext} */
export function emptyContext(url) {
  return { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: url || '' };
}

/**
 * src/context/index.js must export:
 *
 *   getPageContext(): Promise<PageContext>
 *     Never throws. On any error returns
 *     { pageType:'unknown', posts:[], focusedPostId:null, draftCaption:null, url: location.href }.
 *
 *   onNavigate(cb: (url: string) => void): () => void
 *     SPA navigation observer (patched pushState/replaceState + popstate + MutationObserver
 *     on <title>). Debounced ~300 ms. Returns an unsubscribe function.
 *
 *   describeStatus(ctx: PageContext): StatusInfo
 *     Implements rows 1–6 → PILL.*; returns PILL.PUBLIC_POST / PILL.READY otherwise.
 *     Pure function, safe to call from the overlay after every getPageContext().
 *
 *   focusedPost(ctx: PageContext): Post|null   convenience: posts.find(p => p.id === focusedPostId)
 */

/* =========================================================================
 * 3. Memory  (src/brain/, persisted at chrome.storage.local[STORAGE_KEYS.MEMORY])
 * ========================================================================= */

/**
 * @typedef {Object} MemoryProfile
 * @property {Persona} persona
 * @property {string} brandVoice
 * @property {string} niche
 */

/**
 * @typedef {Object} PinnedItem
 * @property {string} id
 * @property {'post_style'|'fact'|'preference'|'post_ref'} kind
 * @property {string} content            model-written summary, <= 60 words
 * @property {{ username?: string, postId?: string, url?: string }} source
 * @property {number} score              10 explicit, 5 auto; += 1 each time it is used in a prompt
 * @property {number} savedAt            epoch ms
 * @property {number} lastUsedAt         epoch ms
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {'user'|'assistant'} role
 * @property {string} text
 * @property {InputMode} inputMode
 * @property {PageType} pageType
 * @property {string} [postId]
 * @property {number} ts                 epoch ms
 */

/**
 * @typedef {Object} Memory
 * @property {MemoryProfile} profile
 * @property {PinnedItem[]} pinned       cap LIMITS.PINNED_CAP
 * @property {HistoryEntry[]} history    rolling, cap LIMITS.HISTORY_CAP
 */

/** @returns {Memory} */
export function defaultMemory() {
  return { profile: { persona: 'casual', brandVoice: '', niche: '' }, pinned: [], history: [] };
}

/* =========================================================================
 * 4. Brain  (src/brain/)
 * ========================================================================= */

/**
 * One turn of the CURRENT session's chat as kept by the overlay. The last
 * element of AskInput.messages is the user turn being answered.
 * @typedef {Object} ChatTurn
 * @property {'user'|'assistant'} role
 * @property {string} text
 * @property {number} [ts]
 */

/**
 * @typedef {Object} AskInput
 * @property {ChatTurn[]} messages
 * @property {PageContext} pageContext
 * @property {Memory} memory
 * @property {Persona} persona
 * @property {InputMode} inputMode
 * @property {string|null} [attachedImage]   data URL (image/jpeg, longest edge <= 1024 px) or null
 */

/**
 * @typedef {Object} MemoryUpdate
 * @property {{ kind: PinnedItem['kind'], content: string, source: PinnedItem['source'] }} [pin]
 * @property {Partial<MemoryProfile>} [profile]
 */

/**
 * @typedef {Object} AskResult
 * @property {string} reply                  THE single reply string (bubble, log, TTS). <= 2 sentences when inputMode === 'voice'
 * @property {HighlightTarget} highlightTarget
 * @property {MemoryUpdate|null} memoryUpdate  already APPLIED to the store by askAssistant; returned so the overlay can refresh its Remembered panel
 * @property {string|null} [notice]          optional one-line system note for the chat log (e.g. row 16 "memory was reset"); never spoken
 */

/**
 * @typedef {Object} StyleAdviceInput
 * @property {PageContext} pageContext
 * @property {string|null} [attachedImage]   data URL or null
 * @property {Memory} memory
 */

/**
 * @typedef {Object} StyleAdviceResult
 * @property {string} reply                  text only, never an image
 * @property {boolean} [needsInput]          true for row 14 ("Open a post or attach a photo of yours first") → overlay pulses the attach button
 */

/**
 * src/brain/index.js must export:
 *
 *   askAssistant(input: AskInput): Promise<AskResult>
 *     Builds ModelMessages (see §6), sends MSG.ASK via request(), parses strict JSON
 *     {reply, highlightTarget, memoryUpdate}; row 10 fallback: whole text → reply.
 *     Applies memoryUpdate (pins, profile) and appends both turns to history. Never throws.
 *     On bus error returns a canned reply: NO_KEY/BAD_KEY → row 13 text; TIMEOUT/HTTP_ERROR →
 *     row 9 "canned menu of what still works".
 *
 *   styleAdvice(input: StyleAdviceInput): Promise<StyleAdviceResult>
 *     Sends MSG.STYLE_ADVICE. Vision INPUT only. Row 14 when nothing to describe.
 *
 *   getMemory(): Promise<Memory>            row 16: parse/quota error → reset pinned+history, keep profile
 *   saveMemory(partial: Partial<Memory>): Promise<Memory>   shallow merge; profile merged one level deeper
 *   pin(item: Omit<PinnedItem,'id'|'savedAt'|'lastUsedAt'> & { score?: number }): Promise<Memory>   row 17 eviction
 *   unpin(id: string): Promise<Memory>
 *   forgetAll(): Promise<Memory>            clears pinned + history, keeps profile
 *   getChips({ pageType, persona }): string[]   static table, no model call
 */

/* =========================================================================
 * 5. Voice  (src/voice/)
 * ========================================================================= */

/**
 * src/voice/index.js must export (content-script side):
 *
 *   startListening(): Promise<{ ok: true } | { ok: false, error: BusError }>
 *     Sends MSG.VOICE_START (bg ensures the offscreen document, forwards). Never throws.
 *     Row 7: MIC_DENIED / MIC_UNAVAILABLE come back as { ok:false, error }.
 *
 *   stopListening(): Promise<Blob|null>
 *     Sends MSG.VOICE_STOP, converts { audioBase64, mime } to a Blob. null on failure.
 *
 *   transcribe(blob: Blob): Promise<string>
 *     Sends MSG.TRANSCRIBE. Returns '' on any failure (row 8 is judged by the overlay:
 *     fewer than LIMITS.MIN_TRANSCRIPT_WORDS words → PILL.DIDNT_CATCH).
 *
 *   speak(text: string): Promise<void>
 *     Sends MSG.SPEAK, plays the returned audio in the content script, resolves when playback
 *     ends. Row 12: resolves silently on any failure. Never rejects.
 *
 *   stopSpeaking(): void
 *
 * src/voice/offscreen.html + offscreen.js (extension origin, inherits the onboarding mic grant):
 *   handles { target:'offscreen', type: MSG.VOICE_START | MSG.VOICE_STOP } with MediaRecorder,
 *   responds with BusResponse. VOICE_STOP data: { audioBase64: string, mime: string }.
 */

/* =========================================================================
 * 6. Background bus  (src/bg/)
 * ========================================================================= */

/**
 * A model-agnostic message. bg translates to the provider's wire format.
 * @typedef {{ type: 'text', text: string } | { type: 'image', url: string }} ContentPart   url = https URL or data: URL
 * @typedef {{ role: 'system'|'user'|'assistant', content: string | ContentPart[] }} ModelMessage
 */

/**
 * Payload of MSG.ASK and MSG.STYLE_ADVICE (content → bg).
 * @typedef {Object} AskRequest
 * @property {ModelMessage[]} messages
 * @property {number} maxOutputTokens        LIMITS.VOICE_MAX_TOKENS or LIMITS.TEXT_MAX_TOKENS
 * @property {'json'|'text'} responseFormat  'json' asks the provider for a JSON object
 * @property {'brain'|'side'} [task]         'brain' (default) → MODELS.brain with MODELS.brainFallback on retry; 'side' → MODELS.side
 */

/** Response data of MSG.ASK / MSG.STYLE_ADVICE. @typedef {{ text: string, model: string }} ModelReply */

/**
 * Message types on chrome.runtime.sendMessage. Envelope: { type, data, target? }.
 * "content → bg" messages are sent with request(). "→ content tab" messages are sent by
 * bg with chrome.tabs.sendMessage(tabId, { type, data }) and handled in src/main.js.
 * Messages carrying target:'offscreen' are for the offscreen document ONLY; bg ignores them.
 */
export const MSG = {
  GET_CONTEXT:     'GET_CONTEXT',     // any → content tab:  {}                          → PageContext
  ASK:             'ASK',             // content → bg:       AskRequest                  → ModelReply
  STYLE_ADVICE:    'STYLE_ADVICE',    // content → bg:       AskRequest (vision input ok)→ ModelReply
  SPEAK:           'SPEAK',           // content → bg:       { text }                    → { audioBase64, mime }
  TRANSCRIBE:      'TRANSCRIBE',      // content → bg:       { audioBase64, mime }       → { text }
  STATUS:          'STATUS',          // bg → content tab:   StatusInfo                  → null   (rows 9, 13 pushed mid-request)
  HIGHLIGHT:       'HIGHLIGHT',       // any → content tab:  { target: HighlightTarget } → null   (stretch)
  GET_MEMORY:      'GET_MEMORY',      // any → bg:           {}                          → Memory
  SAVE_MEMORY:     'SAVE_MEMORY',     // any → bg:           { memory: Partial<Memory> } → Memory (merged; profile merged one level deeper)
  VOICE_START:     'VOICE_START',     // content → bg → offscreen: {}                    → { started: true }
  VOICE_STOP:      'VOICE_STOP',      // content → bg → offscreen: {}                    → { audioBase64, mime }
  OPEN_ONBOARDING: 'OPEN_ONBOARDING', // content → bg:       {}                          → null   (chrome.runtime.openOptionsPage)
};

/**
 * bg behaviour (src/bg/service-worker.js):
 *   - API key from chrome.storage.local[STORAGE_KEYS.API_KEY]; empty → fail(ERR.NO_KEY) and push PILL.NO_KEY (row 13)
 *   - 401 → fail(ERR.BAD_KEY) and push PILL.NO_KEY (row 13)
 *   - per attempt AbortController LIMITS.TIMEOUT_MS; on timeout/5xx push PILL.RETRYING, retry once
 *     on MODELS.brainFallback; then push PILL.UNAVAILABLE and fail(ERR.TIMEOUT | ERR.HTTP_ERROR) (row 9)
 *   - if the provider rejects a request because an image URL could not be fetched (4xx mentioning
 *     image/url), retry once with all image parts removed (row 11)
 *   - every response is ok(data) or fail(code, message); never an unhandled rejection
 */

/* =========================================================================
 * 7. Overlay  (src/overlay/)
 * ========================================================================= */

/**
 * @typedef {Object} DeliverReplyInput
 * @property {string} reply
 * @property {InputMode} inputMode
 * @property {boolean} menuOpen
 */

/**
 * src/overlay/index.js must export:
 *
 *   mountOverlay(): void                    idempotent; creates the Shadow DOM host once
 *   deliverReply(input: DeliverReplyInput): Promise<void>
 *     menu closed → bubble beside the mascot (fade+scale, auto-dismiss LIMITS.BUBBLE_MS or on tap; tap opens menu);
 *     ALWAYS append to chat log; THEN speak(reply) if inputMode === 'voice' (row 19 ordering).
 *     Row 18: flip bubble side if it would overflow; truncate with "…" if still too long.
 *   setStatus(level: StatusLevel, message: string): void
 *   isMenuOpen(): boolean
 *   highlight(target: HighlightTarget): void   stretch; stub returns immediately
 *   clearHighlight(): void
 */

/* =========================================================================
 * 8. Onboarding  (src/onboarding/)
 * ========================================================================= */

/**
 * Writes: STORAGE_KEYS.API_KEY (string), STORAGE_KEYS.ONBOARDED (true), and the persona via
 * MSG.SAVE_MEMORY { memory: { profile: { persona } } }. Requests the mic on its own
 * (extension) origin with getUserMedia, releasing the track immediately, so the offscreen
 * recorder inherits the grant. "Done" closes the tab.
 */
