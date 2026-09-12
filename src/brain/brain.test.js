// src/brain/brain.test.js — run with `node --test src/brain/`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installFakeChrome, okText, okJson, failWith, ALL_CONTEXTS,
  publicPostContext, privatePostContext, rememberTurnContext, storyNoTextContext,
  attachedImageContext, unknownPageContext, unknownPrivacyContext,
  TINY_JPEG_DATA_URL,
} from './fakes.js';

const fake = installFakeChrome();
const brain = await import('./index.js');
const parse = await import('./parse.js');
const { HIGHLIGHT_TARGETS, LIMITS } = await import('../../shared/types.js');

function fresh() {
  fake.reset();
  brain._resetSession();
}

const userTurn = (text) => [{ role: 'user', text, ts: Date.now() }];

function assertAskResult(r) {
  assert.ok(r && typeof r === 'object', 'AskResult is an object');
  assert.equal(typeof r.reply, 'string');
  assert.ok(r.reply.trim().length > 0, 'reply is a non-empty string');
  assert.ok(r.highlightTarget === null || HIGHLIGHT_TARGETS.includes(r.highlightTarget), 'highlightTarget in the allowed set');
  assert.ok(r.memoryUpdate === null || (typeof r.memoryUpdate === 'object' && !Array.isArray(r.memoryUpdate)), 'memoryUpdate is null or an object');
  assert.ok(r.notice === null || typeof r.notice === 'string');
}

/* ------------------------------------------------------------ 1. six pages */

test('askAssistant returns a valid AskResult for all six contexts and never throws', async () => {
  for (const [name, make] of ALL_CONTEXTS) {
    fresh();
    fake.reply(() => okJson({ reply: 'Here is what I can see on this page.', highlightTarget: null, memoryUpdate: null }));
    const r = await brain.askAssistant({
      messages: userTurn("what's this post about?"),
      pageContext: make(),
      memory: null,
      persona: 'casual',
      inputMode: 'text',
      attachedImage: name.includes('attached') ? TINY_JPEG_DATA_URL : null,
    });
    assertAskResult(r, name);
  }
});

test('askAssistant survives a garbage input object', async () => {
  fresh();
  const r = await brain.askAssistant(undefined);
  assertAskResult(r);
  const r2 = await brain.askAssistant({ messages: 'not-an-array', pageContext: 42, memory: 'nope' });
  assertAskResult(r2);
});

/* -------------------------------------------------------- 2. explicit pin */

test('"remember this post\'s style" pins with score 10 and the pin survives in getMemory()', async () => {
  fresh();
  const ctx = rememberTurnContext();
  fake.reply(() => okJson({
    reply: "Saved — warm sunrise light, one yellow accent, film grain, and a short caption with four hashtags.",
    highlightTarget: null,
    memoryUpdate: {
      pin: {
        kind: 'post_style',
        content: 'Warm sunrise light on cliffs, one yellow accent, Portra 400 film grain, two-line caption ending in four travel hashtags.',
        source: { username: 'ansel', postId: 'CrememberOne' },
      },
    },
  }));

  const r = await brain.askAssistant({
    messages: userTurn("remember this post's style"),
    pageContext: ctx, memory: null, persona: 'casual', inputMode: 'text',
  });
  assertAskResult(r);
  assert.ok(r.memoryUpdate && r.memoryUpdate.pin, 'memoryUpdate.pin returned to the overlay');

  const memory = await brain.getMemory();
  assert.equal(memory.pinned.length, 1);
  const p = memory.pinned[0];
  assert.equal(p.kind, 'post_style');
  assert.equal(p.score, LIMITS.EXPLICIT_PIN_SCORE);
  assert.equal(p.source.postId, 'CrememberOne');
  assert.equal(p.source.username, 'ansel');
  assert.ok(p.content.includes('sunrise'));
  assert.ok(typeof p.id === 'string' && p.id.length > 0);
  assert.ok(p.savedAt > 0 && p.lastUsedAt > 0);
});

/* ------------------------------------------------------- 3. auto-pin (hot) */

test('three user messages on one post auto-pin a post_style with score 5 and the clause', async () => {
  fresh();
  const ctx = publicPostContext();
  fake.reply(() => okJson({ reply: 'It is a film sunrise shot from the Cliffs of Moher.', highlightTarget: null, memoryUpdate: null }));

  const messages = [];
  let last = null;
  for (const q of ["what's this?", 'who took it?', 'what film is that?']) {
    messages.push({ role: 'user', text: q });
    last = await brain.askAssistant({ messages: [...messages], pageContext: ctx, memory: null, persona: 'casual', inputMode: 'text' });
    messages.push({ role: 'assistant', text: last.reply });
  }
  assertAskResult(last);
  assert.ok(last.reply.endsWith("(I'll remember this one)"), `reply ends with the clause: ${last.reply}`);

  const memory = await brain.getMemory();
  const auto = memory.pinned.find((p) => p.source && p.source.postId === 'CpublicOne');
  assert.ok(auto, 'the focused post was auto-pinned');
  assert.equal(auto.kind, 'post_style');
  assert.equal(auto.score, LIMITS.AUTO_PIN_SCORE);
  assert.ok(auto.content.includes('ansel'));
});

test('auto-pin fires once per post and never for a private owner', async () => {
  fresh();
  const ctx = publicPostContext();
  fake.reply(() => okJson({ reply: 'Still the same sunrise post.', highlightTarget: null, memoryUpdate: null }));
  const msgs = [];
  for (let i = 0; i < 5; i += 1) {
    msgs.push({ role: 'user', text: `question ${i}` });
    // eslint-disable-next-line no-await-in-loop
    const r = await brain.askAssistant({ messages: [...msgs], pageContext: ctx, memory: null, persona: 'casual', inputMode: 'text' });
    msgs.push({ role: 'assistant', text: r.reply });
  }
  const memory = await brain.getMemory();
  assert.equal(memory.pinned.filter((p) => p.source.postId === 'CpublicOne').length, 1);

  fresh();
  const priv = privatePostContext();
  fake.reply(() => okJson({ reply: 'That account is private, so I am not reading it.', highlightTarget: null, memoryUpdate: null }));
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await brain.askAssistant({ messages: userTurn(`q ${i}`), pageContext: priv, memory: null, persona: 'casual', inputMode: 'text' });
  }
  const m2 = await brain.getMemory();
  assert.equal(m2.pinned.length, 0, 'nothing from a private account is ever pinned');
});

test('a reference to an earlier post auto-pins on the first message', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'Yes, this is shot much like the earlier one.', highlightTarget: null, memoryUpdate: null }));
  const r = await brain.askAssistant({
    messages: userTurn('is this like the one earlier?'),
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.ok(r.reply.endsWith("(I'll remember this one)"));
  const memory = await brain.getMemory();
  assert.equal(memory.pinned.length, 1);
  assert.equal(memory.pinned[0].score, LIMITS.AUTO_PIN_SCORE);
});

/* -------------------------------------------------- 4. row 10 malformed JSON */

test('row 10: malformed model text becomes the whole reply with null fields', async () => {
  fresh();
  const raw = 'Sorry, I got confused and wrote prose instead of JSON.';
  fake.reply(() => okText(raw));
  const r = await brain.askAssistant({
    messages: userTurn('hello'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r.reply, raw);
  assert.equal(r.highlightTarget, null);
  assert.equal(r.memoryUpdate, null);
});

test('JSON wrapped in a fence or in prose is still parsed', async () => {
  fresh();
  fake.reply(() => okText('Here you go:\n```json\n{"reply":"Fenced reply.","highlightTarget":"like_button","memoryUpdate":null}\n```\nhope that helps'));
  const r = await brain.askAssistant({
    messages: userTurn('how do I like this?'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r.reply, 'Fenced reply.');
  assert.equal(r.highlightTarget, 'like_button');
});

test('an out-of-range highlightTarget is dropped to null', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'Tap the little rocket.', highlightTarget: 'rocket_button', memoryUpdate: 'nope' }));
  const r = await brain.askAssistant({
    messages: userTurn('where is the rocket?'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.equal(r.highlightTarget, null);
  assert.equal(r.memoryUpdate, null);
});

/* ------------------------------------------------------ 5. influencer prompt */

test('the influencer AskRequest carries the numbers and the persona instructions', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'With 12483 likes this is a strong post. 1. Re-cut it as a reel.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn('how could this do better?'),
    pageContext: publicPostContext(), memory: null, persona: 'influencer', inputMode: 'text',
  });

  const text = fake.lastRequestText();
  assert.ok(text.includes('12483'), 'likes reached the prompt');
  assert.ok(text.includes('312'), 'comment count reached the prompt');
  assert.ok(text.includes('hours old'), 'post age reached the prompt');
  assert.ok(text.includes('hashtagCount'), 'hashtag count reached the prompt');

  const system = fake.systemPromptOf();
  assert.ok(/cite at least one concrete number/i.test(system), 'told to cite numbers');
  assert.ok(/numbered recommendations/i.test(system), 'told to end with recommendations');
  assert.ok(/PERSONA — influencer/.test(system));

  assert.equal(fake.lastType, 'ASK');
  assert.equal(fake.lastRequest.responseFormat, 'json');
  assert.equal(fake.lastRequest.task, 'brain');
  assert.equal(fake.lastRequest.maxOutputTokens, LIMITS.TEXT_MAX_TOKENS);
});

test('the casual persona prompt differs and comments reach the prompt', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'A sunrise shot.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn("what's this about?"), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  const system = fake.systemPromptOf();
  assert.ok(/PERSONA — casual/.test(system));
  assert.ok(!/cite at least one concrete number/i.test(system));
  assert.ok(fake.lastRequestText().includes('portra never misses'), 'loaded comments are in the prompt');
  assert.ok(fake.lastRequestText().includes('CpublicOne.jpg'), 'row 11: the media URL is passed, never fetched');
});

/* ------------------------------------------------------------- 6. voice cap */

test('a voice reply is cut to at most 2 sentences and the token budget is the voice one', async () => {
  fresh();
  fake.reply(() => okJson({
    reply: 'This is sentence one. This is sentence two. This is sentence three! And a fourth one?',
    highlightTarget: null, memoryUpdate: null,
  }));
  const r = await brain.askAssistant({
    messages: userTurn("what's this post about?"),
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'voice',
  });
  assert.ok(parse.splitSentences(r.reply).length <= LIMITS.VOICE_MAX_SENTENCES, `too many sentences: ${r.reply}`);
  assert.equal(r.reply, 'This is sentence one. This is sentence two.');
  assert.equal(fake.lastRequest.maxOutputTokens, LIMITS.VOICE_MAX_TOKENS);
  assert.ok(/at most 2 SHORT sentences/.test(fake.systemPromptOf()));
});

test('a long text reply is cut to 120 words at a word boundary', async () => {
  fresh();
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  fake.reply(() => okJson({ reply: long, highlightTarget: null, memoryUpdate: null }));
  const r = await brain.askAssistant({
    messages: userTurn('explain everything'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  const words = r.reply.split(/\s+/);
  assert.ok(words.length <= LIMITS.TEXT_MAX_WORDS, `word count ${words.length}`);
  assert.ok(r.reply.endsWith('…'));
});

/* ----------------------------------------------------------- 7. privacy rows */

test('row 1: a private post sends no caption, alt text, comments or media, and the prompt says refuse', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'That account is private, so I am not reading it.', highlightTarget: null, memoryUpdate: null }));
  const r = await brain.askAssistant({
    messages: userTurn("what's this post about?"),
    pageContext: privatePostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assertAskResult(r);

  const text = fake.lastRequestText();
  assert.ok(!text.includes('SECRETWORD'), 'no private caption/alt/comment text left the browser');
  assert.ok(!text.includes('CprivateOne.jpg'), 'no private media URL was sent');
  assert.ok(text.includes('isPrivate: true'));
  assert.ok(text.includes('PRIVATE'));

  const system = fake.systemPromptOf();
  assert.ok(/refuse content questions/i.test(system), 'system prompt tells the model to refuse content questions');
  assert.ok(/never guess its caption/i.test(system));
});

test('row 2: privacy unknown sends the caption only, no comments and no media', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'I cannot confirm this account is public, so going by the caption only.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn('what is this?'), pageContext: unknownPrivacyContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  const text = fake.lastRequestText();
  assert.ok(text.includes('Three ways to plate pasta'), 'the caption is allowed');
  assert.ok(!text.includes('HIDDENCOMMENT'), 'comments are held back');
  assert.ok(!text.includes('HIDDENALT'), 'alt text is held back');
  assert.ok(!text.includes('CunknownOne.jpg'), 'media is held back');
  assert.ok(text.includes('PRIVACY UNCONFIRMED'));
});

test('row 5 + row 6: no comments and a textless story are flagged in the prompt', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'Based on the caption only, I cannot tell much.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn("what's on this story?"),
    pageContext: storyNoTextContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  const text = fake.lastRequestText();
  assert.ok(text.includes('comments: none loaded'), 'row 5 instruction present');
  assert.ok(text.includes('caption: null'), 'row 4/6: the missing caption is stated, not invented');
});

test('row 3: an unknown page tells the model to work from the user text only', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'I cannot tell what page this is, but ask me anything.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn('what can you do?'), pageContext: unknownPageContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  assert.ok(fake.lastRequestText().includes('No page could be identified'));
});

/* ------------------------------------------------------ 8. bus failure rows */

test('row 13: NO_KEY and BAD_KEY produce the API-key canned reply', async () => {
  for (const code of ['NO_KEY', 'BAD_KEY']) {
    fresh();
    fake.reply(() => failWith(code));
    // eslint-disable-next-line no-await-in-loop
    const r = await brain.askAssistant({
      messages: userTurn('hi'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
    });
    assert.equal(r.reply, brain.CANNED_NO_KEY);
    assert.equal(r.highlightTarget, null);
    assert.equal(r.memoryUpdate, null);
  }
});

test('row 9: HTTP_ERROR, TIMEOUT and NETWORK produce the what-still-works canned reply', async () => {
  for (const code of ['HTTP_ERROR', 'TIMEOUT', 'NETWORK', 'BAD_RESPONSE']) {
    fresh();
    fake.reply(() => failWith(code));
    // eslint-disable-next-line no-await-in-loop
    const r = await brain.askAssistant({
      messages: userTurn('hi'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
    });
    assert.equal(r.reply, brain.CANNED_UNAVAILABLE);
  }
});

test('a failed turn never pins anything', async () => {
  fresh();
  fake.reply(() => failWith('TIMEOUT'));
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await brain.askAssistant({
      messages: userTurn(`q${i}`), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
    });
  }
  const memory = await brain.getMemory();
  assert.equal(memory.pinned.length, 0);
});

/* ---------------------------------------------------------- 9/10. styleAdvice */

test('row 14: styleAdvice with no post and no photo asks for input and calls nothing', async () => {
  fresh();
  const r = await brain.styleAdvice({ pageContext: unknownPageContext(), attachedImage: null, memory: null });
  assert.equal(r.reply, 'Open a post or attach a photo of yours first.');
  assert.equal(r.needsInput, true);
  assert.equal(fake.calls.length, 0, 'no model call was made');
});

test('row 14: a private post with no attached photo still counts as nothing to describe', async () => {
  fresh();
  const r = await brain.styleAdvice({ pageContext: privatePostContext(), attachedImage: null, memory: null });
  assert.equal(r.needsInput, true);
  assert.equal(fake.calls.length, 0);
});

test('styleAdvice sends the attached photo as an image part on the last user message, text format', async () => {
  fresh();
  fake.reply(() => okText('Warm sunrise light, one yellow accent, wide frame. 1. Shoot within an hour of sunrise. 2. Add one saturated accent. 3. Open the caption with a time and place.'));
  const r = await brain.styleAdvice({
    pageContext: attachedImageContext(), attachedImage: TINY_JPEG_DATA_URL, memory: null,
  });

  assert.equal(fake.lastType, 'STYLE_ADVICE');
  assert.equal(fake.lastRequest.responseFormat, 'text');
  assert.equal(fake.lastRequest.task, 'brain');
  assert.equal(fake.lastRequest.maxOutputTokens, LIMITS.TEXT_MAX_TOKENS);

  const lastUser = fake.lastUserMessageOf();
  assert.ok(Array.isArray(lastUser.content));
  const imgs = lastUser.content.filter((p) => p.type === 'image');
  assert.ok(imgs.some((p) => p.url === TINY_JPEG_DATA_URL), 'the attached data URL is an image part');
  assert.equal(imgs[imgs.length - 1].url, TINY_JPEG_DATA_URL, 'the attached photo is the last image part');

  const system = fake.systemPromptOf();
  assert.ok(/NEVER GENERATE, EDIT OR OFFER AN IMAGE/i.test(system), 'image generation is forbidden in the prompt');
  assert.ok(/vision INPUT only/i.test(system));
  assert.ok(r.reply.includes('sunrise'));
  assert.equal(r.needsInput, undefined);
});

test('styleAdvice falls back to the canned replies when the bus fails', async () => {
  fresh();
  fake.reply(() => failWith('NO_KEY'));
  const a = await brain.styleAdvice({ pageContext: publicPostContext(), attachedImage: null, memory: null });
  assert.equal(a.reply, brain.CANNED_NO_KEY);

  fresh();
  fake.reply(() => failWith('HTTP_ERROR'));
  const b = await brain.styleAdvice({ pageContext: publicPostContext(), attachedImage: null, memory: null });
  assert.equal(b.reply, brain.CANNED_UNAVAILABLE);
});

/* --------------------------------------------------------- attached image ask */

test('askAssistant puts the attached image on the last user turn as vision input', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'Your photo is darker and tighter than theirs.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: [{ role: 'user', text: 'how does my photo compare?' }],
    pageContext: attachedImageContext(), memory: null, persona: 'casual', inputMode: 'text',
    attachedImage: TINY_JPEG_DATA_URL,
  });
  const lastUser = fake.lastUserMessageOf();
  assert.ok(Array.isArray(lastUser.content), 'the last user turn became a content array');
  assert.ok(lastUser.content.some((p) => p.type === 'text' && p.text.includes('how does my photo compare?')));
  assert.ok(lastUser.content.some((p) => p.type === 'image' && p.url === TINY_JPEG_DATA_URL));
});

/* ------------------------------------------------------------------- chips */

test('getChips is a static table that reacts to the page', () => {
  const casual = brain.getChips({ pageType: 'post', persona: 'casual' });
  assert.deepEqual(casual, ["What's this post about?", 'Summarise the comments', 'Why is this doing well?']);
  const infl = brain.getChips({ pageType: 'post', persona: 'influencer' });
  assert.ok(infl.includes('How could this do better?'));
  assert.deepEqual(brain.getChips({ pageType: 'nonsense', persona: 'casual' }), ['What can you do?', 'Paste the caption', 'Explain Instagram basics']);

  const withPost = brain.getChips({ pageType: 'post', persona: 'casual', pageContext: publicPostContext() });
  assert.ok(withPost.includes('Match this style'));
  assert.ok(!withPost.includes('Paste the caption'));

  const noCaption = publicPostContext();
  noCaption.posts[0].caption = null;
  assert.equal(brain.getChips({ pageType: 'post', persona: 'casual', pageContext: noCaption })[0], 'Paste the caption');
  assert.equal(brain.getChips({ pageType: 'post', persona: 'casual' }, noCaption)[0], 'Paste the caption');

  const priv = brain.getChips({ pageType: 'post', persona: 'casual', pageContext: privatePostContext() });
  assert.ok(!priv.includes('Match this style'), 'no style chip for a private owner');
  assert.deepEqual(brain.getChips(null), ['What can you do?', 'Paste the caption', 'Explain Instagram basics']);
});

/* ------------------------------------------------------------ prompt shape */

test('buildAskRequest puts memory, context and session turns in the right order', async () => {
  fresh();
  await brain.saveMemory({ profile: { persona: 'influencer', brandVoice: 'dry and technical', niche: 'film photography' } });
  await brain.pin({ kind: 'post_style', content: 'Ansel shoots wide sunrise frames with one accent colour.', source: { username: 'ansel', postId: 'COld' } });
  await brain.pin({ kind: 'preference', content: 'Prefers short captions with no emoji.', source: {} });

  const memory = await brain.getMemory();
  const req = await brain.buildAskRequest({
    messages: [
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'first answer' },
      { role: 'user', text: 'second question' },
    ],
    pageContext: publicPostContext(), memory, persona: 'influencer', inputMode: 'text',
  });

  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.messages[1].role, 'user');
  assert.ok(Array.isArray(req.messages[1].content));
  assert.ok(req.messages[1].content[0].text.startsWith('PAGE CONTEXT'));
  assert.ok(req.messages[1].content.some((p) => p.type === 'image'));
  assert.ok(req.messages[1].content.some((p) => p.type === 'text' && p.text.includes('MEMORY')));
  assert.equal(req.messages[2].content, 'first question');
  assert.equal(req.messages[3].role, 'assistant');
  assert.equal(req.messages[4].content, 'second question');

  const text = JSON.stringify(req);
  assert.ok(text.includes('dry and technical'), 'brand voice is in the prompt');
  assert.ok(text.includes('film photography'), 'niche is in the prompt');
  assert.ok(text.includes('Ansel shoots wide sunrise frames'), 'the matching post_style pin is included');

  // Pins that went into the prompt are scored up and persisted.
  const after = await brain.getMemory();
  assert.equal(after.pinned.find((p) => p.kind === 'post_style').score, LIMITS.EXPLICIT_PIN_SCORE + 1);
});

test('history is recorded for both turns and capped', async () => {
  fresh();
  fake.reply(() => okJson({ reply: 'A short answer.', highlightTarget: null, memoryUpdate: null }));
  await brain.askAssistant({
    messages: userTurn('a question'), pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'voice',
  });
  const memory = await brain.getMemory();
  assert.equal(memory.history.length, 2);
  assert.equal(memory.history[0].role, 'user');
  assert.equal(memory.history[0].text, 'a question');
  assert.equal(memory.history[0].inputMode, 'voice');
  assert.equal(memory.history[0].pageType, 'post');
  assert.equal(memory.history[0].postId, 'CpublicOne');
  assert.equal(memory.history[1].role, 'assistant');
  assert.equal(memory.history[1].text, 'A short answer.');
});

test('a profile update from the model is merged into memory', async () => {
  fresh();
  fake.reply(() => okJson({
    reply: 'Got it — film travel photography, dry tone.',
    highlightTarget: null,
    memoryUpdate: { profile: { niche: 'film travel photography', brandVoice: 'dry' } },
  }));
  await brain.askAssistant({
    messages: userTurn('I shoot film travel photography and I like a dry tone'),
    pageContext: publicPostContext(), memory: null, persona: 'casual', inputMode: 'text',
  });
  const memory = await brain.getMemory();
  assert.equal(memory.profile.niche, 'film travel photography');
  assert.equal(memory.profile.brandVoice, 'dry');
  assert.equal(memory.profile.persona, 'casual');
});
