// Offscreen document — owns speech recognition for the Instagram overlay.
// Runs on the chrome-extension:// origin, so it inherits the microphone grant
// made on app.html. It cannot show a permission prompt itself.
//
// In:  { target: "offscreen", type: "start" | "stop" | "permission" }
// Out: { target: "background", type: "state" | "result" | "error", ... }

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

let recog = null;
let wanted = false; // true while the overlay wants us listening
let lang = "en-US";

function emit(payload) {
  chrome.runtime.sendMessage({ target: "background", ...payload }).catch(() => {});
}

// navigator.permissions.query is only a hint here: on a chrome-extension://
// origin it keeps reporting "prompt" in cases where the mic actually opens
// fine, so trusting it alone would lock the overlay out forever. Opening a
// stream is the authoritative test — in an offscreen document it either
// succeeds because the grant is already on file, or it rejects immediately
// (there is no prompt to show), which is exactly the answer we need.
async function micPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err) {
    if (err.name === "NotAllowedError") return "prompt";
    if (err.name === "NotFoundError") return "no-device";
    return "unknown";
  }
}

function buildRecognizer() {
  const r = new SpeechRec();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;

  r.onstart = () => emit({ type: "state", listening: true, lang: r.lang });

  r.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += text;
      else interim += text;
    }
    emit({ type: "result", interim, final: final.trim() });
  };

  r.onerror = (event) => {
    // "no-speech" and "aborted" are routine; let onend handle the restart
    if (event.error === "no-speech" || event.error === "aborted") return;
    emit({ type: "error", error: event.error });
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      wanted = false;
    }
  };

  r.onend = () => {
    if (wanted) {
      // continuous mode still times out on silence; restart to keep listening
      setTimeout(() => { if (wanted) startRecognition(); }, 300);
    } else {
      emit({ type: "state", listening: false });
    }
  };

  return r;
}

function startRecognition() {
  if (!SpeechRec) {
    emit({ type: "error", error: "SpeechRecognition is not available in the offscreen document" });
    wanted = false;
    return;
  }
  if (recog) { try { recog.abort(); } catch (e) {} }
  recog = buildRecognizer();
  try {
    recog.start();
  } catch (err) {
    emit({ type: "error", error: err.message });
  }
}

function stopRecognition() {
  wanted = false;
  if (recog) { try { recog.stop(); } catch (e) {} }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return;

  if (msg.type === "permission") {
    micPermission().then((state) => sendResponse({ state }));
    return true;
  }

  if (msg.type === "start") {
    if (msg.lang) lang = msg.lang;
    micPermission().then((state) => {
      if (state !== "granted") {
        emit({ type: "error", error: "microphone-not-granted", state });
        emit({ type: "state", listening: false });
        return;
      }
      wanted = true;
      startRecognition();
    });
    return;
  }

  if (msg.type === "stop") {
    stopRecognition();
  }
});
