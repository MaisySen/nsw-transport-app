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
* **API token** (My Profile, API Tokens, Create Custom Token). Account permissions: Workers Scripts Edit, D1 Edit, Cloudflare Pages Edit, Workers R2 Storage Edit (only for the APK), Account Settings Read. Account permission for email: Email Routing Addresses Edit. Zone permissions for `transportsydney.app`: Zone Read, DNS Edit, Workers Routes Edit, Single Redirect Edit, Email Routing Rules Edit, Zone Settings Edit.
* **workers.dev subdomain.** Cron Triggers need the account to have one, even though the Worker is not served on it (`workers_dev = false`). Opening Workers & Pages once in the dashboard creates it; the API call is `PUT /accounts/$CF_ACCOUNT_ID/workers/subdomain` with `{"subdomain": "transportsydney"}`. A new schedule can take a few minutes before its first run.
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
| MX | `@` | `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` (priorities set by Cloudflare) | DNS only | `tools/setup-email.mjs` (Email Routing) |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | DNS only | `tools/setup-email.mjs` (Email Routing) |
| TXT | `cf2024-1._domainkey` | the DKIM key Email Routing generates | DNS only | `tools/setup-email.mjs` (Email Routing) |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:contact@fintex.au` | DNS only | `tools/setup-email.mjs` |

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

**Before and after every API deploy (from 25 Oct 2026).**

1. Deploy only from a fresh rebase of `origin/main` (`git fetch origin main && git rebase origin/main`), at or after 986c1c3, so no one else's server change is undone. Never deploy from an old branch.
2. Check the Live Activity routes are still in the worker: `grep -c 'api/live-activity' src/worker.js` (5 or more).
3. `tools/deploy-cloudflare.sh` (it runs `schema.mjs --check`, all tests and the dash check first). The old host (the address in use before the switch) is not deployed from here and must not be redeployed.
4. After it: `/api/health` answers 403 without the key; `/api/lines` and `/api/trackwork` answer 200 with `enabled: true`; `POST /api/live-activity` with an empty body answers 400 `bad token` (the route is there); a shared link still opens: `https://transportsydney.app/trip/abcdefghijkl` answers 302 to `https://api.transportsydney.app/live/?t=abcdefghijkl`, which answers 200.

New tables need no new migration on the live database: the worker creates its tables on first use (`CREATE TABLE IF NOT EXISTS`), and `migrations/0001_init.sql` (regenerated with `node tools/schema.mjs`) is only for a fresh database. Example: `late_agg` (usual lateness) arrived on 25 Oct and was made by the first minute tick.

**Usual lateness (`/api/usual`).** The minute tick folds one past day of `obs` into `late_agg` per tick (28 day backfill on the first runs, then yesterday from 1am), with the claim in `meta` key `late_day`. Free plan only: D1 and the Cron Trigger, no R2, no new binding. It needs live times in `obs`, which the new host records only for departures it serves, so answers fill in as the app uses this host (after the api_base switch).

Deploy log: 25 Oct 2026, 4:31 PM, from main cd4b8e7 (usual lateness, `/api/usual`). Checks above all passed.

**Retention and D1 size (from 25 Oct 2026, 5:27 PM).** The hourly housekeeping (minute tick, at minute 7 of each Sydney hour) deletes, besides the rows listed in the privacy policy:

* `obs` (raw recorded live times) older than `OBS_KEEP_DAYS` = 45 Sydney days. What reads `obs`: reliability (`REL_DAYS`, 42 days), predictions (28 days), the usual lateness fold (one day, the day after; `late_agg` keeps counts only) and the admin `/api/obs` view. At most `OBS_PRUNE_MAX` = 5000 rows per run, so a backlog is spread over several hours.
* `live_activities` rows that ended, expired (10 min after `expires`) or are over 24 hours old; `POST /api/live-activity/end` deletes the row at once.
* `apns_devices` rows the app has not sent for 30 days (it sends the token each time it opens).
* `expo_tokens` and `push_subs` with no working push and no new sign up for 30 days, unless that install still has something that pushes (a live or recently changed watch, an active morning check, a lift alert, an open car park watch or a last way home reminder).

Free plan budget (D1 Free: 5 million rows read and 100,000 rows written a day, 500 MB per database). Measured on 25 Oct: the database was 3.47 MB with 16,698 `obs` rows from 23 to 25 Oct (about 10,000 a day); D1 analytics showed 53,205 rows written and 257,458 read on 24 Oct (UTC), the first full day. A delete costs one row written per row and about four rows read (measured on a scratch copy of the table: 98 rows, 98 written, 392 read). So once `obs` reaches 45 days, pruning adds about 10,000 rows written and 40,000 read a day, and the table levels off at about 450,000 rows (an estimate from the bytes per row today: under 100 MB). If daily writes come near 100,000, lower `OBS_KEEP_DAYS` no further than `REL_DAYS` + 1, or record fewer stops in the sampler.

To read the sizes: `GET /accounts/$CF_ACCOUNT_ID/d1/database` (`file_size`), and `SELECT day, COUNT(*) FROM obs GROUP BY day` through `POST /accounts/$CF_ACCOUNT_ID/d1/database/<uuid>/query` (D1 has no `dbstat`, so sizes per table are not available; count rows instead). Daily reads and writes: the GraphQL dataset `d1AnalyticsAdaptiveGroups` (`rowsRead`, `rowsWritten`).

Deploy log: 25 Oct 2026, 5:27 PM, from main c5f81f5 (Delete all my data for push tokens, token and `obs` clean up), Worker version 0eaaf004-496f-49f3-9e57-480fa7f046bf. Checks above all passed, plus `POST /api/live-activity/forget` 200 (400 without a device).

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

## 5. Email addresses on the domain

`support@transportsydney.app` (support page, store listings), `privacy@transportsydney.app` (privacy policy) and `hello@transportsydney.app` (everything else) forward to `contact@fintex.au` with Cloudflare Email Routing (free).

```bash
cd backend
node tools/setup-email.mjs --dry-run
node tools/setup-email.mjs
```

It turns Email Routing on (Cloudflare adds the MX, SPF and DKIM records in the table above), adds `contact@fintex.au` as the destination, adds one forwarding rule per address and the DMARC record, then prints the mail records. **One click needed:** Cloudflare emails `contact@fintex.au` a "Verify email address" link; nothing is forwarded until it is clicked. Replies go out from `contact@fintex.au` (forwarding does not send mail as the new addresses). Token permissions for this step: Account Email Routing Addresses Edit; Zone Email Routing Rules Edit and Zone Settings Edit, plus DNS Edit.

## 6. App links

`site/.well-known/apple-app-site-association` (team `B85KQRQZW7`, bundle `com.maisysen.nswtransport`) and `site/.well-known/assetlinks.json` (package `com.maisysen.nswtransport`) let `https://transportsydney.app/trip/...`, `/stop/...`, `/plan` and `/open/...` open the app. Both are served as `application/json` with no redirect (`_headers`). Without the app, in a browser: `/trip/<share id>` answers 302 to `https://api.transportsydney.app/live/?t=<share id>` (the live trip page; `site/functions/trip/[id].js`, because Pages rules cannot put a path part into a query string; `site/_routes.json` runs it on `/trip/*` only), and `/stop/...`, `/plan` and `/open/...` show `site/open/`, a page with the store links (200, address kept). Run `wrangler pages deploy` from inside `site/` (as `tools/deploy-site.mjs` does) or the function is left out. This box resolves the domain to IPv6 only, so add `-4 --doh-url https://1.1.1.1/dns-query` to curl here. Check after deploy:

```bash
curl -sI https://transportsydney.app/.well-known/apple-app-site-association | grep -i content-type   # application/json
curl -s https://transportsydney.app/.well-known/assetlinks.json
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://transportsydney.app/trip/abcdefghijkl   # 302 https://api.transportsydney.app/live/?t=abcdefghijkl
curl -s -o /dev/null -w '%{http_code}\n' 'https://transportsydney.app/plan?from=200060&to=2150110'      # 200 (Open in the app page)
```

`assetlinks.json` holds the SHA-256 of the Android upload key (the key the APK and Play uploads are signed with). With Play App Signing, Google signs installs from Play with its own key: copy that key's SHA-256 from Play Console, Test and release, App integrity, App signing key certificate, and add it to the `sha256_cert_fingerprints` list. The apps also need the domain declared in their builds: iPhone entitlement `applinks:transportsydney.app`, Android intent filter with `autoVerify` for `transportsydney.app` (a native build each).

## 7. Check

```bash
A=https://api.transportsydney.app
for p in /api/status "/api/stations?mode=train" "/api/app/config?platform=ios" /live/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' "$A$p")"; done   # all 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $A/                 # 301 https://transportsydney.app/
curl -s -o /dev/null -w '%{http_code}\n' $A/app.js                           # 404
curl -s -H "x-admin-key: $ADMIN_KEY" $A/api/usage                            # lastTick within 2 minutes
for p in / /support/ /privacy/ /terms/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://transportsydney.app$p)"; done   # all 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.transportsydney.app/privacy/   # 301 https://transportsydney.app/privacy/
```

## 8. Move the data (optional)

The new D1 database starts empty: saved trips, commutes, morning checks, watches and notification sign ups live in the first deploy's database. Reading them needs the admin export endpoint (`GET /api/admin/export`, read only, admin key) on the first address for a few minutes. Deploy it there without changing anything else:

1. Copy the folder the first address was last deployed from (`node build.mjs site` output) and add only the export route to its `worker.mjs`, as the first check in `fetch` (the code is `exportRoute` in `src/worker.js`).
2. Deploy that copy, check `/api/status`, `/api/stations?mode=train`, `/api/departures?stop=200060` and `/api/app/config` still answer 200, then run the export below.
3. Deploy the untouched folder again (the same files give the same deploy manifest), check that `/api/admin/export` answers 404 and run the same checks.

```bash
cd backend
SOURCE=<first deploy address> ADMIN_KEY=<its admin key> node tools/export-d1.mjs export.sql   # SKIP=obs to leave out the delay history
npx wrangler@4 d1 execute DB --remote --file export.sql
rm export.sql                                                                                  # it holds user data; never commit it
```

The file replaces every user table on the new database (row ids kept, so loading it twice gives the same result) and merges the tables the new server also writes itself (`obs`, `ip_rate`, `meta`, `usage`; `MERGE=` changes the list) so its own rows stay. Compare the row counts the script prints with `SELECT COUNT(*)` on the new database, table by table.

The first copy was made on 25 Oct 2026 (12,011 rows). The first address keeps taking new saves until the switch, so copy again right before the switch, and pause the first deploy's minute tick right after it. Until then both addresses run their minute tick over the same copied watches, commutes and morning checks; on 25 Oct the only notification sign ups in the copy were two test browsers, so no person gets an alert twice, but a real sign up copied over would.

## 9. The switch

The apps read `copy.api_base` from `/api/app/config` and move to it (https only, from their allowlist). Android round 4 and iPhone build 108 and later read it; older builds keep using the old address until they update.

1. Sections 3 to 7 pass.
2. On the **new** address, so moved apps stay moved:
   `curl -X POST -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" -d '{"copy":{"api_base":"https://api.transportsydney.app"}}' "https://api.transportsydney.app/api/app/config?platform=ios"` and the same with `platform=android`.
3. Optional data move (section 8).
4. The same two POSTs on the **old** address. A POST replaces that platform's stored overrides, so first read `/api/app/config?platform=ios` there and include any flags or timings that differ from the defaults.
5. Apps pick it up at their next launch or within 30 minutes. Watch `/api/usage` on both addresses: calls move to the new one.
6. When the old address has had no traffic for a while: stop its minute tick and retire it.

**Undo:** POST `{"copy":{"api_base":""}}` on the old address and `{"copy":{"api_base":"<old address>"}}` on the new one; apps move back the same way.

**Shared trips made on the old address (TEMP).** Until the apps move here, Share trip still makes the share on the old address, and a browser opening `transportsydney.app/trip/<id>` lands on this address. `GET /api/share` asks the old address when an id is not found here, so the live trip page shows it. The old address is the Worker secret `SHARE_FALLBACK_BASE` (https only), set once with `npx wrangler@4 secret put SHARE_FALLBACK_BASE`, so it is in no file. Remove the secret and `shareFromFallback` in `src/worker.js` once the apps have moved and older shares have ended (4 hours).
