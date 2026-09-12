# Grammy Overlay Test

Hackathon feasibility test: can a Chrome extension draw an AI-assistant style overlay on top of
Instagram that points at, and highlights, real Instagram buttons?

**Answer: yes.** A content script can find Instagram's buttons, draw on top of them, follow them as
the page scrolls and re-renders, and tell when the user clicks the one it pointed at.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Open (or refresh) https://www.instagram.com and log in

## Try it

- **In-page assistant:** click the gradient orb at the bottom-right, or press **Alt+G**.
  - Type things like *"how do I save this post?"*, *"send this to a friend"* or *"where are my DMs"*.
  - Tap a chip (Like, Comment, Share, Save, Home, Search, …).
  - **Guided tour** walks through every button it can find. Click the highlighted button or
    press *Next* to move on.
  - **Scan** outlines every button it recognises, which helps check the selectors.
- **Toolbar popup:** the same controls, plus a toggle to hide the in-page assistant.
- **Esc** clears everything.

## How it works

| Piece | Approach |
|---|---|
| Finding buttons | Instagram's class names are obfuscated, so the script matches on `svg[aria-label="Like"]`, `<title>` text, `aria-label`, link `href` (`/direct/inbox/`, `/explore/`) and sidebar text. It then walks up to the nearest clickable element. When there are several matches (like buttons on every post), it picks the one closest to the centre of the screen. |
| Staying attached | A `requestAnimationFrame` loop reads the target's position every frame. If Instagram re-renders and the node disappears, the script looks it up again. |
| Not breaking the page | Everything lives in a Shadow DOM, so Instagram's CSS can't leak in. The layer is `pointer-events: none`, so the real button stays clickable. |
| Feel | Spring physics move the ring and bubble. The ghost cursor's two axes use different stiffness, so it glides along a curve. The page dims around a spotlight cut-out, the rim is an animated Instagram-gradient ring with ripples, and the bubble types its text out after a short "thinking" pause. Clicking the target sets off a burst. |
| "AI" | Keyword → intent matching in `ask()` stands in for the real agent. |

## Hooking up the real agent

The content script accepts messages that an LLM agent could send as tool calls:

```js
chrome.tabs.sendMessage(tabId, { type: 'highlight', key: 'save' }); // point at a button
chrome.tabs.sendMessage(tabId, { type: 'ask', text: 'how do i dm someone' });
chrome.tabs.sendMessage(tabId, { type: 'tour' });
chrome.tabs.sendMessage(tabId, { type: 'clear' });
```

Keys: `like comment share save home search explore reels messages notifications create profile more`.
To support a new button, add an entry to `TARGETS` in `content.js`.

## Caveats

- The matching assumes Instagram's UI is in **English**, because it relies on aria-labels.
- Instagram changes its markup often. If a button stops being found, run **Scan**, inspect the
  element and add its label or href to `TARGETS`.
