CHANGED:
- src/onboarding/index.html   (rewritten — real 3-step flow + summary view, all markup lives inside
  `<template id="onboardTemplate">` so production and the test page always clone the exact same DOM)
- src/onboarding/onboarding.css (rewritten — IG gradient, #dbdbdb borders, 18-20px radii, #262626/#737373
  text, ~200ms transitions, prefers-reduced-motion override)
- src/onboarding/onboarding.js (rewritten — exports `initOnboarding({ chrome, doc })`; pure logic, no
  chrome.*/DOM access at module top level)
- src/onboarding/boot.js (NEW — the only file that touches real globals: clones the template into
  #mount, then calls `initOnboarding({ chrome, doc: document })`; loaded by index.html as
  `<script type="module" src="boot.js">`, keeping onboarding.js importable by a plain test page)
- src/onboarding/test.html (NEW — fetches index.html, clones its `<template>` fresh per scenario,
  builds a chrome shim, drives the flow programmatically, writes PASS/FAIL lines + ALL PASS/SOME FAILED
  into `<pre id="out">`)
- reports/onboarding-1.md (this file)

Nothing outside src/onboarding/ (and this report) was touched. No new dependencies. No git.

WORKS (verified, exactly how):

1. `node --check` passes on onboarding.js and boot.js.

2. Served on port 8126 (`node tools/serve.js 8126`, backgrounded properly this time — see the
   environment note below) and driven with real headless Chrome
   (`--headless=new --disable-gpu --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
   --user-data-dir=<fresh dir>`), with the fake mic auto-granted. All 26 assertions passed, ending in
   `ALL PASS`:
   ```
   PASS: step 1 visible on load
   PASS: Influencer card selected
   PASS: Casual card deselected
   PASS: Next advances to step 2
   PASS: mic grant shows the granted state — Microphone granted.
   PASS: Next advances to step 3
   PASS: rejected key shows the red "check it and try again" message
   PASS: rejected key result is styled red (err class)
   PASS: working key shows "Key works"
   PASS: working key result is styled ok
   PASS: apiKey saved to storage — sk-test-1234567890
   PASS: onboarded flag set true
   PASS: SAVE_MEMORY carried { memory: { profile: { persona: "influencer" } } }
   PASS: close-tab fallback message shown after Done (window did not actually close)
   PASS: window.close() was actually invoked by Done — 1
   PASS: NotAllowedError shows the denied message with reset instructions
   PASS: Skip for now advances to step 3
   PASS: Skip path still reaches Done (onboarded true)
   PASS: Skip path still saves the typed key
   PASS: NotFoundError shows "No microphone found"
   PASS: already-onboarded: summary view shown (step flow hidden)
   PASS: summary shows persona Influencer
   PASS: summary shows API key present — Saved
   PASS: Change (persona) leaves the stepped flow on step 1
   PASS: Change pre-selects the existing persona (influencer)
   ALL PASS
   ```
   This covers every item in the task's DONE WHEN list: shim storage ends with
   `apiKey === typedKey`, `onboarded === true`, and a recorded SAVE_MEMORY message carrying
   `{ memory: { profile: { persona: 'influencer' } } }`; the mic step actually calls getUserMedia and
   shows the granted state; a second run with getUserMedia stubbed to reject NotAllowedError shows the
   denied message + reset instructions, and the Skip path still reaches Done (with the typed key
   saved); a third mic run covers NotFoundError → "No microphone found"; Test key renders "Key works"
   for `{ok:true}` and the red rejection text for `{ok:false, error:{code:'BAD_KEY'}}`; re-running
   `initOnboarding` with `onboarded` already true renders the summary view with persona "influencer"
   and the key marked present, and its "Change" button on the persona row drops back into the step
   flow on step 1 with that persona pre-selected.

3. Environment finding (worth flagging for other subagents): `--dump-dom` with
   `--virtual-time-budget` reliably hangs getUserMedia forever on this machine, exactly as
   reports/voice-1.md documented — confirmed independently with a raw getUserMedia probe page before
   finding that report. Verification here reuses the same style of fix: a small dependency-free CDP
   driver (Node's built-in net/crypto/http only) that launches headless Chrome with the fake-media
   flags and a fresh --user-data-dir, opens a target via `Target.createTarget` +
   `Target.attachToTarget` (flatten) over the browser-level devtools websocket (hand-rolled RFC6455
   client), and polls `document.getElementById('out').textContent` via `Runtime.evaluate` every 300ms
   in real time (no virtual clock) until ALL PASS/SOME FAILED or a 25s timeout. Kept only in the
   scratchpad, not in src/onboarding/ (it is a verification tool, not part of the deliverable).
   Separately: partway through, `tools/serve.js 8126` itself died (started with shell `(cmd &)`
   instead of the tool's own `run_in_background`), which looked identical to a Chrome navigation
   problem (`net::ERR_CONNECTION_REFUSED` on every load) until `Network.loadingFailed` events were
   inspected — restarting the server with `run_in_background: true` fixed it immediately. Worth
   remembering: background helper servers must be started via the tool's background mechanism, not a
   backgrounded shell job, or they can be reaped between tool calls.

4. Manual read-through against every literal spec point: persona card copy matches the task text
   verbatim; mic messages match demos/mic-tts-test-insta/app.js's `requestMicPermission` (NotAllowedError
   → chrome://settings/content/microphone + "remove this extension from the block list" + reload
   instructions; NotFoundError → "No microphone found"; every track released immediately on success);
   key step has the exact helper text and placeholder from the task, a show/hide toggle, and a
   permanent red reminder line ("Grammy can't answer anything until a valid key is saved here.") per
   the FAILURE BEHAVIOUR section for row 13; Test key saves the key first, then sends exactly
   `{ messages:[{role:'user', content:'Reply with the single word OK.'}], maxOutputTokens:5,
   responseFormat:'text' }` via MSG.ASK; Done saves key → persona (via SAVE_MEMORY, with a direct
   merged-storage fallback if the bus responds `{ok:false}`) → `ONBOARDED:true`, then calls
   `window.close()` and shows the "you can close this tab" fallback if it is still open 400ms later;
   gradient is the exact `linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)` string, used
   on the primary button and the selected persona card's border; `@media (prefers-reduced-motion:
   reduce)` collapses all transition/animation durations to ~0.

UNTESTED:
- Loading the actual unpacked extension in Chrome and opening this page as the real
  `options_page`/via `chrome.runtime.openOptionsPage()` (bg's job) — verified only through the test
  harness's chrome shim and boot.js's code path (which is trivial: clone template, call
  initOnboarding with the real `chrome`/`document`). boot.js itself was not exercised by an automated
  test, only `node --check` and a read-through, since it deliberately contains the one piece of
  "real globals" wiring that can't run outside an actual extension page.
  chrome.storage.local.get/set as promise-returning (no callback) matches the existing Phase-1 stub's
  own convention and current Chrome's support for it, but was only exercised via the shim.
  The `navigator.permissions.query({name:'microphone'})` calls in the summary view ran for real in
  headless Chrome (no throw), but their exact state strings (`granted`/`denied`/`prompt`) were not
  cross-checked against a real OS-level mic permission change.
  Test key hitting a real OpenAI key / real bg fetch — only the shimmed ASK responses were exercised.
- Visual/animation polish (gradient rendering, 200ms slide-in, card hover, dot fill) was reviewed by
  reading the CSS, not screenshotted.
- The "on load pre-fill... key masked" path when NOT yet onboarded but a key already exists in storage
  (e.g., user closed the tab mid-flow and reopened) — the code path exists (`els.apiKeyInput.value =
  existingKey` before showing the step flow) but has no dedicated scenario in test.html.

ASSUMED about other modules:
- bg reads the API key from `chrome.storage.local[STORAGE_KEYS.API_KEY]` at request time (never from
  the MSG.ASK payload), so saving the key before sending the Test-key ASK message is what makes the
  test meaningful — shared/types.js documents the bg key lookup but I did not read src/bg/ itself.
- bg's MSG.GET_MEMORY / MSG.SAVE_MEMORY behave exactly as described in shared/types.js (SAVE_MEMORY
  shallow-merges, profile merged one level deeper) — onboarding.js's fallback path (direct storage
  merge when the bus responds `{ok:false}`) only fires if bg is genuinely unreachable, matching "the
  service worker was not listening yet" scenarios called out in the interface doc.
  manifest.json's `options_page` and the background's `chrome.runtime.openOptionsPage()` wiring (both
  outside my folder) are assumed already correct, since I was told not to touch them and the task
  states bg already opens this page on install and from the gear.

NEEDS from other modules / interface change requests: none. shared/types.js's STORAGE_KEYS, MSG, ERR
and `defaultMemory()` were sufficient as written.
