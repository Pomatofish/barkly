// Grammy overlay test — highlights Instagram buttons the way an AI assistant would.
// Everything renders inside a closed-off Shadow DOM so Instagram's CSS can't touch it,
// and the whole layer is pointer-events: none so the real buttons stay clickable.
(() => {
  const HOST_ID = 'grammy-overlay-host';
  // If an older copy is lying around (extension reloaded), replace it.
  document.getElementById(HOST_ID)?.remove();

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const CLICKABLE = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

  // ---------------------------------------------------------------------------
  // What we know how to find. Instagram's icons are SVGs with aria-labels, which
  // is by far the most stable hook (class names are obfuscated and change).
  // ---------------------------------------------------------------------------
  const POST_MISSING = 'Open your home feed or a post first.';
  const TARGETS = {
    like: { name: 'Like', scope: 'post', labels: ['Like', 'Unlike'], missing: POST_MISSING,
      say: 'Tap the heart to like this post — or double-tap the photo.' },
    comment: { name: 'Comment', scope: 'post', labels: ['Comment'], missing: POST_MISSING,
      say: 'Tap the speech bubble to add a comment.' },
    share: { name: 'Share', scope: 'post', labels: ['Share Post', 'Share'], missing: POST_MISSING,
      say: 'Tap the paper plane to send this post to a friend.' },
    save: { name: 'Save', scope: 'post', labels: ['Save', 'Remove'], missing: POST_MISSING,
      say: 'Tap the bookmark to save this post for later.' },
    home: { name: 'Home', scope: 'nav', labels: ['Home'], hrefs: ['/'],
      say: 'Home takes you back to your feed.' },
    search: { name: 'Search', scope: 'nav', labels: ['Search'],
      say: 'Search lets you look up people, tags and places.' },
    explore: { name: 'Explore', scope: 'nav', labels: ['Explore'], hrefs: ['/explore/'],
      say: 'Explore shows trending posts picked for you.' },
    reels: { name: 'Reels', scope: 'nav', labels: ['Reels'], hrefs: ['/reels/'],
      say: 'Reels is where all the short videos live.' },
    messages: { name: 'Messages', scope: 'nav', labels: ['Messages', 'Messenger', 'Direct', 'Direct messaging'],
      hrefs: ['/direct/inbox/'], say: 'Your DMs live in Messages.' },
    notifications: { name: 'Notifications', scope: 'nav', labels: ['Notifications', 'Activity Feed'],
      say: 'Notifications shows your likes, follows and comments.' },
    create: { name: 'Create', scope: 'nav', labels: ['New post', 'Create'],
      say: 'Tap Create to share a photo, reel or story.' },
    profile: { name: 'Profile', scope: 'nav', labels: ['Profile'],
      say: 'This is your profile — your posts, bio and followers.',
      custom: () =>
        [...document.querySelectorAll('a img[alt*="profile picture" i]')]
          .map((img) => img.closest('a'))
          .filter((a) => {
            if (!a || a.closest('article')) return false;
            const r = a.getBoundingClientRect();
            return r.left < 260 || r.top > innerHeight - 90;
          }) },
    more: { name: 'More', scope: 'nav', labels: ['Settings', 'More'],
      say: 'More has your settings, activity and log out.' },
  };

  const TOUR = ['like', 'comment', 'share', 'save', 'home', 'search', 'explore', 'reels',
    'messages', 'notifications', 'create', 'profile'];

  // Tiny stand-in for the real AI: keyword → target. Order matters.
  const INTENTS = [
    ['tour', /\b(tour|walk ?me|show me around|guide me|basics|how does (this|instagram) work)\b/],
    ['scan', /\b(scan|all (the )?buttons|what can i (click|press|tap))\b/],
    ['clear', /^(clear|stop|hide|close|never ?mind)\b/],
    ['notifications', /(notif|activity|alerts?\b|who liked|who followed)/],
    ['share', /(share|send (this|it|the post|to)|forward|repost)/],
    ['messages', /(message|\bdms?\b|inbox|chat|direct)/],
    ['save', /(\bsave|bookmark|keep (this|it)|for later)/],
    ['comment', /(comment|reply|respond)/],
    ['create', /(create|new post|upload|post (a|something|my|an)|add a (photo|post|story|reel)|story)/],
    ['like', /(\b(un)?like\b(?! to)|heart|\blove\b)/],
    ['search', /(search|find|look (up|for))/],
    ['explore', /(explore|discover|trending)/],
    ['reels', /(reel|video)/],
    ['profile', /(profile|my (page|account|posts|bio)|account)/],
    ['home', /(home|feed|main page|go back)/],
    ['more', /(settings|\bmore\b|log ?out|menu)/],
  ];

  // ---------------------------------------------------------------------------
  // Finding elements
  // ---------------------------------------------------------------------------
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  function clickableOf(node) {
    let c = node.closest(CLICKABLE);
    if (c) {
      const r = c.getBoundingClientRect();
      if (r.width > innerWidth * 0.6 || r.height > innerHeight * 0.5) c = null; // giant wrapper, not a button
    }
    return c || node.parentElement || node;
  }

  // One pass over the DOM, shared by every target lookup.
  function snapshot() {
    const labeled = [];
    document.querySelectorAll('svg[aria-label]').forEach((s) => labeled.push([s, norm(s.getAttribute('aria-label')), 400]));
    document.querySelectorAll('svg > title').forEach((t) => labeled.push([t.parentElement, norm(t.textContent), 380]));
    document.querySelectorAll('[aria-label]:not(svg)').forEach((e) => labeled.push([e, norm(e.getAttribute('aria-label')), 350]));
    let texts = null;
    return {
      labeled,
      get texts() {
        if (!texts) {
          texts = [];
          document.querySelectorAll('a, [role="link"], [role="button"]').forEach((e) => {
            const tc = e.textContent;
            if (tc && tc.length < 40) texts.push([e, norm((e.innerText || '').split('\n')[0])]);
          });
        }
        return texts;
      },
    };
  }

  function candidatesFor(def, snap) {
    const out = new Map(); // element -> confidence bonus
    const add = (el, bonus) => {
      if (el && bonus > (out.get(el) ?? -1)) out.set(el, bonus);
    };
    const labels = def.labels.map(norm);
    for (const [node, label, bonus] of snap.labeled) {
      if (!labels.includes(label)) continue;
      add(node instanceof SVGElement ? clickableOf(node) : node.matches(CLICKABLE) ? node : clickableOf(node), bonus);
    }
    (def.hrefs || []).forEach((h) => document.querySelectorAll(`a[href="${h}"]`).forEach((a) => add(a, 250)));
    if (def.scope === 'nav') {
      for (const [el, text] of snap.texts) if (labels.includes(text)) add(el, 300);
    }
    if (def.custom) def.custom().forEach((el) => add(el, 220));
    return out;
  }

  function iconSize(el) {
    const icon = el.querySelector('svg');
    return icon ? icon.getBoundingClientRect().width : el.getBoundingClientRect().width;
  }

  function pickBest(def, cands) {
    const vw = innerWidth, vh = innerHeight;
    let best = null, bestScore = -Infinity;
    for (const [el, bonus] of cands) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      let s = bonus;
      if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) s += 1000;
      if (r.top >= 0 && r.bottom <= vh) s += 300;
      s -= Math.hypot(r.left + r.width / 2 - vw / 2, r.top + r.height / 2 - vh / 2) * 0.4;
      if (def.scope === 'post' && iconSize(el) < 18) s -= 900; // tiny hearts on comments
      if (r.width > vw * 0.6 || r.height > vh * 0.5) s -= 3000;
      if (s > bestScore) { bestScore = s; best = el; }
    }
    return best;
  }

  function resolve(key) {
    const def = TARGETS[key];
    return def ? pickBest(def, candidatesFor(def, snapshot())) : null;
  }

  // ---------------------------------------------------------------------------
  // Overlay DOM
  // ---------------------------------------------------------------------------
  const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --grad: conic-gradient(from 0deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #d62976, #fa7e1e, #feda75);
  --lin: linear-gradient(135deg, #fa7e1e, #d62976 50%, #962fbf);
  position: fixed; inset: 0; pointer-events: none;
  font: 500 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #fff; -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; }

/* ---------- spotlight ---------- */
.spot {
  position: absolute; left: 0; top: 0; border-radius: 16px;
  box-shadow: 0 0 0 200vmax rgba(12, 8, 28, .38);
  opacity: 0; transition: opacity .6s ease; will-change: transform;
}
.root.dim.active.has-target:not(.lost):not(.success) .spot { opacity: 1; }

/* ---------- ring ---------- */
.ring { position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .35s ease; will-change: transform; }
.root.active.has-target:not(.lost) .ring { opacity: 1; }
.ring-inner { position: absolute; inset: 0; border-radius: inherit; animation: breathe 2.6s ease-in-out infinite; }
.halo { position: absolute; inset: 0; border-radius: inherit; animation: halo 4s ease-in-out infinite; }
.border {
  position: absolute; inset: 0; border-radius: inherit; padding: 3px; overflow: hidden;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.border::before {
  content: ""; position: absolute; left: 50%; top: 50%;
  width: var(--d, 200px); height: var(--d, 200px);
  margin: calc(var(--d, 200px) / -2) 0 0 calc(var(--d, 200px) / -2);
  background: var(--grad); animation: spin 2.8s linear infinite;
}
.pulse {
  position: absolute; inset: 0; border-radius: var(--pr, 16px);
  border: 2px solid rgba(250, 126, 30, .8); opacity: 0;
  animation: ripple 2.6s cubic-bezier(.2, .7, .3, 1) infinite;
}
.pulse.p2 { animation-delay: 1.3s; border-color: rgba(150, 47, 191, .75); }
.root.success .ring-inner { animation: pop .7s cubic-bezier(.2, .9, .3, 1) forwards; }
.root.success .pulse { display: none; }

/* ---------- ghost cursor ---------- */
.cursor {
  position: absolute; left: 0; top: 0; width: 30px; height: 34px;
  transform-origin: 3px 2px; opacity: 0; transition: opacity .45s ease;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, .35)); will-change: transform;
}
.root.active.has-target:not(.lost):not(.success) .cursor { opacity: 1; }
.cursor-inner { transform-origin: 3px 2px; }
.cursor.tap .cursor-inner { animation: tap 1.9s ease-in-out infinite; }
.tap-ring {
  position: absolute; left: 3px; top: 2px; width: 34px; height: 34px; margin: -17px 0 0 -17px;
  border-radius: 50%; border: 2px solid rgba(255, 255, 255, .95); opacity: 0;
}
.cursor.tap .tap-ring { animation: tapring 1.9s ease-out infinite; }

/* ---------- bubble ---------- */
.bubble { position: absolute; left: 0; top: 0; width: 290px; max-width: calc(100vw - 28px); will-change: transform; }
.bubble-pop {
  opacity: 0; transform: scale(.9) translateY(6px);
  transition: opacity .3s ease, transform .55s cubic-bezier(.34, 1.56, .64, 1);
}
.bubble.show { pointer-events: auto; }
.bubble.show .bubble-pop { opacity: 1; transform: none; }
.bubble-inner {
  position: relative; padding: 12px 14px 13px; border-radius: 18px;
  background: rgba(24, 18, 38, .86);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: 0 14px 44px rgba(0, 0, 0, .38), 0 2px 8px rgba(0, 0, 0, .25);
  animation: float 5.5s ease-in-out infinite;
}
.bubble-inner::before, .panel::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(135deg, rgba(254, 218, 117, .75), rgba(214, 41, 118, .55) 40%, rgba(79, 91, 213, .4) 80%, rgba(255,255,255,.08));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.b-head { display: flex; align-items: center; gap: 8px; }
.b-name { font-weight: 700; font-size: 13px; letter-spacing: .01em; }
.b-step {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: rgba(255, 255, 255, .1); color: rgba(255, 255, 255, .75);
}
.b-step:empty { display: none; }
.b-close {
  margin-left: auto; width: 24px; height: 24px; border: 0; border-radius: 50%; padding: 0;
  background: transparent; color: rgba(255, 255, 255, .6); font-size: 18px; line-height: 1;
  transition: background .2s, color .2s;
}
.b-close:hover { background: rgba(255, 255, 255, .12); color: #fff; }
.b-text { position: relative; margin-top: 7px; font-size: 14.5px; color: rgba(255, 255, 255, .95); }
.b-ghost { visibility: hidden; }
.b-typed { position: absolute; inset: 0; }
.b-typed.typing::after {
  content: ""; display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -2px;
  border-radius: 1px; background: #fa7e1e; animation: blink .9s steps(2) infinite;
}
.dots { display: none; position: absolute; left: 0; top: .35em; gap: 4px; }
.b-text.thinking .b-typed { visibility: hidden; }
.b-text.thinking .dots { display: flex; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--lin); animation: dot 1s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
.b-actions { display: none; gap: 8px; margin-top: 11px; }
.root.touring .b-actions { display: flex; }

/* ---------- shared bits ---------- */
.btn {
  border: 0; border-radius: 10px; padding: 7px 13px; font-size: 13px; font-weight: 650;
  transition: transform .25s cubic-bezier(.34, 1.56, .64, 1), filter .2s, background .2s;
}
.btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
.btn:active { transform: scale(.96); }
.btn.primary { background: var(--lin); box-shadow: 0 4px 14px rgba(214, 41, 118, .35); }
.btn.ghost { background: rgba(255, 255, 255, .09); }
.btn.ghost:hover { background: rgba(255, 255, 255, .16); }

.orb {
  position: relative; display: block; flex: none; width: 22px; height: 22px; overflow: hidden;
  border-radius: 50%; animation: blob 7s ease-in-out infinite;
  box-shadow: 0 0 14px rgba(214, 41, 118, .55);
}
.orb::before { content: ""; position: absolute; inset: -25%; background: var(--grad); animation: spin 6s linear infinite; }
.orb::after { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), rgba(255,255,255,0) 45%); }

/* ---------- burst ---------- */
.fx { position: absolute; inset: 0; }
.spark {
  position: absolute; width: var(--s, 7px); height: var(--s, 7px); border-radius: 50%;
  margin: calc(var(--s, 7px) / -2) 0 0 calc(var(--s, 7px) / -2);
  background: var(--c); animation: spark .85s cubic-bezier(.15, .8, .3, 1) forwards;
}
.shock {
  position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%;
  border: 3px solid #fa7e1e; animation: shock .75s ease-out forwards;
}

/* ---------- scan markers ---------- */
.marker { position: absolute; left: 0; top: 0; will-change: transform; }
.marker-box {
  position: absolute; inset: 0; border-radius: 12px;
  border: 2px solid rgba(214, 41, 118, .95); background: rgba(214, 41, 118, .1);
  box-shadow: 0 0 0 4px rgba(214, 41, 118, .16), 0 0 20px rgba(150, 47, 191, .35);
  animation: markerIn .55s cubic-bezier(.34, 1.56, .64, 1) both;
}
.marker .tag {
  position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%);
  white-space: nowrap; font-size: 11px; font-weight: 700; letter-spacing: .02em;
  padding: 3px 8px; border-radius: 999px; background: var(--lin);
  box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
}
.marker.wide .tag { left: auto; right: 8px; bottom: auto; top: 50%; transform: translateY(-50%); }
.marker.below .tag { bottom: auto; top: calc(100% + 6px); }

/* ---------- dock ---------- */
.dock {
  position: absolute; right: 24px; bottom: 96px; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
}
.orb-btn {
  pointer-events: auto; width: 54px; height: 54px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; background: rgba(24, 18, 38, .92);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .35), 0 0 0 1px rgba(255, 255, 255, .08);
  transition: transform .35s cubic-bezier(.34, 1.56, .64, 1);
}
.orb-btn:hover { transform: scale(1.08); }
.orb-btn .orb { width: 30px; height: 30px; }
.panel {
  position: relative; width: 324px; max-width: calc(100vw - 48px); padding: 14px; border-radius: 20px;
  background: rgba(24, 18, 38, .9);
  -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .42);
  transform-origin: bottom right;
  transition: opacity .25s ease, transform .45s cubic-bezier(.34, 1.56, .64, 1), visibility 0s linear .3s;
  opacity: 0; transform: scale(.88) translateY(12px); visibility: hidden;
}
.dock.open .panel {
  pointer-events: auto; opacity: 1; transform: none; visibility: visible;
  transition: opacity .25s ease, transform .45s cubic-bezier(.34, 1.56, .64, 1), visibility 0s;
}
.p-head { display: flex; align-items: center; gap: 10px; }
.p-head .orb { width: 28px; height: 28px; }
.p-title { display: flex; flex-direction: column; line-height: 1.2; }
.p-title b { font-size: 14px; }
.p-title small { font-size: 11.5px; color: rgba(255, 255, 255, .55); }
.p-head .b-close { font-size: 20px; }
.ask {
  display: flex; align-items: center; margin-top: 12px; border-radius: 13px;
  background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .1);
  transition: border-color .2s, box-shadow .2s;
}
.ask:focus-within { border-color: rgba(250, 126, 30, .7); box-shadow: 0 0 0 3px rgba(214, 41, 118, .22); }
.ask input {
  flex: 1; min-width: 0; padding: 10px 12px; border: 0; outline: 0; background: transparent;
  color: #fff; font: inherit; font-size: 13.5px;
}
.ask input::placeholder { color: rgba(255, 255, 255, .42); }
.ask button {
  width: 32px; height: 32px; margin-right: 4px; padding: 0; border: 0; border-radius: 10px;
  display: grid; place-items: center; background: var(--lin);
}
.p-label { margin: 12px 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.45); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255, 255, 255, .13); background: rgba(255, 255, 255, .05);
  transition: background .2s, border-color .2s, transform .25s cubic-bezier(.34, 1.56, .64, 1);
}
.chip:hover { background: rgba(255, 255, 255, .13); border-color: rgba(250, 126, 30, .6); transform: translateY(-1px); }
.p-actions { display: flex; gap: 6px; margin-top: 12px; }
.p-actions .btn { flex: 1; padding: 8px 6px; }
.toggle { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 12.5px; color: rgba(255, 255, 255, .8); cursor: pointer; user-select: none; }
.toggle input { display: none; }
.sw { position: relative; width: 30px; height: 18px; border-radius: 999px; background: rgba(255, 255, 255, .18); transition: background .25s; }
.sw::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; transition: transform .3s cubic-bezier(.34, 1.56, .64, 1);
}
.toggle input:checked + .sw { background: var(--lin); }
.toggle input:checked + .sw::after { transform: translateX(12px); }
.p-status { margin-top: 10px; font-size: 12px; color: rgba(255, 255, 255, .6); min-height: 1em; }
.p-status:empty { display: none; }

/* ---------- keyframes ---------- */
@keyframes spin { to { transform: rotate(1turn); } }
@keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes halo {
  0%, 100% { box-shadow: 0 0 18px 4px rgba(214, 41, 118, .55), 0 0 44px 12px rgba(150, 47, 191, .28); }
  50% { box-shadow: 0 0 24px 6px rgba(250, 126, 30, .55), 0 0 58px 16px rgba(214, 41, 118, .3); }
}
@keyframes ripple { 0% { inset: 0; opacity: .9; } 100% { inset: -20px; opacity: 0; } }
@keyframes pop {
  0% { transform: scale(1); opacity: 1; }
  40% { transform: scale(1.16); opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; }
}
@keyframes tap {
  0%, 45%, 100% { transform: scale(1); }
  55% { transform: scale(.8) translate(1px, 1px); }
  68% { transform: scale(1.04); }
  76% { transform: scale(1); }
}
@keyframes tapring {
  0%, 52% { transform: scale(.3); opacity: 0; }
  57% { opacity: .95; }
  100% { transform: scale(1.5); opacity: 0; }
}
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes blink { to { opacity: 0; } }
@keyframes dot { 0%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }
@keyframes blob {
  0%, 100% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; }
  25% { border-radius: 58% 42% 52% 48% / 46% 56% 44% 54%; }
  50% { border-radius: 45% 55% 44% 56% / 55% 44% 56% 45%; }
  75% { border-radius: 53% 47% 58% 42% / 48% 53% 47% 52%; }
}
@keyframes spark {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; }
}
@keyframes shock { from { transform: scale(.5); opacity: 1; } to { transform: scale(5); opacity: 0; border-width: 1px; } }
@keyframes markerIn { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .ring-inner, .halo, .pulse, .bubble-inner, .orb, .border::before { animation: none !important; }
}
`;

  const HTML = `
<div class="root dim">
  <div class="spot"></div>
  <div class="scan"></div>
  <div class="ring"><div class="ring-inner">
    <div class="pulse"></div><div class="pulse p2"></div><div class="halo"></div><div class="border"></div>
  </div></div>
  <div class="fx"></div>
  <div class="cursor">
    <span class="tap-ring"></span>
    <div class="cursor-inner">
      <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true">
        <defs><linearGradient id="gcg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fa7e1e"/><stop offset=".55" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/>
        </linearGradient></defs>
        <path d="M3 2 L3 26.5 L9.4 20.6 L13.8 30.6 L18.6 28.5 L14.3 18.7 L23 18.4 Z"
          fill="url(#gcg) #d62976" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>
    </div>
  </div>
  <div class="bubble"><div class="bubble-pop"><div class="bubble-inner">
    <div class="b-head">
      <span class="orb"></span><span class="b-name">Grammy</span><span class="b-step"></span>
      <button class="b-close" aria-label="Close">×</button>
    </div>
    <div class="b-text"><span class="b-ghost"></span><span class="b-typed"></span><span class="dots"><i></i><i></i><i></i></span></div>
    <div class="b-actions"><button class="btn primary b-next">Next</button><button class="btn ghost b-end">End tour</button></div>
  </div></div></div>
  <div class="dock">
    <div class="panel">
      <div class="p-head">
        <span class="orb"></span>
        <div class="p-title"><b>Grammy</b><small>Instagram overlay test</small></div>
        <button class="b-close p-close" aria-label="Close">×</button>
      </div>
      <form class="ask">
        <input type="text" placeholder="Ask… “how do I save this post?”" autocomplete="off" spellcheck="false">
        <button type="submit" aria-label="Ask">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </form>
      <div class="p-label">Point me at</div>
      <div class="chips"></div>
      <div class="p-actions">
        <button class="btn primary" data-act="tour">Guided tour</button>
        <button class="btn ghost" data-act="scan">Scan</button>
        <button class="btn ghost" data-act="clear">Clear</button>
      </div>
      <label class="toggle"><input type="checkbox" class="dim-toggle" checked><span class="sw"></span>Dim the page around targets</label>
      <div class="p-status"></div>
    </div>
    <button class="orb-btn" title="Grammy (Alt+G)" aria-label="Open Grammy"><span class="orb"></span></button>
  </div>
</div>`;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
  document.documentElement.appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const rootEl = $('.root'), spot = $('.spot'), ring = $('.ring'), cursor = $('.cursor');
  const bubble = $('.bubble'), bText = $('.b-text'), bGhost = $('.b-ghost'), bTyped = $('.b-typed');
  const bStep = $('.b-step'), bNext = $('.b-next'), fx = $('.fx'), scanLayer = $('.scan');
  const dock = $('.dock'), panel = $('.panel'), orbBtn = $('.orb-btn'), askInput = $('.ask input');
  const pStatus = $('.p-status'), dimToggle = $('.dim-toggle');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    active: false, key: null, el: null, lastRect: null, lastResolve: 0,
    done: false, tour: null, scanning: false, scanAt: 0, timer: 0, bubSide: null,
    ring: { x: 0, y: 0, w: 0, h: 0, r: 16, vx: 0, vy: 0, vw: 0, vh: 0, vr: 0 },
    cur: { x: 0, y: 0, vx: 0, vy: 0, shown: false },
    bub: { x: 0, y: 0, vx: 0, vy: 0, init: false },
  };
  const markers = new Map();

  // Damped spring — slightly under-damped so motion settles with a little life.
  function spring(s, k, target, stiff, damp, dt) {
    const vk = 'v' + k;
    s[vk] += (stiff * (target - s[k]) - damp * s[vk]) * dt;
    s[k] += s[vk] * dt;
  }

  function boxFor(r) {
    const pad = clamp(Math.min(r.width, r.height) * 0.25, 6, 10);
    let x = r.left - pad, w = r.width + pad * 2;
    const h = r.height + pad * 2;
    // Keep the ring fully on-screen for things hugging the viewport edge (e.g. the sidebar).
    if (x < 3) { w -= 3 - x; x = 3; }
    if (x + w > innerWidth - 3) w = innerWidth - 3 - x;
    const circle = Math.max(w, h) / Math.min(w, h) < 1.45;
    return { x, y: r.top - pad, w, h, circle, radius: circle ? Math.min(w, h) / 2 : Math.min(h / 2, 14) };
  }

  function dockAnchor() {
    if (!dock.hidden) return orbBtn.getBoundingClientRect();
    return { left: innerWidth - 78, right: innerWidth - 24, top: innerHeight - 150, bottom: innerHeight - 96 };
  }

  const ORIGINS = { right: '0% 50%', left: '100% 50%', bottom: '50% 0%', top: '50% 100%', dock: '100% 100%' };
  function placeBubble(T, bw, bh, scope) {
    const m = 14, gap = 18, vw = innerWidth, vh = innerHeight;
    const cx = T.x + T.w / 2 - bw / 2, cy = T.y + T.h / 2 - bh / 2;
    const sides = {
      right: [T.x + T.w + gap, cy, (x) => x + bw <= vw - m],
      left: [T.x - gap - bw, cy, (x) => x >= m],
      bottom: [cx, T.y + T.h + gap + 16, (x, y) => y + bh <= vh - m], // extra room for the cursor
      top: [cx, T.y - gap - bh, (x, y) => y >= m],
    };
    const order = scope === 'nav' && T.x < vw * 0.35
      ? ['right', 'bottom', 'top', 'left']
      : ['bottom', 'top', 'right', 'left'];
    for (const side of order) {
      const [x, y, fits] = sides[side];
      if (fits(x, y)) return { side, x: clamp(x, m, vw - bw - m), y: clamp(y, m, vh - bh - m) };
    }
    return { side: 'bottom', x: clamp(cx, m, vw - bw - m), y: clamp(T.y + T.h + gap, m, vh - bh - m) };
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------
  let raf = 0, lastT = 0;
  function startLoop() {
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function tick(now) {
    raf = 0;
    const dt = Math.min((now - lastT) / 1000, 1 / 30);
    lastT = now;
    if (state.active) stepHighlight(dt, now);
    if (state.scanning) stepScan(now);
    if (state.active || state.scanning) raf = requestAnimationFrame(tick);
  }

  function setSide(side) {
    if (side !== state.bubSide) { state.bubSide = side; $('.bubble-pop').style.transformOrigin = ORIGINS[side]; }
  }

  function moveBubble(tx, ty, dt) {
    const B = state.bub;
    if (!B.init) { B.x = tx; B.y = ty; B.vx = B.vy = 0; B.init = true; }
    spring(B, 'x', tx, 110, 18, dt);
    spring(B, 'y', ty, 110, 18, dt);
    bubble.style.transform = `translate3d(${B.x}px, ${B.y}px, 0)`;
  }

  function stepHighlight(dt, now) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;

    // Message-only mode (nothing to point at): float above the dock.
    if (!state.key) {
      const a = dockAnchor();
      setSide('dock');
      moveBubble(clamp(a.right - bw, 14, innerWidth - bw - 14), clamp(a.top - bh - 14, 14, innerHeight - bh - 14), dt);
      return;
    }

    let el = state.el;
    if (!isVisible(el) && now - state.lastResolve > 400) {
      // Instagram re-renders a lot — go find the button again.
      state.lastResolve = now;
      const fresh = resolve(state.key);
      if (fresh) { state.el = el = fresh; state.lastRect = null; }
    }
    const ok = isVisible(el);
    rootEl.classList.toggle('lost', !ok);
    if (!ok) { state.lastRect = null; cursor.classList.remove('tap'); return; }

    const r = el.getBoundingClientRect();
    const R = state.ring, C = state.cur;
    // Move rigidly with the page when it scrolls; springs only handle the "travel" between targets.
    if (state.lastRect) {
      const dx = r.left - state.lastRect.left, dy = r.top - state.lastRect.top;
      if (dx || dy) { R.x += dx; R.y += dy; C.x += dx; C.y += dy; }
    }
    state.lastRect = { left: r.left, top: r.top };

    const T = boxFor(r);
    spring(R, 'x', T.x, 190, 21, dt);
    spring(R, 'y', T.y, 190, 21, dt);
    spring(R, 'w', T.w, 160, 19, dt);
    spring(R, 'h', T.h, 160, 19, dt);
    const w = Math.max(R.w, 8), h = Math.max(R.h, 8);
    spring(R, 'r', T.circle ? Math.min(w, h) / 2 : T.radius, 160, 19, dt);
    const radius = Math.max(0, Math.min(R.r, w / 2, h / 2)) + 'px';
    const tf = `translate3d(${R.x}px, ${R.y}px, 0)`;
    for (const node of [ring, spot]) {
      node.style.transform = tf;
      node.style.width = w + 'px';
      node.style.height = h + 'px';
      node.style.borderRadius = radius;
    }
    ring.style.setProperty('--d', Math.hypot(w, h) * 1.15 + 'px');
    ring.style.setProperty('--pr', T.circle ? '999px' : T.radius + 10 + 'px');

    // Cursor: different stiffness per axis → it glides along a gentle curve, not a straight line.
    const tipX = T.x + Math.min(T.w * 0.62, T.h * 0.8), tipY = T.y + T.h * 0.64;
    spring(C, 'x', tipX, 75, 15, dt);
    spring(C, 'y', tipY, 48, 12.5, dt);
    const tilt = clamp(C.vx * 0.025, -14, 14);
    cursor.style.transform = `translate3d(${C.x - 3}px, ${C.y - 2}px, 0) rotate(${tilt}deg)`;
    const dist = Math.hypot(tipX - C.x, tipY - C.y), speed = Math.hypot(C.vx, C.vy);
    if (dist < 3 && speed < 25) cursor.classList.add('tap');
    else if (dist > 10) cursor.classList.remove('tap');

    const P = placeBubble(T, bw, bh, TARGETS[state.key].scope);
    setSide(P.side);
    moveBubble(P.x, P.y, dt);
  }

  // ---------------------------------------------------------------------------
  // Bubble text (typewriter with a short "thinking" beat)
  // ---------------------------------------------------------------------------
  let typeTimer = 0;
  function setBubble(text, { think = true } = {}) {
    clearTimeout(typeTimer);
    const chars = Array.from(text);
    bGhost.textContent = text;
    bTyped.textContent = '';
    bTyped.classList.add('typing');
    bText.classList.toggle('thinking', think);
    bubble.classList.add('show');
    let i = 0;
    const type = () => {
      bText.classList.remove('thinking');
      i++;
      bTyped.textContent = chars.slice(0, i).join('');
      if (i < chars.length) {
        const ch = chars[i - 1];
        typeTimer = setTimeout(type, /[.!?—]/.test(ch) ? 170 : ch === ',' ? 90 : 12 + Math.random() * 24);
      } else {
        bTyped.classList.remove('typing');
      }
    };
    typeTimer = setTimeout(type, think ? 450 : 0);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function ensureInView(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 80) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function endTour() {
    state.tour = null;
    rootEl.classList.remove('touring');
    bStep.textContent = '';
  }

  function highlight(key, { text, fromTour = false } = {}) {
    const def = TARGETS[key];
    if (!def) return { ok: false, message: `Unknown target "${key}"` };
    if (!fromTour) endTour();
    clearTimeout(state.timer);
    const el = resolve(key);
    if (!el) {
      sayOnly(`I couldn't find the ${def.name} button on this page. ${def.missing || ''}`.trim());
      return { ok: false, message: `${def.name} isn't on this page. ${def.missing || ''}`.trim() };
    }
    const hadTarget = state.active && state.key;
    state.key = key;
    state.el = el;
    state.lastRect = null;
    state.done = false;
    ensureInView(el);

    const T = boxFor(el.getBoundingClientRect());
    if (!hadTarget) {
      // Start wide and soft, then "focus in" on the button.
      Object.assign(state.ring, { x: T.x - 40, y: T.y - 40, w: T.w + 80, h: T.h + 80, r: T.radius + 40, vx: 0, vy: 0, vw: 0, vh: 0, vr: 0 });
    }
    if (!state.cur.shown) {
      const a = dockAnchor();
      Object.assign(state.cur, { x: a.left + 10, y: a.top + 10, vx: 0, vy: 0, shown: true });
    }
    state.active = true;
    rootEl.classList.add('active', 'has-target');
    rootEl.classList.remove('lost', 'success');
    setBubble(text || def.say);
    startLoop();
    return { ok: true, message: `Pointing at ${def.name}` };
  }

  function sayOnly(text, ms = 4500) {
    endTour();
    clearTimeout(state.timer);
    const wasTargeting = !!state.key;
    state.key = null;
    state.el = null;
    state.active = true;
    if (wasTargeting) state.bub.init = false;
    rootEl.classList.add('active');
    rootEl.classList.remove('has-target', 'lost', 'success');
    cursor.classList.remove('tap');
    state.cur.shown = false;
    setBubble(text);
    state.timer = setTimeout(clear, ms);
    startLoop();
  }

  function clear() {
    clearTimeout(state.timer);
    clearTimeout(typeTimer);
    endTour();
    Object.assign(state, { active: false, key: null, el: null, done: false, lastRect: null });
    state.cur.shown = false;
    state.bub.init = false;
    rootEl.classList.remove('active', 'has-target', 'lost', 'success');
    bubble.classList.remove('show');
    cursor.classList.remove('tap');
  }

  function burst(x, y) {
    const colors = ['#feda75', '#fa7e1e', '#d62976', '#962fbf', '#4f5bd5', '#ffffff'];
    const shock = document.createElement('div');
    shock.className = 'shock';
    shock.style.left = x + 'px';
    shock.style.top = y + 'px';
    fx.appendChild(shock);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const d = 30 + Math.random() * 42;
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      s.style.setProperty('--c', colors[i % colors.length]);
      s.style.setProperty('--s', 4 + Math.random() * 5 + 'px');
      fx.appendChild(s);
    }
    for (const n of fx.children) n.addEventListener('animationend', () => n.remove(), { once: true });
  }

  function onTargetClicked() {
    state.done = true;
    const r = state.el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    rootEl.classList.add('success');
    cursor.classList.remove('tap');
    const last = state.tour && state.tour.i >= state.tour.steps.length - 1;
    setBubble(pick(['Nice! ✨', 'Perfect — you got it!', "That's the one! 🎉", 'Yes, exactly!']), { think: false });
    clearTimeout(state.timer);
    state.timer = setTimeout(() => (state.tour && !last ? nextTourStep() : clear()), 1400);
  }

  // ---------------------------------------------------------------------------
  // Tour
  // ---------------------------------------------------------------------------
  function startTour() {
    scan(false);
    const steps = TOUR.filter((k) => resolve(k));
    if (!steps.length) {
      sayOnly("I can't see any Instagram buttons here yet — try the home feed.");
      return { ok: false, message: 'No buttons found for the tour' };
    }
    clear();
    state.tour = { steps, i: 0 };
    showTourStep();
    return { ok: true, message: `Tour started · ${steps.length} stops` };
  }
  function showTourStep() {
    const t = state.tour;
    const key = t.steps[t.i];
    const res = highlight(key, { fromTour: true });
    if (!res.ok) return nextTourStep(); // it vanished; skip it
    rootEl.classList.add('touring');
    bStep.textContent = `${t.i + 1} / ${t.steps.length}`;
    bNext.textContent = t.i === t.steps.length - 1 ? 'Finish' : 'Next';
  }
  function nextTourStep() {
    const t = state.tour;
    if (!t) return;
    t.i++;
    if (t.i >= t.steps.length) {
      sayOnly("That's the whole tour! Ask me about any button, any time. ✨", 3500);
      return;
    }
    showTourStep();
  }

  // ---------------------------------------------------------------------------
  // Scan mode — outline every button we can recognise (good for sanity-checking selectors)
  // ---------------------------------------------------------------------------
  function scan(on = !state.scanning) {
    state.scanning = on;
    if (!on) {
      markers.forEach((m) => m.remove());
      markers.clear();
      return { ok: true, message: 'Scan off' };
    }
    const n = rebuildScan();
    state.scanAt = performance.now();
    startLoop();
    return { ok: true, message: `Found ${n} button${n === 1 ? '' : 's'} on screen` };
  }

  function rebuildScan() {
    const snap = snapshot();
    const want = new Map();
    for (const def of Object.values(TARGETS)) {
      const cands = candidatesFor(def, snap);
      if (def.scope === 'post') {
        for (const [el] of cands) {
          if (!isVisible(el) || iconSize(el) < 18) continue;
          const r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < innerHeight) want.set(el, def.name);
        }
      } else {
        const best = pickBest(def, cands);
        if (best) want.set(best, def.name);
      }
    }
    for (const [el, m] of markers) if (!want.has(el)) { m.remove(); markers.delete(el); }
    let i = 0, round = 0;
    for (const [el, name] of want) {
      if (markers.has(el)) continue;
      const r = el.getBoundingClientRect();
      const m = document.createElement('div');
      m.className = 'marker';
      m.innerHTML = '<div class="marker-box"><span class="tag"></span></div>';
      const box = m.firstChild;
      box.style.animationDelay = Math.min(i++ * 40, 600) + 'ms';
      if (Math.max(r.width, r.height) / Math.min(r.width, r.height) < 1.45) {
        box.style.borderRadius = '999px';
        if (round++ % 2) m.classList.add('below'); // stagger labels so neighbouring icons don't collide
      } else {
        m.classList.add('wide'); // label sits inside the row, on the right
      }
      box.firstChild.textContent = name;
      scanLayer.appendChild(m);
      markers.set(el, m);
    }
    return want.size;
  }

  function stepScan(now) {
    if (now - state.scanAt > 1500) { state.scanAt = now; rebuildScan(); }
    for (const [el, m] of markers) {
      if (!el.isConnected) { m.remove(); markers.delete(el); continue; }
      const r = el.getBoundingClientRect();
      const pad = 4;
      m.style.transform = `translate3d(${r.left - pad}px, ${r.top - pad}px, 0)`;
      m.style.width = r.width + pad * 2 + 'px';
      m.style.height = r.height + pad * 2 + 'px';
      m.style.display = r.bottom < -60 || r.top > innerHeight + 60 ? 'none' : '';
    }
  }

  // ---------------------------------------------------------------------------
  // "AI" — keyword intent matching standing in for the real agent
  // ---------------------------------------------------------------------------
  function ask(text) {
    const q = norm(text);
    if (!q) return { ok: false, message: '' };
    const hit = INTENTS.find(([, re]) => re.test(q));
    if (!hit) {
      sayOnly("Hmm, I'm not sure which button that is. Try “how do I save this post?”");
      return { ok: false, message: 'No matching button' };
    }
    const [key] = hit;
    if (key === 'tour') return startTour();
    if (key === 'scan') return scan(true);
    if (key === 'clear') { clear(); scan(false); return { ok: true, message: 'Cleared' }; }
    return highlight(key, { text: pick(['Sure! ', 'Got it. ', 'Right here! ']) + TARGETS[key].say });
  }

  function setDim(on) {
    rootEl.classList.toggle('dim', on);
    dimToggle.checked = on;
  }
  function setDock(visible) {
    dock.hidden = !visible;
    if (!visible) dock.classList.remove('open');
  }
  function togglePanel(open = !dock.classList.contains('open')) {
    if (dock.hidden) setDock(true);
    dock.classList.toggle('open', open);
    if (open) setTimeout(() => askInput.focus(), 60);
  }
  function status(res) {
    pStatus.textContent = res && res.message ? res.message : '';
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  const chips = $('.chips');
  for (const [key, def] of Object.entries(TARGETS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = def.name;
    b.addEventListener('click', () => { togglePanel(false); status(highlight(key)); });
    chips.appendChild(b);
  }
  $('.p-actions').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'tour') { togglePanel(false); status(startTour()); }
    if (act === 'scan') status(scan());
    if (act === 'clear') { clear(); scan(false); status(null); }
  });
  $('.ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = ask(askInput.value);
    status(res);
    if (res.ok) { askInput.value = ''; togglePanel(false); }
  });
  // Keep Instagram's own keyboard shortcuts from firing while typing in our box.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Escape') togglePanel(false);
    });
  }
  dimToggle.addEventListener('change', () => setDim(dimToggle.checked));
  orbBtn.addEventListener('click', () => togglePanel());
  $('.p-close').addEventListener('click', () => togglePanel(false));
  $('.bubble .b-close').addEventListener('click', clear);
  bNext.addEventListener('click', () => { clearTimeout(state.timer); nextTourStep(); });
  $('.b-end').addEventListener('click', clear);

  // Did the user click the thing we pointed at?
  document.addEventListener('click', (e) => {
    if (!state.active || !state.el || state.done) return;
    if (e.composedPath().includes(state.el)) onTargetClicked();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyG') { e.preventDefault(); togglePanel(); }
    else if (e.key === 'Escape' && (state.active || state.scanning)) { clear(); scan(false); }
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    let res = { ok: true };
    switch (msg && msg.type) {
      case 'ping': res = { ok: true, dim: rootEl.classList.contains('dim'), dock: !dock.hidden, scanning: state.scanning }; break;
      case 'highlight': res = highlight(msg.key); break;
      case 'tour': res = startTour(); break;
      case 'scan': res = scan(); break;
      case 'clear': clear(); scan(false); break;
      case 'ask': res = ask(msg.text || ''); break;
      case 'dim': setDim(!!msg.value); break;
      case 'dock': setDock(!!msg.value); break;
      default: res = { ok: false, message: 'Unknown command' };
    }
    sendResponse(res);
  });
})();
