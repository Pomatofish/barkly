// ---------------------------------------------------------------------------
// Mic + TTS Probe — all logic runs on the chrome-extension:// origin.
// MV3 forbids inline scripts, so every handler is wired up here.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const logEl = $("log");

function log(msg, kind = "") {
  const line = document.createElement("div");
  line.className = kind;
  const t = new Date().toTimeString().slice(0, 8);
  line.textContent = `${t}  ${msg}`;
  logEl.prepend(line);
}

function setStatus(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = kind || "";
}

// --- environment report ----------------------------------------------------

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

setStatus("origin", location.origin);
setStatus(
  "srAvail",
  SpeechRec ? "available" : "missing",
  SpeechRec ? "good" : "bad"
);
setStatus(
  "ttsAvail",
  typeof chrome !== "undefined" && chrome.tts ? "available" : "missing",
  typeof chrome !== "undefined" && chrome.tts ? "good" : "bad"
);

async function refreshMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    const good = status.state === "granted";
    setStatus("permState", status.state, good ? "good" : status.state === "denied" ? "bad" : "");
    status.onchange = () => refreshMicPermission();
  } catch (err) {
    setStatus("permState", "query unsupported");
  }
}
refreshMicPermission();

// --- 1. microphone capture -------------------------------------------------

let micStream = null;
let audioCtx = null;
let rafId = null;

async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const track = micStream.getAudioTracks()[0];
    log(`Microphone open — ${track.label || "device label withheld"}`, "ok");
    $("micStart").disabled = true;
    $("micStop").disabled = false;
    startMeter(micStream);
    refreshMicPermission();
  } catch (err) {
    log(`getUserMedia failed — ${err.name}: ${err.message}`, "err");
    if (err.name === "NotAllowedError") {
      log(
        "Permission was blocked. Reset it at chrome://settings/content/microphone, " +
          "find this extension's origin in the block list, and remove it.",
        "err"
      );
    }
  }
}

function stopMic() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  $("bar").style.width = "0%";
  $("micStart").disabled = false;
  $("micStop").disabled = true;
  log("Microphone closed.");
}

function startMeter(stream) {
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.fftSize);
  const bar = $("bar");

  (function tick() {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    bar.style.width = Math.min(100, rms * 320) + "%";
    rafId = requestAnimationFrame(tick);
  })();
}

$("micStart").addEventListener("click", startMic);
$("micStop").addEventListener("click", stopMic);

// --- 2. speech to text -----------------------------------------------------

let recog = null;
let echoMode = false;

function buildRecognizer() {
  const r = new SpeechRec();
  r.lang = $("lang").value;
  r.continuous = true;
  r.interimResults = true;

  r.onstart = () => log(`Recognition started — ${r.lang}`, "ok");

  r.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += text;
      else interim += text;
    }
    $("interimText").textContent = interim;
    if (final.trim()) {
      $("finalText").textContent = final.trim();
      log(`Heard: "${final.trim()}"`, "ok");
      if (echoMode) speakWeb(final.trim());
    }
  };

  r.onerror = (event) => {
    log(`Recognition error — ${event.error}`, "err");
    if (event.error === "network") {
      log("The recognizer needs internet access; it is not fully on-device.", "err");
    }
  };

  r.onend = () => {
    log("Recognition ended.");
    $("srStart").disabled = false;
    $("srStop").disabled = true;
    if (echoMode) {
      // continuous mode still times out; restart to keep the loop alive
      setTimeout(() => { if (echoMode) startRecognition(); }, 300);
    }
  };

  return r;
}

function startRecognition() {
  if (!SpeechRec) {
    log("SpeechRecognition is not exposed in this build of Chrome.", "err");
    return;
  }
  if (recog) { try { recog.abort(); } catch (e) {} }
  recog = buildRecognizer();
  try {
    recog.start();
    $("srStart").disabled = true;
    $("srStop").disabled = false;
  } catch (err) {
    log(`Could not start recognition — ${err.message}`, "err");
  }
}

function stopRecognition() {
  echoMode = false;
  if (recog) { recog.stop(); }
  $("srStart").disabled = false;
  $("srStop").disabled = true;
}

$("srStart").addEventListener("click", startRecognition);
$("srStop").addEventListener("click", stopRecognition);

// --- 3. text to speech -----------------------------------------------------

$("rate").addEventListener("input", (e) => ($("rateOut").value = (+e.target.value).toFixed(1)));
$("pitch").addEventListener("input", (e) => ($("pitchOut").value = (+e.target.value).toFixed(1)));

const rate = () => parseFloat($("rate").value);
const pitch = () => parseFloat($("pitch").value);

function speakChromeTts(text) {
  chrome.tts.speak(text, {
    rate: rate(),
    pitch: pitch(),
    enqueue: false,
    onEvent: (event) => {
      if (event.type === "error") log(`chrome.tts error — ${event.errorMessage}`, "err");
      else if (event.type === "end") log("chrome.tts finished.", "ok");
      else if (event.type === "start") log("chrome.tts speaking…");
    },
  });
}

function speakWeb(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate();
  utter.pitch = pitch();
  utter.onstart = () => log("speechSynthesis speaking…");
  utter.onend = () => log("speechSynthesis finished.", "ok");
  utter.onerror = (e) => log(`speechSynthesis error — ${e.error}`, "err");
  speechSynthesis.speak(utter);
}

$("ttsChrome").addEventListener("click", () => speakChromeTts($("speakText").value));
$("ttsWeb").addEventListener("click", () => speakWeb($("speakText").value));

$("ttsBg").addEventListener("click", async () => {
  const reply = await chrome.runtime.sendMessage({
    type: "speak",
    text: $("speakText").value,
    rate: rate(),
    pitch: pitch(),
  });
  log(`Service worker replied: ${JSON.stringify(reply)}`);
});

$("ttsStop").addEventListener("click", () => {
  chrome.tts.stop();
  speechSynthesis.cancel();
  log("Speech stopped.");
});

$("listVoices").addEventListener("click", () => {
  chrome.tts.getVoices((voices) => {
    log(`chrome.tts voices (${voices.length}):`);
    voices.slice(0, 12).forEach((v) =>
      log(`  · ${v.voiceName} [${v.lang}] ${v.remote ? "remote" : "local"}`)
    );
  });
  const web = speechSynthesis.getVoices();
  log(`speechSynthesis voices: ${web.length}`);
});

// --- 4. echo mode ----------------------------------------------------------

$("echoStart").addEventListener("click", async () => {
  if (!micStream) await startMic();
  echoMode = true;
  $("echoStart").disabled = true;
  $("echoStop").disabled = false;
  startRecognition();
  log("Echo mode on — speak, pause, and it reads you back.", "ok");
});

$("echoStop").addEventListener("click", () => {
  echoMode = false;
  stopRecognition();
  $("echoStart").disabled = false;
  $("echoStop").disabled = true;
  log("Echo mode off.");
});

log("Probe page loaded.");

// --- 5. grant flow ---------------------------------------------------------
// The overlay on Instagram cannot raise Chrome's microphone prompt, and neither
// can the service worker, the popup or the offscreen document. A top-level tab
// on the extension's own origin is the only place that can, so the overlay
// sends us here with ?grant=1 and we call getUserMedia immediately — otherwise
// the page just sits there and no prompt ever appears.

function banner(text, kind) {
  let el = $("banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "banner";
    document.body.prepend(el);
  }
  el.className = `banner ${kind || ""}`;
  el.textContent = text;
}

async function requestMicPermission() {
  banner("Asking Chrome for microphone access — click Allow in the prompt at the top of the window.", "wait");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it straight away: we only came here for the permission, and a
    // held track would leave the recording indicator on for the whole session.
    stream.getTracks().forEach((t) => t.stop());
    log("Microphone granted for this extension.", "ok");
    banner("Microphone granted. Go back to Instagram and press Listen.", "good");
    chrome.runtime.sendMessage({ type: "permissionResult", state: "granted" }).catch(() => {});
  } catch (err) {
    log(`getUserMedia failed — ${err.name}: ${err.message}`, "err");
    if (err.name === "NotAllowedError") {
      banner(
        "Microphone blocked. Open chrome://settings/content/microphone, remove this " +
          "extension from the block list, then reload this page.",
        "bad"
      );
    } else if (err.name === "NotFoundError") {
      banner("No microphone found — check that an input device is plugged in and enabled.", "bad");
    } else {
      banner(`Could not open the microphone — ${err.name}.`, "bad");
    }
    chrome.runtime
      .sendMessage({ type: "permissionResult", state: "denied", error: err.name })
      .catch(() => {});
  }
  refreshMicPermission();
}

$("grantNow").addEventListener("click", requestMicPermission);

if (new URLSearchParams(location.search).get("grant") === "1") {
  requestMicPermission();
}
