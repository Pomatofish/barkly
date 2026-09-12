// src/brain/fakes.js — test doubles for the Node tests. NOT part of the extension:
// nothing in src/ imports this file. (The name deliberately does not match node --test's
// test-file patterns, so this file is never executed as a test.)

/**
 * Install a fake `globalThis.chrome` with an in-memory storage.local and a
 * runtime.sendMessage that records the last AskRequest and answers with a canned response.
 */
export function installFakeChrome() {
  const state = {
    store: {},
    calls: [],
    lastType: null,
    lastRequest: null,
    responder: null,      // (msg) => BusResponse
    throwOnSet: false,    // row 16: quota error
    throwOnGet: false,    // row 16: storage read error
    corrupt: null,        // raw value to hand back for any key (e.g. a corrupt string)

    reset() {
      state.store = {};
      state.calls.length = 0;
      state.lastType = null;
      state.lastRequest = null;
      state.responder = null;
      state.throwOnSet = false;
      state.throwOnGet = false;
      state.corrupt = null;
      return state;
    },
    /** @param {(msg:object)=>object} fn */
    reply(fn) { state.responder = typeof fn === 'function' ? fn : () => fn; return state; },
    /** JSON.stringify of the last AskRequest, for substring assertions. */
    lastRequestText() { return JSON.stringify(state.lastRequest || null); },
    systemPromptOf(req) {
      const r = req || state.lastRequest;
      const m = r && r.messages && r.messages.find((x) => x.role === 'system');
      return (m && typeof m.content === 'string') ? m.content : '';
    },
    lastUserMessageOf(req) {
      const r = req || state.lastRequest;
      const list = (r && r.messages) || [];
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].role === 'user') return list[i];
      return null;
    },
  };

  globalThis.chrome = {
    runtime: {
      lastError: null,
      async sendMessage(msg) {
        state.calls.push(msg);
        state.lastType = msg && msg.type;
        state.lastRequest = msg && msg.data;
        if (state.responder) return state.responder(msg);
        return okText('{"reply":"Default fake reply.","highlightTarget":null,"memoryUpdate":null}');
      },
    },
    storage: {
      local: {
        async get(key) {
          if (state.throwOnGet) throw new Error('storage read failed');
          const k = Array.isArray(key) ? key[0] : key;
          if (state.corrupt !== null) return { [k]: state.corrupt };
          return { [k]: state.store[k] };
        },
        async set(obj) {
          if (state.throwOnSet) throw new Error('QUOTA_BYTES quota exceeded');
          Object.assign(state.store, obj);
        },
        async remove(key) { delete state.store[Array.isArray(key) ? key[0] : key]; },
        async clear() { state.store = {}; },
      },
    },
  };
  return state;
}

/* ------------------------------------------------------- canned bus replies */

export function okText(text) { return { ok: true, data: { text, model: 'fake-model' } }; }
export function okJson(obj) { return okText(JSON.stringify(obj)); }
export function failWith(code, message) { return { ok: false, error: { code, message: message || code } }; }

/* ------------------------------------------------------- hand-written pages */

const PUBLIC_CAPTION =
  'Sunrise at the Cliffs of Moher, shot on Portra 400. Worth the 4am alarm. '
  + '#film #ireland #sunrise #portra400';

/** 1. Public post: 5 loaded comments, 12483 likes. */
export function publicPostContext() {
  return {
    pageType: 'post',
    url: 'https://www.instagram.com/p/CpublicOne/',
    focusedPostId: 'CpublicOne',
    draftCaption: null,
    posts: [{
      id: 'CpublicOne',
      username: 'ansel',
      caption: PUBLIC_CAPTION,
      altText: 'Photo of cliffs at sunrise with a person in a yellow raincoat',
      likes: 12483,
      commentCount: 312,
      postedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      comments: [
        'mira: the light here is unreal',
        'joe_p: portra never misses',
        'fieldnotes: saved for my trip next month',
        'kk: that yellow coat though',
        'travelgram: where exactly is this?',
      ],
      isPrivate: false,
      mediaType: 'image',
      mediaUrl: 'https://scontent.example.com/p/CpublicOne.jpg',
    }],
  };
}

/** 2. Story with no readable text (row 6). */
export function storyNoTextContext() {
  return {
    pageType: 'story',
    url: 'https://www.instagram.com/stories/ansel/3211/',
    focusedPostId: 'story:ansel:1',
    draftCaption: null,
    posts: [{
      id: 'story:ansel:1',
      username: 'ansel',
      caption: null,
      altText: null,
      likes: null,
      commentCount: null,
      postedAt: null,
      comments: [],
      isPrivate: false,
      mediaType: 'video',
      mediaUrl: 'https://scontent.example.com/s/ansel1.jpg',
    }],
  };
}

/** 3. Private owner (row 1). Caption and comments carry the marker SECRETWORD. */
export function privatePostContext() {
  return {
    pageType: 'post',
    url: 'https://www.instagram.com/p/CprivateOne/',
    focusedPostId: 'CprivateOne',
    draftCaption: null,
    posts: [{
      id: 'CprivateOne',
      username: 'lockedaccount',
      caption: 'SECRETWORD this caption must never reach the model',
      altText: 'SECRETWORD alt text',
      likes: 12,
      commentCount: 3,
      postedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      comments: ['friend: SECRETWORD comment body'],
      isPrivate: true,
      mediaType: 'image',
      mediaUrl: 'https://scontent.example.com/p/CprivateOne.jpg',
    }],
  };
}

/** 4. Privacy unknown (row 2): caption only, comments and media held back. */
export function unknownPrivacyContext() {
  return {
    pageType: 'reel',
    url: 'https://www.instagram.com/reel/CunknownOne/',
    focusedPostId: 'CunknownOne',
    draftCaption: null,
    posts: [{
      id: 'CunknownOne',
      username: 'maybepublic',
      caption: 'Three ways to plate pasta #food #pasta',
      altText: 'HIDDENALT plating pasta',
      likes: 900,
      commentCount: 40,
      postedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      comments: ['HIDDENCOMMENT someone: yum'],
      isPrivate: null,
      mediaType: 'video',
      mediaUrl: 'https://scontent.example.com/r/CunknownOne.jpg',
    }],
  };
}

/** 5. Public post used with an attached photo of the user's own. */
export function attachedImageContext() {
  const ctx = publicPostContext();
  ctx.posts[0].id = 'CattachOne';
  ctx.focusedPostId = 'CattachOne';
  ctx.url = 'https://www.instagram.com/p/CattachOne/';
  return ctx;
}

/** 6. The "remember this post's style" turn on a public post. */
export function rememberTurnContext() {
  const ctx = publicPostContext();
  ctx.posts[0].id = 'CrememberOne';
  ctx.focusedPostId = 'CrememberOne';
  ctx.url = 'https://www.instagram.com/p/CrememberOne/';
  return ctx;
}

/** Row 3: nothing identifiable. */
export function unknownPageContext() {
  return { pageType: 'unknown', posts: [], focusedPostId: null, draftCaption: null, url: 'https://www.instagram.com/direct/inbox/' };
}

export const ALL_CONTEXTS = [
  ['public post', publicPostContext],
  ['story without text', storyNoTextContext],
  ['private post', privatePostContext],
  ['privacy unknown', unknownPrivacyContext],
  ['public post + attached image', attachedImageContext],
  ['remember-this-style turn', rememberTurnContext],
];

/** A 1x1 JPEG data URL — stands in for the user's downscaled photo. */
export const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
