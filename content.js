// Reels Blocker for LinkedIn — content script.
//
// LinkedIn renames its CSS classes often, so this script avoids depending on
// them. It finds reels by what they look like and how they behave:
//   * the in-feed carousel by its heading ("Videos for you", ...),
//   * the full-screen vertical player as a dialog or full-viewport overlay
//     holding a <video> with next/previous-video controls,
//   * the Video tab by where its link points.
// Known LinkedIn selectors are used only as a first guess when locating the
// feed post that wraps something.

(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    hideCarousels: true,
    blockPlayer: true,
    hideNavTab: true,
    hideAllVideoPosts: false,
  });

  // Which setting controls each kind of hidden element.
  const REASON_SETTING = {
    carousel: 'hideCarousels',
    player: 'blockPlayer',
    nav: 'hideNavTab',
    'video-post': 'hideAllVideoPosts',
  };

  const HIDDEN = 'data-lrb-hidden';

  // Heading of the in-feed reels carousel, in a handful of languages.
  const CAROUSEL_HEADING = new RegExp(
    '^(?:' +
      [
        'videos? for you',
        'recommended videos?(?: for you)?',
        'videos? you (?:may|might) (?:like|enjoy)',
        'more videos(?: for you)?',
        '(?:trending|popular|short) videos',
        'vid[ée]os? pour vous',
        'videos? f[üu]r (?:dich|sie)',
        'v[íi]deos? para (?:ti|voc[êe]|usted)',
        'video per te',
        "video'?s voor jou",
      ].join('|') +
      ')$',
    'i'
  );

  // Labels of the up/down controls in the vertical player.
  const PLAYER_NAV = new RegExp(
    [
      '\\b(?:next|previous|prev)\\b.{0,20}\\bvideo',
      '\\bvideo\\b.{0,20}\\b(?:next|previous)\\b',
      '^(?:next|previous|prev)$',
      'vid[ée]o (?:suivante|pr[ée]c[ée]dente)',
      '(?:n[äa]chstes|vorheriges) video',
      'v[íi]deo (?:siguiente|anterior)',
      'pr[óo]ximo v[íi]deo',
    ].join('|'),
    'i'
  );

  const CLOSE_LABEL = /\b(?:close|dismiss|exit)\b|fermer|schlie(?:ß|ss)en|cerrar|chiudi|fechar|sluiten/i;
  const CLOSE_LABEL_STRONG = /^(?:close|dismiss)\b/i;

  // Paths of a standalone video feed. LinkedIn Live (/video/live/...) and
  // video events (/video/event/...) are left alone.
  const VIDEO_PATH = /^\/(?:feed\/)?videos?(?:\/|$)/i;
  const ALLOWED_VIDEO_PATH = /^\/video\/(?:live|event)\//i;

  // First guesses for "the feed post that contains this element".
  const FEED_ITEM = [
    '[data-id^="urn:li:activity"]',
    '[data-id^="urn:li:aggregate"]',
    '[data-urn^="urn:li:activity"]',
    '[data-urn^="urn:li:aggregate"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    '[data-view-name="feed-full-update"]',
    '[role="article"]',
    'article',
  ].join(',');

  const VIDEO_MEDIA = [
    'video',
    '.update-components-linkedin-video',
    '.feed-shared-linkedin-video',
    '[class*="linkedin-video"]',
    '[data-view-name*="video" i]',
  ].join(',');

  const DIALOG = '[role="dialog"], [aria-modal="true"], dialog';
  const MESSAGING = '#msg-overlay, [class*="msg-overlay"], [class*="msg-convo"], [class*="msg-s-"]';

  // Text inside these is the user's or other people's writing, never a carousel heading.
  const NOT_A_HEADING = [
    '[contenteditable]',
    'textarea',
    'input',
    '[role="textbox"]',
    DIALOG,
    MESSAGING,
    '.update-components-text',
    '.feed-shared-text',
    '.feed-shared-inline-show-more-text',
    '[class*="comments-"]',
  ].join(',');

  // Signs that a large dialog with a video is the post composer, not the player.
  const COMPOSER = 'input[type="file"], [class*="share-box"], [class*="share-creation"], [class*="share-media"], [class*="video-editor"]';

  let settings = { ...DEFAULTS };

  // ---------------------------------------------------------------- storage

  function api() {
    try {
      return globalThis.chrome && chrome.runtime && chrome.runtime.id ? chrome.storage : null;
    } catch {
      return null; // extension was reloaded; this copy of the script is orphaned
    }
  }

  function loadSettings() {
    return new Promise((resolve) => {
      const storage = api();
      if (!storage || !storage.sync) return resolve({ ...DEFAULTS });
      try {
        storage.sync.get(DEFAULTS, (v) => resolve({ ...DEFAULTS, ...(v || {}) }));
      } catch {
        resolve({ ...DEFAULTS });
      }
    });
  }

  let pendingCount = 0;
  let countTimer = 0;

  function bumpCount() {
    pendingCount++;
    if (countTimer) return;
    countTimer = setTimeout(() => {
      const n = pendingCount;
      pendingCount = 0;
      countTimer = 0;
      const storage = api();
      if (!storage || !storage.local) return;
      try {
        storage.local.get({ blockedCount: 0 }, (v) => {
          storage.local.set({ blockedCount: ((v && v.blockedCount) || 0) + n });
        });
      } catch {
        /* orphaned script */
      }
    }, 1000);
  }

  // ---------------------------------------------------------------- helpers

  function hide(el, reason, { count = true } = {}) {
    if (!el || el.hasAttribute(HIDDEN)) return false;
    el.setAttribute(HIDDEN, reason);
    el.querySelectorAll('video').forEach(pauseVideo);
    if (count && reason !== 'nav') bumpCount();
    return true;
  }

  function pauseVideo(video) {
    try {
      if (!video.paused) video.pause();
    } catch {
      /* ignore */
    }
  }

  function isRoot(el) {
    return (
      el === document.body ||
      el === document.documentElement ||
      el.matches('main, [role="main"]')
    );
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function coversViewport(el, ratio) {
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth * ratio && r.height >= innerHeight * ratio;
  }

  function labelOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Never hide the page itself, the nav, or something that's clearly a whole list of posts.
  function isSafeToHide(el) {
    if (isRoot(el)) return false;
    if (el.querySelector('main, [role="main"], #global-nav')) return false;
    const h = el.getBoundingClientRect().height;
    return h < Math.max(3000, innerHeight * 3);
  }

  // Walks up from `start` to the feed post (or feed module) that contains it.
  function feedItemFor(start) {
    let item = start.closest(FEED_ITEM) || climbToListItem(start);
    if (!item) return null;
    // Take in wrappers that exist only to hold this item, so no empty gap is left.
    for (let i = 0; i < 3; i++) {
      const p = item.parentElement;
      if (!p || isRoot(p) || p.children.length !== 1) break;
      item = p;
    }
    return isSafeToHide(item) ? item : null;
  }

  // Fallback when no known selector matches: the nearest ancestor that holds
  // media and sits in a list of siblings (the feed list).
  function climbToListItem(start) {
    let el = start.parentElement;
    for (let depth = 0; el && depth < 14; depth++, el = el.parentElement) {
      const p = el.parentElement;
      if (!p || isRoot(el) || isRoot(p)) return null;
      if (p.children.length >= 3 && el.querySelectorAll('video, img').length >= 2) return el;
    }
    return null;
  }

  function contentRoots() {
    const roots = [...document.querySelectorAll('main, [role="main"]')];
    document.querySelectorAll('aside').forEach((a) => {
      if (!a.matches(MESSAGING) && !a.closest(MESSAGING)) roots.push(a);
    });
    const unique = roots.filter((r, i) => roots.indexOf(r) === i);
    const top = unique.filter((r) => !unique.some((o) => o !== r && o.contains(r)));
    if (!top.length && document.body) top.push(document.body);
    return top;
  }

  // ---------------------------------------------------------------- toast

  let toastTimer = 0;

  function toast(message) {
    if (!document.body) return;
    let t = document.getElementById('lrb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'lrb-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = message;
    // Force a reflow so the transition runs even on the first show.
    void t.offsetWidth;
    t.classList.add('lrb-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('lrb-show'), 2200);
  }

  // ---------------------------------------------------------------- 1. carousels

  function scanCarousels(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute(HIDDEN)) return NodeFilter.FILTER_REJECT;
          const tag = node.localName;
          if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'video') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        const len = node.nodeValue.length;
        return len >= 9 && len <= 80 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    const headings = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (CAROUSEL_HEADING.test(text) && n.parentElement) headings.push(n.parentElement);
    }

    for (const heading of headings) {
      if (heading.closest(NOT_A_HEADING) || heading.closest(`[${HIDDEN}]`)) continue;
      hide(feedItemFor(heading), 'carousel');
    }
  }

  // ---------------------------------------------------------------- 2. vertical player

  const lastClosed = new WeakMap();

  function fixedAncestor(start) {
    for (let el = start, i = 0; el && el !== document.body && i < 30; el = el.parentElement, i++) {
      if (getComputedStyle(el).position === 'fixed' && coversViewport(el, 0.7)) return el;
    }
    return null;
  }

  function hasPlayerNav(box) {
    for (const b of box.querySelectorAll('button, [role="button"]')) {
      if (PLAYER_NAV.test(labelOf(b))) return true;
    }
    return false;
  }

  // Returns the player element if this video is playing inside the reels player.
  function playerFor(video) {
    const box = video.closest(DIALOG) || fixedAncestor(video);
    if (!box || !isVisible(box)) return null;
    const strongSignal = hasPlayerNav(box) || box.querySelectorAll('video').length >= 2;
    const fullScreen = coversViewport(box, 0.85) && !box.querySelector(COMPOSER);
    return strongSignal || fullScreen ? box : null;
  }

  function closeButtonFor(box) {
    const scope = fixedAncestor(box) || box;
    const candidates = [...scope.querySelectorAll('button, [role="button"]')].filter((b) => {
      const label = labelOf(b);
      return label.length < 60 && CLOSE_LABEL.test(label) && !PLAYER_NAV.test(label);
    });
    return candidates.find((b) => CLOSE_LABEL_STRONG.test(labelOf(b))) || candidates[0] || null;
  }

  function pressEscape(target) {
    const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    document.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (el && el.style.overflow === 'hidden') el.style.overflow = '';
    }
  }

  function closePlayer(box) {
    const now = Date.now();
    if (now - (lastClosed.get(box) || 0) < 1500) return;
    lastClosed.set(box, now);

    box.querySelectorAll('video').forEach(pauseVideo);
    const button = closeButtonFor(box);
    if (button) button.click();
    else pressEscape(box);

    bumpCount();
    toast('LinkedIn reel blocked');

    // If LinkedIn didn't close it, hide it ourselves.
    setTimeout(() => {
      if (!box.isConnected || !isVisible(box)) return;
      hide(fixedAncestor(box) || box, 'player', { count: false });
      unlockScroll();
    }, 500);
  }

  function scanPlayers() {
    for (const video of document.querySelectorAll('video')) {
      if (video.closest(`[${HIDDEN}]`)) {
        pauseVideo(video); // keep hidden videos from playing in the background
        continue;
      }
      if (document.fullscreenElement && document.fullscreenElement.contains(video)) continue;
      const box = playerFor(video);
      if (box) closePlayer(box);
    }
  }

  // ---------------------------------------------------------------- 3. video feed URLs

  let lastHref = '';

  function isVideoFeedPath(path) {
    return VIDEO_PATH.test(path) && !ALLOWED_VIDEO_PATH.test(path);
  }

  function checkUrl() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!settings.enabled || !settings.blockPlayer) return;
    if (isVideoFeedPath(location.pathname)) {
      bumpCount();
      location.replace(location.origin + '/feed/');
    }
  }

  // ---------------------------------------------------------------- 4. nav tab

  function scanNav() {
    document.querySelectorAll('#global-nav a[href], header a[href], nav a[href]').forEach((a) => {
      if (a.closest(`main, [role="main"], [${HIDDEN}]`)) return;
      let path;
      try {
        path = new URL(a.href, location.href).pathname;
      } catch {
        return;
      }
      const inTopNav = !!a.closest('#global-nav, [aria-label*="primary" i]');
      const label = labelOf(a).replace(/\d+/g, '').trim();
      if (isVideoFeedPath(path) || (inTopNav && /^(?:videos?|vid[ée]os?|v[íi]deos?)$/i.test(label))) {
        hide(a.closest('li') || a, 'nav');
      }
    });
  }

  // ---------------------------------------------------------------- 5. all video posts (optional)

  function scanVideoPosts(root) {
    root.querySelectorAll(VIDEO_MEDIA).forEach((media) => {
      if (media.closest(`[${HIDDEN}], ${DIALOG}, ${MESSAGING}`)) return;
      hide(feedItemFor(media), 'video-post');
    });
  }

  // ---------------------------------------------------------------- main loop

  function run() {
    checkUrl();
    if (!settings.enabled) return;
    if (settings.blockPlayer) scanPlayers();
    const roots = contentRoots();
    if (settings.hideCarousels) roots.forEach(scanCarousels);
    if (settings.hideAllVideoPosts) roots.forEach(scanVideoPosts);
    if (settings.hideNavTab) scanNav();
  }

  let runTimer = 0;

  function schedule(delay = 120) {
    if (runTimer) return;
    runTimer = setTimeout(() => {
      runTimer = 0;
      try {
        run();
      } catch (err) {
        console.debug('[Reels Blocker]', err);
      }
    }, delay);
  }

  function applySettings() {
    document.documentElement.toggleAttribute('data-lrb-nav', settings.enabled && settings.hideNavTab);
    document.querySelectorAll(`[${HIDDEN}]`).forEach((el) => {
      const key = REASON_SETTING[el.getAttribute(HIDDEN)];
      if (!settings.enabled || !settings[key]) el.removeAttribute(HIDDEN);
    });
    lastHref = '';
    schedule(0);
  }

  function watch() {
    new MutationObserver(() => schedule()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Catch the player the moment a video starts, even if LinkedIn reused the DOM.
    document.addEventListener('play', () => schedule(0), true);

    // LinkedIn is a single-page app: watch for in-app navigation.
    addEventListener('popstate', () => schedule(0));
    if (globalThis.navigation && typeof navigation.addEventListener === 'function') {
      navigation.addEventListener('navigatesuccess', () => schedule(0));
    }
    setInterval(checkUrl, 1000);

    const storage = api();
    if (storage && storage.onChanged) {
      storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        let changed = false;
        for (const [key, { newValue }] of Object.entries(changes)) {
          if (key in DEFAULTS) {
            settings[key] = newValue === undefined ? DEFAULTS[key] : newValue;
            changed = true;
          }
        }
        if (changed) applySettings();
      });
    }
  }

  loadSettings().then((loaded) => {
    settings = loaded;
    applySettings();
    watch();
  });
})();
