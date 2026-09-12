// src/overlay/template.js — static Shadow DOM markup for the overlay. index.js queries into
// this by id/class and wires behaviour; nothing here touches chrome.* or does DOM work at
// import time (it is just a template-literal builder).
export function buildHTML() {
  return `
<div class="wrap">
  <div class="panel" id="panel" role="dialog" aria-label="Grammy">
    <div class="panel-head">
      <span class="head-emoji">🐶</span><b>Grammy</b>
      <span class="pill" id="pill">Ready</span>
      <button class="icon-btn" id="gearBtn" type="button" aria-label="Settings" title="Settings">⚙</button>
      <button class="icon-btn" id="closeBtn" type="button" aria-label="Close">×</button>
    </div>

    <div class="persona-row" id="personaRow">
      <button class="persona-btn" id="personaCasual" type="button" data-persona="casual">Casual</button>
      <button class="persona-btn" id="personaInfluencer" type="button" data-persona="influencer">Influencer</button>
    </div>

    <div class="chips-row" id="chips"></div>

    <div class="remembered" id="remembered">
      <button class="remembered-head" id="rememberedToggle" type="button">
        <span>Remembered (<span id="rememberedCount">0</span>)</span>
        <span class="chev">▾</span>
      </button>
      <div class="remembered-body">
        <div id="rememberedList"></div>
        <button class="forget-btn" id="forgetBtn" type="button">Forget everything</button>
      </div>
    </div>

    <div class="log" id="log"></div>

    <div class="attach-preview" id="attachPreview" hidden>
      <img class="attach-thumb" id="attachThumb" alt="Attached photo" />
      <button class="attach-remove" id="attachRemove" type="button" aria-label="Remove attached photo">×</button>
    </div>

    <div class="compose-row">
      <button class="attach-btn" id="attachBtn" type="button" aria-label="Attach my image" title="Attach my image"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
      <input class="text-input" id="textInput" type="text" placeholder="Ask Grammy…" autocomplete="off" spellcheck="false" />
      <button class="ptt-btn" id="pttBtn" type="button" aria-label="Push to talk" title="Hold to talk">🎤</button>
      <button class="send-btn" id="sendBtn" type="button" aria-label="Send">➤</button>
      <input type="file" id="fileInput" accept="image/*" hidden />
    </div>
  </div>

  <div class="dock" id="dock">
    <div class="bubble" id="bubble"></div>
    <div class="hl-ring" id="hlRing" aria-hidden="true"><div class="hl-inner"><div class="hl-pulse"></div><div class="hl-pulse p2"></div><div class="hl-halo"></div><div class="hl-border"></div></div></div>
    <div class="hl-cursor" id="hlCursor" aria-hidden="true"><span class="hl-tapring"></span><div class="hl-cursor-inner"><svg width="30" height="34" viewBox="0 0 30 34"><defs><linearGradient id="gcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fa7e1e"/><stop offset=".55" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/></linearGradient></defs><path d="M3 2 L3 26.5 L9.4 20.6 L13.8 30.6 L18.6 28.5 L14.3 18.7 L23 18.4 Z" fill="url(#gcg)" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div></div>
    <button class="mascot" id="mascot" aria-label="Open Grammy" title="Grammy">🐶</button>
  </div>
</div>`;
}
