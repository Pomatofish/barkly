CHANGED:
- src/bg/api.js (new) — pure functions, no chrome.*, takes fetchImpl explicitly:
  toResponsesInput(messages), extractOutputText(json), callModel({req, apiKey,
  fetchImpl, onStatus, models}), speech({text, apiKey, fetchImpl}),
  transcribe({audioBase64, mime, apiKey, fetchImpl}).
- src/bg/service-worker.js (rewritten) — real router: getKey(), pushStatus(),
  readMemory()/writeMemory(), ensureOffscreen()/toOffscreen() (ported from
  demos/mic-tts-test-insta/background.js), exported async handle(msg, sender),
  exported _setDepsForTest({fetchImpl}) test seam, chrome.* registration
  (onInstalled, action.onClicked, runtime.onMessage) guarded by
  `typeof chrome !== 'undefined'`, each in its own try/catch.
- src/bg/api.test.js (new) — 29 tests, fake fetch only, no chrome shim needed.
- src/bg/router.test.js (new) — 27 tests, installs a fake chrome on globalThis
  before importing service-worker.js, drives both the captured onMessage
  listener and the exported handle() directly.
- src/bg/config.js — untouched (model IDs/endpoints were already correct for
  this task; imported as-is by api.js).

Design decision (per the task's "your choice, document it"): system
ModelMessages are folded into the Responses API `input` array as
{role:'system', content:[{type:'input_text', ...}]} rather than lifted into
the top-level `instructions` field. Reasoning: one code path handles every
role uniformly, and it preserves ordering/count if more than one system-ish
turn ever gets added (e.g. by brain's prompt assembly) instead of silently
collapsing them.

Other implementation choices not fully pinned down by the task text:
- Row 11 image-strip retry reuses the SAME model (not the fallback) and is
  attempted only once; if that retry's response is also non-2xx, it fails
  with HTTP_ERROR (or BAD_KEY on 401, or TIMEOUT/NETWORK on a second throw)
  with no further retries — row 9 and row 11 retries are not chained.
- HTTP_ERROR / TTS_FAILED / STT_FAILED messages are built as
  `${status}: ${providerMessage}`, where providerMessage tries
  JSON.parse(body).error.message, then .message, then the raw body text
  (capped at 300 chars) — never the raw Authorization header or key.
- 429 is treated exactly like 5xx (retry once on brainFallback), per the
  task's "5xx / 429 / abort ... -> onStatus(PILL.RETRYING), retry once".
- ArrayBuffer -> base64 for TTS audio uses btoa + chunked
  String.fromCharCode (0x8000-byte chunks) since Buffer is not available in
  a real MV3 service worker; verified this also works fine under Node 20's
  global btoa/atob.
- transcribe() picks a filename extension from the mime type
  (webm/m4a/mp3/wav/ogg, default webm) purely for the FormData file name;
  the actual `type` on the Blob/File is always the caller's mime string.

WORKS (`node --test src/bg/` and `node --check` on every file in src/bg/,
both run just now — 56/56 tests pass, all 5 files check clean):
- api.js pure-function tests (no chrome shim): toResponsesInput for string
  content / mixed text+image parts / role mapping (system, user, assistant)
  / garbage input; extractOutputText walking output[].content[], joining
  multiple output_text parts, and both fallbacks (output_text field, then
  '').
- callModel: happy path posts to API.responses with Authorization: Bearer
  <key>, correct model id, max_output_tokens, reasoning.effort 'low', and
  text.format json_object when responseFormat==='json'; task:'side' picks
  MODELS.side; empty/whitespace key -> NO_KEY with zero fetch calls and
  PILL.NO_KEY pushed; 401 -> BAD_KEY, exactly 1 fetch call, PILL.NO_KEY
  pushed, no retry; forced 500 twice -> exactly 2 fetch calls (2nd body has
  model===MODELS.brainFallback), HTTP_ERROR, PILL.RETRYING then
  PILL.UNAVAILABLE pushed in order; 429 retried the same way and can
  succeed on the fallback; an AbortError-shaped throw on both attempts ->
  exactly 2 calls, TIMEOUT, RETRYING then UNAVAILABLE; a non-abort throw on
  both attempts -> NETWORK; a throw-then-success recovers on the fallback
  model; a 400 body containing "image_url" with an image part present ->
  retried once on the SAME model with images stripped (verified the 2nd
  request's input has zero input_image parts) and succeeds; a 400
  mentioning "image" with NO image part present does not retry; a 2xx body
  with no extractable text -> BAD_RESPONSE; malformed/null req never
  throws.
- speech(): posts to API.speech with model MODELS.tts, voice 'coral',
  response_format 'mp3'; decodes the returned bytes correctly (round-tripped
  [1,2,3,4,5] through base64 and back); empty key -> NO_KEY with no fetch;
  401 -> BAD_KEY; other error -> TTS_FAILED; fetch throw -> TTS_FAILED
  (never throws out of speech()).
- transcribe(): posts multipart FormData containing a File under 'file',
  'model' === MODELS.stt, 'response_format' === 'json', Authorization
  header set; returns json.text, or '' if the field is missing; empty key
  -> NO_KEY with no fetch; 401 -> BAD_KEY; other error -> STT_FAILED; fetch
  throw -> STT_FAILED; confirmed the API key never appears anywhere in the
  returned BusResponse (JSON.stringify check).
- service-worker.js router (via a hand-rolled chrome shim matching the one
  specified in the task, installed on globalThis before the dynamic
  import): the onMessage listener is captured at import time and an ASK
  message round-trips through it end-to-end (listener returns true for
  async response, sendResponse callback receives {ok:true,
  data:{text,model}}); handle() called directly gives the same shape;
  forced-500-twice through the full router pushes RETRYING then
  UNAVAILABLE via chrome.tabs.sendMessage to sender.tab.id and returns
  HTTP_ERROR; missing key -> NO_KEY with zero fetch calls and PILL.NO_KEY
  pushed to the tab; 401 -> BAD_KEY, PILL.NO_KEY pushed, no retry; abort ->
  TIMEOUT after exactly 2 calls; row-11 image-strip retry works through the
  full router too; STYLE_ADVICE routes through the identical callModel
  path; SPEAK and TRANSCRIBE build the expected requests through the
  router; SAVE_MEMORY merges profile one level deep across two successive
  calls without clobbering unrelated profile fields, and GET_MEMORY reads
  back the merged result, defaulting cleanly when nothing is stored yet;
  VOICE_START called twice concurrently (Promise.all) creates the
  offscreen document exactly once (confirms the ported
  getContexts-guard + shared in-flight-promise pattern is race-safe under
  Node's microtask ordering) and both calls relay the shim's
  {ok:true,data:{started:true}}; VOICE_STOP relays the offscreen response
  unchanged; an undefined offscreen response is turned into
  fail(OFFSCREEN_FAILED); OPEN_ONBOARDING calls openOptionsPage and returns
  ok(null); unknown type -> UNKNOWN_TYPE; a message with target:'offscreen'
  makes the onMessage listener return false (ignored, per the "not for us"
  rule); onInstalled fires openOptionsPage only on reason:'install', not
  'update'; action.onClicked opens onboarding; the API key never appears in
  a returned BusResponse anywhere in the router.

UNTESTED:
- Real network behavior against the live OpenAI Responses/speech/
  transcriptions endpoints (no network calls were made; everything is
  fetch-stubbed per the task's Node-only test environment).
- Real chrome.offscreen / chrome.tabs / chrome.storage.local behavior inside
  an actual loaded MV3 extension (manifest wiring, permissions, and the
  real offscreen document's own message handling in
  src/voice/offscreen.js are outside src/bg/ and owned by other
  subagents).
- btoa/atob and FormData/File/Blob/AbortController behavior specifically
  inside Chrome's real MV3 service worker runtime (only verified under
  Node 20's implementations, which are spec-compliant and match what
  Chrome's worker global scope provides, but not run inside Chrome itself).
- Timing correctness of the real 12 s AbortController timeout (LIMITS.
  TIMEOUT_MS) — tests exercise the abort/error code paths using a fetchImpl
  that throws an AbortError-shaped error synthetically, not a real timer
  firing after 12 s.
- Interaction with the actual brain/voice/overlay modules' real payloads —
  only the AskRequest/StyleAdviceInput shapes described in shared/types.js
  were exercised.

ASSUMED about other modules:
- brain's askAssistant()/styleAdvice() send AskRequest exactly as typed in
  shared/types.js (messages: ModelMessage[], maxOutputTokens, responseFormat,
  optional task) via MSG.ASK / MSG.STYLE_ADVICE, and are responsible for
  building the ModelMessage[] (including attachedImage as an
  {type:'image', url: dataURL} content part) — bg only translates whatever
  ModelMessage[] it's given.
- voice/offscreen.js replies to {target:'offscreen', type: VOICE_START |
  VOICE_STOP} with a BusResponse-shaped object ({ok:true,
  data:{started:true}} or {ok:true, data:{audioBase64, mime}}), matching
  what the demo's offscreen.js does; bg relays it unchanged and does not
  interpret its contents.
- onboarding writes the API key to chrome.storage.local under
  STORAGE_KEYS.API_KEY as a plain string (no wrapping object).
- No other module reads or writes chrome.storage.local[STORAGE_KEYS.MEMORY]
  or [STORAGE_KEYS.API_KEY] directly with a shape bg wouldn't recognize —
  bg's readMemory()/writeMemory() defend against a missing/malformed value
  by falling back to defaultMemory(), which also covers row 16 (memory
  storage full/corrupt) for the fields bg touches, though the deeper
  pin-eviction/cap logic (rows 16, 17) lives in src/brain/ per the layout
  and was not duplicated here.

NEEDS from other modules / interface change requests: none. The frozen
shared/types.js contract was sufficient to implement and test every DONE
WHEN item without modification.
