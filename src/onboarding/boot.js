// src/onboarding/boot.js — the ONLY file that touches real globals.
// index.html loads this as `<script type="module" src="boot.js">` (MV3 forbids
// inline scripts). It clones the page markup out of <template id="onboardTemplate">
// into #mount, then hands the real `chrome` and `document` to initOnboarding().
// Kept separate from onboarding.js so that file can be imported by a plain
// test page (src/onboarding/test.html) without also running this bootstrap.
import { initOnboarding } from './onboarding.js';

try {
  const template = document.getElementById('onboardTemplate');
  const mount = document.getElementById('mount');
  if (template && mount && !mount.firstChild) {
    mount.appendChild(template.content.cloneNode(true));
  }
  initOnboarding({ chrome, doc: document }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Grammy onboarding failed to start', e);
  });
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('Grammy onboarding failed to start', e);
}
