// src/brain/memory.test.js — run with `node --test src/brain/`
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, okJson, publicPostContext } from './fakes.js';

const fake = installFakeChrome();
const brain = await import('./index.js');
const mem = await import('./memory.js');
const { LIMITS, STORAGE_KEYS, defaultMemory } = await import('../../shared/types.js');

function fresh() {
  fake.reset();
  brain._resetSession();
}

const pinItem = (n, score) => ({
  kind: 'fact',
  content: `Remembered fact number ${n}.`,
  source: { postId: `post_${n}` },
  score,
});

/* --------------------------------------------------------------- defaults */

test('getMemory on an empty store returns the default memory', async () => {
  fresh();
  const m = await brain.getMemory();
  assert.deepEqual(m, defaultMemory());
});

test('saveMemory shallow-merges and merges profile one level deeper', async () => {
  fresh();
  await brain.saveMemory({ profile: { persona: 'influencer' } });
  await brain.saveMemory({ profile: { niche: 'bouldering' } });
  const m = await brain.getMemory();
  assert.equal(m.profile.persona, 'influencer', 'the earlier profile field survived');
  assert.equal(m.profile.niche, 'bouldering');
  assert.equal(m.profile.brandVoice, '');
  assert.deepEqual(m.pinned, []);
  // It is really persisted under the agreed storage key.
  assert.ok(fake.store[STORAGE_KEYS.MEMORY], 'written to chrome.storage.local["memory"]');
});

test('an unknown persona in a partial is rejected, not stored', async () => {
  fresh();
  await brain.saveMemory({ profile: { persona: 'pirate' } });
  const m = await brain.getMemory();
  assert.equal(m.profile.persona, 'casual');
});

/* ------------------------------------------------------------------- pin */

test('pin() fills in id, timestamps and the default score', async () => {
  fresh();
  const m = await brain.pin({ kind: 'post_style', content: 'Wide sunrise frames.', source: { username: 'ansel', postId: 'C1' } });
  assert.equal(m.pinned.length, 1);
  const p = m.pinned[0];
  assert.ok(p.id);
  assert.equal(p.score, LIMITS.EXPLICIT_PIN_SCORE);
  assert.ok(p.savedAt > 0);
  assert.equal(p.lastUsedAt, p.savedAt);
});

test('pin() dedupes on kind + postId and bumps the score instead of adding', async () => {
  fresh();
  await brain.pin({ kind: 'post_style', content: 'First summary.', source: { postId: 'C1' } });
  const m = await brain.pin({ kind: 'post_style', content: 'A different summary of the same post.', source: { postId: 'C1' } });
  assert.equal(m.pinned.length, 1);
  assert.equal(m.pinned[0].score, LIMITS.EXPLICIT_PIN_SCORE + 1);
  assert.equal(m.pinned[0].content, 'First summary.');
});

test('pin() dedupes on identical content when there is no postId', async () => {
  fresh();
  await brain.pin({ kind: 'preference', content: 'Hates emoji.', source: {} });
  const m = await brain.pin({ kind: 'preference', content: '  hates emoji.  ', source: {} });
  assert.equal(m.pinned.length, 1);
  assert.equal(m.pinned[0].score, LIMITS.EXPLICIT_PIN_SCORE + 1);
});

test('a pin content longer than 60 words is clamped', async () => {
  fresh();
  const long = Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ');
  const m = await brain.pin({ kind: 'fact', content: long, source: {} });
  assert.ok(m.pinned[0].content.split(' ').length <= LIMITS.PIN_CONTENT_MAX_WORDS + 1);
  assert.ok(m.pinned[0].content.endsWith('…'));
});

test('row 17: at the cap the lowest-score item is evicted and the new one is kept', async () => {
  fresh();
  const pinned = [];
  for (let i = 0; i < LIMITS.PINNED_CAP; i += 1) {
    pinned.push({
      id: `id_${i}`,
      kind: 'fact',
      content: `Remembered fact number ${i}.`,
      source: { postId: `post_${i}` },
      score: i === 7 ? 1 : 20 + i,   // item 7 is the weakest
      savedAt: Date.now() - 1000,
      lastUsedAt: Date.now() - 1000,
    });
  }
  await brain.saveMemory({ pinned });
  let m = await brain.getMemory();
  assert.equal(m.pinned.length, LIMITS.PINNED_CAP);

  m = await brain.pin({ kind: 'post_style', content: 'The brand new pin.', source: { postId: 'post_new' }, score: LIMITS.EXPLICIT_PIN_SCORE });
  assert.equal(m.pinned.length, LIMITS.PINNED_CAP, 'still at the cap');
  assert.ok(m.pinned.some((p) => p.source.postId === 'post_new'), 'the new pin survived');
  assert.ok(!m.pinned.some((p) => p.id === 'id_7'), 'the lowest-score item was evicted');

  const reread = await brain.getMemory();
  assert.equal(reread.pinned.length, LIMITS.PINNED_CAP);
  assert.ok(reread.pinned.some((p) => p.source.postId === 'post_new'));
});

test('unpin removes permanently and forgetAll keeps the profile', async () => {
  fresh();
  await brain.saveMemory({ profile: { persona: 'influencer', brandVoice: 'dry', niche: 'film' } });
  await brain.pin(pinItem(1, 10));
  await brain.pin(pinItem(2, 10));
  let m = await brain.getMemory();
  assert.equal(m.pinned.length, 2);

  const id = m.pinned[0].id;
  m = await brain.unpin(id);
  assert.equal(m.pinned.length, 1);
  assert.ok(!m.pinned.some((p) => p.id === id));
  assert.equal((await brain.getMemory()).pinned.length, 1, 'the delete is persisted');

  await mem.appendHistory([{ role: 'user', text: 'hi', inputMode: 'text', pageType: 'post', ts: Date.now() }]);
  m = await brain.forgetAll();
  assert.deepEqual(m.pinned, []);
  assert.deepEqual(m.history, []);
  assert.deepEqual(m.profile, { persona: 'influencer', brandVoice: 'dry', niche: 'film' });
});

/* --------------------------------------------------------------- history */

test('history is a rolling window capped at LIMITS.HISTORY_CAP', async () => {
  fresh();
  const entries = [];
  for (let i = 0; i < LIMITS.HISTORY_CAP + 12; i += 1) {
    entries.push({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i}`, inputMode: 'text', pageType: 'post', ts: Date.now() + i });
  }
  await mem.appendHistory(entries);
  const m = await brain.getMemory();
  assert.equal(m.history.length, LIMITS.HISTORY_CAP);
  assert.equal(m.history[m.history.length - 1].text, `turn ${LIMITS.HISTORY_CAP + 11}`);
  assert.equal(m.history[0].text, 'turn 12');
});

/* ------------------------------------------------- row 16: corrupt / quota */

test('row 16: a corrupt stored string resets pinned + history and the next askAssistant carries the notice', async () => {
  fresh();
  fake.corrupt = '{{{ not json at all';

  const m = await brain.getMemory();
  assert.deepEqual(m.pinned, []);
  assert.deepEqual(m.history, []);
  assert.equal(m.profile.persona, 'casual');

  fake.corrupt = null;                    // the repaired value is what is stored now
  assert.ok(fake.store[STORAGE_KEYS.MEMORY], 'the reset was persisted');

  fake.reply(() => okJson({ reply: 'All good now.', highlightTarget: null, memoryUpdate: null }));
  const r = await brain.askAssistant({
    messages: [{ role: 'user', text: 'hello' }],
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r.notice, mem.CORRUPT_NOTICE);
  assert.ok(/reset because the store was corrupt/.test(r.notice));

  // The notice is shown once only.
  const r2 = await brain.askAssistant({
    messages: [{ role: 'user', text: 'hello again' }],
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r2.notice, null);
});

test('row 16: an invalid stored shape keeps a readable profile', async () => {
  fresh();
  fake.store[STORAGE_KEYS.MEMORY] = {
    profile: { persona: 'influencer', brandVoice: 'punchy', niche: 'skate' },
    pinned: 'not-an-array',
    history: null,
  };
  const m = await brain.getMemory();
  assert.deepEqual(m.profile, { persona: 'influencer', brandVoice: 'punchy', niche: 'skate' });
  assert.deepEqual(m.pinned, []);
  assert.deepEqual(m.history, []);
  assert.equal(mem.takeNotice(), mem.CORRUPT_NOTICE);
});

test('row 16: a storage read error resets rather than throwing', async () => {
  fresh();
  fake.throwOnGet = true;
  const m = await brain.getMemory();
  assert.deepEqual(m, defaultMemory());
  assert.equal(mem.takeNotice(), mem.CORRUPT_NOTICE);
});

test('row 16: a quota error on write never throws and queues the notice', async () => {
  fresh();
  fake.throwOnSet = true;
  const m = await brain.pin({ kind: 'fact', content: 'Something worth keeping.', source: {} });
  assert.ok(m && Array.isArray(m.pinned), 'pin() still resolved with a memory object');
  assert.deepEqual(m.pinned, [], 'the store fell back to empty pinned');
  assert.equal(mem.takeNotice(), mem.CORRUPT_NOTICE);

  fake.throwOnSet = false;
  const after = await brain.getMemory();
  assert.ok(Array.isArray(after.pinned));
});

test('askAssistant still answers when every storage write fails', async () => {
  fresh();
  fake.throwOnSet = true;
  fake.reply(() => okJson({ reply: 'Answer despite a full store.', highlightTarget: null, memoryUpdate: null }));
  const r = await brain.askAssistant({
    messages: [{ role: 'user', text: 'hi' }],
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r.reply, 'Answer despite a full store.');
  assert.equal(r.notice, mem.CORRUPT_NOTICE);
});

/* ------------------------------------------------------------ score bumps */

test('pinned items used in a prompt gain a point and a fresh lastUsedAt', async () => {
  fresh();
  await brain.pin({ kind: 'fact', content: 'A useful fact.', source: { postId: 'CX' }, score: 4 });
  const before = (await brain.getMemory()).pinned[0];

  const memory = await brain.getMemory();
  await brain.buildAskRequest({
    messages: [{ role: 'user', text: 'hi' }],
    pageContext: publicPostContext(), memory, persona: 'casual', inputMode: 'text',
  });

  const after = (await brain.getMemory()).pinned[0];
  assert.equal(after.score, before.score + 1);
  assert.ok(after.lastUsedAt >= before.lastUsedAt);
});

test('the memory block always includes a post_style pin for the focused username', async () => {
  fresh();
  // 9 high-scoring unrelated pins would normally crowd out the matching one.
  const pinned = [];
  for (let i = 0; i < 9; i += 1) {
    pinned.push({
      id: `hi_${i}`, kind: 'fact', content: `Loud fact ${i}.`, source: { postId: `p${i}` },
      score: 90 + i, savedAt: Date.now(), lastUsedAt: Date.now(),
    });
  }
  pinned.push({
    id: 'quiet', kind: 'post_style', content: 'Ansel uses one accent colour in a wide frame.',
    source: { username: 'ansel', postId: 'COld' }, score: 1, savedAt: Date.now(), lastUsedAt: Date.now(),
  });
  await brain.saveMemory({ pinned });

  const memory = await brain.getMemory();
  const block = brain.buildMemoryBlock(memory, 'ansel');
  assert.ok(block.text.includes('Ansel uses one accent colour'), 'the matching post_style pin is forced in');
  assert.ok(block.usedIds.includes('quiet'));
  assert.ok(block.usedIds.length <= LIMITS.PROMPT_PINNED, 'no more than the prompt cap');
});
