/* ==========================================================================
   STYXSEC — interaction layer
   No dependencies. Progressive enhancement only.
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------------------------------------------------------------- nav */
  var head = $('.site-head');
  var onScroll = function () {
    if (head) head.classList.toggle('is-stuck', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Reading progress: a 1px gold hairline under the sticky header. Purely
     indicative, aria-hidden, and it never animates when motion is reduced. */
  var prog = $('[data-nav-progress]');
  if (prog) {
    var raf = 0;
    var paint = function () {
      raf = 0;
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 8 ? (doc.scrollTop / max) * 100 : 0;
      prog.style.width = Math.max(0, Math.min(100, pct)).toFixed(2) + '%';
    };
    window.addEventListener('scroll', function () {
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    window.addEventListener('resize', paint, { passive: true });
    paint();
  }

  var burger = $('.burger');
  if (burger) {
    var drawer = $('#drawer');
    var setMenu = function (open) {
      document.body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      /* Keep the accessibility tree honest: a hidden drawer must not be
         reachable by screen readers or Tab while it is closed. */
      if (drawer) drawer.setAttribute('aria-hidden', String(!open));
      if (drawer && 'inert' in drawer) drawer.inert = !open;
    };
    setMenu(false);
    burger.addEventListener('click', function () {
      setMenu(!document.body.classList.contains('menu-open'));
    });
    $$('.drawer__link').forEach(function (a, i) {
      a.style.transitionDelay = (0.04 * i + 0.06) + 's';
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
        setMenu(false);
        burger.focus();
      }
    });
  }

  /* -------------------------------------------------------- reveal on scroll */
  var reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ------------------------------------------------------------- counters */
  var counters = $$('[data-count]');
  var runCount = function (el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1400, t0 = performance.now();
    var dec = (target % 1 !== 0) ? 1 : 0;
    var step = function (now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(dec) + (p === 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (counters.length) {
    if ('IntersectionObserver' in window && !reduce) {
      var cio = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (en.isIntersecting) { runCount(en.target); cio.unobserve(en.target); }
        });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { cio.observe(el); });
    } else {
      counters.forEach(function (el) {
        el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '');
      });
    }
  }

  /* ------------------------------------------------------------ countdown */
  var clock = $('[data-countdown]');
  if (clock) {
    var when = new Date(clock.getAttribute('data-countdown')).getTime();
    var units = {
      d: $('[data-cd="d"]', clock), h: $('[data-cd="h"]', clock),
      m: $('[data-cd="m"]', clock), s: $('[data-cd="s"]', clock)
    };
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var tick = function () {
      var diff = when - Date.now();
      if (isNaN(when)) return;
      if (diff <= 0) { diff = 0; }
      var d = Math.floor(diff / 864e5),
          h = Math.floor(diff % 864e5 / 36e5),
          m = Math.floor(diff % 36e5 / 6e4),
          s = Math.floor(diff % 6e4 / 1e3);
      if (units.d) units.d.textContent = pad(d);
      if (units.h) units.h.textContent = pad(h);
      if (units.m) units.m.textContent = pad(m);
      if (units.s) units.s.textContent = pad(s);
    };
    tick();
    setInterval(tick, 1000);
  }

  /* --------------------------------------------------------- event filter */
  var filters = $$('.filter');
  if (filters.length) {
    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-filter');
        filters.forEach(function (b) { b.classList.toggle('is-on', b === btn); });
        $$('[data-event]').forEach(function (row) {
          var tags = (row.getAttribute('data-tags') || '').toLowerCase();
          var show = f === 'all' || tags.indexOf(f.toLowerCase()) > -1;
          row.classList.toggle('is-hidden', !show);
        });
        var empty = $('[data-empty]');
        if (empty) {
          var visible = $$('[data-event]').filter(function (r) { return !r.classList.contains('is-hidden'); });
          empty.hidden = visible.length > 0;
        }
      });
    });
  }

  /* ------------------------------------------------------------ copy buttons */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-copy');
      var done = function () {
        var old = b.textContent;
        b.textContent = 'copied';
        setTimeout(function () { b.textContent = old; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done).catch(done);
      } else {
        var t = document.createElement('textarea');
        t.value = v; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(t); done();
      }
    });
  });

  /* ------------------------------------------------------------- forms */
  var forms = $$('form[data-form]');
  forms.forEach(function (form) {
    /* auth forms are owned by pages-auth.js — do not double-bind */
    if (form.getAttribute('data-form') === 'auth' || form.getAttribute('data-form') === 'signup') return;
    var status = $('.form__status', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.querySelector('[name="_honey"]') && form.querySelector('[name="_honey"]').value) return;

      var required = $$('[required]', form);
      var ok = true;
      required.forEach(function (f) {
        if (!f.value.trim()) { ok = false; f.setAttribute('aria-invalid', 'true'); }
        else { f.removeAttribute('aria-invalid'); }
        if (f.type === 'email' && f.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.value)) {
          ok = false; f.setAttribute('aria-invalid', 'true');
        }
      });
      if (!ok) { if (status) status.textContent = '// check the highlighted fields'; return; }

      var btn = $('button[type="submit"]', form);
      var label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span>sending…</span>'; }
      if (status) status.textContent = '// transmitting…';

      setTimeout(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
        if (status) status.textContent = '// received. we reply within 48 hours.';
        var mode = form.getAttribute('data-form');
        if (mode === 'auth') {
          var note = $('[data-auth-note]', form);
          if (note) note.hidden = false;
        }
        var next = form.getAttribute('data-next');
        form.reset();
        if (next) setTimeout(function () { window.location.href = next; }, 1200);
      }, 950);
    });
  });

  /* --------------------------------------------------------- password toggle */
  $$('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-pw-toggle'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'hide' : 'show';
      btn.setAttribute('aria-label', (show ? 'Hide' : 'Show') + ' password');
    });
  });

  /* ------------------------------------------------- password strength meter */
  var pw = $('[data-strength]');
  if (pw) {
    var bar = $('[data-strength-bar]');
    var txt = $('[data-strength-label]');
    var score = function (v) {
      var s = 0;
      if (v.length >= 10) s++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (/[^\w\s]/.test(v)) s++;
      return s;
    };
    var labels = ['too short', 'weak', 'fair', 'strong', 'excellent'];
    pw.addEventListener('input', function () {
      var s = score(pw.value);
      if (!pw.value) { bar.style.width = '0%'; txt.textContent = 'min. 10 characters'; return; }
      bar.style.width = (s / 4 * 100) + '%';
      bar.style.background = s <= 1 ? '#B85C38' : s === 2 ? '#B88838' : s === 3 ? '#E0B667' : '#7FB77E';
      txt.textContent = labels[Math.min(4, s)];
    });
  }

  /* ---------------------------------------------------------- field canvas */
  var cv = document.getElementById('field');
  if (cv && !reduce) {
    var ctx = cv.getContext('2d');
    var pts = [], w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    var mouse = { x: -999, y: -999 };
    var resize = function () {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(78, Math.max(22, Math.round(w * h / 26000)));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.16,
          r: Math.random() * 1.25 + 0.45
        });
      }
    };
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    resize();

    var draw = function () {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;
        var dx = p.x - mouse.x, dy = p.y - mouse.y;
        var md = Math.sqrt(dx * dx + dy * dy);
        if (md < 150) { p.x += (dx / md) * 0.35; p.y += (dy / md) * 0.35; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = 'rgba(184,136,56,0.38)';
        ctx.fill();
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], ax = p.x - q.x, ay = p.y - q.y;
          var d2 = ax * ax + ay * ay;
          if (d2 < 22000) {
            var o = (1 - d2 / 22000) * 0.13;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = 'rgba(224,182,103,' + o.toFixed(3) + ')';
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  /* -------------------------------------------------------------- cursor */
  var cur = $('.cursor');
  if (cur && window.matchMedia('(hover:hover) and (pointer:fine)').matches && !reduce) {
    var cx = 0, cy = 0, tx = 0, ty = 0;
    window.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY; cur.classList.add('on');
    }, { passive: true });
    var loop = function () {
      cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16;
      cur.style.transform = 'translate(' + (cx - 13) + 'px,' + (cy - 13) + 'px)';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    $$('a,button,summary,.card,.member,summary').forEach(function (el) {
      el.addEventListener('mouseenter', function () { cur.classList.add('dot'); });
      el.addEventListener('mouseleave', function () { cur.classList.remove('dot'); });
    });
    document.addEventListener('mouseleave', function () { cur.classList.remove('on'); });
  }

  /* ------------------------------------------------------------ year stamp */
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
