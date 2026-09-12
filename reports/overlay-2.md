CHANGED:
- src/overlay/index.js
  - Import STORAGE_KEYS from shared/types.js; POS_KEY now = STORAGE_KEYS.MASCOT_POS (was a private literal).
  - Renamed the persisted dock-position shape from {left, top} to {x, y} to match the shape documented
    in shared/types.js's STORAGE_KEYS.MASCOT_POS comment (defaultDockPos, applyDockPos, dockStartDrag,
    dockDragMove, dockDragEnd). Purely internal to this module; nothing else reads this key.
  - renderChips(pageType, persona) -> renderChips(pageType, persona, pageContext): now calls
    deps.getChips({ pageType, persona, pageContext }) instead of dropping the context, with a
    lastCtx fallback if a caller omits the third argument. Fixed at all 4 call sites: initAsync(),
    onNav(), the end of runAsk() (passes the ctx it just fetched), and onPersonaChange() (passes
    lastCtx, since persona toggling doesn't re-fetch context).
- src/overlay/test.html
  - Fixed T2b's expected-chips comparison to also pass pageContext (parity with the real call site).
  - Added T2d: injects a getChips spy via __setDeps, triggers a navigation to a distinct context,
    and asserts the spy's pageContext.url/focusedPostId match what getPageContext (also spied)
    returned for that navigation.
  - Added T2e/T2f: a real (non-mocked) brain.getChips() call, driven through the overlay, with a
    focused post whose caption is null renders a "Paste the caption" chip; clicking it opens the
    menu and focuses the text input (root.activeElement === the text input) instead of running
    the ask flow.
- reports/overlay-2.md (this file)
No files outside src/overlay/ were touched.

WORKS (verified via `node tools/serve.js 8125` + headless Chrome `--dump-dom` against src/overlay/test.html,
fresh --user-data-dir each run, re-run 3-4x after each change, always ending "ALL PASS", 22/22 checks):
- `node --check` passes on every .js file in src/overlay/.
- T2a/b/c (pre-existing): chips still change correctly with pageType and persona.
- T2d (new): a getChips spy receives {pageType, persona, pageContext} where pageContext.url and
  .focusedPostId match the PageContext just returned by getPageContext for that navigation —
  confirms the seam fix (chips no longer render with pageContext missing).
- T2e/T2f (new): with a real brain.getChips() call (not mocked) and a focused post whose caption
  is null, the "Paste the caption" chip appears in the rendered chip list; clicking it leaves
  isMenuOpen() true and root.activeElement === the text input element (row 4 — no ask flow runs).
- Manually confirmed in the same dump that a normal focused public post now also renders
  "Match this style" in the chip list (visible in T2a's logged chip arrays), which was silently
  missing before this fix since pageContext never reached brain's getChips().
- All previously-passing checks (T1, T3-T7) still pass unchanged.
- Re-ran 3x after the STORAGE_KEYS.MASCOT_POS import and the {left,top}->{x,y} rename specifically,
  to confirm neither caused a regression: clean every time.

UNTESTED (same gaps as reports/overlay-1.md, restated because they still apply):
- Real instagram.com page; real mic/TTS/model responses.
- Visual/manual check of animations and IG-gradient rendering.
- Mascot drag-to-reposition scripted end-to-end in test.html (only tap and long-press are scripted
  there); the {x,y} persistence shape is exercised indirectly (load/save round-trip through the
  test page's in-memory chrome.storage.local shim) but not with a real drag gesture in this pass.
- Panel/bubble repositioning on window resize while open.
- highlight()/clearHighlight() remain literal no-op stubs (stretch, out of scope).

ASSUMED about other modules:
- brain/index.js's getChips(a) reads a.pageContext (or a second positional arg) exactly as shown
  in src/brain/chips.js as of this task (prepends "Paste the caption" when the focused post's
  caption is null and the post isn't private; appends "Match this style" when the focused post
  isn't private) — confirmed by reading src/brain/chips.js directly before making the fix.
- shared/types.js now exports STORAGE_KEYS.MASCOT_POS = 'grammy_mascot_pos' (confirmed by reading
  the file); its doc comment describes the stored value as {x, y}, which this module's storage
  writes now match.

NEEDS from other modules / interface change requests: none.

OPERATIONAL NOTE: this pass, the test server was stopped by resolving its actual Windows PID via
`tasklist` and calling `taskkill /PID <pid> /F` (not `/IM node.exe`) specifically to avoid repeating
the mistake from reports/overlay-1.md. Confirmed this was necessary: after killing only my own PID,
`tasklist` still showed a different node.exe process (another subagent's dev server) running
untouched.
