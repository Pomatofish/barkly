# REPORT — context-1 (src/context/)

CHANGED:
- src/context/index.js            (real implementation: getPageContext / onNavigate / describeStatus / focusedPost)
- src/context/pagetype.js         (NEW — URL -> pageType, DOM landmark overrides, URL helpers)
- src/context/readers.js          (NEW — article / story / composer DOM readers, count + media parsing)
- src/context/privacy.js          (NEW — per-username public/private cache, chrome.storage.local + in-memory fallback)
- src/context/capture.js          (NEW — reads the passive capture index as a SECONDARY gap filler)
- src/context/early.js            (document_start content script: injects injected.js, indexes captured JSON)
- src/context/injected.js         (NEW — page-world fetch/XHR patch, ported from demos/fetch)
- src/context/pagetype.test.js    (NEW — node --test, pure parts)
- src/context/test.html           (NEW — fixture runner, prints a results table + "ALL PASS")
- src/context/fixtures/post.html            (kept from the interrupted attempt; already realistic)
- src/context/fixtures/reel.html            (NEW)
- src/context/fixtures/story.html           (NEW)
- src/context/fixtures/private-profile.html (NEW)
- src/context/fixtures/composer.html        (NEW)
- src/context/fixtures/feed.html            (NEW)
- src/context/fixtures/profile.html         (NEW, extra — public profile, primes the privacy cache)
- src/context/fixtures/private-post.html    (NEW, extra — post owned by the private account, row 1)
- src/context/fixtures/unknown.html         (NEW, extra — /accounts/edit/, row 3)
- reports/context-1.md            (this file)

Nothing outside src/context/ (and this report) was touched. No new dependencies. No git.

WORKS (verified, exactly how):

1. `node --test src/context/` -> 16/16 pass. Covers: URL -> pageType for 20 URLs (feed, /p/, /tv/,
   /reel/, /reels/, /stories/, /create/, profile, profile tabs, /accounts/, /explore/, /direct/, junk
   input), usernameFromUrl / shortcodeFromUrl, parseCount ("12,483", "41.2K", "1.2M",
   "View all 214 comments"), stableHash, describeStatus rows 1-6 plus the happy path, focusedPost,
   getPageContext() in Node with no document (-> emptyContext, row 3) and with a document whose
   querySelector throws (-> emptyContext, never throws).

2. `node --check` passes on all 7 .js files in src/context/.

3. Served fixture page, verified from the terminal:
   `node tools/serve.js 8131` (background) then
   `chrome --headless=new --disable-gpu --no-first-run --user-data-dir=$TEMP/grammy-ctx-profile
    --virtual-time-budget=15000 --dump-dom http://localhost:8131/src/context/test.html`
   -> the verdict element reads **ALL PASS** (12 rows, every row "pass").
   The isolated --user-data-dir matters: without it headless can attach to an existing Chrome and
   print nothing.

   Row-by-row output of that page:

   | fixture | pageType | username | comments | commentCount | likes | media | focusedPostId | isPrivate | pill |
   |---|---|---|---|---|---|---|---|---|---|
   | profile.html | profile | lena.explores | 0 | - | - | - | profile:lena.explores | false | green Ready |
   | post.html | post | lena.explores | 5 | 214 | 12483 | image | C9xY2kLpQ7a | false | green PUBLIC_POST |
   | post modal over profile (synthetic) | post | lena.explores | 5 | 214 | 12483 | image | C9xY2kLpQ7a | false | green PUBLIC_POST |
   | private-profile.html | profile | quiet.club | 0 | - | - | - | profile:quiet.club | true | red PRIVATE |
   | private-post.html | post | quiet.club | 0 (stripped) | 9 | 412 | null (stripped) | DB1QuietZ9k | true | red PRIVATE |
   | reel.html | reel | kai.makes | 3 | 143 | 8912 | video (poster URL) | DA7mQ2ZtVbn | null | yellow UNCONFIRMED |
   | story.html | story | nomad.bites | 0 | - | - | image | story:nomad.bites:0 | null | yellow STORY_NO_TEXT |
   | composer.html | composer | - | - | - | - | - | null | - | green READY (draftCaption read) |
   | feed.html | feed | coastal.cassie | 2 | 61 | 3204 | image | C9tHuTsK1mQ | null | yellow UNCONFIRMED |
   | unknown.html | unknown | - | - | - | - | - | null | - | yellow UNKNOWN_PAGE |
   | (live) onNavigate | - | - | - | - | - | - | 1 callback | - | pass |
   | (live) getPageContext() | unknown | - | - | - | - | - | null | - | yellow UNKNOWN_PAGE |

   Additional assertions inside those rows: caption keeps its hashtags; altText comes from img[alt];
   postedAt is the ISO value of <time datetime>; mediaUrl is the largest srcset candidate
   (cliffs_1080.jpg) for images and <video poster> for the reel; feed post 2 = video, "41.2K" likes
   parsed to 41200, 0 loaded comments (row 5) with commentCount 872; feed post 3 caption null
   (row 4) and likes 0 from "Be the first to like this"; the synthetic modal case proves an open
   div[role="dialog"] article beats the profile URL for both pageType and focusedPostId.

4. Live-document checks on that same page (real browser, not DOMParser):
   - onNavigate(cb): the patched history.pushState fires the callback exactly once ~300 ms later with
     the new URL; after the returned unsubscribe it fires no more. Patching is idempotent
     (window.__grammyNavPatched guard plus a module-level subscriber set), so repeated calls and
     repeated module loads cannot double-patch history.
   - getPageContext() with no overrides on a non-Instagram page -> pageType 'unknown', posts [],
     url = the page URL, pill UNKNOWN_PAGE, no throw.

5. Failure rows I own, all exercised by the table above: 1 private account (cache -> caption,
   comments, altText, mediaType, mediaUrl stripped, red PILL.PRIVATE), 2 privacy unknown
   (isPrivate null -> PILL.UNCONFIRMED), 3 unknown page (emptyContext -> PILL.UNKNOWN_PAGE),
   4 caption selector miss (caption null -> PILL.NO_CAPTION), 5 no comments loaded
   (PILL.NO_COMMENTS), 6 story with no readable text (PILL.STORY_NO_TEXT), 11 no media
   (mediaUrl null; context never fetches media, it only reports the URL).

Design notes (decisions taken without asking, per the task):
- getPageContext({ doc, url, win }) — the override object is optional and additive; production calls
  stay getPageContext().
- Privacy is cached per username in chrome.storage.local[STORAGE_KEYS.PRIVACY_CACHE] with an
  in-memory Map fallback when chrome is undefined. A profile page that renders a post grid and no
  private marker caches false; "This account is private" or svg[aria-label="Private"] caches true.
  Post/reel/story pages only look the owner up — they never guess.
- focusedPostId: open modal > story on screen > article nearest the viewport centre; when every
  getBoundingClientRect is all zeros (DOMParser documents, background tabs) it falls back to the URL
  shortcode and then to the first post.
- Comments are read from already-rendered rows only. "View all N comments" and "View replies (N)"
  are read as numbers/ignored, never clicked. Comments are capped at 40 per post so a prompt cannot
  blow up.
- The capture index (early.js + injected.js, ported from demos/fetch) is strictly a gap filler:
  owner.is_private when the cache has nothing, media URL when the DOM had none, caption when the
  selector missed. It sends no requests of its own.

UNTESTED:
- Live instagram.com. Everything was developed against the fixtures. Selectors are semantic
  (article, header, [role="dialog"], [dir="auto"], a[href$="/liked_by/"], a[href*="/comments/"],
  time[datetime], img[alt] + srcset, video[poster]) and the fixtures use obfuscated class names on
  purpose, but real IG markup still needs one pass.
- early.js / injected.js: injection path, Instagram CSP behaviour and the postMessage relay are
  unverified without a real page. Failure is silent by design — capture.js finds no
  window.__grammyCapture and every lookup returns null, so the DOM reader result is unchanged.
- chrome.storage.local persistence of the privacy cache (only the in-memory fallback ran in tests).
- Nearest-to-viewport-centre focus with real layout (and with IG's sticky header overlapping the
  first article).
- draftCaption beyond the trivial textarea[aria-label*="caption"] read (composer is stretch scope).

ASSUMED about other modules:
- The overlay calls describeStatus(ctx) after every getPageContext() and passes it to setStatus();
  it compares/returns the PILL.* objects by identity (I return the PILL objects themselves, never
  copies).
- The brain uses focusedPost(ctx) for the focused post and treats posts[] as "what is rendered"; a
  post with isPrivate === true already arrives stripped, and isPrivate === null means it must say the
  account is unconfirmed and use the caption only.
- src/main.js keeps answering MSG.GET_CONTEXT by calling getPageContext() with no arguments.
- Nobody else writes STORAGE_KEYS.PRIVACY_CACHE — context owns that key.
- manifest.json keeps src/context/early.js registered at document_start and keeps src/*/* in
  web_accessible_resources (needed for chrome.runtime.getURL('src/context/injected.js')).

NEEDS from other modules / interface change requests:
- None blocking. Three decisions worth knowing, all inside the frozen shape:
  1. On a PROFILE page I return exactly one synthetic Post: id 'profile:<username>', username set,
     isPrivate set, everything else null/[] — and focusedPostId points at it. The frozen PageContext
     has nowhere else to say whose profile this is or whether it is private, and describeStatus needs
     that for row 1. Profile-grid thumbnails are not read (out of scope). If the brain would rather
     see posts: [] on profiles, say so — but then describeStatus cannot report PILL.PRIVATE from ctx
     alone and shared/types.js would need an extra field.
  2. For a private owner I null caption, comments, altText, mediaType and mediaUrl (as specified) but
     keep likes, commentCount and postedAt, which are page metadata rather than content. Say the word
     if those should be nulled too.
  3. Story ids are 'story:<username>:<n>' with n = 0, since one story is on screen at a time; the
     numeric story id from the URL is deliberately not used, to match the shape in shared/types.js.
