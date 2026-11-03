/* Offline tests: run with `npm test` (Node 18+). 42 is stubbed, nothing hits the network. */
import worker from './src/index.js';

const env = {
  INTRA42_CLIENT_ID: 'uid', INTRA42_CLIENT_SECRET: 'sec', SESSION_SECRET: 's3cr3t-s3cr3t',
  SITE_ORIGIN: 'https://styxsec.tech', ALLOWED_CAMPUS: '1337 Rabat'
};
let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fails++; };
const call = (path, opts, e) => worker.fetch(new Request('https://api.styxsec.tech' + path, opts || {}), e || env);
const cookiesOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);
const jar = (res) => cookiesOf(res).map((c) => c.split(';')[0]).join('; ');

const realFetch = globalThis.fetch;
const stub = (campus, tokenOk = true) => {
  globalThis.fetch = async (u) => {
    if (String(u).includes('/oauth/token')) {
      return tokenOk ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }) : new Response('{}', { status: 401 });
    }
    return new Response(JSON.stringify({
      id: 7, login: 'aybouqaf', email: 'a@b.c', first_name: 'Aymen', last_name: 'B',
      image: { link: 'https://cdn.intra.42.fr/users/x/aybouqaf.jpg', versions: { large: 'https://cdn.intra.42.fr/users/x/large_aybouqaf.jpg', small: 'https://cdn.intra.42.fr/users/x/small_aybouqaf.jpg' } },
      wallet: 120, correction_point: 5, pool_month: 'july', pool_year: '2025', secret_field: 'LEAK',
      campus_users: [{ is_primary: true, campus: { id: 99, name: campus, city: 'Rabat' } }],
      cursus_users: [{ level: 7.42, cursus: { slug: '42cursus', name: '42cursus' } }]
    }), { status: 200 });
  };
};

/* health + not configured */
ok('health ok', (await (await call('/health')).json()).configured === true);
ok('unconfigured /me -> 501', (await call('/me', {}, { SITE_ORIGIN: env.SITE_ORIGIN })).status === 501);
ok('POST rejected', (await call('/me', { method: 'POST' })).status === 405);

/* login */
let r = await call('/login?next=%5Cevil.com');
const loc = new URL(r.headers.get('location'));
ok('login -> intra authorize', loc.origin + loc.pathname === 'https://api.intra.42.fr/oauth/authorize');
ok('redirect_uri is the Worker callback', loc.searchParams.get('redirect_uri') === 'https://api.styxsec.tech/callback');
ok('scope=public only', loc.searchParams.get('scope') === 'public');
ok('state cookie: HttpOnly Secure Lax Domain', /HttpOnly/.test(cookiesOf(r)[0]) && /Secure/.test(cookiesOf(r)[0]) && /SameSite=Lax/.test(cookiesOf(r)[0]) && /Domain=\.styxsec\.tech/.test(cookiesOf(r)[0]));
const state = loc.searchParams.get('state');
const stateJar = jar(r);

/* callback: CSRF */
ok('callback without state cookie -> error=state', (await call('/callback?code=c&state=' + state)).headers.get('location').endsWith('/login.html?error=state'));
ok('callback with wrong state -> error=state', (await call('/callback?code=c&state=nope', { headers: { Cookie: stateJar } })).headers.get('location').endsWith('error=state'));
ok('user cancelled on 42 -> error=denied', (await call('/callback?error=access_denied', { headers: { Cookie: stateJar } })).headers.get('location').endsWith('error=denied'));

/* callback: full happy path */
stub('1337 Rabat');
r = await call('/callback?code=abc&state=' + state, { headers: { Cookie: stateJar } });
ok('callback -> site dashboard (malicious next=\\evil.com fell back)', r.headers.get('location') === 'https://styxsec.tech/dashboard.html');
const sessionJar = jar(r);
ok('session cookie set + state cleared (2 cookies)', cookiesOf(r).length === 2);

/* /me with session + CORS */
r = await call('/me', { headers: { Cookie: sessionJar, Origin: 'https://styxsec.tech' } });
const me = await r.json();
ok('/me 200 with profile', r.status === 200 && me.profile.login === 'aybouqaf');
ok('/me exposes only whitelisted fields', !('secret_field' in me.profile) && me.profile.image_large.includes('large_'));
ok('/me CORS allows site + credentials', r.headers.get('access-control-allow-origin') === 'https://styxsec.tech' && r.headers.get('access-control-allow-credentials') === 'true');
r = await call('/me', { headers: { Cookie: sessionJar, Origin: 'https://evil.example' } });
ok('/me does not grant CORS to other origins', !r.headers.get('access-control-allow-origin'));
r = await call('/me', { headers: { Cookie: sessionJar, Origin: 'https://www.styxsec.tech' } });
ok('/me allows www variant', r.headers.get('access-control-allow-origin') === 'https://www.styxsec.tech');

/* avatar proxy */
const img = (ct, status = 200) => async () => new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'Content-Type': ct } });
ok('/avatar without session -> 401', (await call('/avatar')).status === 401);
globalThis.fetch = img('image/jpeg');
r = await call('/avatar?s=large', { headers: { Cookie: sessionJar } });
ok('/avatar proxies a jpeg (200, image/jpeg, private cache)', r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && /private/.test(r.headers.get('cache-control')));
globalThis.fetch = img('image/svg+xml');
ok('/avatar refuses svg', (await call('/avatar', { headers: { Cookie: sessionJar } })).status === 404);
globalThis.fetch = img('text/html');
ok('/avatar refuses non-images', (await call('/avatar', { headers: { Cookie: sessionJar } })).status === 404);
globalThis.fetch = img('image/png', 404);
ok('/avatar upstream 404 -> 404', (await call('/avatar', { headers: { Cookie: sessionJar } })).status === 404);
globalThis.fetch = realFetch;

/* session integrity */
ok('no cookie -> 401', (await call('/me')).status === 401);
const tampered = sessionJar.split('; ').filter((c) => c.startsWith('styx42=')).map((c) => c.replace(/^(styx42=.)/, (m) => m.slice(0, -1) + (m.slice(-1) === 'e' ? 'f' : 'e')))[0];
ok('tampered cookie -> 401', (await call('/me', { headers: { Cookie: tampered } })).status === 401);

/* campus gate */
stub('1337 Khouribga');
r = await call('/callback?code=abc&state=' + state, { headers: { Cookie: stateJar } });
ok('other campus blocked (error=campus, no session)', r.headers.get('location').includes('error=campus') && !cookiesOf(r).some((c) => c.startsWith('styx42=') && !/Max-Age=0/.test(c)));

/* 42 failures */
stub('1337 Rabat', false);
ok('bad token exchange -> error=token', (await call('/callback?code=abc&state=' + state, { headers: { Cookie: stateJar } })).headers.get('location').endsWith('error=token'));
globalThis.fetch = realFetch;

/* logout */
r = await call('/logout');
ok('logout clears cookie and returns to site', r.headers.get('location') === 'https://styxsec.tech/index.html' && /Max-Age=0/.test(cookiesOf(r)[0]));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
