# Runbook

How to deploy, build, update and look after each part of Transport. Updated 25 Oct 2026, 5:20 PM.

The API runs at https://api.transportsydney.app and the public site at https://transportsydney.app, both on the Fintex Australia Cloudflare account. The first address keeps serving installed apps that have not moved yet, until the switch is finished. The commands below need Node 20 or later.

Secrets are named in [Security](SECURITY.md). Never paste a value into the repo, a commit message or a log.

## 1. Deploy the API and the public site

Full steps, DNS records, email and the switch: [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md). In short:

```bash
cd backend
node --test test/*.test.mjs             # all pass (the same run as .github/workflows/backend.yml)
tools/deploy-cloudflare.sh              # tests, build, D1 migrations, wrangler deploy to api.transportsydney.app
node tools/deploy-site.mjs              # site/ to Cloudflare Pages (transportsydney.app and www); needs CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID
```

Then check, all must answer:

```bash
A=https://api.transportsydney.app
for p in /api/status "/api/stations?mode=train" "/api/app/config?platform=ios" /live/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' "$A$p")"; done   # 200
curl -s -o /dev/null -w '%{http_code}\n' $A/no-such-page                           # 404
curl -s -o /dev/null -r 0-10 -w 'apk %{http_code}\n' $A/download/transport.apk     # 206 once the APK is uploaded
for p in / /support/ /privacy/ /terms/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://transportsydney.app$p)"; done   # 200
curl -s "$A/api/ask?q=campsie%20to%20newcastle%20via%20chatswood&format=text"
```

Several workers may edit `src/worker.js`. Always pull `main` and reread the file before writing; never write back an older copy, or another feature (for example `/api/plan`) disappears from the live server.

Commit the generated station, bus route and stop data under `src/public/stations/` and `src/public/stops/` (rebuild them with `tools/build_stations.py` and `tools/build_stops.py`), so a clean clone passes every test. When a table changes in `src/worker.js`, run `node tools/schema.mjs` and commit `migrations/`. Never commit `.env`, `wrangler.toml` or an export file.

**Rollback:** `npx wrangler@4 rollback` in `backend/` (the previous Worker version), or check out the previous commit of `backend/` and deploy again. For the site, Cloudflare Pages, project `transportsydney`, Deployments, Rollback, or `POST /accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/<id>/rollback`; the deployment ids are in docs/RELEASES.md. The zone caches CSS at the edge for up to 4 hours and the token cannot purge it, so give a changed stylesheet a new file name (the home page uses `site/home.css` for this reason; rules added later are in `site/extra-1.css`).

**First address, until the switch.** It runs the build from before the move (`node build.mjs site` writes one folder with the secrets filled in). Do not redeploy it unless Bidur asks; `backend/` deployed there keeps its full behaviour for old app builds. Its address is in the credentials email.

### Public site: current deployment, rollback and SEO checklist

Current production deployment: `6a797b2c-197c-4ad0-8721-16737a8b6b03` (25 Oct, about 9:00 PM, SEO and polish). Roll back to the one before it (`564bc47c-7128-4534-83e1-b4fdce138fd4`, the 8:50 PM simple home page): Cloudflare dashboard, Workers and Pages, `transportsydney`, Deployments, 564bc47c, Rollback, or

```bash
curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/564bc47c-7128-4534-83e1-b4fdce138fd4/rollback"
```

Rules for the site: no scripts (JSON-LD data is the one allowed script element), no ads, no analytics, no tracking. The contact addresses are support@, privacy@ and hello@transportsydney.app, and contact@fintex.au never appears. No em or en dashes. Change a stylesheet by giving it a new file name. Leave `site.css` and `home.css` as they are, and put new rules in `extra-1.css`, or in `extra-2.css` once that file has changed. `backend/test/public-site.test.mjs` checks the items below.

**Keep HTML `no-transform`.** The zone has Email Address Obfuscation on and adds Cloudflare Web Analytics on its own. Either one puts a script into the page, which the CSP blocks and which shows as a console error, and the beacon is analytics. `site/_headers` gives each HTML path `Cache-Control: public, max-age=0, must-revalidate, no-transform`, and the zone does not change those responses. The cost is uncompressed HTML (5 to 12 KB a page). Pages that do not exist (the 404) are not covered and still get both scripts, which stay blocked. They go away for good when someone with dashboard access turns off Web Analytics (Analytics and Logs, Web Analytics) and Scrape Shield, Email Address Obfuscation for transportsydney.app. The API token cannot see the Web Analytics site. Add any new HTML path to that list in `_headers`.

**Lighthouse check** (mobile, the live site). Each page should score 100 in all four categories:

```bash
CHROME_PATH=/path/to/chrome npx lighthouse https://transportsydney.app/ --form-factor=mobile --output=json --output-path=lh-home.json --chrome-flags="--headless=new"
```

#### SEO checklist (status 25 Oct 2026, deployment 6a797b2c)

| Item | Status |
| --- | --- |
| Title, meta description, canonical on home | Done (since 564bc47c) |
| Open Graph (title, description, url, image 1200 x 630 `og.png`) and Twitter card on home | Done |
| Favicon 16, 32 and `.ico`, apple-touch-icon | Done |
| robots.txt with the sitemap line | Done. Lighthouse can now read it, because `connect-src 'self'` is in the CSP |
| `lang="en-AU"` on every page | Done |
| Hero icon alt "Transport: Sydney Live app icon" | Done (6a797b2c) |
| `site.webmanifest` (name, short name "Sydney Live", icons 192 and 512, theme and background colour, standalone), linked from every page, `manifest-src 'self'` | Done (6a797b2c) |
| theme-color for light (#f2f2f7) and dark (#000000) with `prefers-color-scheme` | Done on every page |
| JSON-LD on home: SoftwareApplication (name, iOS and Android, TravelApplication, offer 0 AUD, publisher, url, image) and Organization (Fintex Australia Pty Ltd, https://fintex.au, logo https://fintex.au/apple-touch-icon.png), no ratings or reviews | Done (6a797b2c). It is validated by the test and on the live page |
| Sitemap with `lastmod`, only real pages (`/beta` is a redirect, left out) | Done (6a797b2c) |
| h1 reads "Transport: Sydney Live" to screen readers (a real space, `nw` span only stops the line break) | Done. Checked in the accessibility tree |
| Own title, description, canonical, og:title, og:description, og:url on home, support, privacy and terms | Done. Checked by a test |
| Lighthouse mobile, home: Performance, Accessibility, Best Practices, SEO | 99, 95, 93, 92 before. 100, 100, 100, 100 after |
| Lighthouse mobile, support | 100, 96, 93, 92 before. 100, 100, 100, 100 after. Privacy and terms are also 100 in all four |
| 404 page returns 404 with a link home | Done |
| www goes to the bare domain (301) | Done (zone redirect rule) |
| http goes to https (301) | Done (served by Pages; the zone's Always Use HTTPS is off and not needed). HSTS is one year |
| Every image has width and height (no layout shift) | Done. Checked by a test; CLS is 0 |
| No ads, analytics or tracking scripts | Done for every real page (`no-transform`). For the 404, see above |

## 2. Ship an over the air update (iPhone and Android)

For JavaScript only changes (nothing under `app/targets/`, `app/modules/`, `android/`, no new native module, no `app.json` native change). One update group carries both platforms; builds 201 to 206 on iPhone and Android versionCode 2 to 5 take it (runtime 1.0.0). A new native call must be feature detected, since older builds do not have it. This is how every update on 25 Oct was shipped:

```bash
cd app                                   # a fresh clone at the latest origin/main, your commits pushed first
npx tsc --noEmit
OFFLINE=1 node --test test/*.test.mjs    # all pass, including test/battery.test.mjs
# EXPO_TOKEN in the environment of these commands only; never echo it or write it to a log
npx eas-cli update --branch preview --environment production --platform all --message "What changed" --non-interactive
# check both preview manifests: runtime 1.0.0 and the launch asset hash of the local export (docs/RELEASES.md, Over the air updates)
npx eas-cli update:republish --group <preview group id> --destination-branch production --message "What changed" --non-interactive
```

Right before publishing, read the current production group in `docs/RELEASES.md` on main: that is the rollback target. Then record the new update ids, the group, the commit and the rollback command in `docs/RELEASES.md` and `CHANGELOG.md`. Installed apps download the update on the next open and run it on the open after ("close and reopen twice").

**Rollback:** republish the previous production group: `npx eas-cli update:republish --group <previous group id> --destination-branch production --message "Roll back" --non-interactive`. Each `CHANGELOG.md` entry for 25 Oct carries its exact command.

## 3. Build the Android APK and AAB

Needs the Android SDK (`ANDROID_HOME`), Java 17 and the keystore files in `~/.nsw-secrets/` (see [Security](SECURITY.md)).

1. Bump `expo.android.versionCode` in `app/app.json` (next is 6).
2. APK for the download page: `cd app && ./build-android.sh`. Output: `android/app/build/outputs/apk/release/app-release.apk`.
3. Upload it so the download page and `/api/app` offer it:
   `curl -X PUT -H "x-admin-key: $ADMIN_KEY" --data-binary @app-release.apk "https://api.transportsydney.app/api/admin/file?name=transport.apk&version=5"` (the admin key is only read from the header; needs the R2 bucket, see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md))
4. AAB for Google Play: `./build-android-aab.sh`. Output: `android/app/build/outputs/bundle/release/app-release.aab`. Upload steps are in [SUBMIT.md](../SUBMIT.md).
5. Commit any `app/` changes. `android/` is generated by `expo prebuild` and is not committed.

A new native build is needed for native changes (widgets, permissions, new native modules). The runtime version stays 1.0.0 unless native code changes in a way older APKs cannot run; then bump `runtimeVersion` so old installs do not receive incompatible updates.

## 4. Build the iPhone app (EAS Build)

The iPhone app is built from `app/` with EAS Build (builds 201 to 206 so far). There are only a few iOS builds a month on the Expo plan, so a build goes out only when all pending native work is merged and checked. Steps, signing and the app group: [RELEASES.md](RELEASES.md), iPhone (Expo); the watch targets' signing: [WATCH.md](WATCH.md).

1. Merge the native branch (for build 207: `native-207-bus` into `native-207`, then main) and bump only `ios.buildNumber` in `app/app.json`; `version` stays 1.0.0 so the runtime stays 1.0.0.
2. Static checks: `npx tsc --noEmit`, `OFFLINE=1 node --test test/*.test.mjs`, and `swiftc -parse` on every changed Swift file under `app/targets/` and `app/modules/`.
3. One simulator compile check with a simulator profile in `app/eas.json` (`compilecheck` on main): `npx eas-cli build -p ios --profile compilecheck --non-interactive`.
4. Production: `npx eas-cli build -p ios --profile production --non-interactive --no-wait`, then `npx eas-cli submit -p ios --profile production --id <build id> --non-interactive` (the App Store Connect key is copied into `app/credentials/`, git ignored, and removed after).
5. TestFlight: add the build to the Public group, set What to Test (text in [store/apple/listing.md](../store/apple/listing.md)), submit for Beta App Review.
6. Run the device checklist in [TEST_PLAN.md](TEST_PLAN.md) and record the build in [RELEASES.md](RELEASES.md).

The SwiftUI app in `ios-native/` (CI workflow `ios-native.yml`) is no longer shipped.

## 5. Watch the minute scheduler

On Cloudflare a Cron Trigger runs the tick every minute (`[triggers]` in `wrangler.toml.template`). It drives watch alerts, commute alerts, morning checks, delay sampling and data clean up.

* Trip card pushes (build 205): `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/admin/live-activity` lists the cards and what Apple said; `curl -s -X POST -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/admin/live-activity` sends the newest active card a test update (its warning line reads "Server test" and the time). See [API](API.md).
* Healthy: `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/usage` shows `lastTick` within the last two minutes. Without the key, `/api/usage` only shows the count of recorded live times, and `/api/health` answers 403.
* If it is stale: Cloudflare dashboard, Workers and Pages, `transport-api`, Settings, Trigger Events: the cron must be listed; Logs shows each run.
* The first address is ticked by an outside cron service (cron-job.org job 8707266) until the switch; pause that job once the first address is retired, or right after a data export (see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md)).
* Fallback: an open app calls `/api/watches`, which runs a tick for its own device when the scheduler is quiet for more than 100 seconds.
* Budget: `/api/usage` with the admin key also shows upstream calls today against 60,000. Sampling stops at 40,000 and watches at 56,000. Shared live answers are cached at the edge for 15 seconds, and each address is limited to 120 upstream calls and 60 writes a minute across all copies of the worker (D1 table `ip_rate`).

## 6. Read site stats and contact messages

* Page counter: `curl -H "x-admin-key: $ADMIN_KEY" "https://api.transportsydney.app/api/stats?days=30"`
* Contact form messages: `curl -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/feedback`; delete one with `DELETE ...?id=N` and the same header.

## 7. Rotate keys

Rotate when a key may have leaked, when someone who had it leaves, or once a year. After each rotation, update the credentials email.

| Secret | How to rotate | Also update |
| --- | --- | --- |
| `TFNSW_API_KEY` | opendata.transport.nsw.gov.au, sign in, My account, API tokens: create a new token, then revoke the old one after the deploy | `cd backend && npx wrangler@4 secret put NAME` (also `backend/.env` while the first address runs) |
| `ADMIN_KEY` | Generate 24 random characters (`node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`) | `cd backend && npx wrangler@4 secret put NAME` (also `backend/.env` while the first address runs) |
| `APNS_KEY` | The Apple push key (.p8, Key ID 69AK74573Z, team B85KQRQZW7) from Certificates, Identifiers and Profiles, Keys. To replace it: make a new key with Apple Push Notifications service, set `APNS_KEY_ID` in `wrangler.toml.template`, then revoke the old key | `cd backend && npx wrangler@4 secret put APNS_KEY < AuthKey_XXXX.p8` (the file text, never committed) |
| `TICK_KEY` | Same as ADMIN_KEY | `npx wrangler@4 secret put TICK_KEY`; while the first address runs, also its `.env` and the cron-job.org job header |
| `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` | `node backend/tools/vapid.mjs` | `npx wrangler@4 secret put` for both keys. Existing Web Push subscriptions stop working; each browser must turn alerts on again |
| Cloudflare API token | My Profile, API Tokens: Roll | The deploying machine environment (`CLOUDFLARE_API_TOKEN`) |
| Expo access token | See "Expo token rotation" below | `/home/user/.nsw-secrets/expo.json` (`access_token`) on the build machine, passed as `EXPO_TOKEN` |
| cron-job.org password and API key | console.cron-job.org, Settings | Credentials email |
| Android upload key | Cannot simply be replaced. If it is lost or leaked, ask Google Play for an upload key reset (needs Play App Signing). Keep two backups of the `.jks` and its password | |
| App Store Connect API key (when it exists) | App Store Connect, Users and Access, Integrations: revoke and generate | Repo secrets `ASC_KEY_ID`, `ASC_KEY_P8` |


### Expo token rotation

Last rotated 25 Oct 2026, 7:06 PM Sydney (08:06 UTC), because the old token was written to a build log that day.

* **What it is now:** a robot (service) account token, not a personal one. Robot `transportsydney-ci-2026-10-25` on the Expo account `bidurtab`, token note `transportsydney-ci-2026-10-25`. The robot has only the `publish` and `view` permissions (shown as "Custom: publish, view"), enough for `eas build`, `eas update`, `eas submit` and reading builds and updates. It cannot manage the account, members or billing.
* **The old token:** the personal token `tab-cli` (made 23 Oct) was revoked after the new one was checked.
* **Where it lives:** only in `/home/user/.nsw-secrets/expo.json` under `access_token` (file mode 600) on the build machine. No GitHub Actions workflow uses an Expo token, so there is no `EXPO_TOKEN` repo secret. Add one only when a workflow needs it.
* **How it is used:** copy it to a mode 600 file in the task folder, pass it only as `EXPO_TOKEN` in the environment of the command, never echo or log it, delete the copy after.

How to rotate:

1. With the current token, create a new token for the robot (expo.dev, the `bidurtab` account, Settings, Robot users, the robot, Create token; or the GraphQL mutation `accessToken.createAccessToken` with the robot's id as `actorID`). To start over with a fresh robot, create it with `publish` and `view` only. Creating a robot or token works with a token; changing a robot's permissions later needs a signed in session on expo.dev.
2. Check the new token: `EXPO_TOKEN=... npx eas-cli whoami` names the robot, and one read only call works, for example `npx eas-cli update:list --branch production --limit 1 --non-interactive`. No builds, no updates.
3. Back up `expo.json` next to it as `expo.json.bak-<UTC time>` (mode 600), then write the new token into `access_token`, keeping the other keys and mode 600.
4. If a workflow reads `EXPO_TOKEN`, update that repo secret (sealed with the repo public key) and check its `updated_at`.
5. Only then revoke the old token (expo.dev Access tokens, or `accessToken.setAccessTokenRevoked`). Check that `whoami` now fails with the old token and still works with the new one.
6. Update this section, CHANGELOG.md and the credentials record. Never put a token value in the repo, a log or an email.
