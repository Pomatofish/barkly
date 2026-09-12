const TARGETS = [
  ['like', 'Like'], ['comment', 'Comment'], ['share', 'Share'], ['save', 'Save'],
  ['home', 'Home'], ['search', 'Search'], ['explore', 'Explore'], ['reels', 'Reels'],
  ['messages', 'Messages'], ['notifications', 'Alerts'], ['create', 'Create'], ['profile', 'Profile'],
];
const IG = /^https:\/\/(www\.)?instagram\.com\//;

const $ = (id) => document.getElementById(id);
const statusEl = $('status'), dot = $('dot');

function setStatus(text, kind = '') {
  statusEl.textContent = text || '';
  statusEl.className = 'status ' + kind;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Send a command to the content script; inject it first if the tab predates the extension.
async function send(msg, { quiet = false } = {}) {
  const tab = await activeTab();
  if (!tab || !IG.test(tab.url || '')) {
    dot.className = 'dot off';
    if (!quiet) setStatus('Open instagram.com in this tab first.', 'warn');
    return null;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, msg);
    dot.className = 'dot on';
    return res;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      const res = await chrome.tabs.sendMessage(tab.id, msg);
      dot.className = 'dot on';
      return res;
    } catch {
      dot.className = 'dot off';
      if (!quiet) setStatus("Couldn't reach the page — try refreshing Instagram.", 'err');
      return null;
    }
  }
}

function report(res) {
  if (!res) return;
  setStatus(res.message || (res.ok ? 'Done' : ''), res.ok ? 'good' : 'warn');
}

const grid = $('targets');
for (const [key, label] of TARGETS) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = label;
  b.addEventListener('click', async () => report(await send({ type: 'highlight', key })));
  grid.appendChild(b);
}

$('tour').addEventListener('click', async () => report(await send({ type: 'tour' })));
$('scan').addEventListener('click', async () => report(await send({ type: 'scan' })));
$('clear').addEventListener('click', async () => { await send({ type: 'clear' }); setStatus(''); });
$('dim').addEventListener('change', (e) => send({ type: 'dim', value: e.target.checked }));
$('dock').addEventListener('change', (e) => send({ type: 'dock', value: e.target.checked }));
$('ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('askInput');
  const res = await send({ type: 'ask', text: input.value });
  report(res);
  if (res && res.ok) input.value = '';
});

// Sync toggles with the page on open.
(async () => {
  const res = await send({ type: 'ping' }, { quiet: true });
  if (res) {
    $('dim').checked = !!res.dim;
    $('dock').checked = !!res.dock;
  } else {
    setStatus('Open instagram.com in this tab to try the overlay.', 'warn');
  }
  $('askInput').focus();
})();
