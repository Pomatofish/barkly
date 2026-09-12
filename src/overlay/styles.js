// src/overlay/styles.js — all overlay CSS, injected into the Shadow DOM by index.js.
// Design: dark glass surfaces (ported from demos/grammy_overlay_Test) with the Instagram
// gradient as the single accent, hairline gradient borders, soft depth, spring easing.
// Class names and keyframes are referenced from index.js/ptt.js — keep them stable.
import { LIMITS } from '../../shared/types.js';

const IG_GRADIENT = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)';
const IG_CONIC = 'conic-gradient(from 0deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #d62976, #fa7e1e, #feda75)';
const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
// Gradient hairline border on a rounded box (mask trick from the demo).
const HAIRLINE = `content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(135deg, rgba(254,218,117,.7), rgba(214,41,118,.5) 40%, rgba(79,91,213,.4) 80%, rgba(255,255,255,.08));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);`;

export function buildCSS() {
  return `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap {
  --bg: rgba(22, 17, 34, .92); --bg-2: rgba(255,255,255,.06); --bg-3: rgba(255,255,255,.1);
  --fg: #f4f2f8; --fg-2: rgba(244,242,248,.62); --fg-3: rgba(244,242,248,.4);
  --line: rgba(255,255,255,.09); --accent: #d62976; --accent-2: #fa7e1e;
  --green: #4ade80; --yellow: #fbbf24; --red: #fb7185;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; background: none; border: 0; }
input { font: inherit; color: inherit; }

/* ---------------- dock: draggable mascot ---------------- */
.dock { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 60px; height: 60px; touch-action: none; }
.dock.dragging .mascot { cursor: grabbing; transform: scale(1.06); }
.mascot {
  position: relative; width: 60px; height: 60px; border-radius: 50%; cursor: pointer;
  display: grid; place-items: center; font-size: 30px; line-height: 1;
  background: rgba(22,17,34,.94); color: #fff;
  box-shadow: 0 10px 30px rgba(0,0,0,.38), inset 0 0 0 1px rgba(255,255,255,.08);
  transition: transform .35s ${SPRING}, box-shadow .3s ease; touch-action: none; user-select: none;
}
.mascot::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; z-index: -1;
  background: ${IG_CONIC}; animation: grammy-spin 9s linear infinite; filter: saturate(1.15);
}
.mascot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.22), transparent 48%); pointer-events: none; }
.mascot:hover { transform: scale(1.08); box-shadow: 0 14px 34px rgba(214,41,118,.35), inset 0 0 0 1px rgba(255,255,255,.12); }
.mascot.bounce { animation: grammy-bounce .55s ${SPRING}; }
.mascot.listening { animation: grammy-pulse 1.1s ease-in-out infinite; }
.mascot.listening::before { animation-duration: 1.6s; }
.mascot.listening .label, .mascot.listening ~ .listen-label { display: block; }
.mascot.listening::after {
  content: '● Listening…'; inset: auto; right: 0; bottom: calc(100% + 10px); background: none;
  white-space: nowrap; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff; background: linear-gradient(45deg,#dc2743,#cc2366); padding: 7px 11px; border-radius: 999px;
  box-shadow: 0 6px 16px rgba(214,41,118,.4); animation: grammy-float 2s ease-in-out infinite;
}
@keyframes grammy-spin { to { transform: rotate(1turn); } }
@keyframes grammy-bounce { 0% { transform: translateY(0); } 40% { transform: translateY(-14px) scale(1.08); } 100% { transform: translateY(0); } }
@keyframes grammy-pulse {
  0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,.38), 0 0 0 0 rgba(214,41,118,.55); }
  50% { box-shadow: 0 10px 30px rgba(0,0,0,.38), 0 0 0 12px rgba(214,41,118,0); }
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
  background: ${IG_CONIC}; animation: grammy-spin 2.8s linear infinite; }
.hl-pulse { position: absolute; inset: 0; border-radius: inherit; border: 2px solid rgba(250,126,30,.8); opacity: 0; animation: grammy-ripple 2.6s cubic-bezier(.2,.7,.3,1) infinite; }
.hl-pulse.p2 { animation-delay: 1.3s; border-color: rgba(150,47,191,.75); }
.hl-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 34px; z-index: 2147483647; pointer-events: none; transform-origin: 3px 2px; opacity: 0; transition: opacity .45s ease; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); will-change: transform; }
.hl-cursor.show { opacity: 1; }
.hl-cursor-inner { transform-origin: 3px 2px; }
.hl-cursor.tap .hl-cursor-inner { animation: grammy-tap 1.9s ease-in-out infinite; }
.hl-tapring { position: absolute; left: 3px; top: 2px; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(255,255,255,.95); opacity: 0; }
.hl-cursor.tap .hl-tapring { animation: grammy-tapring 1.9s ease-out infinite; }
@keyframes grammy-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes grammy-halo { 0%, 100% { box-shadow: 0 0 18px 4px rgba(214,41,118,.55), 0 0 44px 12px rgba(150,47,191,.28); } 50% { box-shadow: 0 0 24px 6px rgba(250,126,30,.55), 0 0 58px 16px rgba(214,41,118,.3); } }
@keyframes grammy-ripple { 0% { inset: 0; opacity: .9; } 100% { inset: -20px; opacity: 0; } }
@keyframes grammy-tap { 0%, 45%, 100% { transform: scale(1); } 55% { transform: scale(.8) translate(1px, 1px); } 68% { transform: scale(1.04); } 76% { transform: scale(1); } }
@keyframes grammy-tapring { 0%, 52% { transform: scale(.3); opacity: 0; } 57% { opacity: .95; } 100% { transform: scale(1.5); opacity: 0; } }

/* ---------------- speech bubble ---------------- */
.bubble {
  position: fixed; max-width: 290px; z-index: 2147483647;
  background: var(--bg); -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  border-radius: 18px; padding: 12px 15px; color: var(--fg); font-size: 14.5px; line-height: 1.45;
  box-shadow: 0 14px 44px rgba(0,0,0,.38), 0 2px 8px rgba(0,0,0,.25);
  opacity: 0; transform: scale(.9); transform-origin: bottom right;
  transition: opacity .2s ease, transform .2s ${SPRING};
  pointer-events: none; white-space: pre-wrap; word-break: break-word;
}
.bubble::before { ${HAIRLINE} }
.bubble::after { content: ''; position: absolute; width: 14px; height: 14px; background: var(--bg); transform: rotate(45deg); border-radius: 3px; box-shadow: 2px 2px 4px rgba(0,0,0,.18); }
.bubble.tail-bottom::after { left: var(--tx, 60%); bottom: -7px; }
.bubble.tail-top::after { left: var(--tx, 60%); top: -7px; box-shadow: none; }
.bubble.tail-right::after { right: -7px; top: var(--ty, 50%); }
.bubble.tail-left::after { left: -7px; top: var(--ty, 50%); box-shadow: none; }
/* thought-bubble trail for the thinking state: two small puffs between bubble and mascot */
.bubble.thinking::after { width: 10px; height: 10px; border-radius: 50%; transform: none; box-shadow: none; animation: grammy-puff 1.2s ease-in-out infinite; }
.bubble.thinking.tail-bottom::after { bottom: -14px; }
.bubble.thinking.tail-right::after { right: -14px; }
@keyframes grammy-puff { 0%, 100% { transform: scale(.85); opacity: .7; } 50% { transform: scale(1.1); opacity: 1; } }
.bubble.show { opacity: 1; transform: none; pointer-events: auto; cursor: pointer; animation: grammy-bubble-in .45s ${SPRING} both, grammy-float 3.2s ease-in-out .45s infinite; }
.bubble.show.speaking { box-shadow: 0 14px 44px rgba(0,0,0,.38), 0 0 0 3px rgba(214,41,118,.22); animation: grammy-bubble-in .45s ${SPRING} both, grammy-speak 1.4s ease-in-out .45s infinite; }
.bubble.thinking { display: flex; gap: 5px; align-items: center; padding: 14px 16px; }
.bubble.thinking .dot { width: 8px; height: 8px; border-radius: 50%; background: ${IG_GRADIENT}; animation: grammy-dot 1s ease-in-out infinite; }
.bubble.thinking .dot:nth-child(2) { animation-delay: .15s; }
.bubble.thinking .dot:nth-child(3) { animation-delay: .3s; }
@keyframes grammy-bubble-in { 0% { opacity: 0; transform: scale(.6) translateY(12px); } 60% { opacity: 1; transform: scale(1.06) translateY(-3px); } 100% { opacity: 1; transform: none; } }
@keyframes grammy-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes grammy-speak { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.015); } }

/* ---------------- chat panel ---------------- */
.panel {
  position: fixed; width: 340px; max-width: calc(100vw - 32px);
  max-height: min(72vh, 600px); z-index: 2147483647;
  display: flex; flex-direction: column;
  background: var(--bg); -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5);
  border-radius: 22px; box-shadow: 0 18px 50px rgba(0,0,0,.42);
  opacity: 0; transform: scale(.9) translateY(12px); transform-origin: bottom right;
  visibility: hidden; pointer-events: none; overflow: hidden;
  transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform .45s ${SPRING}, visibility 0s linear ${LIMITS.MENU_ANIM_MS}ms;
}
.panel::before { ${HAIRLINE} z-index: 2; }
.panel.open { opacity: 1; transform: none; visibility: visible; pointer-events: auto; transition: opacity ${LIMITS.MENU_ANIM_MS}ms ease, transform .45s ${SPRING}, visibility 0s; }
.panel-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; flex: none; }
.panel-head .head-emoji { font-size: 20px; filter: drop-shadow(0 2px 6px rgba(214,41,118,.45)); }
.panel-head b { font-size: 15px; letter-spacing: .01em; }
.icon-btn { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--fg-2); font-size: 15px; transition: background .2s, color .2s, transform .25s ${SPRING}; }
.icon-btn:hover { background: var(--bg-3); color: var(--fg); transform: translateY(-1px); }
.pill { margin-left: auto; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--bg-3); color: var(--fg-2); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; transition: background .3s, color .3s; }
.pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.pill.green { background: rgba(74,222,128,.14); color: var(--green); }
.pill.yellow { background: rgba(251,191,36,.14); color: var(--yellow); }
.pill.red { background: rgba(251,113,133,.16); color: var(--red); }

.persona-row { display: none; }
.persona-btn { flex: 1; padding: 6px 8px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; font-weight: 600; color: var(--fg-2); }
.persona-btn.active { background: var(--fg); color: #1a1426; }
.chips-row { display: none; }
.chip { padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg-2); font-size: 12px; font-weight: 600; color: var(--fg); }

.remembered { border-top: 1px solid var(--line); flex: none; }
.remembered-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 9px 14px; font-size: 11px; font-weight: 700; color: var(--fg-3); text-transform: uppercase; letter-spacing: .08em; transition: color .2s; }
.remembered-head:hover { color: var(--fg-2); }
.remembered-head .chev { margin-left: auto; transition: transform .25s ${SPRING}; }
.remembered.open .remembered-head .chev { transform: rotate(180deg); }
.remembered-body { max-height: 0; overflow: hidden auto; transition: max-height .25s ${EASE}; padding: 0 14px; scrollbar-width: thin; }
.remembered.open .remembered-body { max-height: 170px; padding: 0 14px 10px; }
.pin-row { display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.pin-row:last-child { border-bottom: 0; }
.pin-kind { flex: none; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #fff; background: ${IG_GRADIENT}; border-radius: 999px; padding: 3px 7px; margin-top: 1px; }
.pin-main { flex: 1; min-width: 0; }
.pin-content { color: var(--fg); }
.pin-source { color: var(--fg-3); font-size: 11px; }
.pin-del { flex: none; color: var(--fg-3); font-size: 16px; line-height: 1; padding: 0 2px; transition: color .2s; }
.pin-del:hover { color: var(--red); }
.remembered-empty { color: var(--fg-3); font-size: 12px; padding: 6px 0; }
.forget-btn { display: block; width: 100%; text-align: left; color: var(--red); font-size: 12px; font-weight: 600; padding: 8px 0 2px; opacity: .85; }
.forget-btn:hover { opacity: 1; }

.log { flex: 1; overflow-y: auto; padding: 14px 14px 10px; min-height: 230px; display: flex; flex-direction: column; gap: 8px; scroll-behavior: smooth; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
.log .msg { animation: grammy-msg-in .3s ${EASE} both; }
@keyframes grammy-msg-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.msg { max-width: 84%; padding: 9px 13px; border-radius: 18px; line-height: 1.42; font-size: 13.5px; white-space: pre-wrap; word-break: break-word; }
.msg.user { align-self: flex-end; background: ${IG_GRADIENT}; color: #fff; border-bottom-right-radius: 6px; box-shadow: 0 6px 18px rgba(214,41,118,.28); }
.msg.assistant { align-self: flex-start; background: var(--bg-3); color: var(--fg); border-bottom-left-radius: 6px; }
.msg.system { align-self: center; background: transparent; color: var(--fg-3); font-size: 11.5px; text-align: center; max-width: 100%; }
.settings-link { color: var(--accent-2); font-weight: 700; text-decoration: underline; padding: 0; }
.msg.typing { display: flex; gap: 4px; align-items: center; padding: 11px 14px; }
.msg.typing .dot { width: 6px; height: 6px; border-radius: 50%; background: ${IG_GRADIENT}; animation: grammy-dot 1s ease-in-out infinite; }
.msg.typing .dot:nth-child(2) { animation-delay: .15s; }
.msg.typing .dot:nth-child(3) { animation-delay: .3s; }
@keyframes grammy-dot { 0%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-4px); opacity: 1; } }

.attach-preview { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--line); flex: none; }
.attach-thumb { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; box-shadow: 0 0 0 1px var(--line); }
.attach-remove { color: var(--fg-2); font-size: 16px; margin-left: auto; }

.compose-row { display: flex; align-items: center; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--line); flex: none; }
.attach-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--fg-2); transition: background .2s, color .2s, transform .25s ${SPRING}; }
.attach-btn:hover { background: var(--bg-3); color: var(--fg); transform: translateY(-1px); }
.attach-btn.pulse { animation: grammy-attach-pulse 1s ease-in-out 2; }
@keyframes grammy-attach-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); color: var(--accent); } }
.text-input {
  flex: 1; min-width: 0; padding: 9px 14px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--bg-2); color: var(--fg); outline: 0; font-size: 13.5px;
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.text-input::placeholder { color: var(--fg-3); }
.text-input:focus { border-color: rgba(250,126,30,.7); box-shadow: 0 0 0 3px rgba(214,41,118,.22); background: var(--bg-3); }
.send-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--accent-2); transition: transform .25s ${SPRING}, background .2s; }
.send-btn:hover { background: var(--bg-3); transform: translateY(-1px); }
.ptt-btn {
  flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  background: ${IG_GRADIENT}; color: #fff; font-size: 16px; box-shadow: 0 6px 16px rgba(214,41,118,.4);
  transition: transform .2s ${SPRING}, box-shadow .2s; touch-action: none;
}
.ptt-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(214,41,118,.5); }
.ptt-btn:active, .ptt-btn.active { transform: scale(1.14); box-shadow: 0 0 0 6px rgba(214,41,118,.25), 0 8px 20px rgba(214,41,118,.5); }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
`;
}
