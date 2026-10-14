// koutsi-usage.js — anonymous usage events for Ylläpito → Käyttö, shared by both Koutsi apps.
//
// The old Koutsi bundles this file last (build.mjs) and it starts itself below; the renewed
// Koutsi imports it from its production entries (koutsi/web/src/app/usage.js). The demos
// never load it. It draws nothing, stores nothing on the device, and every entry point is
// wrapped in try/catch: if anything here fails, the app carries on exactly as without it.
//
// What a batch to koutsi_track_usage (supabase/migrations/…_koutsi_usage_events.sql) holds:
//   view   the address with ids taken out (/valmentaja/ryhma/:id), no query string
//   click  what kind of control was tapped and where on the screen; its text only if every
//          word of it is the app's own wording (KOUTSI_USAGE_WORDS, collected at build time
//          from the app's string literals by scripts/usage-words.mjs). A player's or a
//          group's name is never that, so such a tap is sent without text ("kortti").
//   error  crashes, unhandled promise failures and the error toasts people actually saw
//   hide   the tab was hidden or closed (ends the time spent on the last page)
// plus a random session id that lives in memory and changes after 30 idle minutes. No user
// id, name or e-mail: the server only checks that the caller is signed in.
(function () {
  try {
    if (window.koutsiUsage) return;

    var IDLE_MS = 30 * 60 * 1000;
    var FLUSH_MS = 15000;
    var MAX_BATCH = 100;
    var MAX_QUEUE = 500;
    var MAX_EVENTS = 3000;     // per page load: a runaway loop can't flood the table
    var MAX_ERRORS = 30;

    var cfg = null;
    var words = null;
    var queue = [];
    var token = null;
    var sessionId = null;
    var lastAt = 0;
    var lastPath = null;
    var lastRaw = null;
    var sent = 0;
    var errorsSent = 0;
    var errorCounts = {};
    var disabled = false;
    var timer = null;

    var uuid = function () {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };

    var device = function () {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!coarse) return 'kone';
      return Math.min(window.screen.width || 0, window.screen.height || 0) < 600 ? 'puhelin' : 'tabletti';
    };

    // /valmentaja/ryhma/3f2a…  →  /valmentaja/ryhma/:id. Anything that isn't a plain lowercase
    // word could be data, so it goes too.
    var normalizePath = function (pathname) {
      var parts = String(pathname || '/').replace(/^\/demo(?=\/|$)/, '').split('/').map(function (seg) {
        if (!seg) return seg;
        if (/^[a-zåäö]+(?:-[a-zåäö]+)*$/.test(seg)) return seg;
        return ':id';
      });
      var path = parts.join('/').replace(/\/+$/, '') || '/';
      return path.slice(0, 80);
    };

    // Only the app's own wording passes. Digits become # so "Vko 42" and "Vko 43" count together.
    var cleanLabel = function (raw) {
      var text = String(raw || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 60 || /@/.test(text)) return null;
      text = text.replace(/\d+/g, '#');
      var tokens = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || [];
      if (tokens.length > 7) return null;
      if (!words) return tokens.length ? null : text;
      for (var i = 0; i < tokens.length; i += 1) {
        if (tokens[i].length < 2 || !words.has(tokens[i].toLowerCase())) return null;
      }
      return text;
    };

    // An error toast is a sentence the app wrote, but it may have a name or a raw server
    // message mixed in: every word outside the app's wording becomes "…".
    var redactWords = function (text) {
      if (!words) return '';
      return String(text || '').replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g, function (w) {
        return w.length > 1 && words.has(w.toLowerCase()) ? w : '…';
      }).replace(/…(?:[\s,.'’-]*…)+/g, '…');
    };

    var scrub = function (message) {
      return String(message || '')
        .replace(/\([^()]*\)=\([^()]*\)/g, '(…)=(…)')
        .replace(/[^\s@()]+@[^\s@()]+\.[^\s@()]+/g, '[sähköposti]')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1')
        .replace(/"[^"]*"/g, '"…"')
        .replace(/\d{4,}/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    };

    var startSession = function () {
      sessionId = uuid();
      errorCounts = {};
    };

    var enqueue = function (event) {
      if (disabled || !cfg || sent >= MAX_EVENTS) return;
      var now = Date.now();
      if (!sessionId || now - lastAt > IDLE_MS) {
        var resumed = Boolean(sessionId);
        startSession();
        // a session that starts mid-page still needs its first page view
        if (resumed && event.k !== 'view') queue.push({ k: 'view', p: lastPath || normalizePath(window.location.pathname), ts: now });
      }
      lastAt = now;
      event.ts = now;
      queue.push(event);
      sent += 1;
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      if (queue.length >= 50) flush(false);
    };

    var flush = function (leaving) {
      try {
        if (disabled || !cfg || !queue.length || !token) return;
        var batch = queue.splice(0, MAX_BATCH);
        var now = Date.now();
        var body = JSON.stringify({
          batch: {
            s: sessionId, a: cfg.app, r: cfg.role, d: device(),
            e: batch.map(function (ev) {
              var out = { k: ev.k, p: ev.p, t: Math.max(0, now - ev.ts) };
              if (ev.l) out.l = ev.l;
              if (ev.g) out.g = ev.g;
              if (ev.x != null) { out.x = ev.x; out.y = ev.y; }
              if (ev.m) out.m = ev.m;
              return out;
            }),
          },
        });
        var putBack = function () {
          if (queue.length + batch.length <= MAX_QUEUE) queue = batch.concat(queue);
        };
        window.fetch(cfg.url + '/rest/v1/rpc/koutsi_track_usage', {
          method: 'POST',
          headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: body,
          keepalive: leaving && body.length < 60000,
        }).then(function (res) {
          if (res.status === 404) disabled = true;        // migration not applied: stop trying
          else if (res.status === 401) putBack();         // token expired: retry after refresh
        }, function () {
          if (!leaving) putBack();                        // offline in the hall: try again later
        });
      } catch (e) { /* analytics only */ }
    };

    var view = function (pathname) {
      try {
        var raw = pathname == null ? window.location.pathname : pathname;
        if (raw === lastRaw && Date.now() - lastAt < IDLE_MS) return; // replaceState of the same page
        lastRaw = raw;
        lastPath = normalizePath(raw);
        enqueue({ k: 'view', p: lastPath });
      } catch (e) { /* analytics only */ }
    };

    var report = function (label, message) {
      try {
        if (errorsSent >= MAX_ERRORS) return;
        var detail = scrub(message);
        var key = label + '|' + detail;
        errorCounts[key] = (errorCounts[key] || 0) + 1;
        if (errorCounts[key] > 3) return;
        errorsSent += 1;
        enqueue({ k: 'error', p: lastPath || normalizePath(window.location.pathname), l: label, m: detail || null });
      } catch (e) { /* analytics only */ }
    };

    var CONTROL = 'a[href],button,summary,select,textarea,input,label,[role="button"],[role="tab"],[role="menuitem"],'
      + '[role="option"],[role="switch"],[role="checkbox"],[role="radio"],[role="link"]';

    var targetKind = function (el) {
      var role = el.getAttribute('role');
      var tag = el.tagName;
      if (role === 'tab') return 'välilehti';
      if (role === 'option' || role === 'menuitem' || role === 'switch' || role === 'checkbox' || role === 'radio' || tag === 'SELECT') return 'valinta';
      if (tag === 'INPUT') {
        var type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') return 'valinta';
        if (type === 'button' || type === 'submit') return 'nappi';
        return 'kenttä';
      }
      if (tag === 'TEXTAREA') return 'kenttä';
      if (tag === 'A' || role === 'link') return 'linkki';
      if (tag === 'LABEL') return 'valinta';
      return 'nappi';
    };

    var labelOf = function (el, kind) {
      var aria = el.getAttribute('aria-label');
      if (aria) return aria;
      if (kind === 'kenttä' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && kind === 'valinta')) {
        var lbl = el.labels && el.labels[0];
        return lbl ? lbl.innerText : '';
      }
      if (el.tagName === 'INPUT') return el.value;
      return el.title || el.innerText || '';
    };

    var onClick = function (ev) {
      try {
        var start = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
        if (!start || !start.closest) return;
        var el = start.closest(CONTROL);
        var kind;
        if (el) {
          kind = targetKind(el);
        } else {
          // React cards are often a <div onClick>: the pointer cursor gives them away
          for (var node = start, i = 0; node && node !== document.body && i < 6; node = node.parentElement, i += 1) {
            if (window.getComputedStyle(node).cursor === 'pointer') { el = node; break; }
          }
          if (!el) return;
          kind = 'kortti';
        }
        var w = window.innerWidth || 1;
        var h = window.innerHeight || 1;
        enqueue({
          k: 'click',
          p: lastPath || normalizePath(window.location.pathname),
          l: cleanLabel(labelOf(el, kind)),
          g: kind,
          x: Math.max(0, Math.min(1000, Math.round((ev.clientX / w) * 1000))),
          y: Math.max(0, Math.min(1000, Math.round((ev.clientY / h) * 1000))),
        });
      } catch (e) { /* analytics only */ }
    };

    var watchHistory = function () {
      ['pushState', 'replaceState'].forEach(function (name) {
        var original = window.history[name];
        if (typeof original !== 'function') return;
        window.history[name] = function () {
          var result = original.apply(this, arguments);
          try { view(); } catch (e) { /* analytics only */ }
          return result;
        };
      });
      window.addEventListener('popstate', function () { view(); });
    };

    var onVisibility = function () {
      try {
        if (document.visibilityState === 'hidden') {
          if (sessionId) {
            enqueue({ k: 'hide', p: lastPath || normalizePath(window.location.pathname) });
            flush(true);
          }
        } else if (sessionId) {
          if (Date.now() - lastAt > IDLE_MS) { lastRaw = null; view(); }
          else enqueue({ k: 'view', p: lastPath || normalizePath(window.location.pathname), l: 'paluu' });
        }
      } catch (e) { /* analytics only */ }
    };

    /**
     * start({ app: 'vanha'|'uusi', role: 'valmentaja'|'pelaaja', url, anonKey,
     *         onToken(cb) — calls cb(accessToken | null) now and whenever it changes,
     *         words — space-separated UI vocabulary })
     */
    var start = function (options) {
      try {
        if (cfg || !options || !options.url || !options.anonKey) return;
        if (!window.fetch || !window.history || !document.addEventListener) return;
        cfg = options;
        words = options.words ? new Set(String(options.words).split(' ')) : null;
        options.onToken(function (next) { token = next || null; if (token) flush(false); });
        watchHistory();
        document.addEventListener('click', onClick, { capture: true, passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', function () { flush(true); });
        window.addEventListener('error', function (ev) {
          if (!ev || ev.target !== window || !ev.message) return; // resource load failures are not crashes
          var where = ev.filename ? ' @ ' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ':' + ev.colno : '';
          if (/ResizeObserver loop/.test(ev.message)) return;
          report('Kaatuminen', ev.message + where);
        });
        window.addEventListener('unhandledrejection', function (ev) {
          var reason = ev && ev.reason;
          var message = reason && (reason.message || reason.error_description) || String(reason);
          report('Käsittelemätön virhe', message);
        });
        timer = window.setInterval(function () { flush(false); }, FLUSH_MS);
        view();
      } catch (e) { /* analytics only */ }
    };

    window.koutsiUsage = {
      start: start,
      view: view,
      error: report,
      // an error toast the person saw (both apps' toast components call this)
      toast: function (message) { try { report('Virheilmoitus', redactWords(message)); } catch (e) { /* analytics only */ } },
      // test seam (koutsi/web/test/usage-tracker.test.mjs); the apps never call it
      _internals: { normalizePath: normalizePath, cleanLabel: cleanLabel, scrub: scrub, redactWords: redactWords, setWords: function (w) { words = new Set(w.split(' ')); } },
    };

    // The old Koutsi: its app file has set KOUTSI_APP_NAME and koutsi-auth.jsx the client.
    var appName = window.KOUTSI_APP_NAME;
    if (!window.KOUTSI_DEMO_ROLE && window.koutsiSupabase && (appName === 'koutsi_valmentaja' || appName === 'koutsi_pelaaja')) {
      start({
        app: 'vanha',
        role: appName === 'koutsi_valmentaja' ? 'valmentaja' : 'pelaaja',
        url: window.KOUTSI_SUPABASE_URL,
        anonKey: window.KOUTSI_SUPABASE_ANON_KEY,
        words: window.KOUTSI_USAGE_WORDS,
        onToken: function (cb) {
          var client = window.koutsiSupabase;
          // only the token is read here; the app's own auth handling is untouched
          client.auth.onAuthStateChange(function (_event, session) { cb(session && session.access_token); });
          Promise.resolve(client.auth.getSession()).then(function (r) { cb(r && r.data && r.data.session && r.data.session.access_token); }, function () {});
        },
      });
    }
  } catch (e) { /* analytics only */ }
})();
