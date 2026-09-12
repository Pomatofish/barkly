CHANGED:
- src/voice/recorder.js (new) — the actual MediaRecorder logic, meant to run inside the
  offscreen document. Exports startRecording()/stopRecording() per the task's contract
  (plain {ok:true}/{ok:false,error} shapes, not the bus ok()/fail() envelope — offscreen.js
  does that translation). getUserMedia({audio:true}); MediaRecorder with
  'audio/webm;codecs=opus' when MediaRecorder.isTypeSupported() says so, else the browser
  default (mimeType omitted from the constructor options). err.name mapping:
  NotAllowedError/SecurityError -> ERR.MIC_DENIED; NotFoundError/NotReadableError/no
  MediaRecorder -> ERR.MIC_UNAVAILABLE. Guards: a `starting` flag plus a `recorder.state ===
  'recording'` check make startRecording() idempotent against overlapping/double calls; a
  stop with no active recorder (or an already-inactive one) fails with
  ERR.MIC_UNAVAILABLE/'not recording' instead of throwing. stopRecording() calls
  requestData() then stop(), awaits the 'stop' event (fires after the final dataavailable),
  assembles the Blob, base64-encodes it (FileReader.readAsDataURL, sliced after the comma;
  arrayBuffer+chunked-btoa fallback if FileReader is ever unavailable), and always releases
  every track (stream.getTracks().forEach(t=>t.stop())) whether it succeeded or threw — the
  demo's "release the track immediately" pattern, ported to the record/stop lifecycle since
  the demo itself never used MediaRecorder (see ASSUMED).
- src/voice/offscreen.js (rewritten from the Phase-1 stub) — imports recorder.js, listens on
  chrome.runtime.onMessage for {target:'offscreen', type: MSG.VOICE_START|MSG.VOICE_STOP},
  ignores everything else, returns true and answers asynchronously. Wraps recorder.js's
  results into the bus envelope: VOICE_START -> ok({started:true}) on success; VOICE_STOP ->
  ok({audioBase64, mime}) on success. On failure it forwards the recorder's own error code/
  message (MIC_DENIED/MIC_UNAVAILABLE) via fail(), only substituting ERR.OFFSCREEN_FAILED for
  a genuine thrown exception in the handler itself or an unrecognised message type
  (ERR.UNKNOWN_TYPE).
- src/voice/index.js (rewritten from the Phase-1 stub) — content-script API.
  startListening() -> request(MSG.VOICE_START) -> {ok:true} or {ok:false,error} passed through
  unchanged (so MIC_DENIED/MIC_UNAVAILABLE from recorder.js survive all the way to the
  overlay); never throws. stopListening() -> request(MSG.VOICE_STOP) -> base64 decoded to a
  Uint8Array -> new Blob([bytes], {type: mime}); null on any failure/missing data. transcribe(
  blob) -> blob to base64 (FileReader, arrayBuffer+chunked-btoa fallback) -> request(
  MSG.TRANSCRIBE, {audioBase64, mime: blob.type}) -> data.text.trim(); '' on any failure.
  speak(text) -> request(MSG.SPEAK, {text}) -> data:<mime>;base64,<audioBase64> -> new Audio(
  url).play(); resolves on 'ended', on 'error', if play() rejects (autoplay), or after a
  2500ms internal safety timeout (belt-and-braces so speak() truly never hangs); never
  rejects. stopSpeaking() pauses/clears the module-level `currentAudio`. isListening() reads
  a module-level flag set by start/stopListening. No chrome.* or DOM access at module top
  level — everything above is inside functions, confirmed by importing this file in a plain
  browser test page with a chrome shim installed after the static import graph resolves.
- src/voice/test.html (new) — served by tools/serve.js on port 8124. Installs
  globalThis.chrome = { runtime: { sendMessage } } before importing ./index.js. The shim
  routes VOICE_START/VOICE_STOP straight to recorder.js (imported directly in the page,
  standing in for the offscreen document), replicating offscreen.js's own ok()/fail()
  wrapping so the two stay behaviourally identical. TRANSCRIBE always answers
  ok({text:'what is this post about'}). SPEAK answers ok({audioBase64, mime:'audio/wav'})
  with a hand-built 0.2s silent 16-bit PCM WAV (RIFF header written by hand, base64-encoded
  in-page) so speak() has real audio to play. Two switches (forceMicDenied, forceTtsFail)
  let the shim return fail(ERR.MIC_DENIED, ...) / fail(ERR.TTS_FAILED, ...) on demand. Writes
  "PASS: ..."/"FAIL: ..." lines to <pre id="out"> and a final "ALL PASS"/"SOME FAILED" line.
- src/voice/offscreen.html — left as-is (already correctly `<script type="module"
  src="offscreen.js">`; no change needed).
- src/voice/diag.html — created several throwaway variants while diagnosing the headless-
  Chrome issue below, then deleted. Not part of the final state (confirmed: only index.js,
  offscreen.html, offscreen.js, recorder.js, test.html remain in src/voice/).

WORKS (and how it was verified):
- `node --check` passes on recorder.js, offscreen.js and index.js.
- Environment finding that changed how verification was done: the prescribed command
  (`--virtual-time-budget=8000 --dump-dom`) reliably hangs forever on this machine's
  Chrome 152.0.7977.83 — getUserMedia/MediaRecorder never resolve under it, no matter how
  large the budget (tried 8000 and 60000: both consumed the full budget, in ~0.5s of *real*
  wall-clock time, while gum stayed "pending"). Root-caused with a heartbeat probe: JS timers
  fire (fast-forwarded) but the real out-of-process IPC round trip for device negotiation
  never gets serviced before dump-dom tears the page down, because virtual-time-budget's
  "idle" detection doesn't know that IPC call is outstanding. Confirmed the negotiation itself
  is fine: the identical getUserMedia call resolves in ~140ms when run WITHOUT
  --virtual-time-budget (plain headless navigation, real time). Also found the first attempts
  were silently talking to the user's already-open Chrome ("Opening in existing browser
  session") until a unique --user-data-dir was added — worth flagging for any other subagent
  driving headless Chrome from a shell that may have a live Chrome session.
  Because plain `--dump-dom` (no virtual-time-budget) also doesn't work — it dumps right after
  the `load` event, before any of the test's async chain (real 500ms sleep, real ~140ms mic
  negotiation, real ~200ms audio playback) has run — verification was done with a small,
  dependency-free CDP driver instead (Node's built-in net/crypto/http only, no npm install):
  launch headless Chrome with the same fake-media flags and a fresh --user-data-dir,
  no --dump-dom/--virtual-time-budget (so everything runs in real time), connect to its
  --remote-debugging-port over a hand-rolled WebSocket client, and poll
  `document.getElementById('out').textContent` via Runtime.evaluate every 250ms for up to 15s
  real time. This is functionally the same check the task asked for (fake mic auto-granted,
  verified from the terminal, grep for "ALL PASS") with a different, working mechanism for
  waiting on the async result. Two independent runs against the final files both printed:
    PASS: startListening() resolves {ok:true}
    PASS: stopListening() returns a Blob with size>0 and audio/* type — type=audio/webm;codecs=opus size=408
    PASS: transcribe() returns the shimmed text — "what is this post about"
    PASS: speak() resolves under 3s — ~1200ms
    PASS: startListening() resolves {ok:false, error:{code:MIC_DENIED}} without throwing
    PASS: speak() resolves silently on TTS failure (never throws)
    PASS: stopListening() without a prior start returns null
    ALL PASS
  This covers every item in the task's DONE WHEN list: real Blob with size>0 and an audio/*
  type after start-wait500ms-stop; transcribe() returning the exact shimmed string; speak()
  resolving well under 3s; startListening() surfacing {ok:false,error:{code:'MIC_DENIED'}}
  without throwing when the shim forces denial; speak() resolving silently (never throwing)
  when the shim forces a TTS failure; stopListening() with no prior successful start
  returning null without throwing.
- All background Chrome/Node processes spawned during this investigation and verification
  (multiple throwaway --user-data-dir profiles, the CDP driver's own launches, tools/serve.js
  on 8124, a small ad-hoc diagnostic HTTP reporter on 8199) were confirmed killed afterward;
  a `tools/serve.js 8125` process belonging to a different subagent was left untouched.

UNTESTED:
- The real offscreen document flow end-to-end (chrome.offscreen.createDocument -> real
  chrome.runtime.onMessage delivery to offscreen.js -> recorder.js) was not exercised as a
  whole; only offscreen.js's logic was validated indirectly by having test.html's shim
  reproduce its exact wrapping (same ok()/fail() calls, same success/failure shapes) around
  the same recorder.js used by the real file. offscreen.js itself only got node --check plus
  a manual code read, since driving a real offscreen document requires the extension loaded
  in Chrome (bg's ensureOffscreen()), which is out of scope for this module.
- recorder.js's double-start guard (calling startRecording() again while already recording,
  or two overlapping calls racing) has no dedicated test; only single start/stop cycles were
  exercised.
- Real STT/TTS network calls (bg's actual OpenAI fetches) — out of scope per the task; the
  test page's shim stands in for MSG.TRANSCRIBE/MSG.SPEAK.
- Behaviour on an actual instagram.com page / real microphone hardware / a denied OS-level
  mic permission was not tested (fixtures/headless only, per "develop against fixtures
  first, live instagram.com second" and the task's explicit test methodology).
- MediaRecorder mimeType fallback path (browser default when 'audio/webm;codecs=opus' is
  unsupported) — this Chrome supports the opus codec, so only the primary path was exercised.

ASSUMED about other modules:
- bg's ensureOffscreen()/target:'offscreen' forwarding for VOICE_START/VOICE_STOP (confirmed
  present in reports/bg-1.md, ported from demos/mic-tts-test-insta/background.js) delivers
  the message to offscreen.js unchanged, i.e. offscreen.js's `{target, type}` shape is exactly
  what arrives.
- bg's MSG.TRANSCRIBE handler responds with ok({text}) where text is already whatever the STT
  provider returned (index.js just trims it); bg's MSG.SPEAK handler responds with
  ok({audioBase64, mime}) using whatever mime the TTS provider actually produces (index.js
  treats it as an opaque string for the data: URL and does not assume audio/mpeg).
  the shared/types.js MSG table already documents both shapes, so this is confirmed by the
  contract rather than a real assumption.
- Row 8 (STT error / short transcript) judgment by word count, and hiding the PTT button on
  MIC_DENIED/MIC_UNAVAILABLE, are the overlay's responsibility, not voice's — per the
  interface doc under shared/types.js §5 and the task's "OUT OF SCOPE" list. voice/index.js
  only returns the raw ok/fail results and the empty-string-on-failure contract for
  transcribe().
- The demos/mic-tts-test-insta/ demo itself uses webkitSpeechRecognition + chrome.tts, neither
  of which apply here (explicitly out of scope); the only things actually ported from it were
  the two patterns called out in the task: mapping getUserMedia's err.name to a small enum,
  and releasing every track immediately once it's no longer needed.

NEEDS from other modules / interface change requests: none. shared/types.js's §5 contract
(startListening/stopListening/transcribe/speak/stopSpeaking, plus the MSG.VOICE_START/
VOICE_STOP/TRANSCRIBE/SPEAK payload shapes) was sufficient as written; no changes requested.
