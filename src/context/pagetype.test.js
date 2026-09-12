// src/context/pagetype.test.js — node --test src/context/
// Pure parts only (no DOM): URL -> pageType, URL helpers, parseCount, describeStatus,
// focusedPost, and the Node-import safety of getPageContext().
import test from 'node:test';
import assert from 'node:assert/strict';

import { pageTypeFromUrl, usernameFromUrl, shortcodeFromUrl, detectPageType } from './pagetype.js';
import { parseCount, stableHash, blankPost } from './readers.js';
import { getPageContext, describeStatus, focusedPost } from './index.js';
import { PILL } from '../../shared/types.js';

const IG = 'https://www.instagram.com';

test('pageTypeFromUrl: every surface we support', () => {
  const cases = [
    [`${IG}/`, 'feed'],
    [`${IG}`, 'feed'],
    [`${IG}/?variant=following`, 'feed'],
    [`${IG}/p/C9xY2kLpQ7a/`, 'post'],
    [`${IG}/p/C9xY2kLpQ7a/?img_index=2`, 'post'],
    [`${IG}/tv/C9xY2kLpQ7a/`, 'post'],
    [`${IG}/reel/DA7mQ2ZtVbn/`, 'reel'],
    [`${IG}/reels/DA7mQ2ZtVbn/`, 'reel'],
    [`${IG}/stories/nomad.bites/3421987654321/`, 'story'],
    [`${IG}/create/style/`, 'composer'],
    [`${IG}/create/select/`, 'composer'],
    [`${IG}/lena.explores/`, 'profile'],
    [`${IG}/lena.explores`, 'profile'],
    [`${IG}/lena.explores/tagged/`, 'profile'],
    [`${IG}/lena.explores/reels/`, 'profile'],
    [`${IG}/accounts/edit/`, 'unknown'],
    [`${IG}/explore/`, 'unknown'],
    [`${IG}/explore/tags/film/`, 'unknown'],
    [`${IG}/direct/inbox/`, 'unknown'],
    [`${IG}/lena.explores/followers/deeper/`, 'unknown'],
  ];
  for (const [url, expected] of cases) {
    assert.equal(pageTypeFromUrl(url), expected, `${url} -> ${expected}`);
  }
});

test('pageTypeFromUrl: garbage in, "unknown"/"feed" out, never throws', () => {
  assert.equal(pageTypeFromUrl(''), 'feed');
  assert.equal(pageTypeFromUrl(null), 'feed');
  assert.equal(pageTypeFromUrl(undefined), 'feed');
  assert.equal(pageTypeFromUrl('not a url at all'), 'unknown');
});

test('detectPageType tolerates a missing document', () => {
  assert.equal(detectPageType(null, `${IG}/p/ABC12345/`), 'post');
  assert.equal(detectPageType(undefined, `${IG}/accounts/edit/`), 'unknown');
});

test('usernameFromUrl and shortcodeFromUrl', () => {
  assert.equal(usernameFromUrl(`${IG}/lena.explores/`), 'lena.explores');
  assert.equal(usernameFromUrl('/lena.explores/'), 'lena.explores');
  assert.equal(usernameFromUrl('/lena.explores/tagged/'), 'lena.explores');
  assert.equal(usernameFromUrl(`${IG}/stories/nomad.bites/342198/`), 'nomad.bites');
  assert.equal(usernameFromUrl(`${IG}/p/C9xY2kLpQ7a/`), null);
  assert.equal(usernameFromUrl(`${IG}/explore/`), null);
  assert.equal(usernameFromUrl(`${IG}/`), null);

  assert.equal(shortcodeFromUrl(`${IG}/p/C9xY2kLpQ7a/`), 'C9xY2kLpQ7a');
  assert.equal(shortcodeFromUrl('/reel/DA7mQ2ZtVbn/comments/'), 'DA7mQ2ZtVbn');
  assert.equal(shortcodeFromUrl('/p/DB1QuietZ9k/liked_by/'), 'DB1QuietZ9k');
  assert.equal(shortcodeFromUrl(`${IG}/lena.explores/`), null);
});

test('parseCount handles the formats Instagram renders', () => {
  assert.equal(parseCount('12,483'), 12483);
  assert.equal(parseCount('12,483 likes'), 12483);
  assert.equal(parseCount('41.2K'), 41200);
  assert.equal(parseCount('1.2M'), 1200000);
  assert.equal(parseCount('View all 214 comments'), 214);
  assert.equal(parseCount('214'), 214);
  assert.equal(parseCount('no digits here'), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount(null), null);
});

test('stableHash is stable and string-safe', () => {
  assert.equal(stableHash('a|b'), stableHash('a|b'));
  assert.notEqual(stableHash('a|b'), stableHash('a|c'));
  assert.equal(typeof stableHash(undefined), 'string');
});

/* ------------------------------------------------------------ describeStatus */

function ctxWith(post, pageType = 'post') {
  return {
    pageType,
    posts: [post],
    focusedPostId: post ? post.id : null,
    draftCaption: null,
    url: `${IG}/p/${post ? post.id : 'x'}/`,
  };
}
function publicPost(over = {}) {
  return Object.assign(blankPost('C9xY2kLpQ7a'), {
    username: 'lena.explores',
    caption: 'Golden hour on the cliffs',
    altText: 'Photo by lena.explores',
    likes: 12483,
    commentCount: 214,
    comments: ['marco.b: this light is unreal'],
    isPrivate: false,
    mediaType: 'image',
    mediaUrl: 'https://cdn/x.jpg',
  }, over);
}

test('describeStatus row 3: unknown page', () => {
  assert.equal(describeStatus({ pageType: 'unknown', posts: [], focusedPostId: null, url: '' }), PILL.UNKNOWN_PAGE);
  assert.equal(describeStatus(null), PILL.UNKNOWN_PAGE);
  assert.equal(describeStatus({}), PILL.UNKNOWN_PAGE);
});

test('describeStatus row 1: private owner beats everything', () => {
  assert.equal(describeStatus(ctxWith(publicPost({ isPrivate: true, caption: null, comments: [] }))), PILL.PRIVATE);
  const profile = Object.assign(blankPost('profile:quiet.club'), { username: 'quiet.club', isPrivate: true });
  assert.equal(describeStatus(ctxWith(profile, 'profile')), PILL.PRIVATE);
});

test('describeStatus row 2: privacy unknown', () => {
  assert.equal(describeStatus(ctxWith(publicPost({ isPrivate: null }))), PILL.UNCONFIRMED);
});

test('describeStatus row 4: caption selector miss', () => {
  assert.equal(describeStatus(ctxWith(publicPost({ caption: null }))), PILL.NO_CAPTION);
  assert.equal(describeStatus({ pageType: 'post', posts: [], focusedPostId: null, url: '' }), PILL.NO_CAPTION);
});

test('describeStatus row 5: no comments loaded', () => {
  assert.equal(describeStatus(ctxWith(publicPost({ comments: [] }))), PILL.NO_COMMENTS);
});

test('describeStatus row 6: story with no readable text', () => {
  const story = Object.assign(blankPost('story:nomad.bites:0'), {
    username: 'nomad.bites', mediaType: 'image', mediaUrl: 'https://cdn/s.jpg',
  });
  assert.equal(describeStatus(ctxWith(story, 'story')), PILL.STORY_NO_TEXT);
  const storyWithText = Object.assign(blankPost('story:nomad.bites:0'), {
    username: 'nomad.bites', caption: 'ramen o clock', isPrivate: false,
  });
  assert.notEqual(describeStatus(ctxWith(storyWithText, 'story')), PILL.STORY_NO_TEXT);
});

test('describeStatus: happy path and neutral pages', () => {
  assert.equal(describeStatus(ctxWith(publicPost())), PILL.PUBLIC_POST);
  assert.equal(describeStatus({ pageType: 'composer', posts: [], focusedPostId: null, url: '' }), PILL.READY);
  assert.equal(describeStatus({ pageType: 'feed', posts: [], focusedPostId: null, url: '' }), PILL.READY);
  const publicProfile = Object.assign(blankPost('profile:lena.explores'), { username: 'lena.explores', isPrivate: false });
  assert.equal(describeStatus(ctxWith(publicProfile, 'profile')), PILL.READY);
});

test('focusedPost picks the focused post, or null', () => {
  const a = publicPost();
  const b = publicPost({ id: 'OTHER' });
  const ctx = { pageType: 'feed', posts: [a, b], focusedPostId: 'OTHER', draftCaption: null, url: IG };
  assert.equal(focusedPost(ctx), b);
  assert.equal(focusedPost({ pageType: 'feed', posts: [a], focusedPostId: null, url: IG }), null);
  assert.equal(focusedPost(null), null);
});

/* ---------------------------------------------------------- getPageContext */

test('getPageContext in Node (no document) returns the row-3 empty context', async () => {
  const ctx = await getPageContext();
  assert.equal(ctx.pageType, 'unknown');
  assert.deepEqual(ctx.posts, []);
  assert.equal(ctx.focusedPostId, null);
  assert.equal(ctx.draftCaption, null);
  assert.equal(typeof ctx.url, 'string');
  assert.equal(describeStatus(ctx), PILL.UNKNOWN_PAGE);
});

test('getPageContext never throws on a hostile override', async () => {
  const ctx = await getPageContext({ doc: { querySelector: () => { throw new Error('boom'); }, querySelectorAll: () => { throw new Error('boom'); } }, url: `${IG}/p/ABC12345/` });
  assert.equal(ctx.pageType, 'unknown');
  assert.equal(ctx.url, `${IG}/p/ABC12345/`);
});
