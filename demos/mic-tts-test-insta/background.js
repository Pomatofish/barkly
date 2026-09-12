// MV3 service worker — the router between the Instagram overlay and the
// offscreen document that owns the microphone.
//
// What is possible here:
//   chrome.tts        -> yes, no DOM required, unaffected by page autoplay rules
//   getUserMedia      -> no, navigator.mediaDevices does not exist
//   SpeechRecognition -> no, needs a document
//
// Nothing in this file can show the microphone prompt. Only a real tab on the
// extension's own origin can, which is what openGrantPage is for: it opens
// app.html with ?grant=1, and that page calls getUserMedia straight away so
// Chrome actually raises the prompt instead of waiting for another click.

const OFFSCREEN_PATH = "offscreen.html";
const GRANT_URL = chrome.runtime.getURL("app.html") + "?grant=1";
let overlayTabId = null;

async function offscreenExists() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

let creating = null;
async function ensureOffscreen() {
  if (await offscreenExists()) return;
  if (creating) return creating; // two overlapping calls would throw on the second create
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["USER_MEDIA"],
      justification: "Capture voice commands while the user is browsing Instagram.",
    })
    .finally(() => { creating = null; });
  return creating;
}

function toOverlay(payload) {
  if (overlayTabId === null) return;
  chrome.tabs.sendMessage(overlayTabId, payload).catch(() => {
    overlayTabId = null;
  });
}

// Reuse the grant tab if it is already open, so repeated clicks do not pile up
// tabs — and focus it, because a background tab cannot show a permission prompt.
async function openGrantPage() {
  try {
    const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("app.html") + "*" });
    if (existing.length) {
      await chrome.tabs.update(existing[0].id, { url: GRANT_URL, active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
      return;
    }
  } catch (err) {
    // url filtering needs the "tabs" permission; fall through to a fresh tab
  }
  await chrome.tabs.create({ url: GRANT_URL, active: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // --- from the content script -------------------------------------------
  if (msg.type === "voice:start") {
    overlayTabId = sender.tab?.id ?? null;
    (async () => {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: "offscreen", type: "start", lang: msg.lang }).catch(() => {});
    })();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "voice:stop") {
    // no offscreen document yet means nothing to stop
    chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "voice:permission") {
    overlayTabId = sender.tab?.id ?? overlayTabId;
    (async () => {
      await ensureOffscreen();
      const reply = await chrome.runtime
        .sendMessage({ target: "offscreen", type: "permission" })
        .catch(() => ({ state: "unknown" }));
      sendResponse(reply ?? { state: "unknown" });
    })();
    return true;
  }

  if (msg.type === "openGrantPage") {
    overlayTabId = sender.tab?.id ?? overlayTabId;
    openGrantPage();
    sendResponse({ ok: true });
    return true;
  }

  // sent by app.html once the user has answered Chrome's prompt
  if (msg.type === "permissionResult") {
    toOverlay({ target: "background", type: "permission", state: msg.state, error: msg.error });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "speak") {
    chrome.tts.speak(msg.text, {
      rate: msg.rate ?? 1,
      pitch: msg.pitch ?? 1,
      enqueue: false,
      onEvent: (e) => {
        if (e.type === "error") console.warn("[tts]", e.errorMessage);
      },
    });
    sendResponse({ ok: true, from: "service worker" });
    return true;
  }

  if (msg.type === "stopSpeaking") {
    chrome.tts.stop();
    sendResponse({ ok: true });
    return true;
  }

  // --- from the offscreen document ---------------------------------------
  if (msg.target === "background") {
    toOverlay(msg);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Probe installed. Open the options page once to grant the microphone.");
});
