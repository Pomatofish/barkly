# Orchestrator prompt

Paste everything below the line into ONE Claude Code session at 0:00. Only the lead talks to it.
Before starting: demos/ contains the two working demos (mic, highlight); src/context/fixtures/ contains saved
HTML for post, reel, story, private-profile and composer pages.

---

You are the orchestrator for a 4-hour hackathon build. Read CLAUDE.md, failure-modes.md and
skim every file under demos/ now.
You do NOT write feature code yourself except in Phase 1 and Phase 4. You plan, delegate to
subagents, integrate, and verify. Ask me only when a decision genuinely blocks you; otherwise
decide, note the decision in your status, and continue. Build CORE features only; do not assign
any stretch feature unless I say so.

## PHASE 1 — Scaffold (yourself, ~10 min)
Create:
- shared/types.js with JSDoc typedefs for every interface in CLAUDE.md
- manifest.json (MV3; content script on *://*.instagram.com/*; background service worker;
  permissions: storage, activeTab; host_permissions: https://api.openai.com/*;
  options_page = onboarding; open onboarding on install)
- src/bg/config.js with the model IDs from CLAUDE.md
- stubs for every interface in every folder returning realistic fake data
  (getPageContext returns a fake public post with caption, 5 comments and an image URL;
  getMemory returns a default profile)
- a hello mascot (🐶 in a Shadow DOM) on instagram.com that opens an empty panel on click
Commit "scaffold". Print the file tree. STOP and wait for me to confirm the mascot loads.

## PHASE 2 — Fan out (parallel)
Spawn exactly 6 subagents IN PARALLEL: context, voice, overlay, brain, bg, onboarding.
No subagent may add image generation; reject any report that does.
Use the strongest model for context, brain and overlay; a fast model for voice, bg, onboarding.

Each subagent prompt MUST contain, verbatim:
1. the full text of CLAUDE.md, failure-modes.md and shared/types.js
2. "You own ONLY src/<folder>/. Do not edit any other file. Other modules are stubs; call
   them through the interface in shared/types.js. Reuse the code in demos/ where it applies."
3. TASK (one paragraph), DONE WHEN (an observable check I can run myself),
   FAILURE BEHAVIOUR (the rows of failure-modes.md that belong to this folder), OUT OF SCOPE
4. "Work in small steps and verify after each. Finish with a REPORT in the CLAUDE.md format,
   written to reports/<folder>-1.md."

Task specs:
- context (no demo exists — build from scratch, fixtures first): pageType detection from URL + DOM landmarks incl. story;
  SPA navigation observer (patch pushState + MutationObserver on title); getPageContext()
  passing on every file in src/context/fixtures/; focusedPostId = open modal > story on screen
  > post nearest viewport centre; media thumbnail URL + type; likes, commentCount, postedAt,
  username; isPrivate from profile page cached per username, null if unknown; loaded comments
  only. Failure rows 1–6, 11.
  DONE WHEN: a test script prints correct caption/username/comment count/mediaType for each
  fixture and isPrivate true for the private-profile fixture.
- voice (port demos/mic/): MediaRecorder push-to-talk exposed as startListening/stopListening
  (overlay wires the mascot long-press and Space key); transcribe() and speak() send
  TRANSCRIBE / SPEAK to bg and play returned audio; every error falls back to text.
  Failure rows 7, 8, 12.
  DONE WHEN: start/stop returns a Blob; with a fake bg response transcribe returns the string
  and speak plays audio; denied mic resolves to the row-7 fallback without throwing.
- overlay: Shadow DOM mascot (🐶 placeholder, draggable, bottom-right); tap opens chat menu,
  long-press = PTT (calls voice); hold Space when no IG input focused = PTT; deliverReply():
  if menu closed show a speech bubble beside the mascot (fade+scale in, auto-dismiss after
  8 s or on tap, tap opens menu), always append to chat log, then call speak() if inputMode is
  voice — bubble, log and speech use the identical reply string; mascot bounce on reply;
  menu slide in/out (~200 ms CSS transitions); chat menu with streaming message log, text
  input, PTT button with IG gradient, persona toggle, status pill (setStatus), suggested chips
  from getChips(), "attach my image" button (file picker, client-side downscale to 1024 px,
  preview thumbnail), "Remembered" panel listing pinned items with delete + "forget everything";
  IG-native styling. highlight()/clearHighlight() exist but are stubs in this build.
  Failure rows 15, 18, 19.
  DONE WHEN: with stub data: reply with menu closed shows bubble then log; reply with menu
  open shows log only; chips change with pageType and persona; attaching an image shows its
  preview and passes base64 to ASK; Remembered panel lists and deletes stub pins.
- brain: two system prompts per CLAUDE.md persona rules; memory store per CLAUDE.md Memory
  section (profile / pinned with scores / rolling history cap 30; pin, unpin, forgetAll,
  eviction, score bump on use); pinning logic: explicit "remember…" requests come back as
  memoryUpdate.pin (score 10), high-interest auto-pin when the same postId gets >= 3 user
  messages or is referenced later (score 5, reply adds "(I'll remember this one)");
  buildMessages(pageContext, memory, persona, inputMode, attachedImage) with profile + top 8
  pinned + last 10 history + focused post in full (media as image input when available) + up
  to 5 other posts as one-line summaries; strict JSON {reply, highlightTarget, memoryUpdate}
  with plain-text fallback; voice replies <= 2 sentences; getChips static table; styleAdvice()
  = text-only description of the focused post's visual + caption style and concrete steps to
  match it with the user's attached photo/caption (vision input only, NO image output).
  Failure rows 10, 14, 16, 17.
  DONE WHEN: askAssistant() against 6 hand-written pageContexts (incl. one story, one private,
  one with attached image, one "remember this post's style") returns valid JSON every time;
  the "remember" case yields a pin that persists across a second call; 3 messages on one
  postId auto-pins; influencer replies contain at least one number from the context.
- bg: service worker routing every message type; all fetches here; API key from
  chrome.storage; 12 s AbortController timeout + one retry; 401 →
  row 13; every response { ok, data } or { ok:false, error:{code,message} }. Failure rows 9, 13.
  DONE WHEN: a test message round-trips; a forced 500 returns a structured error; a missing
  key returns code NO_KEY.
- onboarding: extension page opened on install and from the menu: step 1 persona picker
  with one-line description of each, step 2 mic permission request (port demos/mic/ permission
  part), step 3 API key field; saves to chrome.storage; "Done" closes. IG-native styling.
  DONE WHEN: completing the flow leaves persona + key in storage and mic permission granted.

## PHASE 3 — Collect and repair
When all 6 return, read every reports/*.md. For each "NEEDS from other modules" or interface
change request: reject (tell the requester to adapt) or accept (edit shared/types.js yourself,
update CLAUDE.md, and re-spawn ONLY the affected subagents with a targeted fix task writing
reports/<folder>-2.md). Never let a subagent edit shared/. Print a 5-line status.

## PHASE 4 — Integrate and verify (yourself)
Replace stubs with real implementations. Run on fixtures/post.html:
mascot visible, menu closed → long-press → voice "what's this post about?" → bubble appears,
same text spoken → tap bubble → menu opens with the same text in the log, green pill →
persona to influencer → chip "how could this do better?" → reply with numbers →
type "remember this post's style" → pin shows in Remembered panel → reload page → pin still
there → attach image → "how do I make my photo match this style?" → text advice only.
Then: private-profile fixture → red pill and refusal. Mic denied → text fallback.
Forced model 500 → yellow then red then canned menu. Missing key → row 13.
Fix seams only. If a module is broken beyond a seam fix, re-spawn that folder's subagent with
the exact failing check as DONE WHEN. Commit "integrated". Print: works / doesn't / assumed.
STOP and wait. Only after I confirm may stretch features be assigned, one at a time, each as
its own subagent with its own DONE WHEN.

## PHASE 5 — Deliverables (parallel, after I confirm)
Spawn 3 subagents:
- README.md: title, one-paragraph description (what / who / why the context matters), the two
  personas, "Why inside Instagram beats screenshot-into-ChatGPT" section, privacy & ToS rules
  (DOM-only, public-only, no actions, user's own images as input only, no image generation, local memory with user-visible delete), rubric→code table
  (5 rows), the failure-modes table, setup steps, AI-voice disclosure, demos/ credit.
- DEMO_SCRIPT.md: 2-minute video script — 10 s problem / 60 s golden path (voice question,
  persona switch, "remember this style", text style advice) / 20 s failure case (private account) / 20 s architecture.
  Exact lines to say, exact clicks.
- SOCIAL_POST.md: one post <= 280 chars + one LinkedIn variant, placeholders for sponsor tags,
  one line describing the GIF to attach.
Collect, commit "deliverables". Print final status.

Throughout: never spawn more than 6 subagents at once; after each phase print a 5-line status;
never hand-edit a subagent's folder — re-spawn with a tighter DONE WHEN instead.
