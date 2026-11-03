# StyxSec backend: 42 intra login (Cloudflare Worker)

    styxsec.tech       GitHub Pages   site/            (static)
    api.styxsec.tech   Cloudflare     backend/src      (this Worker, login only)

The browser never sees the 42 `client_secret`. The Worker does the OAuth
exchange, checks the campus, and sets a signed HttpOnly session cookie.

## 1. Create the 42 application
https://profile.intra.42.fr/oauth/applications/new

| Field            | Value                                                       |
|------------------|-------------------------------------------------------------|
| Name             | StyxSec Intranet (must be unique)                           |
| Image            | optional (the club logo: site/assets/img/mark-256.png)      |
| Description      | Member sign-in for the StyxSec cybersecurity club, 1337 Rabat. |
| Application type | Campus Tool                                                 |
| Website          | https://styxsec.tech                                        |
| Public           | unchecked                                                   |
| Redirect URI     | https://api.styxsec.tech/callback                           |
| Scopes           | ONLY "Access the user public data"                          |
| Terms            | accept                                                      |

Redirect URI is one per line. For local dev add a second line:
`http://localhost:8787/callback`. It must match the Worker's URL character for
character (https, no trailing slash).

After saving, 42 shows a **UID** (client id) and a **SECRET**. The secret goes
only into `wrangler secret put`. Never into git, chat or the site.

## 2. DNS on Cloudflare
A Worker custom domain needs the domain's DNS on Cloudflare (free plan).
1. dash.cloudflare.com > Add a site > styxsec.tech
2. Records, all **DNS only (grey cloud)** so GitHub Pages can issue HTTPS:
   - A  @    185.199.108.153 / .109.153 / .110.153 / .111.153
   - CNAME www  aymenbouqaffa51-debug.github.io
3. At the registrar, switch the nameservers to the two Cloudflare gives you.
   Wait for "Active". The site keeps working during the switch.

## 3. Deploy the Worker
    cd backend
    npm install
    npx wrangler login
    npx wrangler secret put INTRA42_CLIENT_ID        # the UID
    npx wrangler secret put INTRA42_CLIENT_SECRET    # the SECRET
    npx wrangler secret put SESSION_SECRET           # openssl rand -hex 32
    npx wrangler deploy

`deploy` also creates api.styxsec.tech. Campus gate: `ALLOWED_CAMPUS` in
wrangler.toml (default "1337 Rabat", matched against the campus name or city
on the member's 42 profile). Use `CAMPUS_ID` for an exact numeric match.
If both are empty, any 42 account can sign in.

## 4. Check
- https://api.styxsec.tech/health  ->  {"ok":true,"configured":true}
- https://api.styxsec.tech/me      ->  {"error":"unauthenticated"}
- https://styxsec.tech/login.html  ->  Continue with 42 -> dashboard with your photo

`configured:false` means a secret is missing. `error=campus` on the login page
means your 42 campus name did not match ALLOWED_CAMPUS.

## Local development
    cp .dev.vars.example .dev.vars   # fill in
    npm run dev                      # http://localhost:8787
    npm test                         # offline tests, 42 is stubbed

## Security model
- State cookie (10 min, signed) blocks login CSRF. `next` accepts bare page names only.
- Session cookie: HttpOnly, Secure, SameSite=Lax, HMAC-SHA256, 7-day expiry checked server-side.
- CORS: only SITE_ORIGIN (and www) may call /me with cookies.
- Only whitelisted profile fields leave the Worker. 8 s timeout on calls to 42.
- To invalidate every session at once, rotate SESSION_SECRET.
