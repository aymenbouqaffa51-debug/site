/* ==========================================================================
   STYXSEC — auth page controller (login / signup / dashboard)
   Login is 42 Network OAuth. No password fields exist any more.

   Every network call goes through window.StyxAuth (assets/js/auth42.js), which
   owns the single configurable API base — this file hardcodes no host.
   ========================================================================== */
(function () {
  'use strict';
  var A = window.StyxAuth;
  if (!A) return;
  var $ = function (s, c) { return (c || document).querySelector(s); };

  /* ------------------------------------------------- login page status */
  var msg = $('[data-auth-msg]');
  var params = new URLSearchParams(location.search);
  var err = params.get('error');
  var MESSAGES = {
    state: '// sign-in expired \u2014 try again',
    denied: '// you cancelled the 42 authorisation',
    token: '// 42 did not return a token \u2014 try again',
    intra: '// could not read your 42 profile \u2014 try again'
  };
  if (msg && err) {
    msg.textContent = MESSAGES[err] || '// sign-in failed \u2014 try again';
    if (err === 'campus') {
      var campus = params.get('campus') || 'your campus';
      /* textContent, never innerHTML: the campus name came over the wire. */
      msg.textContent = '// ' + campus + ' is not a 1337 Rabat campus account';
    }
  }

  /* --------------------------------------- detect an unconfigured deploy */
  var setup = $('[data-intra-setup]');
  if (setup) {
    fetch(A.apiBase + '/me', { credentials: 'include' })
      .then(function (r) { if (r.status === 501 || r.status === 404) setup.hidden = false; })
      .catch(function () { setup.hidden = false; });
  }

  /* --------------------------------------------- already signed in? hint */
  var status = $('[data-intra-status]');
  if (status && A.cached) {
    var me = A.cached();
    if (me) {
      status.hidden = false;
      var t = $('[data-intra-status-text]', status);
      if (t) t.textContent = 'signed in as ' + (me.login || me.first_name || 'member');
    }
  }

  /* ------------------------------------------------------------ dashboard */
  var root = $('#dashRoot');
  if (root) {
    var gate = $('#dashGate');
    A.load().then(function (res) {
      var p = res.profile;
      if (!p) { if (gate) gate.hidden = false; return; }
      if (gate) gate.hidden = true;
      root.hidden = false;

      /* textContent only — 42 profile values are attacker-influenced. */
      var setText = function (sel, val) {
        var el = $(sel);
        if (el) el.textContent = (val == null || val === '') ? '\u2014' : String(val);
      };
      var num = function (v, d) {
        return (typeof v === 'number' && isFinite(v)) ? (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)) : null;
      };

      /* ---- identity ----------------------------------------------------
         The HEADLINE is the public handle (0xch4r0), resolved through the
         single roster map on <body data-handles>. The 42 intra login stays
         visible but subordinate, and the legal name sits under the handle as
         small mono context. Fallbacks are honest: no known handle -> the
         intra login -> the display name. ---------------------------------- */
      var full = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.login || 'member';
      var handle = (A.handleFor ? A.handleFor(p) : null) || full;
      var lvl = num(p.cursus && p.cursus.level, 2);
      setText('[data-dash-handle]', handle);
      /* The name line only adds information when the handle is not the name. */
      var nameEl = $('[data-dash-full]');
      if (nameEl) {
        var same = String(handle).toLowerCase() === String(full).toLowerCase();
        nameEl.textContent = same ? '' : full;
        nameEl.hidden = same;
      }
      setText('[data-dash-login]', p.login ? '@' + p.login : null);
      setText('[data-dash-campus]', p.campus && p.campus.name);
      setText('[data-dash-level]', lvl);
      setText('[data-dash-meta]',
        (p.email || '') +
        (p.pool_month && p.pool_year ? '  \u00b7  pool ' + p.pool_month + ' ' + p.pool_year : '') +
        (p.id ? '  \u00b7  intra #' + p.id : ''));
      var lk = $('[data-dash-login]');
      if (lk && p.login) {
        lk.href = 'https://profile.intra.42.fr/users/' + encodeURIComponent(p.login);
      }

      /* ---- avatar: cdn.intra.42.fr only (https), monogram as fallback ---- */
      var img = $('[data-dash-avatar]');
      var ini = $('[data-dash-initials]');
      /* Same rule as build/people.py: strip 0x, take the first two alnum chars. */
      var initials = (A.monogramFor ? A.monogramFor(handle) : String(handle).slice(0, 2).toUpperCase());
      if (ini) ini.textContent = initials;
      var sources = A.avatarSources ? A.avatarSources(p, 'large') : [];
      if (img && sources.length) {
        var tried = 0;
        var nextSrc = function () {
          if (tried < sources.length) { img.src = sources[tried++]; }
          else { img.hidden = true; if (ini) ini.hidden = false; }
        };
        img.addEventListener('load', function () { img.hidden = false; if (ini) ini.hidden = true; });
        img.addEventListener('error', nextSrc);
        img.referrerPolicy = 'no-referrer';
        img.alt = handle;
        nextSrc();   /* API proxy first, then the 42 CDN, then the monogram */
      }

      /* ---- level ring + progress bar (fraction of the current level) ---- */
      var frac = lvl == null ? 0 : Math.max(0, Math.min(1, lvl - Math.floor(lvl)));
      var pct = Math.round(frac * 100);
      var ring = $('[data-dash-ring]');
      var bar = $('[data-stat-bar]');
      setText('[data-dash-badge]', lvl == null ? '\u2014' : Math.floor(lvl));
      requestAnimationFrame(function () {
        if (ring) ring.setAttribute('stroke-dasharray', pct + ' 100');
        if (bar) bar.style.width = pct + '%';
      });

      /* ---- stat cards ---- */
      setText('[data-stat-campus]', p.campus && p.campus.name);
      setText('[data-stat-cursus]', p.cursus && p.cursus.name);
      setText('[data-stat-level]', lvl);
      setText('[data-stat-next]', lvl == null ? null : pct + '% to level ' + (Math.floor(lvl) + 1));
      setText('[data-stat-wallet]', num(p.wallet, 0));
      setText('[data-stat-eval]', num(p.correction_point, 0));

      var sess = $('[data-dash-session]');
      if (sess && p.authenticated_at) {
        var left = Math.ceil((new Date(p.authenticated_at).getTime() + 7 * 864e5 - Date.now()) / 864e5);
        if (isFinite(left)) sess.textContent = 'Signed in with 42. Session ends in ' + Math.max(left, 0) + (left === 1 ? ' day.' : ' days.');
      }

      var lo = $('[data-logout]');
      if (lo) lo.addEventListener('click', function () { A.logout(); });
    });
  }

  /* --------------------------------------------- remember ?next= for login */
  var next = params.get('next');
  if (next) {
    var btn = $('[data-intra-login]');
    if (btn) btn.setAttribute('href', A.loginUrl(next));
  }

  /* Any remaining 42 button without an explicit data-next follows ?next or the
     current page — resolved through the single API base in auth42.js. */
  var links = document.querySelectorAll('[data-intra-login]:not([data-next])');
  for (var i = 0; i < links.length; i++) {
    if (next) links[i].setAttribute('data-next', next);
    links[i].setAttribute('href', A.loginUrl(next || 'dashboard.html'));
  }
})();
