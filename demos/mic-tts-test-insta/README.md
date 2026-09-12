# Mic + TTS Probe

A minimal Manifest V3 extension that answers one question: can a Chrome extension
open the microphone, transcribe speech, and speak text back, without hitting a
permission wall?

Short answer: yes, with one structural constraint — the microphone prompt has to
happen on a page, not in the service worker and not in the popup.

## Fixed in 1.2.0

**The issue:** no permission prompt ever appeared because nothing in the
extension actually called `getUserMedia` from a context that can prompt — the
overlay gated on `navigator.permissions.query`, which reports `"prompt"` from
the offscreen document, and the "Grant mic" button only opened the test page
without requesting the microphone.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Click the extension icon, then **Open the test page**

The test page is the options page, so `chrome://extensions` → Details → Extension
options gets you there too.

## What each section tests

| Section | What it proves |
|---|---|
| Capture the microphone | `getUserMedia` succeeds on the extension origin and audio actually flows |
| Speech to text | `webkitSpeechRecognition` works in an extension page |
| Text to speech | Both `chrome.tts` and `speechSynthesis`, from a page and from the service worker |
| Round trip | Mic and speaker running at once without feedback problems |

## Where audio code can and cannot live

| Context | getUserMedia | SpeechRecognition | chrome.tts |
|---|---|---|---|
| Service worker | No — no `navigator.mediaDevices` | No — needs a document | Yes |
| Extension page in a tab | Yes, and it can prompt | Yes | Yes |
| Popup | Only if already granted | Yes | Yes |
| Offscreen document | Yes, but cannot prompt | Usually | Yes |
| Content script | Uses the host page's origin, not yours | Same | Yes |

The popup restriction is the one that catches people. When Chrome shows the
permission prompt, focus leaves the popup, the popup unloads, and the pending
`getUserMedia` promise dies with it. Prompt from a tab once; after that the grant
is remembered for `chrome-extension://<your-id>` and the popup and any offscreen
document can open the mic silently.

## How the microphone actually gets granted

Nothing that runs in the background can raise Chrome's permission prompt — not
the service worker, not the popup, and not the offscreen document. Only a
top-level tab on the extension's own origin can, and it only happens if that tab
*calls `getUserMedia`*. Opening the test page is not enough on its own.

So the overlay's flow is:

1. Press **Listen** on Instagram.
2. The offscreen document tries to open the mic. If the grant is already on
   file it succeeds and recognition starts.
3. If not, the service worker opens `app.html?grant=1` in a focused tab, and
   that page calls `getUserMedia` on load — which is what makes Chrome's prompt
   appear.
4. Click **Allow**. The page releases the track immediately (it only wanted the
   permission), tells the overlay, and you can go back to Instagram and press
   **Listen**.

Note that `navigator.permissions.query({ name: "microphone" })` is not a
reliable gate on a `chrome-extension://` origin — it can keep reporting
`"prompt"` when the mic opens fine. Attempting the stream is the real test, so
that is what the offscreen document does.

## Resetting a denied permission

`chrome://settings/content/microphone` → find the `chrome-extension://<id>` entry
under the blocked list → remove it, then reload the test page.

## Things worth knowing before you build on this

- `webkitSpeechRecognition` streams audio to Google's servers. It needs a network
  connection, and it is not a privacy-neutral choice. For on-device work, look at
  Whisper compiled to WASM or `chrome.audio` plus your own model.
- Recognition stops on its own after a stretch of silence even with
  `continuous = true`. The echo mode here restarts it in `onend`; that is the
  standard workaround.
- `chrome.tts` on desktop falls back to the OS voices. Quality varies by platform.
- For the Web Store, microphone use triggers a "Use your microphone" install
  warning and pulls you into the Limited Use disclosure requirements. Fine for
  local testing with Load unpacked.
- MV3 blocks inline scripts, so every handler lives in a separate `.js` file.
