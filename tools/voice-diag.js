// tools/voice-diag.js — times the VOICE_START / VOICE_STOP bus round trips directly from an
// extension page (bypassing the overlay) and dumps the service-worker + offscreen consoles.
//   CHROME_PATH=<edge/chromium> node tools/voice-diag.js [--mic-denied]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
// Ports come from e2e.js (override with E2E_SERVE_PORT / E2E_DEV_PORT) so waitDevtools() polls the right one.
import { connectWS, getJSON, putJSON, evalIn, waitFor, sleep, waitDevtools, CHROME, repo, DEV_PORT, SERVE_PORT } from './e2e.js';

const MIC_DENIED = process.argv.includes('--mic-denied');

async function main() {
  const server = spawn(process.execPath, [path.join(repo, 'tools', 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  await sleep(500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grammy-vdiag-'));
  const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900',
    `--user-data-dir=${profile}`, `--load-extension=${repo}`, `--disable-extensions-except=${repo}`,
    `--remote-debugging-port=${DEV_PORT}`, '--autoplay-policy=no-user-gesture-required'];
  if (!MIC_DENIED) flags.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  else flags.push('--deny-permission-prompts');
  flags.push(`http://localhost:${SERVE_PORT}/p/C9xY2kLpQ7a/`);
  const chrome = spawn(CHROME, flags, { stdio: 'ignore' });
  const logs = [];
  const attachConsole = async (t, label) => {
    const c = await connectWS(t.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    c.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${label}] ${m.params.type}: ${m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') logs.push(`[${label}] EXC: ${(m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text}`);
    });
    return c;
  };
  try {
    await waitDevtools();
    // wait for the page + our service worker to exist
    let targets; let sw = null; let page = null;
    for (let i = 0; i < 40 && !sw; i++) {
      targets = await getJSON(`http://localhost:${DEV_PORT}/json`);
      page = targets.find((t) => t.type === 'page' && /localhost/.test(t.url));
      sw = targets.find((t) => t.type === 'service_worker' && /src\/bg\/service-worker\.js/.test(t.url));
      if (!sw) await sleep(250);
    }
    console.log('service worker target:', sw ? sw.url : 'NOT FOUND');
    if (!sw) throw new Error('service worker never appeared (extension not loaded?)');
    const extId = new URL(sw.url).host;
    const swc = await attachConsole(sw, 'sw');

    // an extension page to send bus messages from
    const t = await putJSON(`http://localhost:${DEV_PORT}/json/new?chrome-extension://${extId}/src/onboarding/index.html`);
    const ext = await connectWS(t.webSocketDebuggerUrl);
    await ext.send('Runtime.enable');
    await sleep(600);

    const timeIt = async (label, type) => {
      const r = await evalIn(ext, `(async()=>{const t0=Date.now();let res;try{res=await chrome.runtime.sendMessage({type:${JSON.stringify(type)},data:{}})}catch(e){res={threw:String(e&&e.message)}};return {ms:Date.now()-t0,res}})()`);
      console.log(`${label}: ${r.ms} ms →`, JSON.stringify(r.res).slice(0, 220));
      return r;
    };
    const contexts = async (label) => {
      const r = await evalIn(swc, `(async()=>{const c=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});return c.map(x=>x.documentUrl||x.url)})()`);
      console.log(`${label}: offscreen contexts =`, JSON.stringify(r));
    };

    await contexts('before any VOICE_START');
    await timeIt('VOICE_START #1', 'VOICE_START');
    await contexts('after VOICE_START #1');
    // attach to the offscreen doc console if it exists now
    targets = await getJSON(`http://localhost:${DEV_PORT}/json`);
    const off = targets.find((x) => /offscreen\.html/.test(x.url));
    console.log('offscreen target:', off ? `${off.type} ${off.url}` : 'NOT LISTED');
    if (off) await attachConsole(off, 'offscreen');
    await sleep(700);
    await timeIt('VOICE_STOP  #1', 'VOICE_STOP');
    await sleep(300);
    await timeIt('VOICE_START #2', 'VOICE_START');
    await sleep(700);
    await timeIt('VOICE_STOP  #2', 'VOICE_STOP');
    await timeIt('VOICE_START #3', 'VOICE_START');
    await timeIt('VOICE_STOP  #3', 'VOICE_STOP');
    await contexts('at the end');
  } catch (e) {
    console.log('diag error:', e && e.message);
  } finally {
    await sleep(300);
    console.log('\n--- captured console ---');
    for (const l of logs.slice(0, 60)) console.log(l.slice(0, 300));
    try { chrome.kill(); } catch { /* ignore */ }
    try { server.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
main();
