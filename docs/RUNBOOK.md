# Runbook

Every routine operation as copy and paste steps, with what you should see, how to check it and how to roll it back. Updated 26 Oct 2026, 4:30 PM Sydney. Start with [START_HERE.md](START_HERE.md); live numbers come from `node tools/orient.mjs`.

The API runs at https://api.transportsydney.app and the public site at https://transportsydney.app, both on the Fintex Australia Cloudflare account. The first address (`nsw-transport-bot.sites.tab.bot`) is switched off: it only forwards to api.transportsydney.app (its /api paths) and transportsydney.app (pages) since 30 Oct 2026, set up by the operator, not from this repo. Never deploy it. Commands need Node 20 or later. Times are Sydney time.

Secrets are named in [Security](SECURITY.md) and in section 11. Never paste a value into the repo, a commit message, a log or a chat. When a command below needs a secret, load it into the environment of that one command from the operator's private files, for example:

```bash
export CLOUDFLARE_API_TOKEN="$(node -p 'require(process.env.HOME+"/.nsw-secrets/cloudflare.json").api_token')"
export CF_ACCOUNT_ID="$(node -p 'require(process.env.HOME+"/.nsw-secrets/cloudflare.json").account_id')" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
export ADMIN_KEY="$(grep ^ADMIN_KEY= ~/nsw-backend/.env | cut -d= -f2-)"
```

| Section | |
| --- | --- |
| 0 | Rules for every operation |
| 1 | Deploy the API (server) |
| 2 | Roll back the API |
| 3 | Ship an over the air update (preview, then production) and roll it back |
| 4 | Turn a flag on or off (server variable, remote config, app switch) |
| 5 | Transport for NSW quota ran out (429 or 403) |
| 6 | Cloudflare budget: US$5 a month, usage check, budget guard |
| 7 | Daily timetable and planner packs |
| 8 | Native builds: iPhone build 209 on 1 Nov, Android |
| 9 | App Store, TestFlight and Google Play steps that need the owner |
| 10 | Incident playbooks |
| 11 | Credentials: list, where each lives, rotation, the credentials email |
| 12 | Public site (transportsydney.app) |
| 13 | Minute scheduler, stats and contact messages |

## 0. Rules for every operation

* Pull first: `git pull --rebase origin main`. Other workers push all day. Never force push, never write back an older copy of a file.
* History was rewritten on 27 Oct 2026 (about 1:30 AM Sydney) to take a personal phone number out of all old commits. Every clone made before then must be deleted and cloned fresh. Never merge, rebase or push from an old clone, or the old history comes back. Old commit ids from 25 Oct onward no longer exist.
* Tests green before anything ships: backend `node --test test/*.test.mjs`, app `npx tsc --noEmit` and `OFFLINE=1 node --test test/*.test.mjs` (includes `test/battery.test.mjs`).
* Wrap long commands in `timeout -k 5 <seconds>` so a stuck child is killed.
* One over the air update a day, overnight (after 10 PM). No EAS build before 1 Nov. No D1 migration without asking. No load test on production or with the production NSW key. No NSW calls for tests during the day (tests only 11 PM to 5 AM, capped).
* After any ship, record it: `docs/RELEASES.md` (ids, commit, rollback command) and `CHANGELOG.md` (newest first), and update [STATE.md](STATE.md).
* Why each rule exists: [DECISIONS.md](DECISIONS.md).

## 1. Deploy the API (server)

Only when a change needs the server. Who deployed last and from which commit: `node tools/orient.mjs` (Server section) or `docs/RELEASES.md`, section Web.

```bash
# 1. fresh tree: your commits pushed, then the newest main
git pull --rebase origin main && git log --oneline -5
cd backend
# 2. the live deploy must be an ancestor of what you deploy (never deploy an older tree over a newer one)
#    find its commit in its message (node ../tools/orient.mjs) and check:
git merge-base --is-ancestor <live deploy's main commit> HEAD && echo "ok, newer"
# 3. tests and checks
node --test test/*.test.mjs 2>&1 | grep -E '^# (pass|fail)'          # fail 0
node tools/schema.mjs --check                                          # no output
grep -rnP '\x{2013}|\x{2014}' src/ ../docs/ && echo "fix dashes first"  # no output
# 4. build and render wrangler.toml (not committed)
node build.mjs --cloudflare dist
export D1_DATABASE_ID="$(npx --yes wrangler@4 d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.name==="transport").uuid))')"
node tools/render-wrangler.mjs
# 5. pending D1 migrations must be none; if any are listed, STOP and ask (no migration without asking)
npx --yes wrangler@4 d1 migrations list DB --remote | tail -4          # "No migrations to apply"
# 6. note the live version for rollback, then deploy with a message naming the brief and the commit
npx --yes wrangler@4 deployments list --name transport-api | tail -8
timeout -k 5 300 npx --yes wrangler@4 deploy --message "What changed (brief), main $(git rev-parse --short HEAD)"
# 7. verify, every line ok
cd .. && node tools/verify-deploy.mjs
```

Expected from step 6: `Uploaded transport-api`, `Deployed transport-api triggers`, `api.transportsydney.app (custom domain)`, `schedule: * * * * *` and `Current Version ID: <id>`.

Expected from step 7 (`tools/verify-deploy.mjs`, no NSW call): ok for `/api/lines`, `/api/trackwork`, `/api/health` 403 without the key, `/api/usual`, `/api/stations` (300+ stations), `/api/parking?live=0` (40+ car parks), `/api/app/config`, the `/live/` page, a 404 for an unknown path, and a shared live trip link made, opened and ended. With the NSW key working, also run `node tools/verify-deploy.mjs --live` (departures at Central and a Central to Strathfield trip). With the admin key, `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/health` says `"ok":true`. Keep the `/api/live-activity` routes: the trip card pushes of builds 205 and later depend on them.

Then record: a row in `docs/RELEASES.md` section Web (version id, commit, what changed, rollback version), a `CHANGELOG.md` entry with the rollback command, and the deploy in [STATE.md](STATE.md).

`tools/deploy-cloudflare.sh` does steps 3 to 6 in one go, but it **applies** pending D1 migrations itself; run step 5 first and use it only when the list is empty. Secrets are never part of a code deploy; to change one, see section 11.

Commit the generated station, bus route and stop data under `src/public/stations/` and `src/public/stops/` (rebuild them with `tools/build_stations.py` and `tools/build_stops.py`), so a clean clone passes every test. When a table changes in `src/worker.js`, run `node tools/schema.mjs` and commit `migrations/`. Never commit `.env`, `wrangler.toml` or an export file.

## 2. Roll back the API

```bash
cd backend
npx --yes wrangler@4 deployments list --name transport-api | tail -16    # newest last; pick the version before the bad one
npx --yes wrangler@4 rollback <version id> --name transport-api --message "Roll back: why" -y
cd .. && node tools/verify-deploy.mjs
```

Each `CHANGELOG.md` and `RELEASES.md` deploy entry names its rollback version. A rollback restores code and plain variables, not D1 data and not Durable Object storage. If the bad deploy added a Durable Object migration (for example `planner-v1`), the rollback still works: the older code simply does not use that class. After a rollback, tell the other workers in your report: their next deploy from main would bring the bad change back.

**First address, until the switch.**  It runs the build from before the move (`node build.mjs site` writes one folder with the secrets filled in). Do not redeploy it unless Bidur asks; `backend/` deployed there keeps its full behaviour for old app builds. Its address is `nsw-transport-bot.sites.tab.bot`. Never deploy to it.

**Update 30 Oct 2026 (Bidur: disable all tab.bot addresses).** The first address no longer runs the old build: the operator replaced it with a forwarder. Its /api paths reach api.transportsydney.app and its pages go to transportsydney.app. The rule above still holds: never deploy to it from this repo. The app (from tonight's update) and build 209 never name it.

## 3. Ship an over the air update (iPhone and Android)

For JavaScript only changes (nothing under `app/targets/`, `app/modules/`, `android/`, no new native module, no native `app.json` change). One update group carries both platforms; iPhone builds 201 to 208 and Android versionCode 2 to 5 take it (runtime 1.0.0). A new native call must be feature detected, since older builds do not have it. **At most one a day, published overnight.**

```bash
git pull --rebase origin main                     # your commits pushed first; the update ships everything on main
cd app && npm ci
npx tsc --noEmit                                  # no output
OFFLINE=1 node --test test/*.test.mjs 2>&1 | grep -E '^# (pass|fail|skipped)'   # fail 0
# rollback target = the production group live now (also the top row of docs/RELEASES.md, Over the air updates)
node ../tools/orient.mjs | grep -A2 'Over the air'
# token from the operator file into a mode 600 copy; pass it only in the command's environment
install -m 600 /dev/null .expo_token && node -p 'require(process.env.HOME+"/.nsw-secrets/expo.json").access_token' > .expo_token
EXPO_TOKEN="$(cat .expo_token)" timeout -k 5 1200 npx eas-cli update --branch preview --environment production --platform all --message "What changed, in plain words" --non-interactive --json > /tmp/eas-preview.json
```

Check the preview before promoting it. Both platforms must answer with runtime 1.0.0 and the new group:

```bash
for p in ios android; do curl -s -H 'expo-channel-name: preview' -H 'expo-runtime-version: 1.0.0' -H "expo-platform: $p" \
  -H 'expo-protocol-version: 1' -H 'accept: multipart/mixed' https://u.expo.dev/cf1f4c4c-5157-41bf-a254-4480223f6368 \
  | grep -o '{"id".*' | head -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(0,s.indexOf("\r\n--")>0?s.indexOf("\r\n--"):undefined));console.log(j.metadata.updateGroup,j.runtimeVersion,j.launchAsset.hash)})'; done
```

The launch asset hash must match your local export (`npx expo export --platform ios` then `ios` and `android` bundle hashes, as in RELEASES.md). Look at the web export at 390 x 844 and 430 x 932, light and dark (see [WORKER_GUIDE.md](WORKER_GUIDE.md), Checks). Then promote the same bundles:

```bash
EXPO_TOKEN="$(cat .expo_token)" npx eas-cli update:republish --group <preview group id> --destination-branch production --message "What changed" --non-interactive
rm -f .expo_token
node ../tools/orient.mjs | grep -A2 'Over the air'      # production now shows the new group on ios and android
```

Record the preview group, production group, iOS and Android update ids, the commit and the rollback command in `docs/RELEASES.md` (top row of Over the air updates) and `CHANGELOG.md`, then [STATE.md](STATE.md). Installed apps download it on the next open or foreground check (at most every 15 minutes) and run it on the open after: "close and reopen twice".

**Rollback:** republish the previous production group:

```bash
EXPO_TOKEN="$(cat .expo_token)" npx eas-cli update:republish --group <previous production group id> --destination-branch production --message "Roll back: why" --non-interactive
```

or return to the code inside the binary: `npx eas-cli update:roll-back-to-embedded --branch production --runtime-version 1.0.0 --platform ios` (then `android`). Publishing with `--platform android` only leaves iPhones on the last iPhone update; always use `--platform all`. `eas update:list` needs `npm ci` in `app/` first (it loads the app config); `tools/orient.mjs` reads the live group without it.

## 4. Turn a flag on or off

There are three kinds. `node tools/orient.mjs` prints all three.

**Server variables** (`[vars]` in `backend/wrangler.toml.template`, live values on the Worker). A variable not set counts as off. While the budget guard holds (section 6), `ENGINE_BOARDS`, `ENGINE_PUSH`, `LIVE_PUSH`, `OWN_PLANNER`, `ENGINE_LEARN` and `LOAD_TESTS` act as off whatever they say.

| Variable | Now | What on does | Who may turn it on |
| --- | --- | --- | --- |
| `ENGINE_BOARDS` | off | Boards come from our board engine instead of the Trip Planner | Only after the 95% match gate passes and the owner agrees |
| `ENGINE_PUSH` | not set (off) | Engine boards pushed over a socket at `/api/live` | After a device test |
| `ENGINE_FEED_TIMING` | not set (off) | Engine fetches each feed just after it publishes, with If-None-Match | After NSW answers are measured (after 1 AM) |
| `ENGINE_SHARDS` | 4 in the template since the budget mode commit (the Worker read 16 at 4:10 PM, until the next deploy) | How many shard objects build boards | Cost guard, [COSTS.md](COSTS.md) |
| `ENGINE_IDLE_MIN` | 5 | An idle engine object stops its alarm after this many minutes with no reads | Keep |
| `ENGINE_LEARN` | off | Platform names and missing lines sent to the engine from Trip Planner boards | Only while the engine serves boards |
| `LIVE_PUSH` | off | Trip Planner boards pushed over a socket | After a device test, and the app flag below |
| `OWN_PLANNER` | off | Trip searches answered by our own planner, no NSW call; also whole day trip lists for phones that send `days=1` (src/daylist.js) | After `tools/planner_match.mjs` passes 90% (3 to 6 AM) and, for the day lists, `tools/trips-compare.mjs` passes 95% (11 PM to 5 AM, at most 40 Trip Planner calls; root and the owner decide) |
| `TRIP_TT` | not set (on once deployed) | `trip-tt` in x-serves: the newer app asks `/api/trip?tt=1` for timetable trips beside a new search (no Trip Planner call); `off` or `kill.tripTt` removes it, the budget guard holds it | Root, after the device check |
| `TRIP_TT_OWN` | not set (on) | The first look may use our own planner's pack when the board engine's timetable has none (labelled timetable, never instead of the Trip Planner); `off` leaves it out | Root |
| `REQ_LOG` | on | One log line per request | Turn off if Workers Logs costs grow |
| `LOAD_TESTS` | off | Load test keys accepted | Never on production |
| `API_ONLY` | 1 | API host serves only `/api`, `/live/` and the APK | Keep |

Change one: edit the value in `backend/wrangler.toml.template`, commit with the reason, then deploy (section 1). The template is the source of truth: a value changed only in the Cloudflare dashboard is overwritten by the next deploy. To roll back, set it back and deploy, or roll back the version (section 2).

**Remote config** (what the phones read at start and every 30 minutes from `/api/app/config?platform=ios`, `android` or `server`; edge cached 5 minutes). Flags: `ask`, `parkRide`, `opalMachines`, `liveTrip`, `shareTrip`, `weekdayReminder`, `nearby`, `morningCheck`, `platformAlerts`, `occupancy`, `liftAwareRouting`, `reliabilityPick`, `lastWayHome`, `weekendTrackwork`, `lineStatus`, `usualLate`, all on; `livePush` absent (off; the app opens a socket only when it is exactly `true`). A POST **replaces** the stored override for that platform, so post the full set you want:

```bash
A=https://api.transportsydney.app
curl -s "$A/api/app/config?platform=ios" > cfg.json                  # current, merged
# edit cfg.json (for example "kill": {"ask": true}, or "flags": {..., "livePush": true}), then
curl -s -X POST -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' --data @cfg.json "$A/api/app/config?platform=ios"
# repeat for platform=android; platform=server turns server features off for everyone at once (read within a minute)
```

Roll back: post the previous file again. `copy.api_base` moves every phone to another server: only an https origin is accepted, and a wrong one strands every install, so never set it without the owner.

**App switches** in `app/src/lib/features.ts` (`LIVE_DATA_AGE=false`; Platform view and its switch were removed on 26 Oct): change the line, test, ship in the nightly over the air update (section 3).

## 5. Transport for NSW quota ran out (429 or 403)

The key has 60,000 calls a day (Bronze plan). The day resets at midnight AEST, which is **1 AM AEDT** in summer time. NSW answers 429 "Your API quota or rate limit has been exceeded" (their docs say 403) when it is out. On 26 Oct it ran out at about 1:25 PM because load tests shared the production key.

What happens on its own (no action needed): trip searches answer with timetable trips labelled "Timetable times. Live trips are unavailable right now.", boards fall back to the timetable, Nearby comes from our own stop list, Ask says NSW is not answering (not the phone's signal), the phones keep their saved copies, the engine backs its feed calls off from 30 s to 10 minutes, and server sampling stops at 40,000 calls and watches at 56,000.

What to do:

1. Confirm: `node tools/orient.mjs` shows "NSW calls today ... of 60000" near or over, and `/api/health` with the key shows `upstream.refused` above 0. One probe at most every 5 minutes, never a loop:
   `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: apikey $TFNSW_API_KEY" "https://api.transport.nsw.gov.au/v1/tp/departure_mon?outputFormat=rapidJSON&coordOutputFormat=EPSG:4326&mode=direct&type_dm=stop&name_dm=200060&departureMonitorMacro=true&TfNSWDM=true&version=10.2.1.42"` (200 back, 429 or 403 out). The key's operator copy is `TFNSW_API_KEY` in `~/nsw-backend/.env`.
2. Stop anything of ours that spends calls: load tests, match runs, samplers, probes in a loop. Check `ps` for your own scripts; never kill another worker's processes, ask the root instead.
3. Tell the owner in plain words that live times are back after 1 AM and the app shows timetable times until then. Do not promise sooner.
4. After 1 AM: probe once, then `node tools/verify-deploy.mjs --live`.
5. The owner asked NSW for 1,000,000 calls a day and 25 a second on 26 Oct, 2:46 PM (to OpenDataHelp, username bidurtab). When NSW raises it, update the server budget (`/api/usage` budget, sampling and watch cut offs in `src/worker.js`) and [STATE.md](STATE.md).

There is no NSW dashboard showing our usage (NSW staff confirmed this in Oct 2025; "Last access: Never" on the key page means nothing). Our own count is `/api/usage` with the admin key, and the request log lines (`REQ_LOG`) carry the NSW calls per request.

## 6. Cloudflare budget: US$5 a month, no overage

The account is on Workers Paid (US$5 a month) since 26 Oct 9:06 AM Sydney; the billing cycle runs from the 25th, 00:00 UTC. Owner's rule (26 Oct 3:47 PM): stay at US$5 with no overage, built for up to 1,000 people. Full numbers and the guard design: [COSTS.md](COSTS.md).

Included each month: 10 million Worker requests, 30 million CPU ms, 1 million Durable Object requests (every alarm, RPC and socket open counts), 400,000 GB-s Durable Object duration, 25 billion D1 rows read, 50 million D1 rows written, 5 GB D1 storage, 20 million log events. The meter a test can blow is Durable Object requests: the 1,000 phone soak on 26 Oct used about 70,000 in one hour.

Check usage (read only):

```bash
node tools/orient.mjs        # "Cloudflare usage this cycle": each meter, share of included, month pace; OVER 80% PACE is the warning
```

It uses the read only analytics token (`CF_ANALYTICS_TOKEN`, operator file `~/.nsw-secrets/cloudflare-analytics.json`, permission Account Analytics Read only). The bill itself: Cloudflare dashboard, Manage Account, Billing, Billable Usage ("All usage is within included tier limits" and projected cost US$0.00). Cloudflare also emails a spend alert at US$10 to the Fintex mailbox.

The budget guard (`budgetCheck` in `src/worker.js`, [COSTS.md](COSTS.md), "Budget guard") runs every hour at minute 17 with the Worker secret `CF_ANALYTICS_TOKEN`: over 50% projected on any meter it emails the Fintex mailbox once a cycle; over 80% projected, or 80% used, it holds the engine, push, own planner, engine learn and load keys off and emails why. The app keeps working on the Trip Planner path.

```bash
A=https://api.transportsydney.app
curl -s -H "x-admin-key: $ADMIN_KEY" $A/api/budget                       # last reading, hold, each switch
curl -s -X POST -H "x-admin-key: $ADMIN_KEY" "$A/api/budget/check?dry=1"  # read now, change nothing, no email
curl -s -X POST -H "x-admin-key: $ADMIN_KEY" $A/api/budget/clear           # lift a hold (no new hold for 6 h unless a meter is at 95%)
```

If a meter is pacing over 80%: find what drives it (orient's table, then the dashboard), turn that feature off (section 4), confirm `LOAD_TESTS` is off, look for a runaway alarm (`node tools/orient.mjs --engine`). Lift a hold only after the cause is gone. Never upgrade a plan or add a paid product without the owner.

## 7. Daily timetable and planner packs

GitHub Actions workflow `timetable` (`.github/workflows/timetable.yml`) runs every night at 2:40 AM Sydney in summer time (15:40 UTC).

* **Engine timetable, every second night** (budget mode): it first reads `/api/engine/status`; when the engine already holds today and tomorrow it skips the engine load. Otherwise it downloads the NSW GTFS bundles (a few dozen calls on `TFNSW_API_KEY`, a repo secret), builds 4 days (yesterday to 2 days ahead, `backend/tools/build_timetable.py`) and loads them (`backend/tools/load_timetable.mjs`, repo secret `ENGINE_LOAD_KEY`). Each load writes about 1.3 million rows, which is why it is not nightly.
* **Planner pack, every night**: today's pack from the complete GTFS bundle (`build_planner.py`, `load_planner.mjs`). A failure keeps yesterday's pack and does not fail the job; searches for a day without a pack go to the Trip Planner.

* Check it ran: GitHub, Actions, timetable, the latest run is green. `curl -s https://api.transportsydney.app/api/engine/status | head -c 300` shows `days` covering today and tomorrow and a recent `builtAt` (this read wakes the engine; do it once). A run that skipped the engine load says "no engine load tonight" in the step log: that is normal every second night.
* Run it by hand (a manual run always loads the engine): Actions, timetable, Run workflow (or `POST /repos/MaisySen/nsw-transport-app/actions/workflows/timetable.yml/dispatches` with `{"ref":"main"}`). Not during the day if the NSW quota is tight.
* If it fails: open the failed step. Download errors are usually the NSW quota (section 5): rerun after 1 AM. A load error with 401 means `ENGINE_LOAD_KEY` in the repo secrets no longer matches the Worker secret (section 11). The engine keeps the last loaded days, so one missed night is not an outage; boards for a day with no timetable fall back to the Trip Planner.
* Phone timetable packs (`/api/pack`, [TIMETABLE_PACKS.md](TIMETABLE_PACKS.md)) come from the same engine data; nothing else to run.

## 8. Native builds

### iPhone: build 209 on 1 Nov (EAS Build)

The Expo plan's 15 iPhone builds for October are used up (build 208 was the 15th). The next build is **build 209, on or after 1 Nov**, with everything listed in [IOS27.md](IOS27.md) under "Build 209 (1 Nov)". Until then, everything ships as JavaScript and any native call is feature detected (`Application.nativeBuildVersion`, a module's presence), so builds 201 to 208 keep working.

1. Native work lives on branch `native-207` (builds 207 and 208 were built from it; it is not merged into main). Merge `main` into `native-207`, add the build 209 native items, bump only `ios.buildNumber` to 209 in `app/app.json`. `version` stays 1.0.0 so the runtime stays 1.0.0.
2. Static checks: `npx tsc --noEmit`, `OFFLINE=1 node --test test/*.test.mjs`, `swiftc -parse` on every changed Swift file under `app/targets/` and `app/modules/`.
3. One simulator compile check: `npx eas-cli build -p ios --profile compilecheck --non-interactive` (counts against the plan).
4. Production: `npx eas-cli build -p ios --profile production --non-interactive --no-wait`, then `npx eas-cli submit -p ios --profile production --id <build id> --non-interactive` (App Store Connect key copied into `app/credentials/`, git ignored, removed after).
5. TestFlight: add the build to the Public group `36f40c38`, set What to Test ([store/apple/listing.md](../store/apple/listing.md)), submit for Beta App Review. Not App Store review (owner only).
6. Run the device checklist in [TEST_PLAN.md](TEST_PLAN.md), record the build in [RELEASES.md](RELEASES.md) (iPhone table) and [STATE.md](STATE.md).

Signing, the app group and the Watch targets: [RELEASES.md](RELEASES.md) (iPhone, Expo) and [WATCH.md](WATCH.md). The SwiftUI app in `ios-native/` is no longer shipped.

### Android APK and AAB

Needs the Android SDK (`ANDROID_HOME`), Java 17 and the keystore files in `~/.nsw-secrets/` (see [Security](SECURITY.md)).

1. Bump `expo.android.versionCode` in `app/app.json` (next is 6).
2. APK for the download page: `cd app && ./build-android.sh`. Output: `android/app/build/outputs/apk/release/app-release.apk`.
3. Upload it so the download page and `/api/app` offer it:
   `curl -X PUT -H "x-admin-key: $ADMIN_KEY" --data-binary @app-release.apk "https://api.transportsydney.app/api/admin/file?name=transport.apk&version=<versionCode>"` (the admin key is only read from the header; needs the R2 bucket, see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md))
4. AAB for Google Play: `./build-android-aab.sh`. Output: `android/app/build/outputs/bundle/release/app-release.aab`. Upload steps are in [SUBMIT.md](../SUBMIT.md).
5. Commit any `app/` changes. `android/` is generated by `expo prebuild` and is not committed.

A new native build is needed for native changes (widgets, permissions, new native modules). The runtime stays 1.0.0 (owner rule, [DECISIONS.md](DECISIONS.md)): native changes must stay compatible with the JavaScript every older build runs, and new native calls are feature detected. Changing `version` or `runtimeVersion` would cut every installed app off from over the air updates.



## 9. App Store, TestFlight and Google Play steps that need the owner

Do these only with the owner's OK. The listing, privacy answers, review notes and screenshots are ready ([STORE_READINESS.md](STORE_READINESS.md), [REVIEW-NOTES.md](REVIEW-NOTES.md), `store/`).

**Apple** (App Store Connect app 6826543653, team B85KQRQZW7, today an individual account in the owner's name):

* TestFlight for a new build: we can do it (section 8, step 5); Beta App Review is usually approved within minutes.
* **Submit version 1.0.0 for App Store review: owner only.** Never press Submit for Review without the owner's written OK. When he says go: attach the newest build to version 1.0.0 (App Store Connect, the app, 1.0.0, Build), check App Review Information (contact, notes from REVIEW-NOTES.md) and App Privacy (published 25 Oct), then Submit.
* Seller name: the account is individual, so the store shows the owner's own name. Converting to an organisation account for Fintex (D-U-N-S 889795329) is the owner's to do on developer.apple.com; check the Seller reads Fintex before the first public release if he wants that.
* Price, availability, age rating: set (free, Australia only, 4+). Change only with the owner.

**Google Play** (`com.maisysen.nswtransport`, not created yet):

1. Owner: create the app in Play Console (Fintex developer account), invite the service account named in section 11 with release permissions.
2. Owner or us with his login: upload the first AAB by hand to Internal testing (Google requires the first upload in the web page). Later uploads: `node store/play-upload.mjs`.
3. A new personal developer account needs a closed test with 12 testers for 14 days before production. An organisation account does not.
4. Fill App content from `store/google/` (data safety, content rating, ads: none).

**Android alerts with the app closed** need Firebase Cloud Messaging: the owner makes a Firebase project and sends `google-services.json` and the FCM V1 key privately (steps in [app/NEEDS_BIDUR.md](../app/NEEDS_BIDUR.md), section "Android push alerts"). Then: upload the key to the Expo project credentials, add `android.googleServicesFile`, build versionCode 6 (a native build).

## 10. Incident playbooks

Start every incident with `node tools/orient.mjs` and `node tools/verify-deploy.mjs`. Tell the owner what users see and when it will be fixed, in plain words, once; then fix.

**Live data down (boards show Timetable, trips say live trips unavailable).** Usually the NSW quota (section 5) or an NSW outage. Check `/api/health` with the key (`upstream.refused`), the NSW calls count, and https://opendataforum.transport.nsw.gov.au. If our side: the last deploy (roll back, section 2). The app already shows timetable times honestly; do not ship an update for an NSW outage.

**Server 5xx.** `node tools/verify-deploy.mjs` names the failing path. Look at Workers Logs (Cloudflare dashboard, Workers and Pages, `transport-api`, Logs; one request in 10 is kept, with `path`, `status`, `ms`, `nswMs`, `nswCalls`). If it began with a deploy, roll back first (section 2), then debug on a branch. Error 1102 (CPU limit) means a hot path got heavier; Workers Paid allows more CPU, so look for a loop. A 5xx on every path with nothing deployed: Cloudflare status page, then D1 (`npx wrangler@4 d1 execute transport --remote --command "select 1"`).

**NSW 429 or 403.** Section 5. Never retry in a loop; the server already retries up to 4 times over about 5 s and then serves a copy or the timetable.

**Wrong times reported by the owner** (a screenshot or "the app said X"). Write down the stop, line, time seen, time expected and the app screen. Reconstruct from our records: the request log lines in Workers Logs (3 days), recorded live times (`/api/predict`, `obs` table, 45 days), the GTFS timetable for that day (engine `days`). Compare with the Trip Planner only after 1 AM when the quota is back. Write the cause and the fix in the commit and in [STATE.md](STATE.md) (open bugs). Test with NSW wide cases, at most 5% on the owner's own routes. Never ship a fix that hard codes his stops or times.

**Over the air update broke the app.** Republish the previous production group at once (section 3, Rollback; its id is in `RELEASES.md` and `CHANGELOG.md`). Phones get the rollback on their next open or foreground check, and run it on the open after. If the update crashes on start before it can check for updates, the phone falls back to the embedded code after a crash on launch; also run `update:roll-back-to-embedded` for both platforms. Then find the cause on a branch; the fix goes out the next night.

**Watch or widget stale.** Builds 201 to 208 read from the phone's kept copies and from the server's instant kept copies (`/api/departures` with the Watch or widget flag returns a kept copy at once). Check: the phone app's own board is fresh (if not, it is live data, above), then `/api/health` and the cron (`lastTick` within 2 minutes, section 13). iOS limits how often widgets refresh (a budget per day); a widget a few minutes old is iOS, not us. The real fix (the phone sends times to the Watch, widgets get pushed) is build 209 ([WIDGET_WATCH_SPEED.md](WIDGET_WATCH_SPEED.md)).

**Trip card (Live Activity) stopped updating.** `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/admin/live-activity` lists cards and Apple's last answer. `BadDeviceToken` or 410 means the card ended on the phone. `ExpiredProviderToken` fixes itself; if it repeats, check the `APNS_KEY` secret (section 11).

**Budget meter over 80% pace.** Section 6.

## 11. Credentials: list, where each lives, rotation

Names and places only, never values. The operator machine is the build box the workers run on; its private folder `~/.nsw-secrets/` (mode 700, files mode 600) and the deploy checkout's `backend/.env` (git ignored; the operator copy is `~/nsw-backend/.env`) hold the operator copies.

| Credential | Used for | Where it lives | Rotate |
| --- | --- | --- | --- |
| `TFNSW_API_KEY` | Transport for NSW Open Data (Bronze, 60,000 a day) | Worker secret; `backend/.env`; GitHub Actions secret `TFNSW_API_KEY` (timetable workflow) | opendata.transport.nsw.gov.au (user bidurtab), API tokens: new token, `wrangler secret put`, update the repo secret, then revoke the old |
| `ADMIN_KEY` | Admin and test endpoints (`x-admin-key`) | Worker secret; `backend/.env` | Table below |
| `TICK_KEY` | The minute tick on the first address (cron-job.org) | Worker secret; `backend/.env`; cron-job.org job header | Table below |
| `ENGINE_LOAD_KEY` | Loading timetable and planner packs | Worker secret; GitHub Actions secret `ENGINE_LOAD_KEY` | New random value: `wrangler secret put ENGINE_LOAD_KEY`, then the repo secret, same minute |
| `SHARE_FALLBACK_BASE` | Where shared links of the first address are read | Worker secret | Only if the first address moves |
| `APNS_KEY` (Key ID 69AK74573Z) | Trip card pushes | Worker secret; `.p8` in `~/.nsw-secrets/` | Table below |
| `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` | Web Push | Worker secrets; `backend/.env` | Table below |
| Cloudflare API token (deploy) | wrangler deploys, DNS, Pages | `~/.nsw-secrets/cloudflare.json` (`api_token`, with `account_id`, `zone_id`); `CLOUDFLARE_API_TOKEN` in the deploy environment | Dashboard, My Profile, API Tokens, Roll |
| Cloudflare analytics token (read only) | Usage checks (`tools/orient.mjs`), the budget guard | Worker secret `CF_ANALYTICS_TOKEN`; `~/.nsw-secrets/cloudflare-analytics.json` (`api_token`; scope Account Analytics Read only; made 26 Oct) | Dashboard, My Profile, API Tokens, Roll; then `wrangler secret put CF_ANALYTICS_TOKEN` and the file |
| Cloudflare dashboard login and 2FA | Billing and settings | Operator vault login; TOTP seed in `~/.nsw-secrets/cloudflare-2fa.json` | Dashboard, My Profile, Authentication |
| Expo robot token | `eas update`, `eas build`, `eas submit` | `~/.nsw-secrets/expo.json` (`access_token`) | "Expo token rotation" below |
| App Store Connect API key | Builds, TestFlight, metadata | `~/.nsw-secrets/asc.json` and its `.p8` beside it; GitHub Actions secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` | App Store Connect, Users and Access, Integrations: revoke and generate; update both places |
| iPhone distribution certificate and profiles | Signing | Expo project credentials; copies in `~/.nsw-secrets/ios-expo/` | Expo credentials, or Apple Certificates, Identifiers and Profiles |
| Android upload keystore (`nsw-transport-release.jks`, alias `nswtransport`) | Signs every APK and AAB | `~/.nsw-secrets/` with `android-keystore.json` (passwords); a copy with the owner | Cannot be replaced freely: Play upload key reset only. Keep two backups |
| Google Play service account | `store/play-upload.mjs` | `~/.nsw-secrets/play-service-account.json` | Google Cloud console, the service account, Keys |
| Google account for Play Console work | Play Console sign in | Operator vault login | Google account settings |
| cron-job.org login and API key | Minute tick of the first address (job 8707266) | Credentials email; operator notes | console.cron-job.org, Settings |
| GitHub | The repo | The owner's account `MaisySen`, connected by authorization; no token stored in the project | The owner revokes the authorization in GitHub settings |
| Mailboxes | support@, privacy@, hello@transportsydney.app forward to the Fintex mailbox | Cloudflare Email Routing | Cloudflare, Email, Routing rules |

**The credentials email rule.** Whenever a credential is created, changed or revoked, email the full, current credentials list (all of them, organised by service) to the owner's ops email. The address is in the operator notes, not in this repo, because it is personal. Send it from the operator's own mailbox, then note the date in [STATE.md](STATE.md). The email holds values; the repo never does.

Rotate when a key may have leaked, when someone who had it leaves, or once a year. After each rotation, send the credentials email (rule above).

| Secret | How to rotate | Also update |
| --- | --- | --- |
| `TFNSW_API_KEY` | opendata.transport.nsw.gov.au, sign in, My account, API tokens: create a new token, then revoke the old one after the deploy | `cd backend && npx wrangler@4 secret put NAME` (also `backend/.env` while the first address runs) |
| `ADMIN_KEY` | Generate 24 random characters (`node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`) | `cd backend && npx wrangler@4 secret put NAME` (also `backend/.env` while the first address runs) |
| `APNS_KEY` | The Apple push key (.p8, Key ID 69AK74573Z, team B85KQRQZW7) from Certificates, Identifiers and Profiles, Keys. To replace it: make a new key with Apple Push Notifications service, set `APNS_KEY_ID` in `wrangler.toml.template`, then revoke the old key | `cd backend && npx wrangler@4 secret put APNS_KEY < AuthKey_XXXX.p8` (the file text, never committed) |
| `TICK_KEY` | Same as ADMIN_KEY | `npx wrangler@4 secret put TICK_KEY`; while the first address runs, also its `.env` and the cron-job.org job header |
| `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` | `node backend/tools/vapid.mjs` | `npx wrangler@4 secret put` for both keys. Existing Web Push subscriptions stop working; each browser must turn alerts on again |
| Cloudflare API token | My Profile, API Tokens: Roll | `~/.nsw-secrets/cloudflare.json` and the deploying environment (`CLOUDFLARE_API_TOKEN`) |
| `ENGINE_LOAD_KEY` | Same as ADMIN_KEY | `npx wrangler@4 secret put ENGINE_LOAD_KEY` and the GitHub Actions secret of the same name, in the same minute |
| Expo access token | See "Expo token rotation" below | `/home/user/.nsw-secrets/expo.json` (`access_token`) on the build machine, passed as `EXPO_TOKEN` |
| cron-job.org password and API key | console.cron-job.org, Settings | Credentials email (operator notes) |
| Android upload key | Cannot simply be replaced. If it is lost or leaked, ask Google Play for an upload key reset (needs Play App Signing). Keep two backups of the `.jks` and its password | |
| App Store Connect API key | App Store Connect, Users and Access, Integrations: generate a new key, update both places, then revoke the old | `~/.nsw-secrets/asc.json` and its `.p8`; repo secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` |


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

## 12. Public site (transportsydney.app)

```bash
cd backend && node tools/deploy-site.mjs     # site/ to Cloudflare Pages (transportsydney.app and www); needs CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID
for p in / /support/ /privacy/ /terms/; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://transportsydney.app$p)"; done   # 200 each
```

**Rollback:** For the site, Cloudflare Pages, project `transportsydney`, Deployments, Rollback, or `POST /accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/<id>/rollback`; the deployment ids are in docs/RELEASES.md. The zone caches CSS at the edge for up to 4 hours and the token cannot purge it, so give a changed stylesheet a new file name (the home page uses `site/home.css` for this reason; rules added later are in `site/extra-1.css`).

### Current deployment, rollback and SEO checklist

Current production deployment: `202d89e9-fd1f-4253-83b1-7d02ad00d17f` (27 Oct, 12:56 PM, privacy policy discloses crash reports). Roll back to the one before it (`462d58fc-28e0-4aba-b6b8-4249f5921f9d`, the 26 Oct privacy update): Cloudflare dashboard, Workers and Pages, `transportsydney`, Deployments, 462d58fc, Rollback, or

```bash
curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/462d58fc-28e0-4aba-b6b8-4249f5921f9d/rollback"
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

## 13. Minute scheduler, stats and contact messages

On Cloudflare a Cron Trigger runs the tick every minute (`[triggers]` in `wrangler.toml.template`). It drives watch alerts, commute alerts, morning checks, delay sampling and data clean up.

* Trip card pushes (build 205): `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/admin/live-activity` lists the cards and what Apple said; `curl -s -X POST -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/admin/live-activity` sends the newest active card a test update (its warning line reads "Server test" and the time). See [API](API.md).
* Healthy (also in `node tools/orient.mjs`): `curl -s -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/usage` shows `lastTick` within the last two minutes. Without the key, `/api/usage` only shows the count of recorded live times, and `/api/health` answers 403.
* If it is stale: Cloudflare dashboard, Workers and Pages, `transport-api`, Settings, Trigger Events: the cron must be listed; Logs shows each run.
* The first address is ticked by an outside cron service (cron-job.org job 8707266). Since 26 Oct the updated apps read from api.transportsydney.app (with the first address as a read fallback); builds without that update still save watches and morning checks on the first address, so keep the job running until the first address has had no saves for a few days, then pause it and retire the address (see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md), section 9).
* Fallback: an open app calls `/api/watches`, which runs a tick for its own device when the scheduler is quiet for more than 100 seconds.
* Budget: `/api/usage` with the admin key also shows upstream calls today against 60,000. Sampling stops at 40,000 and watches at 56,000. Shared live answers are cached at the edge for 15 seconds, and each address is limited to 120 upstream calls and 60 writes a minute across all copies of the worker (D1 table `ip_rate`).

Stats and messages:

* Page counter: `curl -H "x-admin-key: $ADMIN_KEY" "https://api.transportsydney.app/api/stats?days=30"`
* Contact form messages: `curl -H "x-admin-key: $ADMIN_KEY" https://api.transportsydney.app/api/feedback`; delete one with `DELETE ...?id=N` and the same header.
