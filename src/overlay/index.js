// src/overlay/index.js — full overlay UI: draggable mascot, speech bubble, chat menu.
// Owns the ONE Shadow DOM host for the whole extension. Reuses demos/grammy_overlay_Test/content.js
// for the Shadow DOM setup pattern, IG-gradient styling and bubble placement/flip logic (ported
// into position.js + styles.js), split into small modules per the task brief.
//
// Rule: no chrome.* / DOM access at module top level — everything happens inside mountOverlay()
// and the functions it wires up, so this module still imports cleanly in Node/test pages.
import { PILL, LIMITS, MSG, ERR, STORAGE_KEYS, request, defaultMemory } from '../../shared/types.js';
import { getPageContext, onNavigate, describeStatus, focusedPost } from '../context/index.js';
import { startListening, stopListening, transcribe, speak, stopSpeaking, lastVoiceError } from '../voice/index.js';
import { askAssistant, styleAdvice, getMemory, saveMemory, unpin, forgetAll, getChips } from '../brain/index.js';
import { buildCSS } from './styles.js';
import { buildHTML } from './template.js';
import { downscaleImageFile } from './image.js';
import { computeFloatPosition, fitBubbleText } from './position.js';
import { attachMascotGestures, attachHoldToTalk, attachSpacebarHoldToTalk } from './ptt.js';

const HOST_ID = 'grammy-host';
const POS_KEY = STORAGE_KEYS.MASCOT_POS;

/* =========================================================================
 * Test hook — production code never calls this. Lets src/overlay/test.html inject spies
 * for every external call the overlay makes, since ESM exports of the real modules are
 * read-only and cannot be monkey-patched from outside.
 * ========================================================================= */
let deps = {
  getPageContext, onNavigate, describeStatus, focusedPost,
  startListening, stopListening, transcribe, speak, stopSpeaking,
  askAssistant, styleAdvice, getMemory, saveMemory, unpin, forgetAll, getChips,
  request,
};
/** @param {Partial<typeof deps>} overrides */
export function __setDeps(overrides) {
  deps = { ...deps, ...(overrides || {}) };
}

/* =========================================================================
 * Module state
 * ========================================================================= */
let root = null;          // ShadowRoot
let hostEl = null;
let mounted = false;
let menuOpen = false;
let micAvailable = true;
let pttActive = false;
let detachNav = null;
let lastCtx = null;
let lastStatus = { level: 'green', message: '', ts: 0 };
let pendingAttachedImage = null; // data URL or null
let session = []; // ChatTurn[] for the current in-page session
let dragOrigin = null;
let memPos = null; // in-memory fallback when chrome.storage is unavailable

const $ = (id) => (root ? root.getElementById(id) : null);

/* =========================================================================
 * Mount
 * ========================================================================= */

/** Idempotent. */
export function mountOverlay() {
  try {
    if (typeof document === 'undefined') return;
    if (mounted && document.getElementById(HOST_ID)) return;
    document.getElementById(HOST_ID)?.remove();

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText = 'all:initial;';
    root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${buildCSS()}</style>${buildHTML()}`;
    (document.body || document.documentElement).appendChild(hostEl);

    wireEvents();
    applyDockPos(defaultDockPos());
    mounted = true;

    try { detachNav?.(); } catch (_) { /* ignore */ }
    try { detachNav = deps.onNavigate((url) => { onNav(url); }); } catch (e) { console.warn('[grammy/overlay] onNavigate wiring failed', e); }

    initAsync();
    console.log('[grammy] overlay mounted');
  } catch (e) {
    console.error('[grammy/overlay] mount failed', e);
  }
}

async function initAsync() {
  try {
    const saved = await loadDockPosition();
    if (saved) applyDockPos(saved);
  } catch (e) { /* ignore, keep default */ }
  try {
    const ctx = await deps.getPageContext();
    lastCtx = ctx;
    const info = deps.describeStatus(ctx);
    setStatus(info.level, info.message);
    const mem = await deps.getMemory();
    setPersonaUI(mem.profile.persona);
    renderChips(ctx.pageType, mem.profile.persona, ctx);
    renderRemembered(mem);
  } catch (e) {
    console.warn('[grammy/overlay] initAsync failed', e);
  }
}

async function onNav(url) {
  try {
    const ctx = await deps.getPageContext();
    lastCtx = ctx;
    const info = deps.describeStatus(ctx);
    setStatus(info.level, info.message);
    const mem = await deps.getMemory();
    renderChips(ctx.pageType, mem.profile.persona, ctx);
  } catch (e) {
    console.warn('[grammy/overlay] onNav failed', e);
  }
}

/* =========================================================================
 * Wiring
 * ========================================================================= */
function wireEvents() {
  const panel = $('panel');
  const mascot = $('mascot');
  const bubble = $('bubble');
  const dock = $('dock');
  const closeBtn = $('closeBtn');
  const gearBtn = $('gearBtn');
  const textInput = $('textInput');
  const sendBtn = $('sendBtn');
  const pttBtn = $('pttBtn');
  const attachBtn = $('attachBtn');
  const fileInput = $('fileInput');
  const attachRemove = $('attachRemove');
  const personaCasual = $('personaCasual');
  const personaInfluencer = $('personaInfluencer');
  const rememberedToggle = $('rememberedToggle');
  const forgetBtn = $('forgetBtn');

  // Keep Instagram's own keyboard shortcuts (and our Space-PTT listener) from firing while
  // the user is interacting with our panel.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(type, (e) => e.stopPropagation());
  }

  bubble.addEventListener('click', () => { hideBubble(true); setMenuOpen(true); });
  closeBtn.addEventListener('click', () => setMenuOpen(false));
  gearBtn.addEventListener('click', () => { try { deps.request(MSG.OPEN_ONBOARDING); } catch (e) { console.warn(e); } });

  attachMascotGestures(mascot, {
    dragThreshold: 6,
    longPressMs: LIMITS.LONG_PRESS_MS,
    onTap: () => { hideBubble(true); setMenuOpen(!menuOpen); },
    onLongPressStart: () => beginPTT('mascot'),
    onLongPressEnd: () => endPTT(),
    onDragStart: () => dockStartDrag(),
    onDragMove: (dx, dy) => dockDragMove(dx, dy),
    onDragEnd: () => dockDragEnd(),
  });

  attachHoldToTalk(pttBtn, {
    onStart: () => beginPTT('button'),
    onEnd: () => endPTT(),
  });

  attachSpacebarHoldToTalk({
    isBlocked: spaceBlocked,
    onStart: () => beginPTT('space'),
    onEnd: () => endPTT(),
  });

  sendBtn.addEventListener('click', onSendClick);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendClick(); }
  });

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', onFileChosen);
  attachRemove.addEventListener('click', clearAttachedImage);

  personaCasual.addEventListener('click', () => onPersonaChange('casual'));
  personaInfluencer.addEventListener('click', () => onPersonaChange('influencer'));

  rememberedToggle.addEventListener('click', () => {
    $('remembered').classList.toggle('open');
  });
  forgetBtn.addEventListener('click', onForgetEverything);

  void dock; // referenced via applyDockPos()
}

function spaceBlocked() {
  const ae = document.activeElement;
  if (!ae) return false;
  if (ae === hostEl) return true; // focus delegated into our own shadow DOM (our text input)
  const tag = ae.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (ae.isContentEditable) return true;
  return false;
}

/* =========================================================================
 * Menu open/close + positioning
 * ========================================================================= */
export function isMenuOpen() { return menuOpen; }

function setMenuOpen(open) {
  menuOpen = !!open;
  const panel = $('panel');
  if (!panel) return;
  if (menuOpen) {
    hideBubble();
    positionPanel();
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

function positionPanel() {
  const panel = $('panel');
  const dock = $('dock');
  if (!panel || !dock) return;
  const anchor = dock.getBoundingClientRect();
  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  const w = panel.offsetWidth || 328;
  const h = Math.min(panel.scrollHeight || 420, (window.innerHeight || 800) - 24);
  const pos = computeFloatPosition(anchor, { width: w, height: h }, 16);
  panel.style.left = pos.x + 'px';
  panel.style.top = pos.y + 'px';
}

/* =========================================================================
 * Dock drag + position persistence
 * ========================================================================= */
function defaultDockPos() {
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 900;
  return { x: Math.max(8, vw - 20 - 56), y: Math.max(8, vh - 20 - 56) };
}

function applyDockPos(pos) {
  const dock = $('dock');
  if (!dock || !pos) return;
  dock.style.left = pos.x + 'px';
  dock.style.top = pos.y + 'px';
  dock.style.right = 'auto';
  dock.style.bottom = 'auto';
}

function dockStartDrag() {
  const dock = $('dock');
  if (!dock) return;
  const r = dock.getBoundingClientRect();
  dragOrigin = { x: r.left, y: r.top };
  dock.classList.add('dragging');
}

function dockDragMove(dx, dy) {
  const dock = $('dock');
  if (!dock || !dragOrigin) return;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 900;
  const x = Math.max(4, Math.min(dragOrigin.x + dx, vw - dock.offsetWidth - 4));
  const y = Math.max(4, Math.min(dragOrigin.y + dy, vh - dock.offsetHeight - 4));
  applyDockPos({ x, y });
}

function dockDragEnd() {
  const dock = $('dock');
  dock?.classList.remove('dragging');
  if (dock) {
    const r = dock.getBoundingClientRect();
    saveDockPosition({ x: r.left, y: r.top });
  }
  dragOrigin = null;
}

async function loadDockPosition() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(POS_KEY);
      return (res && res[POS_KEY]) || memPos;
    }
  } catch (e) { /* fall through to memory */ }
  return memPos;
}

async function saveDockPosition(pos) {
  memPos = pos;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [POS_KEY]: pos });
    }
  } catch (e) { /* ignore, memory fallback already set */ }
}

/* =========================================================================
 * Bubble (row 18: flip on overflow, truncate as a last resort)
 * ========================================================================= */
let bubbleTimer = 0;

let bubbleLocked = false; // true while the reply is being spoken: only a tap may dismiss it
function showBubble(fullText, lock = false) {
  const bubble = $('bubble');
  const dock = $('dock');
  if (!bubble || !dock) return;
  clearTimeout(bubbleTimer);
  bubbleLocked = !!lock;
  bubble.classList.remove('show');
  void bubble.offsetWidth; // restart the pop-in animation
  bubble.classList.add('show');
  bubble.classList.toggle('speaking', !!lock);
  bubble.classList.remove('thinking');
  bubble.style.maxWidth = '280px';
  bubble.textContent = fullText;
  positionBubble(fullText);
  if (!lock) bubbleTimer = setTimeout(() => hideBubble(true), LIMITS.BUBBLE_MS);
}

/** Three bouncing dots beside the mascot while the model works (menu closed). Replaced by the reply. */
function showThinkingBubble() {
  const bubble = $('bubble');
  const dock = $('dock');
  if (!bubble || !dock) return;
  clearTimeout(bubbleTimer);
  bubbleLocked = true;
  bubble.classList.remove('speaking');
  bubble.classList.add('show', 'thinking');
  bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  positionBubble('...');
}

/** The user interrupted the spoken reply: unlock the bubble and let it fade on the normal timer. */
function releaseBubbleIfSpeaking() {
  if (bubbleLocked && $('bubble')?.classList.contains('speaking')) releaseBubble();
}

/** Speech finished: unlock and start the normal auto-dismiss timer. */
function releaseBubble() {
  bubbleLocked = false;
  $('bubble')?.classList.remove('speaking');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => hideBubble(true), LIMITS.BUBBLE_MS);
}

function positionBubble(fullText) {
  const bubble = $('bubble');
  const dock = $('dock');
  if (!bubble || !dock) return;
  bubble.style.left = '0px';
  bubble.style.top = '0px';
  let anchor = dock.getBoundingClientRect();
  let pos = computeFloatPosition(anchor, { width: bubble.offsetWidth, height: bubble.offsetHeight }, 12);
  bubble.style.left = pos.x + 'px';
  bubble.style.top = pos.y + 'px';

  const maxH = (window.innerHeight || 800) - 24;
  if (bubble.offsetHeight > maxH) {
    fitBubbleText(bubble, fullText, maxH);
    anchor = dock.getBoundingClientRect();
    pos = computeFloatPosition(anchor, { width: bubble.offsetWidth, height: bubble.offsetHeight }, 12);
    bubble.style.left = pos.x + 'px';
    bubble.style.top = pos.y + 'px';
  }
}

function hideBubble(force = false) {
  if (bubbleLocked && !force) return;
  bubbleLocked = false;
  clearTimeout(bubbleTimer);
  const b = $('bubble');
  if (b) { b.classList.remove('show', 'speaking', 'thinking'); }
}

function bounceMascot() {
  const m = $('mascot');
  if (!m) return;
  m.classList.remove('bounce');
  void m.offsetWidth;
  m.classList.add('bounce');
}

/* =========================================================================
 * Chat log
 * ========================================================================= */
function appendLog(role, text) {
  const logEl = $('log');
  if (!logEl) return;
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}

function appendSettingsLink() {
  const logEl = $('log');
  if (!logEl) return;
  const el = document.createElement('div');
  el.className = 'msg system';
  el.append('No API key set — ');
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'settings-link';
  link.textContent = 'Open settings';
  link.addEventListener('click', () => { try { deps.request(MSG.OPEN_ONBOARDING); } catch (e) { console.warn(e); } });
  el.appendChild(link);
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}

function showTyping(on) {
  const logEl = $('log');
  if (!logEl) return;
  const existing = logEl.querySelector('#grammyTyping');
  if (on) {
    if (existing) return;
    const row = document.createElement('div');
    row.id = 'grammyTyping';
    row.className = 'msg assistant typing';
    row.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  } else {
    existing?.remove();
  }
}

/* =========================================================================
 * Status pill (row 13/9: bg-pushed pills stay visible >= 10s before being overwritten
 * by the page's own describeStatus() result)
 * ========================================================================= */
export function setStatus(level, message) {
  try {
    const wasNoKey = lastStatus.message === PILL.NO_KEY.message;
    lastStatus = { level, message, ts: Date.now() };
    const pillEl = $('pill');
    if (pillEl) {
      pillEl.className = 'pill ' + (level || '');
      pillEl.textContent = message || '';
    }
    if (message === PILL.NO_KEY.message && !wasNoKey) appendSettingsLink();
  } catch (e) {
    console.warn('[grammy/overlay] setStatus failed', e);
  }
}

function restoreStatus(ctx) {
  try {
    const isBgPill = lastStatus.message === PILL.NO_KEY.message || lastStatus.message === PILL.UNAVAILABLE.message;
    if (isBgPill && Date.now() - lastStatus.ts < 10000) return; // keep it visible
    const info = deps.describeStatus(ctx);
    setStatus(info.level, info.message);
  } catch (e) {
    console.warn('[grammy/overlay] restoreStatus failed', e);
  }
}

/* =========================================================================
 * Ask flow (text + voice) and style advice
 * ========================================================================= */
async function safeGetPageContext() {
  try { return await deps.getPageContext(); }
  catch (e) { return { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: '' }; }
}
async function safeGetMemory() {
  try { return await deps.getMemory(); }
  catch (e) { return defaultMemory(); }
}

/** Local intent guess so "how do I …" always points at the control, even if the model forgets. */
function guessHighlightTarget(text) {
  const q = String(text || '').toLowerCase();
  if (!/(how|where|show|teach|help)/.test(q)) return null;
  if (/(like|heart|love)/.test(q)) return 'like_button';
  if (/(save|bookmark|keep)/.test(q)) return 'save_button';
  if (/(share|send|forward|repost)/.test(q)) return 'share_button';
  if (/caption/.test(q)) return 'caption_box';
  if (/(comment|reply|respond)/.test(q)) return 'comment_box';
  return null;
}

async function runAsk({ text, inputMode }) {
  try {
    session.push({ role: 'user', text, inputMode, ts: Date.now() });
    if (session.length > 50) session = session.slice(-50);
    appendLog('user', text);
    showTyping(true);
    if (!isMenuOpen()) showThinkingBubble();
    setStatus(PILL.THINKING.level, PILL.THINKING.message);

    const ctx = await safeGetPageContext();
    lastCtx = ctx;
    const memBefore = await safeGetMemory();
    const persona = (memBefore.profile && memBefore.profile.persona) || 'casual';
    const attachedImage = pendingAttachedImage;

    let result;
    try {
      result = await deps.askAssistant({ messages: session, pageContext: ctx, memory: memBefore, persona, inputMode, attachedImage });
    } catch (e) {
    hideBubble(true);
      result = { reply: "Something went wrong on my side, but you can keep typing.", highlightTarget: null, memoryUpdate: null, notice: null };
    }

    showTyping(false);
    session.push({ role: 'assistant', text: result.reply, ts: Date.now() });
    await deliverReply({ reply: result.reply, inputMode, menuOpen: isMenuOpen() });
    const target = result.highlightTarget || guessHighlightTarget(text);
    if (target) highlight(target);
    if (result.notice) appendLog('system', result.notice);
    clearAttachedImage();

    const memAfter = await safeGetMemory();
    setPersonaUI(memAfter.profile.persona);
    renderRemembered(memAfter);
    renderChips(ctx.pageType, memAfter.profile.persona, ctx);
    restoreStatus(ctx);
  } catch (e) {
    console.warn('[grammy/overlay] runAsk failed', e);
    showTyping(false);
  }
}

async function runStyleAdvice() {
  try {
    appendLog('user', 'Match this style');
    showTyping(true);
    setStatus(PILL.THINKING.level, PILL.THINKING.message);
    const ctx = await safeGetPageContext();
    lastCtx = ctx;
    const memory = await safeGetMemory();
    const attachedImage = pendingAttachedImage;

    let result;
    try {
      result = await deps.styleAdvice({ pageContext: ctx, attachedImage, memory });
    } catch (e) {
      result = { reply: 'Open a post or attach a photo of yours first.', needsInput: true };
    }

    showTyping(false);
    session.push({ role: 'assistant', text: result.reply, ts: Date.now() });
    await deliverReply({ reply: result.reply, inputMode: 'text', menuOpen: isMenuOpen() });
    clearAttachedImage();
    if (result.needsInput) pulseAttachButton();
    restoreStatus(ctx);
  } catch (e) {
    console.warn('[grammy/overlay] runStyleAdvice failed', e);
    showTyping(false);
  }
}

/** @param {import('../../shared/types.js').DeliverReplyInput} input */
export async function deliverReply(input) {
  try {
    const { reply, inputMode, menuOpen: open } = input || {};
    const text = reply == null ? '' : String(reply);
    const speakIt = inputMode === 'voice';
    if (!open) showBubble(text, speakIt); else hideBubble(true);
    appendLog('assistant', text);
    bounceMascot();
    if (speakIt) {
      await deps.speak(text); // row 19: bubble+log render first, then speak the SAME string
      if (!open) releaseBubble(); // stays up while speaking, then the normal 8 s timer
    }
  } catch (e) {
    console.warn('[grammy/overlay] deliverReply failed', e);
  }
}

function onSendClick() {
  const textInput = $('textInput');
  if (!textInput) return;
  const val = textInput.value.trim();
  if (!val) return;
  textInput.value = '';
  runAsk({ text: val, inputMode: 'text' });
}

function focusTextInput() {
  setMenuOpen(true);
  try { $('textInput')?.focus(); } catch (e) { /* ignore */ }
}

/* =========================================================================
 * Push-to-talk (mascot long-press, panel button, Space bar)
 * ========================================================================= */
async function beginPTT(_source) {
  if (pttActive || !micAvailable) return;
  pttActive = true;
  try { deps.stopSpeaking(); } catch (e) { /* ignore */ } // the user is talking: stop the spoken reply
  releaseBubbleIfSpeaking();
  $('mascot')?.classList.add('listening');
  try {
    const res = await deps.startListening();
    if (!res || res.ok === false) {
      pttActive = false;
      $('mascot')?.classList.remove('listening');
      const code = res && res.error && res.error.code;
      if (code === ERR.MIC_DENIED || code === ERR.MIC_UNAVAILABLE) {
        handleMicUnavailable();
      } else {
        setStatus(PILL.DIDNT_CATCH.level, PILL.DIDNT_CATCH.message);
      }
      return;
    }
    setStatus(PILL.LISTENING.level, PILL.LISTENING.message);
  } catch (e) {
    pttActive = false;
    $('mascot')?.classList.remove('listening');
    console.warn('[grammy/overlay] startListening failed', e);
  }
}

async function endPTT() {
  if (!pttActive) return;
  pttActive = false;
  $('mascot')?.classList.remove('listening');
  try {
    const blob = await deps.stopListening();
    if (!blob) {
      setStatus(PILL.DIDNT_CATCH.level, PILL.DIDNT_CATCH.message);
      const e = lastVoiceError();
      appendLog('system', 'Recording failed' + (e ? ` (${e.code}: ${e.message})` : '') + ' — hold the mascot or Space a little longer, then speak.');
      focusTextInput();
      return;
    }
    const text = await deps.transcribe(blob);
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < LIMITS.MIN_TRANSCRIPT_WORDS) {
      setStatus(PILL.DIDNT_CATCH.level, PILL.DIDNT_CATCH.message); // row 8
      const e = lastVoiceError();
      appendLog('system', text && text.trim()
        ? `Heard only "${text.trim()}" — try a full question of a few words.`
        : 'Transcription failed' + (e ? ` (${e.code}: ${e.message})` : '') + ' — check the API key, or type instead.');
      focusTextInput();
      return;
    }
    await runAsk({ text: text.trim(), inputMode: 'voice' });
  } catch (e) {
    console.warn('[grammy/overlay] PTT flow failed', e);
    setStatus(PILL.DIDNT_CATCH.level, PILL.DIDNT_CATCH.message);
  }
}

function handleMicUnavailable() {
  micAvailable = false;
  const pttBtn = $('pttBtn');
  if (pttBtn) pttBtn.hidden = true;
  setStatus(PILL.MIC_OFF.level, PILL.MIC_OFF.message); // row 7
  setMenuOpen(true);
  try { $('textInput')?.focus(); } catch (e) { /* ignore */ }
}

/* =========================================================================
 * Attach my image (row 15)
 * ========================================================================= */
async function onFileChosen(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const dataUrl = await downscaleImageFile(file, { maxPx: LIMITS.IMAGE_MAX_PX, maxBytes: LIMITS.IMAGE_MAX_BYTES });
    pendingAttachedImage = dataUrl;
    showAttachPreview(dataUrl);
  } catch (err) {
    console.warn('[grammy/overlay] image attach failed', err);
  }
}

function showAttachPreview(dataUrl) {
  const preview = $('attachPreview');
  const thumb = $('attachThumb');
  if (!preview || !thumb) return;
  thumb.src = dataUrl;
  preview.hidden = false;
}

function clearAttachedImage() {
  pendingAttachedImage = null;
  const preview = $('attachPreview');
  const thumb = $('attachThumb');
  if (preview) preview.hidden = true;
  if (thumb) thumb.src = '';
}

function pulseAttachButton() {
  const btn = $('attachBtn');
  if (!btn) return;
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 1600);
}

/* =========================================================================
 * Persona toggle
 * ========================================================================= */
function setPersonaUI(persona) {
  $('personaCasual')?.classList.toggle('active', persona === 'casual');
  $('personaInfluencer')?.classList.toggle('active', persona === 'influencer');
}

async function onPersonaChange(persona) {
  setPersonaUI(persona);
  try {
    const mem = await deps.saveMemory({ profile: { persona } });
    const pageType = lastCtx ? lastCtx.pageType : 'unknown';
    renderChips(pageType, mem.profile.persona, lastCtx);
  } catch (e) {
    console.warn('[grammy/overlay] persona change failed', e);
  }
}

/* =========================================================================
 * Chips
 * ========================================================================= */
function renderChips(pageType, persona, pageContext) {
  const wrap = $('chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  let list = [];
  try { list = deps.getChips({ pageType, persona, pageContext: pageContext || lastCtx || null }) || []; } catch (e) { list = []; }
  for (const text of list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => onChipClick(text));
    wrap.appendChild(b);
  }
}

function onChipClick(text) {
  if (text === 'Paste the caption') { focusTextInput(); return; } // row 4
  if (text === 'Match this style') { runStyleAdvice(); return; }
  runAsk({ text, inputMode: 'text' });
}

/* =========================================================================
 * Remembered panel
 * ========================================================================= */
function renderRemembered(memory) {
  const list = $('rememberedList');
  const count = $('rememberedCount');
  if (!list) return;
  const items = [...((memory && memory.pinned) || [])].sort((a, b) => b.score - a.score);
  if (count) count.textContent = String(items.length);
  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'remembered-empty';
    empty.textContent = 'Nothing remembered yet.';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'pin-row';

    const kind = document.createElement('span');
    kind.className = 'pin-kind';
    kind.textContent = item.kind;
    row.appendChild(kind);

    const main = document.createElement('div');
    main.className = 'pin-main';
    const content = document.createElement('div');
    content.className = 'pin-content';
    content.textContent = item.content;
    main.appendChild(content);
    if (item.source && item.source.username) {
      const src = document.createElement('div');
      src.className = 'pin-source';
      src.textContent = '@' + item.source.username;
      main.appendChild(src);
    }
    row.appendChild(main);

    const del = document.createElement('button');
    del.className = 'pin-del';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete');
    del.textContent = '×';
    del.addEventListener('click', async () => {
      try {
        const mem = await deps.unpin(item.id);
        renderRemembered(mem);
      } catch (e) { console.warn('[grammy/overlay] unpin failed', e); }
    });
    row.appendChild(del);

    list.appendChild(row);
  }
}

async function onForgetEverything() {
  try {
    let go = true;
    if (typeof confirm === 'function') {
      try { go = confirm('Forget everything Grammy remembers about you? This cannot be undone.'); }
      catch (e) { go = true; }
    }
    if (!go) return;
    const mem = await deps.forgetAll();
    renderRemembered(mem);
  } catch (e) {
    console.warn('[grammy/overlay] forgetAll failed', e);
  }
}

/* =========================================================================
 * Stretch stubs
 * ========================================================================= */
/* =========================================================================
 * Highlight — ported lean from demos/grammy_overlay_Test: find the Instagram control by its
 * aria-label, draw a pulsing IG-gradient ring around it and follow it for a few seconds.
 * Never clicks anything.
 * ========================================================================= */
const HL_LABELS = {
  like_button: ['Like', 'Unlike'],
  save_button: ['Save', 'Remove'],
  share_button: ['Share Post', 'Share'],
  comment_box: ['Comment'],
  caption_box: ['Write a caption...', 'Write a caption…'],
};
let hlRaf = 0;
let hlTimer = 0;
let hlEl = null;

function hlVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function hlFind(target) {
  const labels = (HL_LABELS[target] || []).map((s) => s.toLowerCase());
  const cands = [];
  if (target === 'comment_box' || target === 'caption_box') {
    document.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => {
      const l = ((el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')).toLowerCase();
      if ((target === 'comment_box' && /comment/.test(l)) || (target === 'caption_box' && /caption/.test(l))) cands.push(el);
    });
  }
  document.querySelectorAll('svg[aria-label], [aria-label]:not(svg)').forEach((node) => {
    const l = (node.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!labels.includes(l)) return;
    const c = node.closest('a, button, [role="button"]') || node.parentElement || node;
    const r = c.getBoundingClientRect();
    if (r.width > innerWidth * 0.6 || r.height > innerHeight * 0.5) return;
    if (target !== 'comment_box' && target !== 'caption_box' && r.width < 18) return; // tiny hearts on comments
    cands.push(c);
  });
  let best = null; let bestD = Infinity;
  for (const el of cands) {
    if (!hlVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < innerHeight;
    const d = Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2) + (onScreen ? 0 : 5000);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}

// Damped springs (ported from demos/grammy_overlay_Test): ring follows the target, the cursor glides
// in on a curve (different stiffness per axis) and "taps" once it settles.
const hlS = { x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, vw: 0, vh: 0, cx: 0, cy: 0, vcx: 0, vcy: 0, last: 0, init: false };
function spring(o, k, target, stiff, damp, dt) { const v = 'v' + k; o[v] += (stiff * (target - o[k]) - damp * o[v]) * dt; o[k] += o[v] * dt; }

function hlTick(now) {
  const ring = $('hlRing'); const cur = $('hlCursor');
  if (!ring || !cur || !hlEl) return;
  if (!hlVisible(hlEl)) { ring.classList.remove('show'); cur.classList.remove('show'); hlRaf = requestAnimationFrame(hlTick); return; }
  const t = now || performance.now();
  const dt = Math.min((t - (hlS.last || t)) / 1000, 1 / 30); hlS.last = t;
  const r = hlEl.getBoundingClientRect();
  const pad = Math.max(6, Math.min(10, Math.min(r.width, r.height) * 0.25));
  const T = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  if (!hlS.init) {
    Object.assign(hlS, { x: T.x - 40, y: T.y - 40, w: T.w + 80, h: T.h + 80, vx: 0, vy: 0, vw: 0, vh: 0, init: true });
    const d = $('dock')?.getBoundingClientRect(); hlS.cx = d ? d.left + 10 : innerWidth - 60; hlS.cy = d ? d.top + 10 : innerHeight - 60; hlS.vcx = 0; hlS.vcy = 0;
  }
  spring(hlS, 'x', T.x, 190, 21, dt); spring(hlS, 'y', T.y, 190, 21, dt);
  spring(hlS, 'w', T.w, 160, 19, dt); spring(hlS, 'h', T.h, 160, 19, dt);
  const w = Math.max(hlS.w, 8), h = Math.max(hlS.h, 8);
  const circle = Math.max(w, h) / Math.min(w, h) < 1.45;
  ring.style.transform = 'translate3d(' + hlS.x + 'px, ' + hlS.y + 'px, 0)';
  ring.style.width = w + 'px'; ring.style.height = h + 'px';
  ring.style.borderRadius = (circle ? Math.min(w, h) / 2 : 14) + 'px';
  ring.style.setProperty('--d', Math.hypot(w, h) * 1.15 + 'px');
  ring.classList.add('show');
  // cursor tip aims just inside the control
  const tipX = T.x + Math.min(T.w * 0.62, T.h * 0.8), tipY = T.y + T.h * 0.64;
  spring(hlS, 'cx', tipX, 75, 15, dt); spring(hlS, 'cy', tipY, 48, 12.5, dt);
  const tilt = Math.max(-14, Math.min(14, hlS.vcx * 0.025));
  cur.style.transform = 'translate3d(' + (hlS.cx - 3) + 'px, ' + (hlS.cy - 2) + 'px, 0) rotate(' + tilt + 'deg)';
  cur.classList.add('show');
  const dist = Math.hypot(tipX - hlS.cx, tipY - hlS.cy), speed = Math.hypot(hlS.vcx, hlS.vcy);
  if (dist < 3 && speed < 25) cur.classList.add('tap'); else if (dist > 10) cur.classList.remove('tap');
  hlRaf = requestAnimationFrame(hlTick);
}

export function highlight(target) {
  try {
    clearHighlight();
    if (!target || !HL_LABELS[target]) return;
    const el = hlFind(target);
    if (!el) return;
    hlEl = el; hlS.init = false; hlS.last = 0;
    try { const r = el.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 80) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
    hlRaf = requestAnimationFrame(hlTick);
    hlTimer = setTimeout(clearHighlight, 12000);
    // any click or Escape anywhere dismisses the highlight (the ring is pointer-events: none)
    setTimeout(() => {
      document.addEventListener('pointerdown', clearHighlight, { capture: true, once: true });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearHighlight(); }, { capture: true, once: true });
    }, 0);
  } catch (e) {
    console.warn('[grammy/overlay] highlight failed', e);
  }
}

export function clearHighlight() {
  try {
    cancelAnimationFrame(hlRaf); hlRaf = 0;
    clearTimeout(hlTimer); hlTimer = 0;
    hlEl = null;
    $('hlRing')?.classList.remove('show');
    $('hlCursor')?.classList.remove('show', 'tap');
  } catch (e) { /* ignore */ }
}

