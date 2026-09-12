// src/overlay/index.js — STUB (Phase 1 "hello mascot"). A 🐶 in a Shadow DOM, bottom-right, that opens an
// empty panel on click. The overlay subagent replaces this with the full chat menu, speech bubble,
// PTT, chips, status pill, attach button and Remembered panel.
// Interface: mountOverlay, deliverReply, setStatus, highlight, clearHighlight — see shared/types.js.

const HOST_ID = 'grammy-overlay-host';
let shadow = null;
let menuOpen = false;

const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.root {
  --grad: linear-gradient(45deg, #f09433, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888);
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #262626; -webkit-font-smoothing: antialiased;
}
.mascot {
  width: 60px; height: 60px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  display: grid; place-items: center; font-size: 32px; line-height: 1;
  background: #fff; position: relative;
  box-shadow: 0 8px 24px rgba(0,0,0,.18), 0 0 0 3px #fff;
  transition: transform .2s cubic-bezier(.34,1.56,.64,1);
}
.mascot::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; z-index: -1;
  background: var(--grad);
}
.mascot:hover { transform: scale(1.06); }
.mascot:active { transform: scale(.94); }
.mascot.bounce { animation: bounce .5s cubic-bezier(.34,1.56,.64,1); }
@keyframes bounce { 0% { transform: translateY(0) } 35% { transform: translateY(-14px) scale(1.05) } 100% { transform: translateY(0) } }
.panel {
  width: 340px; max-width: calc(100vw - 40px); max-height: min(520px, calc(100vh - 120px));
  background: #fff; border: 1px solid #dbdbdb; border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,.18);
  display: flex; flex-direction: column; overflow: hidden;
  transform-origin: bottom right;
  opacity: 0; transform: translateY(12px) scale(.96); visibility: hidden;
  transition: opacity .2s ease, transform .2s ease, visibility 0s linear .2s;
}
.panel.open { opacity: 1; transform: none; visibility: visible; transition: opacity .2s ease, transform .2s ease, visibility 0s; }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #efefef; }
.head b { font-size: 15px; }
.pill { margin-left: auto; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: #efefef; color: #555; }
.pill.green { background: #e7f7ec; color: #1a7f37; }
.pill.yellow { background: #fff4d6; color: #9a6700; }
.pill.red { background: #fde8e8; color: #c0392b; }
.log { flex: 1; min-height: 160px; padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.empty { margin: auto; color: #8e8e8e; font-size: 13px; text-align: center; }
.msg { max-width: 85%; padding: 8px 12px; border-radius: 16px; font-size: 13.5px; }
.msg.user { align-self: flex-end; background: var(--grad); color: #fff; }
.msg.assistant { align-self: flex-start; background: #efefef; }
.msg.notice { align-self: center; background: none; color: #8e8e8e; font-size: 12px; }
`;

const HTML = `
<div class="root">
  <div class="panel" id="panel" role="dialog" aria-label="Grammy">
    <div class="head"><span>🐶</span><b>Grammy</b><span class="pill" id="pill">ready</span></div>
    <div class="log" id="log"><div class="empty" id="empty">Hi! I'm Grammy. Nothing here yet.</div></div>
  </div>
  <button class="mascot" id="mascot" aria-label="Open Grammy" title="Grammy">🐶</button>
</div>`;

function $(id) { return shadow ? shadow.getElementById(id) : null; }

/** Idempotent. Injects the Shadow DOM host. */
export function mountOverlay() {
  try {
    if (typeof document === 'undefined') return;
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
    (document.body || document.documentElement).appendChild(host);
    $('mascot').addEventListener('click', () => toggleMenu());
    shadow.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') toggleMenu(false); });
    console.log('[grammy] mascot mounted');
  } catch (e) {
    console.error('[overlay stub] mount failed', e);
  }
}

function toggleMenu(open = !menuOpen) {
  menuOpen = open;
  $('panel')?.classList.toggle('open', open);
}

function appendLog(role, text) {
  const log = $('log');
  if (!log) return;
  $('empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

/** @param {import('../../shared/types.js').DeliverReplyInput} input */
export async function deliverReply({ reply, inputMode, menuOpen: isOpen } = {}) {
  try {
    appendLog('assistant', String(reply ?? ''));
    $('mascot')?.classList.remove('bounce');
    void $('mascot')?.offsetWidth;
    $('mascot')?.classList.add('bounce');
    if (!isOpen) console.log('[overlay stub] would show bubble:', reply);
    if (inputMode === 'voice') console.log('[overlay stub] would speak:', reply);
  } catch (e) {
    console.warn('[overlay stub] deliverReply failed', e);
  }
}

/** @param {'green'|'yellow'|'red'} level @param {string} message */
export function setStatus(level, message) {
  try {
    const pill = $('pill');
    if (!pill) return;
    pill.className = `pill ${level}`;
    pill.textContent = message || level;
  } catch (e) { /* ignore */ }
}

/** Stretch — stub. @param {string} _target */
export function highlight(_target) { /* stub: returns immediately */ }
export function clearHighlight() { /* stub */ }
