/* ==========================================================================
   STYXSEC — 42 intra OAuth2 backend (Cloudflare Worker)
   --------------------------------------------------------------------------
   Site:  https://styxsec.tech        (GitHub Pages)
   API:   https://api.styxsec.tech    (this Worker)

   Routes
     GET /login?next=page.html  -> 302 to api.intra.42.fr/oauth/authorize
     GET /callback              -> exchange code, GET /v2/me, campus gate,
                                   set signed session cookie, 302 to the site
     GET /me                    -> 200 { profile } | 401 | 501 (not configured)
     GET /logout                -> clear cookie, 302 to the site
     GET /avatar?s=large|small  -> the member's 42 photo, proxied (needs the session)
     GET /health                -> { ok, configured }  (no secrets, for debugging)

   Config (wrangler.toml [vars] or dashboard; secrets via `wrangler secret put`)
     INTRA42_CLIENT_ID      secret
     INTRA42_CLIENT_SECRET  secret
     SESSION_SECRET         secret   (openssl rand -hex 32)
     SITE_ORIGIN            var      https://styxsec.tech
     ALLOWED_CAMPUS         var      "1337 Rabat"   (comma list, name or city)
     CAMPUS_ID              var      numeric id, stricter than names (optional)
   ========================================================================== */

const AUTHORIZE = 'https://api.intra.42.fr/oauth/authorize';
const TOKEN = 'https://api.intra.42.fr/oauth/token';
const ME = 'https://api.intra.42.fr/v2/me';

const SESSION_COOKIE = 'styx42';
const STATE_COOKIE = 'styx42_state';
const SESSION_TTL = 60 * 60 * 24 * 7;   // 7 days
const STATE_TTL = 600;                  // 10 minutes
const UPSTREAM_TIMEOUT_MS = 8000;

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------------------------------------------------------------- crypto */
const toB64u = (bytes) => {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (str) => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const hmacKey = (secret, usage) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);

async function seal(obj, secret) {
  const body = toB64u(enc.encode(JSON.stringify(obj)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(body));
  return body + '.' + toB64u(mac);
}

/* crypto.subtle.verify compares in constant time. */
async function unseal(token, secret) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), fromB64u(parts[1]), enc.encode(parts[0]));
    return ok ? JSON.parse(dec.decode(fromB64u(parts[0]))) : null;
  } catch (e) { return null; }
}

/* --------------------------------------------------------------- helpers */
const siteOrigin = (env) => String(env.SITE_ORIGIN || '').replace(/\/+$/, '');

/* The site is allowed to call /me with cookies. www.<host> is accepted too. */
function allowedOrigins(env) {
  const o = siteOrigin(env);
  if (!o) return [];
  try {
    const u = new URL(o);
    const bare = u.hostname.replace(/^www\./, '');
    return [u.protocol + '//' + bare, u.protocol + '//www.' + bare];
  } catch (e) { return [o]; }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {}
  });
  return out;
}

/* Scoped to the parent domain so styxsec.tech and api.styxsec.tech are
   same-site: Lax cookies then ride along on the site's fetch('/me'). */
function cookieDomain(env) {
  try {
    const host = new URL(env.SITE_ORIGIN).hostname.replace(/^www\./, '');
    return host.indexOf('.') > 0 ? '.' + host : '';
  } catch (e) { return ''; }
}

function mkCookie(env, name, value, maxAge) {
  let s = name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
  const d = cookieDomain(env);
  if (d) s += '; Domain=' + d;
  return s;
}

/* Bare page names only. Blocks //host, \host, https://, javascript:, ../ */
function safeNext(n) {
  const v = String(n || '');
  return /^[A-Za-z0-9_-]+(\.html)?(\?[A-Za-z0-9_=&%.-]*)?$/.test(v) ? v : 'dashboard.html';
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && allowedOrigins(env).indexOf(origin) >= 0) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
  }
  return h;
}

function json(env, request, code, body) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: Object.assign({ 'Content-Type': 'application/json' }, BASE_HEADERS, corsHeaders(env, request))
  });
}

function redirect(location, cookies) {
  const h = new Headers(BASE_HEADERS);
  h.set('Location', location);
  (cookies || []).forEach((c) => h.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers: h });
}

/* fetch with a hard timeout so a slow intra never hangs the login. */
async function timedFetch(url, init) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try { return await fetch(url, Object.assign({}, init, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}

/* Only these fields ever leave the Worker. */
function slim(u) {
  const cus = u.campus_users || [];
  const cu = cus.filter((c) => c.is_primary)[0] || cus[0];
  const campus = (cu && cu.campus) || {};
  const cl = u.cursus_users || [];
  const cursus = cl.filter((c) => c.cursus && c.cursus.slug === '42cursus')[0] || cl[0] || {};
  const v = (u.image && u.image.versions) || {};
  return {
    id: u.id,
    login: u.login,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    displayname: u.displayname,
    image: (u.image && (u.image.link || v.large)) || null,
    image_large: v.large || v.medium || null,
    image_small: v.small || v.micro || null,
    pool_month: u.pool_month,
    pool_year: u.pool_year,
    wallet: u.wallet,
    correction_point: u.correction_point,
    campus: { id: campus.id || null, name: campus.name || null, city: campus.city || null },
    cursus: { name: (cursus.cursus && cursus.cursus.name) || null, level: cursus.level || null, grade: cursus.grade || null },
    staff: !!u['staff?']
  };
}

/* No restriction configured => any 42 account (set ALLOWED_CAMPUS in prod). */
function campusAllowed(env, profile) {
  const ids = (env.CAMPUS_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  const names = (env.ALLOWED_CAMPUS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!ids.length && !names.length) return { ok: true };
  const cid = profile.campus && profile.campus.id;
  if (ids.length && cid && ids.indexOf(String(cid)) >= 0) return { ok: true };
  const cname = ((profile.campus && profile.campus.name) || '').toLowerCase();
  const city = ((profile.campus && profile.campus.city) || '').toLowerCase();
  if (names.some((n) => cname.indexOf(n) >= 0 || city.indexOf(n) >= 0)) return { ok: true };
  return { ok: false, campus: profile.campus };
}

/* --------------------------------------------------------------- handler */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const qs = url.searchParams;
    const site = siteOrigin(env);
    const configured = !!(env.INTRA42_CLIENT_ID && env.INTRA42_CLIENT_SECRET && env.SESSION_SECRET && site);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: Object.assign({
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
        'Access-Control-Max-Age': '86400'
      }, BASE_HEADERS, corsHeaders(env, request)) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(env, request, 405, { error: 'method_not_allowed' });
    }

    if (path === '/health') return json(env, request, 200, { ok: true, configured: configured });

    if (!configured) {
      return json(env, request, 501, { error: 'not_configured' });
    }

    const id = env.INTRA42_CLIENT_ID;
    const secret = env.INTRA42_CLIENT_SECRET;
    const sessionSecret = env.SESSION_SECRET;
    const cookies = parseCookies(request.headers.get('Cookie'));
    const redirectUri = url.origin + '/callback';
    const fail = (code) => redirect(site + '/login.html?error=' + code, [mkCookie(env, STATE_COOKIE, '', 0)]);

    /* ---------------------------------------------------------- /login */
    if (path === '/login') {
      const state = toB64u(crypto.getRandomValues(new Uint8Array(16)));
      const stateCookie = await seal({ s: state, n: safeNext(qs.get('next')), t: Date.now() }, sessionSecret);
      const auth = AUTHORIZE
        + '?client_id=' + encodeURIComponent(id)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code&scope=public'
        + '&state=' + encodeURIComponent(state);
      return redirect(auth, [mkCookie(env, STATE_COOKIE, stateCookie, STATE_TTL)]);
    }

    /* ------------------------------------------------------- /callback */
    if (path === '/callback') {
      if (qs.get('error')) return fail('denied');               // user clicked "Cancel" on 42
      const st = await unseal(cookies[STATE_COOKIE], sessionSecret);
      if (!st || !st.s || st.s !== qs.get('state') || Date.now() - (st.t || 0) > STATE_TTL * 1000) return fail('state');
      const code = qs.get('code');
      if (!code) return fail('denied');

      let tokRes;
      try {
        tokRes = await timedFetch(TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: id,
            client_secret: secret,
            code: code,
            redirect_uri: redirectUri
          })
        });
      } catch (e) { console.log('token fetch failed', String(e)); return fail('token'); }
      if (!tokRes.ok) { console.log('token endpoint', tokRes.status); return fail('token'); }
      let token;
      try { token = await tokRes.json(); } catch (e) { return fail('token'); }
      if (!token || !token.access_token) return fail('token');

      let meRes;
      try {
        meRes = await timedFetch(ME, { headers: { Authorization: 'Bearer ' + token.access_token } });
      } catch (e) { console.log('me fetch failed', String(e)); return fail('intra'); }
      if (!meRes.ok) { console.log('/v2/me', meRes.status); return fail('intra'); }
      let me;
      try { me = await meRes.json(); } catch (e) { return fail('intra'); }

      const profile = slim(me);
      const gate = campusAllowed(env, profile);
      if (!gate.ok) {
        const who = encodeURIComponent((gate.campus && gate.campus.name) || 'unknown campus');
        return redirect(site + '/login.html?error=campus&campus=' + who, [mkCookie(env, STATE_COOKIE, '', 0)]);
      }

      profile.authenticated_at = new Date().toISOString();
      const session = await seal({ p: profile, e: Date.now() + SESSION_TTL * 1000 }, sessionSecret);
      return redirect(site + '/' + safeNext(st.n), [
        mkCookie(env, SESSION_COOKIE, session, SESSION_TTL),
        mkCookie(env, STATE_COOKIE, '', 0)
      ]);
    }

    /* ------------------------------------------------------------ /me */
    if (path === '/me') {
      const s = await unseal(cookies[SESSION_COOKIE], sessionSecret);
      if (!s || !s.p || !s.e || s.e < Date.now()) return json(env, request, 401, { error: 'unauthenticated' });
      return json(env, request, 200, { profile: s.p });
    }

    /* ------------------------------------------------------- /avatar */
    /* The photo URL comes from the signed session (42's own answer), never from
       the request, so this cannot be pointed at an arbitrary host. Proxying it
       means the browser only talks to api.styxsec.tech: no hotlink / referrer /
       adblock / CSP-host surprises. */
    if (path === '/avatar') {
      const s = await unseal(cookies[SESSION_COOKIE], sessionSecret);
      if (!s || !s.p || !s.e || s.e < Date.now()) return json(env, request, 401, { error: 'unauthenticated' });
      const small = qs.get('s') === 'small';
      const src = small ? (s.p.image_small || s.p.image) : (s.p.image_large || s.p.image);
      let u;
      try { u = new URL(src); } catch (e) { return json(env, request, 404, { error: 'no_avatar' }); }
      const isIp = /^[0-9.]+$/.test(u.hostname) || u.hostname.indexOf(':') >= 0;
      if (u.protocol !== 'https:' || u.username || u.password || isIp || u.hostname.indexOf('.') < 0) {
        return json(env, request, 404, { error: 'no_avatar' });
      }
      let up;
      try { up = await timedFetch(u.href, { headers: { Accept: 'image/*' } }); }
      catch (e) { console.log('avatar fetch failed', String(e)); return json(env, request, 502, { error: 'avatar_unreachable' }); }
      const ct = (up.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      const len = parseInt(up.headers.get('Content-Length') || '0', 10);
      if (!up.ok || !/^image\/(jpeg|png|gif|webp|avif)$/.test(ct) || len > 3 * 1024 * 1024) {
        console.log('avatar rejected', up.status, ct, len);
        return json(env, request, 404, { error: 'no_avatar' });
      }
      return new Response(up.body, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-site',
          'Content-Security-Policy': "default-src 'none'"
        }
      });
    }

    /* -------------------------------------------------------- /logout */
    if (path === '/logout') {
      return redirect(site + '/index.html', [mkCookie(env, SESSION_COOKIE, '', 0)]);
    }

    return json(env, request, 404, { error: 'unknown_route' });
  }
};
