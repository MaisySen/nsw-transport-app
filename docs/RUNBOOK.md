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

**Rollback:** `npx wrangler@4 rollback` in `backend/` (the previous Worker version), or check out the previous commit of `backend/` and deploy again. For the site, Cloudflare Pages, project `transportsydney`, Deployments, Rollback.

**First address, until the switch.** It runs the build from before the move (`node build.mjs site` writes one folder with the secrets filled in). Do not redeploy it unless Bidur asks; `backend/` deployed there keeps its full behaviour for old app builds. Its address is in the credentials email.

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

The iPhone app is built from `app/` with EAS Build (builds 201 to 208 so far). There are only a few iOS builds a month on the Expo plan, so a build goes out only when all pending native work is merged and checked. Steps, signing and the app group: [RELEASES.md](RELEASES.md), iPhone (Expo); the watch targets' signing: [WATCH.md](WATCH.md).

1. Merge the native branch (for build 207: `native-207-bus` into `native-207`, then main) and bump only `ios.buildNumber` in `app/app.json`; `version` stays 1.0.0 so the runtime stays 1.0.0.
2. Static checks: `npx tsc --noEmit`, `OFFLINE=1 node --test test/*.test.mjs`, and `swiftc -parse` on every changed Swift file under `app/targets/` and `app/modules/`.
3. One simulator compile check, right after merging main again: `npx eas-cli build -p ios --profile watchshots --non-interactive --no-wait` (`compilecheck` builds without screenshots). It compiles the app, the widget, the watch app and the complications for the simulator, then `.eas/build/watch-shots.yml` runs `tools/watch-shots.sh` (the watch app on watch simulators) and `tools/widget-shots.sh` (the iPhone widgets, Lock Screen widgets and complications drawn from their own SwiftUI views with live data) and uploads `$HOME/shots` as the build artifact. Neither script can fail the build, and the upload ignores errors. Read the result with `npx eas-cli build:view <id> --json`; the artifact is `artifacts.buildArtifactsUrl` (a tar.gz with `watch/`, `widgets/` and `complications/`, each with a log). Run the EAS CLI from a clean commit: setting `EAS_NO_VCS` (even to 0) makes it pack the working folder instead of the commit.
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
| Expo access token | expo.dev, Account settings, Access tokens: create new, delete old | The build machine environment (`EXPO_TOKEN`) |
| cron-job.org password and API key | console.cron-job.org, Settings | Credentials email |
| Android upload key | Cannot simply be replaced. If it is lost or leaked, ask Google Play for an upload key reset (needs Play App Signing). Keep two backups of the `.jks` and its password | |
| App Store Connect API key (when it exists) | App Store Connect, Users and Access, Integrations: revoke and generate | Repo secrets `ASC_KEY_ID`, `ASC_KEY_P8` |
