# Deploy on Cloudflare

How the Transport: Sydney Live server and public site run on the Fintex Australia Cloudflare account, and how to move the apps to the new address. Updated 25 October 2026.

| Address | What | Cloudflare product | Source |
| --- | --- | --- | --- |
| https://api.transportsydney.app | The API (`/api/*`), the shared live trip page (`/live/`), the Android APK (`/download/transport.apk`) | Worker `transport-api`, D1 database `transport`, Cron Trigger every minute, optional R2 bucket | `backend/` |
| https://transportsydney.app | Public site: store links, Support, Privacy Policy, Terms of Use | Pages project `transportsydney` | `site/` (plain files, no build) |
| https://www.transportsydney.app | Redirects (301) to https://transportsydney.app | Redirect rule on the zone | |

On the API address everything that is not the API, `/live/` or the APK answers a JSON 404; `/`, `/privacy/`, `/support/`, `/terms/` and `/download/` redirect to the site. CORS is open (`*`) so app builds on the old and new address both work during the switch. The first deploy keeps running unchanged until the switch is done.

## 1. Before you start

* **Plan.** Workers Paid (5 USD a month, Workers & Pages, Plans) is strongly recommended. The free plan allows 10 ms of CPU per request and per cron run; decoding the live train feeds needs more, so the minute tick and live boards would fail some of the time. D1 and Pages free limits are fine.
* **API token** (My Profile, API Tokens, Create Custom Token). Account permissions: Workers Scripts Edit, D1 Edit, Cloudflare Pages Edit, Workers R2 Storage Edit (only for the APK), Account Settings Read. Zone permissions for `transportsydney.app`: Zone Read, DNS Edit, Workers Routes Edit, Single Redirect Edit.
* **Values** in the environment of the machine that deploys, never in the repo:

```bash
export CLOUDFLARE_API_TOKEN=...      # the token above
export CF_ACCOUNT_ID=...             # Workers & Pages, Account details, Account ID
export CF_ZONE_ID=...                # transportsydney.app, Overview, Zone ID
```

* **Secrets** for the Worker are the same five as the first deploy (see [Security](SECURITY.md)): `TFNSW_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TICK_KEY`, `ADMIN_KEY`. Keep the same VAPID keys so existing notification sign ups keep working. The deploy script reads them from the environment or `backend/.env`.
* Node 20 or later. Wrangler is fetched by `npx` (version 4).

## 2. DNS: move the nameservers to Cloudflare (preferred)

`transportsydney.app` is registered at GoDaddy. Cloudflare can only attach the Worker and Pages to it when Cloudflare runs the DNS.

1. Cloudflare dashboard, Add a domain, `transportsydney.app`, Free plan. Cloudflare shows two nameservers, for example `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com` (yours will differ; use the two it shows).
2. GoDaddy, My Products, `transportsydney.app`, DNS. If DNSSEC is on, turn it off first.
3. Nameservers, Change Nameservers, "I'll use my own nameservers", enter the two Cloudflare nameservers, Save.
4. Wait until Cloudflare shows the zone as Active (usually under an hour, up to 24 hours). GoDaddy's parking records are not needed; delete any Cloudflare imported `A` or `CNAME` records for `@` and `www` that point at GoDaddy parking.

Records in the Cloudflare zone once deployed (the scripts create them; this is the full list to check against):

| Type | Name | Content | Proxy | Created by |
| --- | --- | --- | --- | --- |
| Worker (shown as `AAAA 100::`) | `api` | Worker `transport-api` | Proxied | `wrangler deploy` (custom domain in `wrangler.toml`) |
| CNAME | `@` | `transportsydney.pages.dev` | Proxied | `tools/deploy-site.mjs` |
| CNAME | `www` | `transportsydney.pages.dev` | Proxied | `tools/deploy-site.mjs` |
| TXT | `@` | `v=spf1 -all` | | by hand, recommended: the domain sends no email |
| TXT | `_dmarc` | `v=DMARC1; p=reject;` | | by hand, recommended: stops others sending email as the domain |

Certificates are issued by Cloudflare on their own. `.app` only works over HTTPS, which is already the case.

**Alternative: keep DNS at GoDaddy.** Workers custom domains need the zone on Cloudflare, so the API cannot be served at `api.transportsydney.app` this way on a normal plan (it would need Cloudflare for SaaS custom hostnames, a paid add on). The site could still go up: in GoDaddy add `CNAME www transportsydney.pages.dev`, add `www.transportsydney.app` as a custom domain on the Pages project, and use GoDaddy Forwarding to send `transportsydney.app` to `https://www.transportsydney.app` (GoDaddy cannot put a CNAME on the bare domain). Use this only for the site, and only if the nameserver move is not possible.

## 3. Deploy the API

```bash
cd backend
tools/deploy-cloudflare.sh --dry-run     # tests, build, renders wrangler.toml, wrangler dry run; deploys nothing
tools/deploy-cloudflare.sh --secrets     # first time: creates D1 "transport" (Oceania), applies migrations, sets the 5 secrets, deploys
tools/deploy-cloudflare.sh               # later deploys
```

What it does, in order: `node tools/schema.mjs --check`, all tests, dash check, `node build.mjs --cloudflare dist`, finds or creates the D1 database and renders `wrangler.toml` from `wrangler.toml.template` (`node tools/render-wrangler.mjs`), `wrangler d1 migrations apply DB --remote` (the schema in `migrations/0001_init.sql`, generated from `src/worker.js`), optionally `wrangler secret put` for each secret (values piped, never printed), then `wrangler deploy`, which also attaches `api.transportsydney.app`.

**APK download (optional).** R2 must be turned on in the account first (R2, Purchase R2 Plan; the free allowance covers this).

```bash
npx wrangler@4 r2 bucket create transport-files
R2_BUCKET=transport-files tools/deploy-cloudflare.sh
curl -X PUT -H "x-admin-key: $ADMIN_KEY" --data-binary @app-release.apk "https://api.transportsydney.app/api/admin/file?name=transport.apk&version=5"
```

Without a bucket the API works and `/download/transport.apk` answers 503.

**Minute tick.** The Cron Trigger in `wrangler.toml` runs the tick every minute on Cloudflare, so the new address needs no outside cron service.

## 4. Deploy the public site

```bash
cd backend
node tools/deploy-site.mjs --dry-run
node tools/deploy-site.mjs
```

It creates the Pages project `transportsydney` if missing, uploads `site/`, adds `transportsydney.app` and `www.transportsydney.app` as custom domains, sets both DNS records in the table above, and adds the `www` to bare domain redirect. `_headers` in `site/` sets HSTS, a strict Content Security Policy and the other security headers.

## 5. Check

```bash
A=https://api.transportsydney.app
for p in /api/status "/api/stations?mode=train" "/api/app/config?platform=ios" /live/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' "$A$p")"; done   # all 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $A/                 # 301 https://transportsydney.app/
curl -s -o /dev/null -w '%{http_code}\n' $A/app.js                           # 404
curl -s -H "x-admin-key: $ADMIN_KEY" $A/api/usage                            # lastTick within 2 minutes
for p in / /support/ /privacy/ /terms/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://transportsydney.app$p)"; done   # all 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.transportsydney.app/privacy/   # 301 https://transportsydney.app/privacy/
```

## 6. Move the data (optional)

The new D1 database starts empty: saved trips, commutes, morning checks, watches and notification sign ups live in the first deploy's database. To copy them, the first deploy needs this code's admin export endpoint (`GET /api/admin/export`), which means one deploy of `backend/` to the first address with its usual runbook. Nothing changes there for the apps (the old address keeps its full behaviour), but it is a deploy of the live address, so do it only with Bidur's go ahead.

```bash
cd backend
SOURCE=<first deploy address> ADMIN_KEY=<its admin key> node tools/export-d1.mjs export.sql   # SKIP=obs,ip_rate to leave out the delay history
npx wrangler@4 d1 execute DB --remote --file export.sql
rm export.sql                                                                                  # it holds user data; never commit it
```

Do the export right before the switch, and pause the first deploy's minute tick right after it (otherwise both addresses send the same alerts).

## 7. The switch

The apps read `copy.api_base` from `/api/app/config` and move to it (https only, from their allowlist). Android round 4 and iPhone build 108 and later read it; older builds keep using the old address until they update.

1. Sections 3 to 5 pass.
2. On the **new** address, so moved apps stay moved:
   `curl -X POST -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" -d '{"copy":{"api_base":"https://api.transportsydney.app"}}' "https://api.transportsydney.app/api/app/config?platform=ios"` and the same with `platform=android`.
3. Optional data move (section 6).
4. The same two POSTs on the **old** address. A POST replaces that platform's stored overrides, so first read `/api/app/config?platform=ios` there and include any flags or timings that differ from the defaults.
5. Apps pick it up at their next launch or within 30 minutes. Watch `/api/usage` on both addresses: calls move to the new one.
6. When the old address has had no traffic for a while: stop its minute tick and retire it.

**Undo:** POST `{"copy":{"api_base":""}}` on the old address and `{"copy":{"api_base":"<old address>"}}` on the new one; apps move back the same way.
