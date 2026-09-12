// src/overlay/index.js — STUB (Phase 1): hello mascot 🐶 in a Shadow DOM that opens an
// empty panel on click. The overlay subagent replaces this with the full chat menu.
// Keep the exports (see shared/types.js §7).
import { LIMITS } from '../../shared/types.js';
import { speak } from '../voice/index.js';

const HOST_ID = 'grammy-host';
let root = null;
let menuOpen = false;
const log = [];

const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.wrap {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #262626;
}
.mascot {
  width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; font-size: 30px; line-height: 1;
  background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.18), 0 0 0 2px #fff;
  position: relative; transition: transform .2s cubic-bezier(.34,1.56,.64,1);
}
.mascot::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; z-index: -1;
  background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
}
.mascot:hover { transform: scale(1.06); }
.mascot.bounce { animation: bounce .5s cubic-bezier(.34,1.56,.64,1); }
@keyframes bounce { 0% { transform: translateY(0); } 40% { transform: translateY(-14px) scale(1.08); } 100% { transform: translateY(0); } }
.panel {
  width: 320px; max-width: calc(100vw - 40px); max-height: 60vh; overflow: auto;
  background: #fff; border: 1px solid #dbdbdb; border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,.16);
  opacity: 0; transform: translateY(12px) scale(.96); transform-origin: bottom right;
  transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform ${LIMITS.MENU_ANIM_MS}ms ease, visibility 0s linear ${LIMITS.MENU_ANIM_MS}ms;
  visibility: hidden; pointer-events: none;
}
.panel.open { opacity: 1; transform: none; visibility: visible; pointer-events: auto; transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform ${LIMITS.MENU_ANIM_MS}ms ease, visibility 0s; }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #efefef; }
.head b { font-size: 15px; }
.pill { margin-left: auto; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: #efefef; color: #262626; white-space: nowrap; }
.pill.green { background: #e6f7ec; color: #1d7a3f; }
.pill.yellow { background: #fff4d6; color: #8a5a00; }
.pill.red { background: #fde8e8; color: #b3261e; }
.body { padding: 14px; min-height: 120px; color: #737373; }
.msg { margin: 0 0 8px; padding: 8px 12px; border-radius: 14px; background: #efefef; color: #262626; }
.bubble {
  position: absolute; right: 70px; bottom: 4px; max-width: 260px;
  background: #fff; border: 1px solid #dbdbdb; border-radius: 16px; padding: 10px 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,.14); color: #262626;
  opacity: 0; transform: scale(.9); transform-origin: bottom right;
  transition: opacity .2s ease, transform .2s cubic-bezier(.34,1.56,.64,1);
  pointer-events: none;
}
.bubble.show { opacity: 1; transform: none; pointer-events: auto; cursor: pointer; }
.dock { position: relative; }
`;

const HTML = `
<div class="wrap">
  <div class="panel" id="panel">
    <div class="head"><span>🐶</span><b>Grammy</b><span class="pill" id="pill">Ready</span></div>
    <div class="body" id="body">Hi! I'm Grammy. The chat menu lands here soon.</div>
  </div>
  <div class="dock">
    <div class="bubble" id="bubble"></div>
    <button class="mascot" id="mascot" aria-label="Open Grammy" title="Grammy">🐶</button>
  </div>
</div>`;

function $(id) { return root ? root.getElementById(id) : null; }

/** Idempotent. */
export function mountOverlay() {
  try {
    if (typeof document === 'undefined') return;
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    (document.body || document.documentElement).appendChild(host);

    $('mascot').addEventListener('click', () => toggleMenu());
    $('bubble').addEventListener('click', () => { hideBubble(); toggleMenu(true); });
    // Keep Instagram's keyboard shortcuts from firing while typing in our panel.
    for (const type of ['keydown', 'keyup', 'keypress']) $('panel').addEventListener(type, (e) => e.stopPropagation());
    console.log('[grammy] mascot mounted');
  } catch (e) {
    console.error('[grammy/overlay] mount failed', e);
  }
}

function toggleMenu(open = !menuOpen) {
  menuOpen = open;
  const p = $('panel');
  if (p) p.classList.toggle('open', open);
}

export function isMenuOpen() { return menuOpen; }

let bubbleTimer = 0;
function showBubble(text) {
  const b = $('bubble');
  if (!b) return;
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, LIMITS.BUBBLE_MS);
}
function hideBubble() {
  const b = $('bubble');
  if (b) b.classList.remove('show');
}

function appendLog(role, text) {
  log.push({ role, text, ts: Date.now() });
  const body = $('body');
  if (!body) return;
  if (log.length === 1) body.textContent = '';
  const el = document.createElement('p');
  el.className = 'msg';
  el.textContent = (role === 'user' ? 'You: ' : '') + text;
  body.appendChild(el);
}

/** @param {import('../../shared/types.js').DeliverReplyInput} input */
export async function deliverReply(input) {
  try {
    const { reply, inputMode, menuOpen: open } = input || {};
    if (!open) showBubble(reply);           // bubble only when the menu is closed
    appendLog('assistant', reply);          // log always
    const m = $('mascot');
    if (m) { m.classList.remove('bounce'); void m.offsetWidth; m.classList.add('bounce'); }
    if (inputMode === 'voice') await speak(reply);   // row 19: render first, then speak the SAME string
  } catch (e) {
    console.warn('[grammy/overlay] deliverReply', e);
  }
}

/** @param {'green'|'yellow'|'red'} level @param {string} message */
export function setStatus(level, message) {
  try {
    const p = $('pill');
    if (!p) return;
    p.className = 'pill ' + (level || '');
    p.textContent = message || '';
  } catch (e) {
    /* ignore */
  }
}

export function highlight(_target) { /* stretch: stub */ }
export function clearHighlight() { /* stretch: stub */ }
