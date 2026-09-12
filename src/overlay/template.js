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
      <button class="attach-btn" id="attachBtn" type="button" aria-label="Attach my image" title="Attach my image">📎</button>
      <input class="text-input" id="textInput" type="text" placeholder="Ask Grammy…" autocomplete="off" spellcheck="false" />
      <button class="ptt-btn" id="pttBtn" type="button" aria-label="Push to talk" title="Hold to talk">🎤</button>
      <button class="send-btn" id="sendBtn" type="button" aria-label="Send">➤</button>
      <input type="file" id="fileInput" accept="image/*" hidden />
    </div>
  </div>

  <div class="dock" id="dock">
    <div class="bubble" id="bubble"></div>
    <button class="mascot" id="mascot" aria-label="Open Grammy" title="Grammy">🐶</button>
  </div>
</div>`;
}
