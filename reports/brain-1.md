# REPORT — brain-1 (src/brain/)

CHANGED:
- src/brain/index.js        (stub replaced) askAssistant(), styleAdvice(), canned replies, session
                            auto-pin, history, re-exports of the whole brain surface
- src/brain/memory.js       (new) store at chrome.storage.local['memory'] + in-memory fallback,
                            getMemory/saveMemory/pin/unpin/forgetAll/appendHistory/bumpPinned,
                            rows 16 and 17
- src/brain/prompts.js      (new) shared core + casual / influencer layers + style-advice prompt
- src/brain/build.js        (new) buildAskRequest(), buildStyleRequest(), context block, memory block
- src/brain/parse.js        (new) tolerant JSON parsing (row 10) + voice/text length clamps
- src/brain/chips.js        (new) static chip table
- src/brain/fakes.js        (new, test-only) fake chrome + the six hand-written pageContexts.
                            Nothing in src/ imports it; the filename does not match node --test's
                            test-file patterns so it never runs as a test.
- src/brain/brain.test.js   (new) 29 tests
- src/brain/memory.test.js  (new) 17 tests
- reports/brain-1.md        (this file)

No file outside src/brain/ was touched. No dependencies added. No git commands run.

WORKS (verified by `node --test src/brain/` → 46 tests, 46 pass, 0 fail; `node --check` clean on
all 9 files; plus a no-`chrome`-global smoke run):
- askAssistant() returns a valid AskResult (non-empty string reply, highlightTarget null or in
  HIGHLIGHT_TARGETS, memoryUpdate null or object, notice null or string) for all six hand-written
  contexts: public post (12483 likes, 5 comments), textless story, private post, privacy-unknown
  post, public post + attached image, "remember this post's style" turn. It also survives
  `askAssistant(undefined)` and a fully garbage input object.
- Explicit pin: canned model JSON with memoryUpdate.pin → getMemory() shows one pinned item,
  kind post_style, score 10, source.postId/username filled from the focused post, id + timestamps set.
- Auto-pin: three user messages on one postId → a post_style pin with score 5 written from the
  context (username, mediaType, caption gist, hashtags, likes/comments) and the reply ends with
  "(I'll remember this one)". Fires exactly once per postId per session (5 messages → 1 pin),
  never for a private owner, never after a failed turn. "is this like the one earlier?" triggers it
  on the first message via the back-reference regex.
- Row 10: non-JSON model text → the whole trimmed text becomes `reply`, highlightTarget and
  memoryUpdate null. ```json fences and JSON embedded in prose still parse; an out-of-range
  highlightTarget ("rocket_button") and a non-object memoryUpdate are dropped to null.
- Influencer prompt: the recorded AskRequest contains "12483", "312", "26 hours old" and
  "hashtagCount"; the system prompt contains "cite at least one concrete number" and
  "numbered recommendations"; responseFormat 'json', task 'brain', maxOutputTokens 400.
- Voice: a 4-sentence model reply is cut to exactly 2 sentences, maxOutputTokens 150, and the
  system prompt carries the "at most 2 sentences, no lists/markdown" rule. Text: a 200-word reply is
  cut to 120 words at a word boundary + "…".
- Row 1: the private context's request contains no caption, alt text, comment text (marker
  "SECRETWORD" absent) and no media URL; it does carry `isPrivate: true` and the refusal
  instruction, and the system prompt says to refuse content questions in one friendly sentence.
- Row 2: privacy-unknown sends the caption only — comments, alt text and media URL are withheld and
  the block says "PRIVACY UNCONFIRMED".
- Rows 4/5/6: "comments: none loaded … based on the caption only" and "caption: null (selector
  miss…)" reach the prompt. Row 3: "No page could be identified" for pageType unknown.
- Row 13: NO_KEY and BAD_KEY → "Add your API key in settings to start chatting — open the 🐶 menu
  and tap the gear." Row 9: HTTP_ERROR / TIMEOUT / NETWORK / BAD_RESPONSE → the what-still-works
  canned menu.
- Row 14: styleAdvice with an unknown page and no photo → needsInput true and zero bus calls; a
  private post with no photo counts the same way.
- styleAdvice with an attached image: MSG.STYLE_ADVICE, responseFormat 'text', the data URL is an
  image part on the LAST user message (and the last image part in it), and the system prompt
  forbids producing images ("NEVER GENERATE, EDIT OR OFFER AN IMAGE", "vision INPUT only").
  Reply word-capped at 160. Bus failure → the same canned replies as askAssistant.
- Memory: saveMemory merges shallowly with profile one level deeper and rejects an unknown persona;
  pin() fills id/savedAt/lastUsedAt/score and dedupes on kind+source.postId or identical content
  (score += 1 instead of a duplicate); content over 60 words is clamped; row 17 at 25 pinned evicts
  the lowest-score item and keeps the new one (verified after a re-read); unpin persists; forgetAll
  clears pinned+history and keeps the profile; history rolls at 30.
- Row 16: a corrupt stored string, an invalid stored shape, a storage read error and a quota error
  on write all reset pinned+history (keeping a readable profile), persist, never throw, and queue
  "Your saved memories were reset because the store was corrupt" — returned in the NEXT
  askAssistant()'s `notice` and null on the call after that. askAssistant still answers normally
  while every write is failing.
- Prompt assembly: [system, user(context parts + media image part + memory part), …last 10 session
  turns]; the attached image rides on the last user turn; every post_style pin whose
  source.username matches the focused post's owner is forced into the memory block even when nine
  higher-scoring pins exist; each included pin gets score += 1 and a fresh lastUsedAt, persisted.
- getChips: static table by pageType × persona, GENERIC_CHIPS for an unknown page, "Paste the
  caption" prepended when the focused caption is null (row 4), "Match this style" appended for a
  non-private focused post and never for a private one, null-safe.
- Node-safety: every module imports with no `chrome` global at all (verified in a separate process)
  — memory falls back to an in-memory object and request() failure yields the row-9 canned reply.

UNTESTED:
- Anything against the live model or the real bg service worker: only `request()` through a fake
  chrome.runtime.sendMessage was exercised. The AskRequest wire shape is my reading of
  shared/types.js §6; bg's translation to the provider format is unverified end to end.
- Real chrome.storage.local (quota behaviour, the callback-vs-promise branch of the storage
  adapter — the fake is promise-based; the callback path is written but never executed).
- Prompt QUALITY: no model has ever answered these prompts. Whether gpt-5.6-sol actually returns
  strict JSON, honours the 2-sentence voice rule, or reliably emits memoryUpdate.pin on
  "remember this" is unknown. The parser is deliberately tolerant because of that.
- Live Instagram contexts: I used six hand-written PageContexts, not src/context/fixtures/*.html.
- The overlay integration (deliverReply, Remembered panel refresh after memoryUpdate).

ASSUMED about other modules:
- bg answers MSG.ASK / MSG.STYLE_ADVICE with `{ ok:true, data:{ text, model } }` and maps
  BusError.code to ERR.* exactly as listed; it pushes PILL.RETRYING / UNAVAILABLE / NO_KEY itself,
  so the brain sets no status.
- The overlay calls askAssistant() with `messages` = the CURRENT session chat (last element = the
  user turn being answered), passes `memory` from getMemory() (or null — the brain re-reads the
  store if it is missing or invalid), and re-reads getMemory() after every call to refresh the
  Remembered panel. It renders `notice` in the chat log and never speaks it.
- The overlay downscales an attached photo to a `data:image/jpeg` URL ≤ 1024 px (row 15) before
  handing it over; the brain passes the string through untouched.
- src/context returns Posts exactly as typed, with isPrivate === null meaning "never confirmed",
  comments already loaded only, and mediaUrl a plain https URL that bg's provider can fetch (row 11
  is bg's retry-without-images).
- Nothing else writes chrome.storage.local['memory'] except through SAVE_MEMORY → brain (the
  onboarding persona write must go through that path, or it will be overwritten).

NEEDS from other modules / interface change requests: none (no change to shared/types.js).
Two notes for the lead, decided without asking:
1. `getChips` accepts the PageContext either as `pageContext` on its argument object or as a second
   positional argument — both spellings work, so the overlay can use whichever it already wrote.
2. Row 2 (privacy unknown) withholds comments, alt text and the media URL but still sends the
   visible like/comment counts, so the influencer persona has a number to cite. If the lead wants
   those withheld too it is one line in build.js (`focusedPostLines`).
3. Extra exports beyond the contract, for the overlay and for tests: `CANNED_NO_KEY`,
   `CANNED_UNAVAILABLE`, `AUTO_PIN_CLAUSE`, `buildAskRequest`, `buildStyleRequest`,
   `buildContextBlock`, `buildMemoryBlock`, `focusedPostOf`, `parseModelReply`, `clampReply`,
   `buildSystemPrompt`, `buildStyleSystemPrompt`, `_resetSession()` (test helper).
   `focusedPostOf` is a local copy of context's `focusedPost()` so the brain never imports another
   folder's module (keeps `node --test` independent of in-flight work in src/context/).
4. No image generation anywhere: both system prompts explicitly forbid producing, editing or
   offering an image, and the only image data that moves is an inbound ContentPart.
