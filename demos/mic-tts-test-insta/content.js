// Content script — injects a small voice overlay into Instagram web.
//
// The microphone is NOT opened here: a content script runs on instagram.com's
// origin, so getUserMedia would prompt on behalf of Instagram. Instead the
// overlay asks the service worker, which drives an offscreen document on the
// extension's own origin. TTS also goes through the service worker, because
// chrome.tts is not exposed to content scripts.

(() => {
  if (window.__micTtsOverlay) return;
  window.__micTtsOverlay = true;

  const LANGS = [
    ["en-US", "English (US)"],
    ["en-SG", "English (Singapore)"],
    ["en-GB", "English (UK)"],
    ["zh-CN", "Chinese (Mandarin)"],
    ["ms-MY", "Malay"],
    ["ta-IN", "Tamil"],
  ];

  // --- DOM (shadow root keeps Instagram's CSS out, and ours in) -------------

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        width: 280px;
        background: #eef0ea;
        color: #16211f;
        border: 1px solid #c9cec4;
        border-radius: 4px;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        font: 13px/1.45 "Iowan Old Style", Palatino, Georgia, serif;
      }
      header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border-bottom: 1px solid #c9cec4; cursor: pointer;
        font-weight: 600;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #9aa197; display: inline-block; margin-right: 6px; }
      .dot.on { background: #c0392b; }
      .body { padding: 10px 12px; }
      .collapsed .body { display: none; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
      select, textarea {
        font: inherit; color: inherit; background: #fff;
        border: 1px solid #c9cec4; border-radius: 2px; padding: 4px;
      }
      select { flex: 1; }
      textarea { width: 100%; box-sizing: border-box; resize: vertical; }
      button {
        padding: 5px 10px; background: #16211f; color: #eef0ea;
        border: none; border-radius: 2px; font: inherit; cursor: pointer;
      }
      button.ghost { background: none; color: #16211f; border: 1px solid #c9cec4; }
      button:disabled { opacity: .5; cursor: default; }
      .transcript { min-height: 2.6em; margin-bottom: 8px; }
      .final { margin: 0; }
      .interim { margin: 0; color: #61695f; font-style: italic; }
      .note { margin: 0; font-size: 11.5px; color: #61695f; }
      .note.err { color: #a93226; }
      label.check { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-bottom: 8px; }
    </style>
    <div class="panel" id="panel">
      <header id="head"><span><span class="dot" id="dot"></span>Mic + TTS Probe</span><span id="chev">–</span></header>
      <div class="body">
        <div class="row">
          <select id="lang">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
          <button id="mic">Listen</button>
        </div>
        <label class="check"><input type="checkbox" id="echo"> Read back what I say</label>
        <div class="transcript">
          <p class="final" id="final">Nothing recognised yet.</p>
          <p class="interim" id="interim"></p>
        </div>
        <textarea id="text" rows="2">Text to speech is working on Instagram.</textarea>
        <div class="row" style="margin-top:6px">
          <button id="speak" class="ghost">Speak</button>
          <button id="hush" class="ghost">Stop</button>
          <button id="grant" class="ghost" hidden>Grant mic</button>
        </div>
        <p class="note" id="note"></p>
      </div>
    </div>
  `;

  const $ = (id) => root.getElementById(id);
  let listening = false;

  function note(text, isErr = false) {
    $("note").textContent = text;
    $("note").className = isErr ? "note err" : "note";
  }

  function setListening(on) {
    listening = on;
    $("mic").textContent = on ? "Stop" : "Listen";
    $("dot").className = on ? "dot on" : "dot";
    $("lang").disabled = on;
  }

  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch((err) => {
      // happens after the extension is reloaded while this tab stays open
      note("Extension was reloaded — refresh this page.", true);
      throw err;
    });
  }

  // --- persisted settings ----------------------------------------------------

  chrome.storage.local.get(["lang", "echo", "collapsed"]).then((s) => {
    if (s.lang) $("lang").value = s.lang;
    $("echo").checked = !!s.echo;
    if (s.collapsed) $("panel").classList.add("collapsed");
  });

  $("lang").addEventListener("change", () => chrome.storage.local.set({ lang: $("lang").value }));
  $("echo").addEventListener("change", () => chrome.storage.local.set({ echo: $("echo").checked }));
  $("head").addEventListener("click", () => {
    const collapsed = $("panel").classList.toggle("collapsed");
    $("chev").textContent = collapsed ? "+" : "–";
    chrome.storage.local.set({ collapsed });
  });

  // --- microphone ------------------------------------------------------------

  $("mic").addEventListener("click", async () => {
    if (listening) {
      await send({ type: "voice:stop" });
      setListening(false);
      note("Stopped.");
      return;
    }

    note("Checking microphone permission…");
    const reply = await send({ type: "voice:permission" });
    if (!reply || reply.state !== "granted") {
      // Neither this overlay nor the offscreen document can raise Chrome's
      // prompt, so open the extension page that can instead of leaving the
      // user staring at an error with no prompt in sight.
      $("grant").hidden = false;
      if (reply?.state === "no-device") {
        note("No microphone found — check that an input device is connected.", true);
        return;
      }
      note("Opening the permission page — click Allow there, then come back.", true);
      await send({ type: "openGrantPage" });
      return;
    }

    $("grant").hidden = true;
    await send({ type: "voice:start", lang: $("lang").value });
    note("Starting…");
  });

  $("grant").addEventListener("click", () => send({ type: "openGrantPage" }));

  // --- text to speech --------------------------------------------------------

  $("speak").addEventListener("click", () => send({ type: "speak", text: $("text").value }));
  $("hush").addEventListener("click", () => send({ type: "stopSpeaking" }));

  // --- updates from the offscreen document, relayed by the service worker ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== "background") return;

    if (msg.type === "state") {
      setListening(msg.listening);
      note(msg.listening ? `Listening — ${msg.lang}` : "Not listening.");
    }

    if (msg.type === "result") {
      $("interim").textContent = msg.interim;
      if (msg.final) {
        $("final").textContent = msg.final;
        if ($("echo").checked) send({ type: "speak", text: msg.final });
      }
    }

    if (msg.type === "permission") {
      if (msg.state === "granted") {
        $("grant").hidden = true;
        note("Microphone granted — press Listen.");
      } else {
        $("grant").hidden = false;
        note("Microphone was not granted. Click Grant mic to try again.", true);
      }
    }

    if (msg.type === "error") {
      if (msg.error === "microphone-not-granted") {
        $("grant").hidden = false;
        note("Microphone not granted yet — click Grant mic.", true);
      } else if (msg.error === "network") {
        note("Recognition error: network (the recognizer needs internet).", true);
      } else {
        note(`Recognition error: ${msg.error}`, true);
      }
    }
  });

  (document.body || document.documentElement).appendChild(host);
})();
