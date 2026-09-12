# Grammy — a voice-first AI assistant that lives inside Instagram

Grammy is a Chrome extension that puts a small 🐶 mascot on instagram.com. Hold it and ask a question
out loud, or tap it and type: Grammy reads the post you are looking at (caption, alt text, likes,
comment count, the comments already on screen, who posted it and when) and answers in context. It is
built for two kinds of people: casual users who want to understand what is on their screen, and
creators who want a quick, data-backed read on why a post works and what to do next. The context is
the whole point: instead of describing a post to a chatbot, you ask about the thing in front of you.

## Two personas

| Persona | Voice | What it does with the numbers |
|---|---|---|
| **Casual** | Talks like a friend, plain language, short | Explains what is on screen and what people are saying |
| **Influencer** | Analytical, data-driven | Cites the likes, comment count, post age and hashtags it can see, and ends every answer with 1–3 concrete recommendations |

Same capabilities for both; the persona changes tone, emphasis and the suggested chips. Switch it in the
chat menu or on the onboarding page.

## Why inside Instagram beats screenshot-into-ChatGPT

- **No copy-paste.** Grammy reads the rendered page itself, so the caption, comments and counts arrive intact, not as a lossy screenshot.
- **It knows which post you mean.** Open modal, story on screen, or the post nearest the middle of the viewport: that is the focused post.
- **Voice in, voice out.** Hold the mascot, ask, and hear a two-sentence answer while you keep scrolling.
- **It remembers.** Say "remember this post's style" and Grammy pins a short summary; later questions use it. Everything stays in your browser and you can delete any item.
- **It knows what it must not read.** Private accounts turn the pill red and Grammy refuses content questions about them.

## Privacy and Instagram ToS rules

- Reads only what Instagram already rendered or loaded in your tab. Grammy sends no requests to Instagram, never auto-loads more comments, and never scrolls, clicks, likes, comments, or posts on your behalf.
- Public content only. A private account (lock icon or "This account is private") is never read; if it cannot confirm an account is public, Grammy uses the caption only and says so.
- Your own images are vision **input** only. Grammy describes a post's style and tells you how to match it in text. There is no image generation or editing anywhere.
- Memory is local: `chrome.storage.local`, never synced, never sent anywhere except inside the prompt to your own OpenAI key. The "Remembered" panel lists every pinned item with a delete button, and "Forget everything" clears pins and history.
- Your API key lives in `chrome.storage.local` and is only ever sent to `api.openai.com` from the extension's background worker.

## Rubric → code

| What judges look for | Where it lives |
|---|---|
| Context awareness (reads the actual post) | `src/context/` — `getPageContext()`, page-type detection, focused-post choice, per-username privacy cache |
| Voice-first interaction | `src/voice/` (offscreen recorder, STT/TTS round trip) + `src/overlay/ptt.js` (long-press and Space push-to-talk) |
| Personalisation (personas + memory) | `src/brain/prompts.js` (two system prompts), `src/brain/memory.js` (pins, scores, eviction, history) |
| Safety and failure handling | `failure-modes.md` rows 1–19, surfaced through the status pill (`shared/types.js` → `PILL`) |
| Instagram-native UX | `src/overlay/` — Shadow DOM mascot, speech bubble, chat menu, IG gradient, 200 ms transitions |

## Failure checks

| # | Failure | Detected by | Pill | Fallback |
|---|---------|-------------|------|----------|
| 1 | Private account | context: profile shows "This account is private" / lock icon; cached per username | red "Private account — not reading" | Assistant refuses content questions, still answers general ones |
| 2 | Privacy unknown | context: post seen but owner profile never visited (isPrivate === null) | yellow "Can't confirm this account is public" | Caption only, no comments/media; assistant says it's unconfirmed |
| 3 | Unknown page type | context: URL and DOM match nothing | yellow "Not sure what page this is" | Generic chips; assistant works from user text only |
| 4 | Selector miss (no caption) | context: caption null on post/reel/story | yellow "Can't read this post" | Chip "Paste the caption" → text input |
| 5 | No comments loaded | context: comments.length === 0 | yellow "Caption only, no comments" | Assistant says "based on caption only" |
| 6 | Story with no text | context: pageType story, caption and altText both null | yellow "Story has no text I can read" | Send media thumbnail only if available; else ask user to describe it |
| 7 | Mic denied / unavailable | voice: getUserMedia rejects | yellow "Mic off — type instead" | PTT hidden, text input focused |
| 8 | STT error / empty transcript (< 3 words) | voice: fetch !ok or short text | yellow "Didn't catch that" | Re-arm PTT; show text input |
| 9 | Model timeout (> 12 s) or HTTP error | bg: AbortController + status | yellow "Assistant slow — retrying" then red "Assistant unavailable" | One retry; then canned menu of what still works |
| 10 | Malformed JSON from model | brain: JSON.parse fails | (none) | Whole text becomes `reply`; highlightTarget and memoryUpdate null |
| 11 | Media fetch blocked / no media | context: mediaUrl null or fetch fails | (none) | Send caption + altText only |
| 12 | TTS error | voice: fetch !ok | (none) | Text reply shown silently |
| 13 | No API key / invalid key | bg: 401 or empty key | red "Add your API key in settings" | Link to onboarding page |
| 14 | Style advice: no post in focus and no attached image | brain: nothing to describe | (none) | Reply "Open a post or attach a photo of yours first" + attach button pulses |
| 15 | Attached image too large (> 4 MB) | overlay: file size | (none) | Downscale client-side to 1024 px before sending |
| 16 | Memory storage full / corrupt | brain: parse or quota error | (none) | Reset pinned + history to empty, keep profile; tell user once |
| 17 | Pinned store full (25) | brain: on pin() | (none) | Evict lowest-score item, never the one just pinned |
| 18 | Bubble would overflow viewport | overlay: bubble bounds check | (none) | Flip bubble to other side of mascot; if still too long, truncate with "…" and open menu on tap |
| 19 | TTS finishes before bubble shown / bubble shown before TTS | overlay: deliverReply ordering | (none) | Bubble and chat log render first, then speak(); never speak a different string |

## Setup

1. `chrome://extensions` → Developer mode → Load unpacked → pick this folder. The onboarding page opens.
2. Pick a persona, grant the microphone, paste your OpenAI API key and press "Test key", then Done.
3. Open instagram.com. Tap 🐶 to chat, hold it (or hold Space) to talk.

Tests: `node --test src/` (context, brain, bg). Fixture demo without Instagram: `node tools/serve.js`, then open
`http://localhost:8123/lena.explores/` and `http://localhost:8123/p/C9xY2kLpQ7a/`. End-to-end in headless Edge:
`CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" node tools/e2e.js` (add `GRAMMY_TEST_KEY=sk-…` for the real model).
Model ids live only in `src/bg/config.js`. The `http://localhost/*` entries in `manifest.json` exist for the fixture demo; remove them for a release build.

## AI voice disclosure

Grammy's spoken replies are synthetic speech generated by OpenAI's text-to-speech model (`gpt-4o-mini-tts`, voice "coral").
Your speech is transcribed by `gpt-4o-mini-transcribe`. Audio is recorded only while you hold the mascot or the Space key.

## Credits

Built on three feasibility demos in `demos/`: `mic-tts-test-insta` (microphone from an extension on instagram.com via an
offscreen document), `grammy_overlay_Test` (Shadow DOM overlay, IG styling, bubble placement, button highlighting) and
`fetch` (passive capture of the post data Instagram already loaded). Mascot 🐶 is a placeholder emoji.
