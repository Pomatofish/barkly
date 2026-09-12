# Failure modes

Every row must be implemented. The status pill is the user-visible surface for the rows that have one.
Copy this table into the README under "Failure checks".

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

Golden path to verify after integration:
open public post → green → ask by voice "what's this post about?" → short spoken reply →
switch to influencer → chip "how could this do better?" → analytical reply with numbers →
say "remember this post's style" → item appears in Remembered panel.
Then verify rows 1, 7, 9 and 14 by hand before recording the video.
