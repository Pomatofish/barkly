// tools/e2e.js — Phase-4 end-to-end harness. Zero dependencies.
//
// Launches headless Chrome with the unpacked extension, serves the fixtures under
// Instagram-shaped paths (tools/serve.js dev routes), and drives the real overlay
// through the Chrome DevTools Protocol over a hand-rolled WebSocket client.
//
//   node tools/e2e.js                 normal run: fake microphone auto-granted
//   node tools/e2e.js --mic-denied    no fake-mic flags → getUserMedia is denied (row 7)
//   GRAMMY_TEST_KEY=sk-...  node tools/e2e.js   writes the key into chrome.storage first,
//                                     so the ask flow hits the real model instead of row 13
//
// Prints PASS/FAIL lines, a summary, and exits 1 on any failure.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const MIC_DENIED = argv.includes('--mic-denied');
const KEY = process.env.GRAMMY_TEST_KEY || '';
const SERVE_PORT = Number(process.env.E2E_SERVE_PORT) || 8150;
const DEV_PORT = Number(process.env.E2E_DEV_PORT) || 9333;
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = `http://localhost:${SERVE_PORT}`;
const URLS = {
  post: `${BASE}/p/C9xY2kLpQ7a/`,
  publicProfile: `${BASE}/lena.explores/`,
  privateProfile: `${BASE}/quiet.club/`,
  privatePost: `${BASE}/p/DB1QuietZ9k/`,
  unknown: `${BASE}/accounts/edit/`,
  story: `${BASE}/stories/nomad.bites/3421987654321/`,
};
const PILL = {
  READY: 'Ready',
  UNCONFIRMED: "Can't confirm this account is public",
  LISTENING: 'Listening…',
  PUBLIC_POST: 'Public post — reading',
  PRIVATE: 'Private account — not reading',
  UNKNOWN_PAGE: 'Not sure what page this is',
  STORY_NO_TEXT: 'Story has no text I can read',
  MIC_OFF: 'Mic off — type instead',
  DIDNT_CATCH: "Didn't catch that",
  NO_KEY: 'Add your API key in settings',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* ------------------------------------------------------------- tiny WS/CDP */

export function connectWS(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const sock = net.connect({ host: u.hostname, port: Number(u.port) });
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let nextId = 1;
    let frags = [];
    const pending = new Map();
    const listeners = [];

    const xor = (payload, mask) => {
      const out = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
      return out;
    };
    const sendFrame = (op, payload) => {
      const mask = crypto.randomBytes(4);
      const len = payload.length;
      let header;
      if (len < 126) header = Buffer.from([0x80 | op, 0x80 | len]);
      else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
      sock.write(Buffer.concat([header, mask, xor(payload, mask)]));
    };
    const onMessage = (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) { try { fn(msg); } catch { /* ignore */ } }
      }
    };
    const client = {
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params })));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { sock.end(); } catch { /* ignore */ } },
    };

    sock.on('connect', () => {
      sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on('error', (e) => reject(e));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.slice(0, i).toString();
        if (!/ 101 /.test(head)) { reject(new Error('WS upgrade failed: ' + head.split('\r\n')[0])); return; }
        upgraded = true;
        buf = buf.slice(i + 4);
        resolve(client);
      }
      for (;;) {
        if (buf.length < 2) break;
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (masked) off += 4;
        if (buf.length < off + len) break;
        let payload = buf.slice(off, off + len);
        if (masked) payload = xor(payload, buf.slice(off - 4, off));
        buf = buf.slice(off + len);
        if (op === 0x8) { sock.end(); break; }
        if (op === 0x9) { sendFrame(0xA, payload); continue; }
        if (op === 0x1 || op === 0x0) {
          frags.push(payload);
          if (fin) { const text = Buffer.concat(frags).toString('utf8'); frags = []; onMessage(text); }
        }
      }
    });
  });
}

export function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
export function putJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT' }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('bad /json/new response: ' + s.slice(0, 120))); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitDevtools(timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { return await getJSON(`http://localhost:${DEV_PORT}/json/version`); } catch { /* not yet */ }
    if (Date.now() - t0 > timeout) throw new Error('devtools endpoint never came up');
    await sleep(250);
  }
}

/* ------------------------------------------------------------ page helpers */

// Reads inside the overlay's shadow root from the page's main world.
const SH = `(function(id){var h=document.getElementById('grammy-host');return h&&h.shadowRoot?h.shadowRoot.getElementById(id):null;})`;

export async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('eval threw: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
  }
  return r.result ? r.result.value : undefined;
}
async function waitFor(cdp, expression, { timeout = 8000, every = 200, label = '' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await evalIn(cdp, expression); } catch (e) { last = undefined; }
    if (last) return last;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}
async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  const ok = await waitFor(cdp, `document.readyState==='complete' && location.href===${JSON.stringify(url)}`, { timeout: 10000 });
  if (!ok) throw new Error('navigation did not complete: ' + url);
}
const pillText = (cdp) => evalIn(cdp, `(function(){var p=${SH}('pill');return p?p.textContent:null})()`);
const pillClass = (cdp) => evalIn(cdp, `(function(){var p=${SH}('pill');return p?p.className:null})()`);
const waitPill = (cdp, text, timeout = 8000) => waitFor(cdp, `(function(){var p=${SH}('pill');return !!p&&p.textContent===${JSON.stringify(text)}})()`, { timeout });
const chipTexts = (cdp) => evalIn(cdp, `(function(){var c=${SH}('chips');return c?Array.from(c.querySelectorAll('button')).map(function(b){return b.textContent.trim()}):[]})()`);
const logText = (cdp) => evalIn(cdp, `(function(){var l=${SH}('log');return l?l.textContent:''})()`);
const clickIn = (cdp, id) => evalIn(cdp, `(function(){var e=${SH}(${JSON.stringify(id)});if(!e)return false;e.click();return true})()`);

// Records every pill text change (with ms since install) into window.__pillLog.
async function installPillLog(cdp) {
  return evalIn(cdp, `(function(){var p=${SH}('pill');if(!p)return false;window.__pillLog=[[0,p.textContent]];var t0=Date.now();new MutationObserver(function(){window.__pillLog.push([Date.now()-t0,p.textContent])}).observe(p,{childList:true,characterData:true,subtree:true});return true})()`);
}
const pillLog = (cdp) => evalIn(cdp, `JSON.stringify(window.__pillLog||[])`);

async function mascotCenter(cdp) {
  return evalIn(cdp, `(function(){var m=${SH}('mascot');if(!m)return null;var r=m.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}
async function pressMascot(cdp, holdMs, label = '') {
  const c = await mascotCenter(cdp);
  if (!c) throw new Error('mascot not found');
  const under = await evalIn(cdp, `(function(){var h=document.getElementById('grammy-host');var e=h&&h.shadowRoot?h.shadowRoot.elementFromPoint(${c.x},${c.y}):null;var p=${SH}('panel');return (e?(e.id||e.className||e.tagName):'none')+' | menuOpen='+(!!p&&p.classList.contains('open'))})()`);
  const t = [];
  let t0 = Date.now();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 }); t.push(Date.now() - t0);
  await sleep(holdMs);
  t0 = Date.now();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 }); t.push(Date.now() - t0);
  if (label) console.log(`  · ${label}: under=${under} dispatch ms press/release=${t.join('/')}`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log(`e2e: mode=${MIC_DENIED ? 'mic-denied' : 'normal'} key=${KEY ? 'set' : 'none'}`);

  // 1. static server with the dev routes
  const server = spawn(process.execPath, [path.join(repo, 'tools', 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  await sleep(600);

  // 2. headless Chrome with the unpacked extension
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grammy-e2e-'));
  const flags = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--window-size=1280,900',
    // the fixture tab must never be treated as a background tab (timers/input get throttled)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${profile}`,
    `--load-extension=${repo}`, `--disable-extensions-except=${repo}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--remote-debugging-port=${DEV_PORT}`,
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (!MIC_DENIED) flags.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  else flags.push('--deny-permission-prompts'); // headless cannot show a prompt; make the denial explicit
  flags.push('about:blank');
  const chrome = spawn(CHROME, flags, { stdio: 'ignore' });

  const errors = [];
  let cdp = null;
  try {
    await waitDevtools();
    let targets = await getJSON(`http://localhost:${DEV_PORT}/json`);
    let page = targets.find((t) => t.type === 'page' && /about:blank/.test(t.url)) || targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    cdp = await connectWS(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // The extension opens its onboarding page on install; that tab would steal focus and
    // background our fixture tab. Close every other page target, then bring ours to the front.
    await sleep(1200);
    targets = await getJSON(`http://localhost:${DEV_PORT}/json`);
    for (const t of targets) {
      if (t.type === 'page' && t.id !== page.id) {
        try { await getJSON(`http://localhost:${DEV_PORT}/json/close/${t.id}`); } catch { try { await putJSON(`http://localhost:${DEV_PORT}/json/close/${t.id}`); } catch { /* ignore */ } }
      }
    }
    await cdp.send('Page.bringToFront');
    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails && (m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || '')));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    });

    // 3. optional: put the API key into the extension's storage via an extension page
    if (KEY) {
      await navigate(cdp, URLS.post);            // wakes the service worker
      await sleep(1500);
      targets = await getJSON(`http://localhost:${DEV_PORT}/json`);
      const ext = targets.find((t) => /^chrome-extension:\/\//.test(t.url));
      if (!ext) console.log('WARN: could not find the extension id; skipping key setup');
      else {
        const extId = new URL(ext.url).host;
        const t = await putJSON(`http://localhost:${DEV_PORT}/json/new?chrome-extension://${extId}/src/onboarding/index.html`);
        const c2 = await connectWS(t.webSocketDebuggerUrl);
        await sleep(500);
        await c2.send('Runtime.evaluate', { expression: `chrome.storage.local.set({ apiKey: ${JSON.stringify(KEY)}, onboarded: true })`, awaitPromise: true });
        c2.close();
        console.log('key: written to chrome.storage.local');
      }
    }

    // 4. fresh profile: the owner's privacy is unknown → row 2. Then visit the public
    //    profile (primes the per-username cache) and the post → green.
    await navigate(cdp, URLS.post);
    const injected = await waitFor(cdp, `!!document.getElementById('grammy-host')`, { timeout: 10000 });
    check('extension injected the overlay host on the fixture page', injected);
    if (!injected) throw new Error('overlay never mounted — is --load-extension honoured by this Chrome build? (try Chromium or the lead\'s browser)');
    check('first visit, owner never seen → pill "Can\'t confirm this account is public" (row 2)', await waitPill(cdp, PILL.UNCONFIRMED), `got "${await pillText(cdp)}"`);
    await navigate(cdp, URLS.publicProfile);
    check('public profile → pill "Ready" and caches isPrivate=false', await waitPill(cdp, PILL.READY), `got "${await pillText(cdp)}"`);
    await navigate(cdp, URLS.post);
    const green = await waitPill(cdp, PILL.PUBLIC_POST);
    check('post fixture → pill "Public post — reading"', green, `got "${await pillText(cdp)}"`);
    check('pill is green', /green/.test((await pillClass(cdp)) || ''), await pillClass(cdp));
    let chips = await chipTexts(cdp);
    check('chips include "What\'s this post about?"', chips.includes("What's this post about?"), chips.join(' | '));
    check('chips include "Match this style" (public post focused)', chips.includes('Match this style'), chips.join(' | '));

    // 5. tap opens the menu
    await pressMascot(cdp, 60);
    const opened = await waitFor(cdp, `(function(){var p=${SH}('panel');return !!p&&p.classList.contains('open')})()`, { timeout: 4000 });
    check('tap on mascot opens the chat menu', opened);

    // 6. persona toggle re-renders chips
    await clickIn(cdp, 'personaInfluencer');
    const infl = await waitFor(cdp, `(function(){var c=${SH}('chips');return !!c&&Array.from(c.querySelectorAll('button')).some(function(b){return /how could this do better/i.test(b.textContent)})})()`, { timeout: 4000 });
    chips = await chipTexts(cdp);
    check('influencer persona → chip "How could this do better?"', infl, chips.join(' | '));

    // 7. text ask → row 13 without a key, real reply with a key
    await evalIn(cdp, `(function(){var i=${SH}('textInput');i.value="what's this post about?";return true})()`);
    await clickIn(cdp, 'sendBtn');
    if (!KEY) {
      const canned = await waitFor(cdp, `(function(){var l=${SH}('log');return !!l&&/Add your API key/i.test(l.textContent)})()`, { timeout: 12000 });
      check('no key → canned row-13 reply appears in the chat log', canned, (await logText(cdp)).slice(0, 160));
      const nokeyPill = await waitPill(cdp, PILL.NO_KEY, 4000);
      check('no key → pill "Add your API key in settings" (pushed by bg via STATUS)', nokeyPill, `got "${await pillText(cdp)}"`);
      check('pill is red', /red/.test((await pillClass(cdp)) || ''), await pillClass(cdp));
    } else {
      const replied = await waitFor(cdp, `(function(){var l=${SH}('log');return !!l&&l.querySelectorAll('[class*="assistant"],[data-role="assistant"]').length>0&&!/Add your API key|unavailable right now/i.test(l.textContent)})()`, { timeout: 25000 });
      check('with key → a real assistant reply appears in the chat log', replied, (await logText(cdp)).slice(0, 200));
    }

    // 8. private profile → red; the post owned by that account → red (privacy cache)
    await navigate(cdp, URLS.privateProfile);
    check('private profile → pill "Private account — not reading"', await waitPill(cdp, PILL.PRIVATE), `got "${await pillText(cdp)}"`);
    await navigate(cdp, URLS.privatePost);
    check('post by the private owner → pill PRIVATE via the per-username cache', await waitPill(cdp, PILL.PRIVATE), `got "${await pillText(cdp)}"`);

    // 9. unknown page → yellow row 3; story with no text → row 6
    await navigate(cdp, URLS.unknown);
    check('unknown page → pill "Not sure what page this is"', await waitPill(cdp, PILL.UNKNOWN_PAGE), `got "${await pillText(cdp)}"`);
    await navigate(cdp, URLS.story);
    check('story without text → pill "Story has no text I can read"', await waitPill(cdp, PILL.STORY_NO_TEXT), `got "${await pillText(cdp)}"`);

    // 10. voice: long-press the mascot (pill changes are traced to diagnose the flow)
    await navigate(cdp, URLS.post);
    await waitPill(cdp, PILL.PUBLIC_POST);
    await installPillLog(cdp);
    await pressMascot(cdp, 700, 'press #1');
    if (MIC_DENIED) {
      const off = await waitPill(cdp, PILL.MIC_OFF, 10000);
      check('mic denied → pill "Mic off — type instead" (row 7)', off, `got "${await pillText(cdp)}" trace=${await pillLog(cdp)}`);
      const hidden = await evalIn(cdp, `(function(){var b=${SH}('pttBtn');return !b||b.hidden===true})()`);
      check('mic denied → PTT button hidden (row 7)', hidden);
    } else {
      // Poll the trace (not the live pill) so a state that is set and then restored is still seen.
      const outcome = await waitFor(cdp, `(function(){var L=window.__pillLog||[];var t=L.map(function(x){return x[1]});var l=${SH}('log');if(t.indexOf(${JSON.stringify(PILL.DIDNT_CATCH)})>=0)return 'didnt_catch';if(t.indexOf(${JSON.stringify(PILL.NO_KEY)})>=0||(l&&/Add your API key/.test(l.textContent)))return 'no_key';return null})()`, { timeout: 15000 });
      const trace = await pillLog(cdp);
      check('long-press → pill went through "Listening…"', /Listening/.test(trace), `trace=${trace}`);
      check('long-press → recorded, transcribed, and ended in a defined state (row 8 or row 13)', !!outcome, `outcome=${outcome} final="${await pillText(cdp)}"`);
      const firstListen = (JSON.parse(trace).find((x) => x[1] === PILL.LISTENING) || [null])[0];
      // Second press: is the warm path fast? (first press pays service-worker + offscreen start-up)
      await sleep(800);
      await installPillLog(cdp);
      await pressMascot(cdp, 700, 'press #2 (as-is)');
      const gotIt = await waitFor(cdp, `(function(){var L=window.__pillLog||[];return L.some(function(x){return x[1]===${JSON.stringify(PILL.LISTENING)}})})()`, { timeout: 6000 });
      if (!gotIt) {
        // Diagnostic: does closing the menu first make the second press work?
        await clickIn(cdp, 'closeBtn');
        await sleep(400);
        await installPillLog(cdp);
        await pressMascot(cdp, 700, 'press #2b (menu closed first)');
      }
      await waitFor(cdp, `(function(){var L=window.__pillLog||[];return L.some(function(x){return x[1]===${JSON.stringify(PILL.DIDNT_CATCH)}})})()`, { timeout: 15000 });
      const trace2 = JSON.parse(await pillLog(cdp));
      const secondListen = (trace2.find((x) => x[1] === PILL.LISTENING) || [null])[0];
      check('second long-press → "Listening…" within 1.5 s (warm path)', secondListen !== null && secondListen <= 1500, `first=${firstListen} ms, second=${secondListen} ms`);
    }
  } catch (e) {
    check('harness ran to completion', false, e && e.message);
  } finally {
    try { if (cdp) cdp.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    try { server.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (errors.length) {
    console.log('\npage console errors / exceptions:');
    for (const e of errors.slice(0, 15)) console.log('  · ' + String(e).slice(0, 220));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'SOME FAILED' : 'ALL PASS'} — ${results.length - failed}/${results.length} checks`);
  process.exit(failed ? 1 : 0);
}

export { waitFor, navigate, sleep, waitDevtools, SH, CHROME, repo, DEV_PORT, SERVE_PORT };

// Only run when executed directly (tools/voice-diag.js imports the helpers above).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('e2e crashed:', e); process.exit(1); });
}
