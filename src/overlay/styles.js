// src/overlay/styles.js — all overlay CSS, injected into the Shadow DOM by index.js.
// IG-native palette + the IG gradient on the PTT button and mascot ring; spring-ish
// cubic-bezier easing for the "IG feel" (bounce/scale), ported from demos/grammy_overlay_Test.
import { LIMITS } from '../../shared/types.js';

const IG_GRADIENT = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)';
const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';

export function buildCSS() {
  return `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap {
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #262626;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; background: none; }
input { font: inherit; color: inherit; }

/* ---------------- dock (draggable mascot + bubble) ---------------- */
.dock {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  width: 56px; height: 56px; touch-action: none;
}
.dock.dragging .mascot { cursor: grabbing; transform: scale(1.04); }
.mascot { position: relative;
  width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; font-size: 30px; line-height: 1;
  background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.18), 0 0 0 2px #fff;
  position: relative; transition: transform .2s ${SPRING};
  touch-action: none; user-select: none;
}
.mascot::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; z-index: -1;
  background: ${IG_GRADIENT};
}
.mascot:hover { transform: scale(1.06); }
.mascot.bounce { animation: grammy-bounce .5s ${SPRING}; }
.mascot.listening { animation: grammy-pulse 1.1s ease-in-out infinite; box-shadow: 0 0 0 4px rgba(220,39,67,.35), 0 0 22px rgba(220,39,67,.6); }
.mascot.listening::after { content: '● Listening…'; position: absolute; right: 0; bottom: calc(100% + 8px); white-space: nowrap; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; background: linear-gradient(45deg,#dc2743,#cc2366); padding: 6px 10px; border-radius: 999px; box-shadow: 0 4px 12px rgba(0,0,0,.2); animation: grammy-pulse 1.1s ease-in-out infinite; }
@keyframes grammy-bounce {
  0% { transform: translateY(0); }
  40% { transform: translateY(-14px) scale(1.08); }
  100% { transform: translateY(0); }
}
@keyframes grammy-pulse {
  0%, 100% { box-shadow: 0 6px 20px rgba(0,0,0,.18), 0 0 0 2px #fff, 0 0 0 0 rgba(220,39,67,.5); }
  50% { box-shadow: 0 6px 20px rgba(0,0,0,.18), 0 0 0 2px #fff, 0 0 0 10px rgba(220,39,67,0); }
}

/* ---------------- highlight ring + ghost cursor (ported from demos/grammy_overlay_Test) ---------------- */
.hl-ring { position: fixed; left: 0; top: 0; z-index: 2147483646; pointer-events: none; opacity: 0; transition: opacity .35s ease; will-change: transform; }
.hl-ring.show { opacity: 1; }
.hl-inner { position: absolute; inset: 0; border-radius: inherit; animation: grammy-breathe 2.6s ease-in-out infinite; }
.hl-halo { position: absolute; inset: 0; border-radius: inherit; animation: grammy-halo 4s ease-in-out infinite; }
.hl-border { position: absolute; inset: 0; border-radius: inherit; padding: 3px; overflow: hidden;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
.hl-border::before { content: ""; position: absolute; left: 50%; top: 50%; width: var(--d, 200px); height: var(--d, 200px); margin: calc(var(--d, 200px) / -2) 0 0 calc(var(--d, 200px) / -2);
  background: conic-gradient(from 0deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #d62976, #fa7e1e, #feda75); animation: grammy-spin 2.8s linear infinite; }
.hl-pulse { position: absolute; inset: 0; border-radius: inherit; border: 2px solid rgba(250,126,30,.8); opacity: 0; animation: grammy-ripple 2.6s cubic-bezier(.2,.7,.3,1) infinite; }
.hl-pulse.p2 { animation-delay: 1.3s; border-color: rgba(150,47,191,.75); }
.hl-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 34px; z-index: 2147483647; pointer-events: none; transform-origin: 3px 2px; opacity: 0; transition: opacity .45s ease; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); will-change: transform; }
.hl-cursor.show { opacity: 1; }
.hl-cursor-inner { transform-origin: 3px 2px; }
.hl-cursor.tap .hl-cursor-inner { animation: grammy-tap 1.9s ease-in-out infinite; }
.hl-tapring { position: absolute; left: 3px; top: 2px; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(255,255,255,.95); opacity: 0; }
.hl-cursor.tap .hl-tapring { animation: grammy-tapring 1.9s ease-out infinite; }
@keyframes grammy-spin { to { transform: rotate(1turn); } }
@keyframes grammy-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes grammy-halo { 0%, 100% { box-shadow: 0 0 18px 4px rgba(214,41,118,.55), 0 0 44px 12px rgba(150,47,191,.28); } 50% { box-shadow: 0 0 24px 6px rgba(250,126,30,.55), 0 0 58px 16px rgba(214,41,118,.3); } }
@keyframes grammy-ripple { 0% { inset: 0; opacity: .9; } 100% { inset: -20px; opacity: 0; } }
@keyframes grammy-tap { 0%, 45%, 100% { transform: scale(1); } 55% { transform: scale(.8) translate(1px, 1px); } 68% { transform: scale(1.04); } 76% { transform: scale(1); } }
@keyframes grammy-tapring { 0%, 52% { transform: scale(.3); opacity: 0; } 57% { opacity: .95; } 100% { transform: scale(1.5); opacity: 0; } }

/* ---------------- speech bubble ---------------- */
.bubble {
  position: fixed; max-width: 280px; z-index: 2147483647;
  background: #fff; border: 1px solid #dbdbdb; border-radius: 18px; padding: 10px 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,.14); color: #262626;
  opacity: 0; transform: scale(.9); transform-origin: bottom right;
  transition: opacity .2s ease, transform .2s ${SPRING};
  pointer-events: none; white-space: pre-wrap; word-break: break-word;
}
.bubble::after { content: ''; position: absolute; right: 22px; bottom: -8px; width: 14px; height: 14px; background: #fff; border-right: 1px solid #dbdbdb; border-bottom: 1px solid #dbdbdb; transform: rotate(45deg); }
.bubble.show { opacity: 1; transform: none; pointer-events: auto; cursor: pointer; animation: grammy-bubble-in .45s ${SPRING} both, grammy-float 3.2s ease-in-out .45s infinite; }
.bubble.show.speaking { box-shadow: 0 8px 24px rgba(0,0,0,.14), 0 0 0 3px rgba(220,39,67,.18); animation: grammy-bubble-in .45s ${SPRING} both, grammy-speak 1.4s ease-in-out .45s infinite; }
.bubble.thinking { display: flex; gap: 5px; align-items: center; padding: 12px 16px; min-width: 0; }
.bubble.thinking .dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(45deg,#dc2743,#cc2366); animation: grammy-dot 1s ease-in-out infinite; }
.bubble.thinking .dot:nth-child(2) { animation-delay: .15s; }
.bubble.thinking .dot:nth-child(3) { animation-delay: .3s; }
@keyframes grammy-dot { 0%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-5px); opacity: 1; } }
@keyframes grammy-bubble-in { 0% { opacity: 0; transform: scale(.6) translateY(12px); } 60% { opacity: 1; transform: scale(1.06) translateY(-3px); } 100% { opacity: 1; transform: none; } }
@keyframes grammy-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes grammy-speak { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.015); } }

/* ---------------- chat panel ---------------- */
.panel {
  position: fixed; width: 328px; max-width: calc(100vw - 32px);
  max-height: min(70vh, 560px); z-index: 2147483647;
  display: flex; flex-direction: column;
  background: #fafafa; border: 1px solid #dbdbdb; border-radius: 20px;
  box-shadow: 0 12px 40px rgba(0,0,0,.18);
  opacity: 0; transform: scale(.96) translateY(10px); transform-origin: bottom right;
  visibility: hidden; pointer-events: none; overflow: hidden;
  transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform ${LIMITS.MENU_ANIM_MS}ms ${SPRING}, visibility 0s linear ${LIMITS.MENU_ANIM_MS}ms;
}
.panel.open {
  opacity: 1; transform: none; visibility: visible; pointer-events: auto;
  transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform ${LIMITS.MENU_ANIM_MS}ms ${SPRING}, visibility 0s;
}
.panel-head {
  display: flex; align-items: center; gap: 8px; padding: 12px 12px; background: #fff;
  border-bottom: 1px solid #efefef; flex: none;
}
.panel-head .head-emoji { font-size: 18px; }
.panel-head b { font-size: 15px; }
.icon-btn {
  width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  color: #737373; font-size: 15px; transition: background .2s;
}
.icon-btn:hover { background: #efefef; }
.pill {
  margin-left: auto; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
  background: #efefef; color: #262626; white-space: nowrap;
}
.pill.green { background: #e6f7ec; color: #1d7a3f; }
.pill.yellow { background: #fff4d6; color: #8a5a00; }
.pill.red { background: #fde8e8; color: #b3261e; }

.persona-row { display: none; } /* persona lives in settings (gear) — kept in the DOM for the JS wiring */
.persona-btn {
  flex: 1; padding: 6px 8px; border-radius: 999px; border: 1px solid #dbdbdb;
  font-size: 12px; font-weight: 600; color: #737373; background: #fff; transition: all .2s;
}
.persona-btn.active { background: #262626; color: #fff; border-color: #262626; }

.chips-row { display: none; } /* suggestions removed from the chat for a cleaner, organic feel */
.chip {
  padding: 6px 11px; border-radius: 999px; border: 1px solid #dbdbdb; background: #fff;
  font-size: 12px; font-weight: 600; color: #262626; transition: transform .2s ${SPRING}, background .2s;
}
.chip:hover { background: #f2f2f2; transform: translateY(-1px); }

.remembered { border-top: 1px solid #efefef; flex: none; }
.remembered-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 12px;
  font-size: 12px; font-weight: 700; color: #737373; text-transform: uppercase; letter-spacing: .04em;
}
.remembered-head .chev { margin-left: auto; transition: transform .2s; }
.remembered.open .remembered-head .chev { transform: rotate(180deg); }
.remembered-body { max-height: 0; overflow: hidden auto; transition: max-height .2s ease; padding: 0 12px; }
.remembered.open .remembered-body { max-height: 160px; padding: 0 12px 10px; }
.pin-row { display: flex; align-items: flex-start; gap: 6px; padding: 6px 0; border-bottom: 1px dashed #efefef; font-size: 12px; }
.pin-row:last-child { border-bottom: 0; }
.pin-kind {
  flex: none; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #8a5a00;
  background: #fff4d6; border-radius: 999px; padding: 2px 6px; margin-top: 1px;
}
.pin-main { flex: 1; min-width: 0; }
.pin-content { color: #262626; }
.pin-source { color: #737373; font-size: 11px; }
.pin-del { flex: none; color: #b3261e; font-size: 15px; line-height: 1; padding: 0 2px; }
.remembered-empty { color: #737373; font-size: 12px; padding: 6px 0; }
.forget-btn { display: block; width: 100%; text-align: left; color: #b3261e; font-size: 12px; font-weight: 600; padding: 6px 0 2px; }

.log {
  flex: 1; overflow-y: auto; padding: 14px 14px 10px; min-height: 220px;
  display: flex; flex-direction: column; gap: 8px; background: #fff; scroll-behavior: smooth; scrollbar-width: thin;
}
.log .msg { animation: grammy-msg-in .25s ease both; line-height: 1.4; }
@keyframes grammy-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.msg { max-width: 84%; padding: 8px 12px; border-radius: 16px; line-height: 1.35; font-size: 13.5px; white-space: pre-wrap; word-break: break-word; }
.msg.user { align-self: flex-end; background: #0095f6; color: #fff; border-bottom-right-radius: 4px; }
.msg.assistant { align-self: flex-start; background: #efefef; color: #262626; border-bottom-left-radius: 4px; }
.msg.system { align-self: center; background: transparent; color: #8a8a8a; font-size: 11.5px; text-align: center; max-width: 100%; }
.settings-link { color: #0095f6; font-weight: 700; text-decoration: underline; padding: 0; }
.msg.typing { display: flex; gap: 4px; align-items: center; padding: 10px 14px; }
.msg.typing .dot { width: 6px; height: 6px; border-radius: 50%; background: #9a9a9a; animation: grammy-dot 1s ease-in-out infinite; }
.msg.typing .dot:nth-child(2) { animation-delay: .15s; }
.msg.typing .dot:nth-child(3) { animation-delay: .3s; }
@keyframes grammy-dot { 0%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-3px); opacity: 1; } }

.attach-preview { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #efefef; background: #fff; flex: none; }
.attach-thumb { width: 40px; height: 40px; border-radius: 10px; object-fit: cover; border: 1px solid #dbdbdb; }
.attach-remove { color: #737373; font-size: 16px; margin-left: auto; }

.compose-row { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-top: 1px solid #efefef; background: #fff; flex: none; }
.attach-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #737373; font-size: 16px; transition: background .2s; }
.attach-btn:hover { background: #efefef; }
.attach-btn.pulse { animation: grammy-attach-pulse 1s ease-in-out 2; }
@keyframes grammy-attach-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); color: #dc2743; } }
.text-input {
  flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid #dbdbdb; border-radius: 999px;
  outline: 0; transition: border-color .2s; font-size: 13.5px;
}
.text-input:focus { border-color: #a0a0a0; }
.send-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #0095f6; font-size: 16px; }
.ptt-btn {
  flex: none; width: 38px; height: 38px; border-radius: 50%; border: 0; display: grid; place-items: center;
  background: ${IG_GRADIENT}; color: #fff; font-size: 16px; box-shadow: 0 4px 12px rgba(220,39,67,.35);
  transition: transform .15s ${SPRING}; touch-action: none;
}
.ptt-btn:active, .ptt-btn.active { transform: scale(1.12); }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
`;
}
