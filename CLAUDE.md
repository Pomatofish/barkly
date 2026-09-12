# Project: <NAME> — Instagram AI assistant (Chrome extension)

Hackathon build, 4 hours. Ship > perfect. No new dependencies without asking the lead.
"Posts" = posts, reels and stories. DMs, notes and explore-grid thumbnails are out of scope.
FIRST BUILD = core features only. NO image generation of any kind in the first build.
Stretch features (bottom of file) are NOT built unless the lead explicitly assigns them.

## Existing working demo code — REUSE, do not reinvent
demos/mic/        microphone access from the extension on instagram.com
demos/highlight/  overlay that outlines an element to show the user what to click (stretch use)
Read the relevant demo before writing your module and port its working parts.

## Stack
- Chrome MV3 extension, vanilla JS, no bundler
- Overlay rendered in a Shadow DOM so Instagram CSS never leaks in or out
- ALL network calls happen in the background service worker (src/bg/), never in content scripts
- Models (src/bg/config.js — change IDs only there):
  - brain: gpt-5.6-sol (low reasoning effort, max_output_tokens 150 for voice, 400 for text)
    fallback gpt-5.6-terra
  - side tasks (chips, sentiment tally): gpt-5.6-luna
  - STT: gpt-4o-mini-transcribe   TTS: gpt-4o-mini-tts (voice: coral)
  - NO image generation model

## Core features (first build)
1. Onboarding page on install: choose persona (casual / influencer), grant mic, paste API key
2. Page/post detection: which page type, which post the user is on
3. Push-to-talk voice in, spoken reply out (only when asked by voice)
4. Public/private detection with status pill (green / yellow / red)
5. Read the focused post: caption, alt text, image/video thumbnail, likes, comment count,
   loaded comments, owner username, post time — from the DOM only
6. Floating mascot (🐶 placeholder emoji); tap opens the chat menu; long-press = push-to-talk
7. Speech bubble: when the chat menu is CLOSED, every reply appears in a bubble next to the
   mascot (and is spoken if the question came by voice). When the menu is OPEN, replies appear
   only in the chat log — no bubble. Bubble and chat log show the exact same `reply` string,
   and TTS speaks that same string. One reply, three surfaces, never different text.
8. Chat menu: message log, text input, PTT button, persona toggle, "attach my image" button,
   suggested chips (vary by pageType + persona), status pill, "remembered" panel
9. Dynamic long-term memory (see Memory section)
10. Style advice (text only): user attaches their own photo and/or points at a public post →
    assistant describes the post's visual + caption style and gives concrete steps to make the
    user's photo/caption match it. Attached image is sent as vision INPUT only. No image output.
11. Instagram-native look: rounded, IG gradient on PTT, system font stack, fluid animations
    (mascot bounce on reply, bubble fade/scale, menu slide — CSS transitions, ~200 ms)

## Persona rules (expand into system prompts in src/brain/)
- casual: talks like a friend; plain language; explains what's on screen; curious, short
- influencer: analytical, data-driven; cites the numbers it can see (likes, comment count,
  post time, hashtags); every answer ends with 1–3 concrete recommendations
- Same capabilities for both. Persona changes tone, emphasis and chips only.

## Memory (chrome.storage.local, never leaves the browser except inside the prompt)
memory = {
  profile: { persona, brandVoice: string, niche: string },
  pinned: [ { id, kind: 'post_style'|'fact'|'preference'|'post_ref',
              content: string,            // model-written summary, <= 60 words
              source: { username?, postId?, url? },
              score: number,              // interest score, see below
              savedAt, lastUsedAt } ],    // cap 25; evict lowest score when full
  history: [ { role, text, inputMode, pageType, postId?, ts } ]   // rolling, cap 30
}
Pinning rules (implemented in src/brain/):
- EXPLICIT: user says "remember this / remember this post's style / keep this in mind /
  save this" → model returns memoryUpdate.pin with kind + content; score starts at 10.
- HIGH INTEREST (automatic): the same postId gets >= 3 user messages in a session, OR the user
  asks to compare/reference it later ("like the one earlier") → auto-pin a post_style summary,
  score starts at 5. Tell the user in one clause: "(I'll remember this one)".
- Every time a pinned item is used in a prompt, score += 1 and lastUsedAt updates.
- Prompt assembly: profile + top 8 pinned by score (post_style always included if the current
  post is on the same username) + last 10 history turns + current pageContext.
- "Remembered" panel in the chat menu lists pinned items with a delete button. Deleting is
  permanent. "Forget everything" clears pinned + history, keeps profile.

## Layout — you may ONLY edit files in your assigned folder
src/context/   getPageContext(), pageType detection, SPA nav observer, isPrivate, fixtures/*.html
src/voice/     startListening(), stopListening(), transcribe(), speak()
src/overlay/   mascot, speech bubble, chat menu, chips, status pill, attach, remembered panel, highlight()
src/brain/     askAssistant(), styleAdvice(), system prompts, memory store + pinning, JSON parsing
src/bg/        service worker, message routing, ALL fetches to the model API, config.js
src/onboarding/ onboarding page (persona, mic, API key) — writes to chrome.storage
shared/types.js   ALL interfaces. FROZEN. Request changes in your REPORT; never edit.
reports/       one REPORT per task: reports/<folder>-<n>.md

## Interfaces (frozen — mirror of shared/types.js)
getPageContext() -> Promise<{          // async; also exports describeStatus(ctx) and onNavigate(cb)
  pageType: 'feed'|'post'|'reel'|'story'|'profile'|'composer'|'unknown',
  posts: [{ id, username, caption, altText, likes, commentCount, postedAt,
            comments: string[], isPrivate: boolean|null,
            mediaType: 'image'|'video'|null, mediaUrl: string|null }],
  focusedPostId: string|null,      // open modal > story on screen > post nearest viewport centre
  draftCaption: string|null,       // composer only (stretch)
  url: string
}
askAssistant({ messages, pageContext, memory, persona, inputMode: 'voice'|'text',
               attachedImage?: base64 }) -> {
  reply: string,                   // <= 2 sentences if inputMode === 'voice'; THE single reply string
  highlightTarget: null | 'like_button'|'save_button'|'share_button'|'comment_box'|'caption_box',
  memoryUpdate: null | { pin?: { kind, content, source }, profile?: Partial<profile> }
}
styleAdvice({ pageContext, attachedImage?: base64, memory }) -> { reply: string }   // text only
getMemory() -> memory ; saveMemory(partial) ; pin(item) ; unpin(id) ; forgetAll()
deliverReply({ reply, inputMode, menuOpen }) // overlay: bubble if menu closed, chat log always,
                                             // then speak(reply) if inputMode === 'voice'
highlight(target) / clearHighlight()             // stretch; stub returns immediately
startListening() ; stopListening() -> Blob ; transcribe(blob) -> string ; speak(text) -> Promise
setStatus('green'|'yellow'|'red', message)
getChips({ pageType, persona }) -> string[]      // static table, no model call in first build

Message bus (chrome.runtime.sendMessage), type field:
GET_CONTEXT | ASK | STYLE_ADVICE | SPEAK | TRANSCRIBE | STATUS | HIGHLIGHT | GET_MEMORY | SAVE_MEMORY |
VOICE_START | VOICE_STOP | OPEN_ONBOARDING   (payloads, directions and the offscreen `target` rule: shared/types.js)
Every response is { ok: true, data } or { ok: false, error: { code, message } }.

## Rules
- Every exported function has try/catch and a defined fallback (see failure-modes.md).
- Never click, submit, type into, scroll, or navigate on the user's behalf.
- Never call Instagram endpoints. Read the rendered DOM only. Never auto-load more comments.
- Never read content from a private account (isPrivate === true). If isPrivate === null,
  read caption only and say the account is unconfirmed.
- No image generation or editing anywhere. Attached images are vision input only.
- Bubble text, chat-log text and spoken text are always the same `reply` string.
- Prefer semantic selectors (article, [role], [aria-label], img[alt], video) over class names.
- Develop against src/context/fixtures/*.html first, live instagram.com second.
- Secrets never enter the repo. API key lives in chrome.storage via the onboarding page.
- Voice replies <= 2 sentences. Text replies <= 120 words.
- Finish EVERY task with a REPORT written to reports/<folder>-<n>.md.

## Stretch (NOT in first build — lead assigns explicitly)
- Highlight buttons when the user asks "how do I…" (demo exists in demos/highlight/)
- Organic cursor animation
- Draft-aware mode on the composer page
- Automatic comment-section summary chip
- Image generation for style transfer

## REPORT format
CHANGED: <files>
WORKS: <what you verified and exactly how>
UNTESTED: <what you did not verify>
ASSUMED about other modules: <list>
NEEDS from other modules / interface change requests: <list, or "none">
