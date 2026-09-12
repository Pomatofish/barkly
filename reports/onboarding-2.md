CHANGED:
- src/onboarding/onboarding.js (`handleTestKey`) — `maxOutputTokens` for the Test-key ASK request
  changed from 5 to 16 (the live API's minimum: "integer below minimum value. Expected a value >= 16,
  but got 5 instead."). The generic (non-key) failure branch now reads `'Key saved, but the test call
  failed: ' + message` instead of surfacing the bare error message alone, so the user knows the key
  itself was already stored even though the test call itself failed; the NO_KEY/BAD_KEY branch is
  unchanged ("That key was rejected — check it and try again.").
- src/onboarding/test.html — added a scenario between the BAD_KEY case and the success case that sets
  the shim's ASK behaviour to `fail(ERR.TIMEOUT, 'Assistant unavailable')` and asserts the result text
  is exactly "Key saved, but the test call failed: Assistant unavailable" (still styled `.err`); added
  an assertion that every recorded MSG.ASK payload from the Test-key clicks in that scenario carries
  `maxOutputTokens: 16`.
- reports/onboarding-2.md (this file)

Nothing outside src/onboarding/ was touched. No new dependencies. No git.

WORKS (verified, exactly how):
- `node --check` passes on onboarding.js and boot.js (the only two .js files in the folder).
- `node tools/serve.js 8126` restarted with the tool's own `run_in_background` (not a backgrounded
  shell job — the underlying cause of a false-alarm connection-refused earlier in Phase 1), confirmed
  reachable with `curl`, then a fresh headless-Chrome run
  (`--headless=new --disable-gpu --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --user-data-dir=<new dir>`, fake mic auto-granted) against a brand-new `--user-data-dir` printed
  28/28 PASS ending in `ALL PASS`, including the three new/changed assertions:
  ```
  PASS: rejected key shows the red "check it and try again" message — That key was rejected — check it and try again.
  PASS: rejected key result is styled red (err class)
  PASS: non-key failure shows the friendlier "Key saved, but..." message (not a rejection) — Key saved, but the test call failed: Assistant unavailable
  PASS: non-key failure result is still styled red (err class)
  PASS: working key shows "Key works" — Key works.
  PASS: working key result is styled ok
  PASS: every Test-key ASK used maxOutputTokens: 16 (the API minimum — 5 was rejected live) — [16,16,16]
  ...
  ALL PASS
  ```
  (`[16,16,16]` — one value per Test-key click in that scenario: the BAD_KEY case, the TIMEOUT case,
  and the success case — confirming the fix applies on every call, not just the first.)
- Confirmed no leftover Chrome process from this run (`wmic ... | grep remote-debugging-port=9240`
  empty after the driver's own cleanup) and stopped only my own `tools/serve.js 8126` background task
  (task id `bjrub3bqs`) — no other subagent's server was touched.

UNTESTED: same as reports/onboarding-1.md — this was a targeted two-line fix plus its test coverage;
no other behaviour was re-reviewed (Done/persona/mic/summary paths were exercised again incidentally
by the full test.html run above, all still green, but not independently re-verified beyond that).

ASSUMED about other modules: unchanged from onboarding-1 — bg reads the key from storage at request
time (not from the ASK payload), and MSG.ASK's `maxOutputTokens` is passed through to the real
provider call, which is exactly what made the old value of 5 visible as a live 400 in the first place.

NEEDS from other modules / interface change requests: none.
