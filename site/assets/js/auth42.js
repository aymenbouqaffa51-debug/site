/* ==========================================================================
   STYXSEC — 42 intra auth layer
   --------------------------------------------------------------------------
   Login is the 42 Network OAuth2 flow (api.intra.42.fr). 1337 Rabat is part
   of the 42 network, so a member's 42 account IS their club account.

   The browser never sees a client_secret: the OAuth exchange happens on the
   backend (Cloudflare Worker / Deno Deploy / Vercel / Node — see backend/),
   which sets a signed HttpOnly cookie. This file only reads the session back.

   THE API BASE — one constant, two shapes
   ---------------------------------------
   Everything below goes through `API_BASE`. It is resolved, in order, from:

     1. window.STYX_API_BASE                     (runtime override, any value)
     2. <script src="assets/js/auth42.js" data-api-base="...">
     3. window.STYX_API_SAME_ORIGIN === true     (API served from this origin)
     4. the built-in default below               (GitHub Pages + separate API)

   So the SAME file works for a cross-origin backend
   (site on styxsec.tech, API on api.styxsec.tech) and for a same-origin one
   (site and API both on api.styxsec.tech, or localhost during development)
   with no code change — only the constant differs.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ config */

  /* 4. Built-in default: the production API host. Change this line (or set
        data-api-base / window.STYX_API_BASE) to point at a different backend. */
  var API_BASE_DEFAULT = 'https://api.styxsec.tech';

  var API_BASE = (function resolveApiBase() {
    var strip = function (s) { return String(s).replace(/\/+$/, ''); };

    /* 1. explicit runtime override */
    if (typeof window.STYX_API_BASE === 'string') return strip(window.STYX_API_BASE);

    /* 2. declarative override on the script tag */
    var el = document.currentScript || document.querySelector('script[data-api-base]');
    if (el && el.getAttribute) {
      var attr = el.getAttribute('data-api-base');
      if (attr) return strip(attr);
    }

    /* 3. same-origin deployment (API and site behind one host) */
    if (window.STYX_API_SAME_ORIGIN === true) return strip(location.origin);

    /* 4. default (cross-origin) */
    return strip(API_BASE_DEFAULT);
  })();

  var CACHE = 'styxsec.42.profile';

  /* ---------------------------------------------------------------- handles */

  /* Public handles, emitted once on <body data-handles> by build/shell.py from
     build/people.py. Resolution order is the site-wide rule:
     known handle  ->  42 intra login  ->  display name. Nothing is invented. */
  var HANDLES = (function readHandles() {
    var el = document.body;
    var raw = el && el.getAttribute ? el.getAttribute('data-handles') : null;
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  })();

  function handleFor(p) {
    if (!p) return null;
    var login = p.login ? String(p.login) : '';
    if (login && Object.prototype.hasOwnProperty.call(HANDLES, login)) return HANDLES[login];
    if (login) return login;
    var nm = String(p.first_name || '').trim();
    return nm || null;
  }

  /* Deterministic two-character monogram for a handle, matching the generator's
     rule in build/people.py (strip a leading 0x, then first two alphanumerics). */
  function monogramFor(handle) {
    var h = String(handle == null ? '' : handle);
    if (h.slice(0, 2).toLowerCase() === '0x' && h.length > 2) h = h.slice(2);
    h = h.replace(/[^0-9A-Za-z]/g, '');
    return (h.slice(0, 2) || 'M').toUpperCase();
  }

  /* ---------------------------------------------------------------- helpers */

  function readCache() {
    try { return JSON.parse(sessionStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
  }
  function writeCache(p) {
    try {
      if (p) sessionStorage.setItem(CACHE, JSON.stringify(p));
      else sessionStorage.removeItem(CACHE);
    } catch (e) {}
  }

  /* 42 profile fields are attacker-influenced (a member picks their own login
     and display name), so nothing is ever interpolated into HTML raw: the
     renderers below build nodes and assign textContent, and `esc` is exported
     for the rare place a template string is unavoidable. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  /* Only the 42 CDN over https, so a crafted image URL cannot inject a
     javascript:/data: URL or load a third-party tracker. */
  function safeAvatar(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      var u = new URL(url, location.href);
      if (u.protocol !== 'https:') return null;
      if (u.username || u.password) return null;
      if (!/(^|\.)intra\.42\.fr$/.test(u.hostname)) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function nextPath() {
    var p = location.pathname.split('/').pop() || '';
    if (!p || p === 'login.html' || p === 'signup.html' || p === 'dashboard.html') return 'dashboard.html';
    /* Send only the bare page name: the backend rejects anything carrying a
       scheme, a host or a `//`, which is what blocks open redirects. */
    return p;
  }

  /* Photo through the API proxy first (one host, session-checked), the 42 CDN
     second, monogram last. Callers walk this list on <img> errors. */
  function avatarSources(p, size) {
    var out = [];
    if (p && (p.image || p.image_large || p.image_small)) out.push(API_BASE + '/avatar?s=' + (size === 'small' ? 'small' : 'large'));
    var direct = safeAvatar(size === 'small' ? (p && (p.image_small || p.image)) : (p && (p.image_large || p.image)));
    if (direct) out.push(direct);
    return out;
  }

  function absolute(path) {
    /* API_BASE may be '' (same-origin), so build through URL to stay correct. */
    return API_BASE + path;
  }

  /* --------------------------------------------------------------- identity */

  /* Build the nav account chip from DOM nodes — profile strings reach the page
     via textContent / setAttribute only, never through innerHTML. */
  function paintAccountChip(slot, p) {
    if (!slot || !p) return;
    /* The chip shows the HANDLE, not the legal name: the handle is the public
       identity everywhere else on the site. */
    var label = handleFor(p) || 'member';
    var initials = monogramFor(label);
    var sources = avatarSources(p, 'small');

    var link = document.createElement('a');
    link.className = 'acct';
    link.href = 'dashboard.html';
    link.title = 'Member intranet';

    var avWrap = document.createElement('span');
    avWrap.className = 'acct__av';
    if (sources.length) {
      var img = document.createElement('img');
      var tried = 0;
      img.addEventListener('error', function () {
        if (tried < sources.length) img.src = sources[tried++];
        else { avWrap.textContent = initials; }
      });
      img.src = sources[tried++];
      img.alt = '';
      img.width = 26;
      img.height = 26;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      avWrap.appendChild(img);
    } else {
      avWrap.textContent = initials;
    }

    var name = document.createElement('span');
    name.className = 'acct__n';
    name.textContent = label;

    link.appendChild(avWrap);
    link.appendChild(name);
    slot.textContent = '';
    slot.appendChild(link);

    var btn = document.querySelector('[data-login-slot]');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  /* ------------------------------------------------------------------- API */

  var Auth = {
    /* The resolved API base, exposed so pages/debug tooling share one value. */
    apiBase: API_BASE,

    /* Cheap synchronous check for non-critical UI (nav chip). */
    cached: function () { return readCache(); },

    /* Authoritative check. Returns {status, profile, configured}. */
    load: function () {
      return fetch(absolute('/me'), {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
        .then(function (r) {
          if (r.status === 401) { writeCache(null); return { status: 401, profile: null, configured: true }; }
          if (r.status === 501) { return { status: 501, profile: null, configured: false }; }
          if (!r.ok) return { status: r.status, profile: null, configured: true };
          return r.json().then(function (j) {
            var p = (j && j.profile) || null;
            writeCache(p);
            return { status: 200, profile: p, configured: true };
          });
        })
        .catch(function () {
          /* API unreachable / not deployed: still render the site as a brochure. */
          return { status: 0, profile: null, configured: false };
        });
    },

    /* Start OAuth. Full page navigation. */
    login: function (next) {
      location.href = absolute('/login?next=' + encodeURIComponent(next || nextPath()));
    },

    loginUrl: function (next) {
      return absolute('/login?next=' + encodeURIComponent(next || nextPath()));
    },

    logout: function () {
      writeCache(null);
      location.href = absolute('/logout');
    },

    require: function () {
      return Auth.load().then(function (res) {
        if (!res.profile && res.status === 401) {
          location.replace(absolute('/login?next=' + encodeURIComponent(nextPath())));
          return null;
        }
        return res.profile;
      });
    }
  };

  Auth.safeAvatar = safeAvatar;
  Auth.avatarSources = avatarSources;
  Auth.esc = esc;
  Auth.handleFor = handleFor;
  Auth.monogramFor = monogramFor;
  Auth.handles = HANDLES;
  window.StyxAuth = Auth;

  /* Point every 42 entry point in the markup at the resolved API base, so the
     HTML carries no second copy of the URL. `href` in the markup stays a valid
     no-JS fallback. */
  function wireLoginLinks() {
    var links = document.querySelectorAll('[data-intra-login]');
    for (var i = 0; i < links.length; i++) {
      var next = links[i].getAttribute('data-next') || nextPath();
      links[i].setAttribute('href', Auth.loginUrl(next));
    }
  }
  wireLoginLinks();

  /* Fill the nav account chip as soon as possible. */
  var slot = document.querySelector('[data-acct-slot]');
  if (!slot) return;
  var me = readCache();
  if (me) paintAccountChip(slot, me);
  else {
    Auth.load().then(function (r) {
      if (r.profile) paintAccountChip(slot, r.profile);
      else if (r.status === 401) {
        /* Not signed in: leave the "Intranet" CTA in place. */
      }
    });
  }
})();
