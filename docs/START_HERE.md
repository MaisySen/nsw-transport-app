# Start here

The one page to read first. It is enough to start work on Transport: Sydney Live without asking the owner anything. Last checked 26 Oct 2026, 4:15 PM Sydney. Live numbers change all day: run `node tools/orient.mjs` for the current ones, and read [STATE.md](STATE.md) for open work.

## What this is

Transport: Sydney Live is a free public transport app for NSW: live departures with honest live labels (Live, Timetable, Not tracking), trip planning, trip following with alerts, a rule based Ask box, widgets, a Live Activity and an Apple Watch app. No account, no login, no ads, no tracking. Data is Transport for NSW Open Data (CC BY 4.0).

| | |
| --- | --- |
| Owner | Bidur (decides everything in [DECISIONS.md](DECISIONS.md)) |
| Publisher | Fintex Australia Pty Ltd, ABN 60 688 406 108, https://fintex.au |
| Repo | https://github.com/MaisySen/nsw-transport-app, **public**: no secret value ever goes in it |
| Website | https://transportsydney.app (Cloudflare Pages project `transportsydney`, files in `site/`) |
| API | https://api.transportsydney.app (Cloudflare Worker `transport-api`, code in `backend/`) |
| iPhone | App Store Connect app 6826543653, bundle `com.maisysen.nswtransport`, TestFlight public link https://testflight.apple.com/join/ZKZY7PKX. Not submitted for App Store review |
| Android | Application id `com.maisysen.nswtransport`, versionCode 5, APK at https://api.transportsydney.app/download/transport.apk. Not on Google Play yet |
| Expo | Account `bidurtab`, project `nsw-transport` (id `cf1f4c4c-5157-41bf-a254-4480223f6368`) |
| Old host | `nsw-transport-bot.sites.tab.bot`, the first address. Switched off 30 Oct 2026: it only forwards to api.transportsydney.app (its /api paths) and transportsydney.app (pages) since 30 Oct 2026. Old builds still reach the live server through it. Never deploy to it |

## Current state (26 Oct, 4:15 PM)

* **App binaries:** iPhone builds 201 to 208 are in the field (208 is the newest, built 25 Oct 6:48 PM from branch `native-207`). Android versionCode 2 to 5. Version and runtime are 1.0.0 on all of them and must stay 1.0.0. The Expo plan's 15 iPhone builds for October are used up, so the next iPhone build is **build 209 on 1 Nov**; everything native waits for it ([IOS27.md](IOS27.md), "Build 209").
* **Over the air updates:** channel and branch `production` (everyone), `preview` (checked before production), `expo-go`. Production group now: `fa0017d8-4ffe-49e7-91da-3b415254943f` (26 Oct 3:39 PM, outage honesty). Its rollback target is `1f117d04-ee6c-4149-b153-b32fe8f1db79`. The chain, newest first, is the table in [RELEASES.md](RELEASES.md), "Over the air updates". To read the live group without any token: `node tools/orient.mjs` (it reads the manifest the phones read).
* **Server:** Worker `transport-api` on the Fintex Cloudflare account, Workers Paid (US$5 a month) since 26 Oct 9:06 AM, D1 database `transport`, Durable Objects `BoardEngine`, `BoardShard`, `LiveHub`, `TripPlanner`, a cron every minute. Deploys are listed newest first in [RELEASES.md](RELEASES.md), "Web", and by `node tools/orient.mjs`.
* **Live vs behind flags** (checked on the Worker at 4:10 PM; [STATE.md](STATE.md) has the table):
  * Live for everyone: departures and trips from the Transport for NSW Trip Planner with the outage fallback (timetable trips and boards, Nearby from our own stops, honest messages), shared edge copies for 15 s, per request log lines (`REQ_LOG=on`), instant kept copies for the Watch and widgets, `liveAt` on every live row, the timetable on the phone for saved stops.
  * Built but off: board engine serving boards (`ENGINE_BOARDS=off`), engine push and feed timing (`ENGINE_PUSH`, `ENGINE_FEED_TIMING` not set, so off), live push for Trip Planner boards (`LIVE_PUSH=off`), our own trip planner (`OWN_PLANNER=off`), app side live push (remote config `flags.livePush` absent), data age per row on the phone (`LIVE_DATA_AGE=false` in `app/src/lib/features.ts`). Platform view was removed from the app on 26 Oct (owner).
* **Transport for NSW key:** Bronze plan, 60,000 calls a day, resets at midnight AEST, which is **1 AM AEDT**. On 26 Oct it ran out at about 1:25 PM; the owner asked NSW for 1,000,000 a day at 2:46 PM (no reply yet).

## Standing rules (full list with reasons: [DECISIONS.md](DECISIONS.md))

1. No secret values in the repo, commits, logs or screenshots. Name where a secret lives, never the value ([SECURITY.md](SECURITY.md)).
2. Cloudflare stays at US$5 a month with no overage, built for up to 1,000 people. No load tests on production or with the production NSW key ([COSTS.md](COSTS.md) when present, [RUNBOOK.md](RUNBOOK.md) section 9).
3. JavaScript only, shipped over the air. No new native module and no EAS build until build 209 on 1 Nov. Feature detect every native call.
4. At most one over the air update a day, published overnight (after 10 PM). Preview first, then production.
5. Never change `version` (1.0.0) or the runtime. Never submit for App Store review, change pricing, or create store records without the owner's OK.
6. No D1 migrations without asking. Never deploy an older tree over a newer deploy. Never deploy the old host.
7. The board engine serves phones only after it matches the Trip Planner on 95% or more and the owner agrees. Platform view was removed on 26 Oct (owner).
8. Battery first: no `setInterval`, no `useNow(1000)`, no high accuracy location, no new background modes. `app/test/battery.test.mjs` must pass.
9. No em or en dashes anywhere. Plain words, no filler. No hard coded content or example times. No ads, no login, no AI model in Ask, no Transport for NSW branding. Apple HIG on iPhone, Material 3 on Android. Never name another transport app in the UI, code or commits.
10. When a credential is created or changed, the full credentials list is emailed to the owner's ops email (address in the operator notes, not in this repo).

## First 10 commands

```bash
git clone https://github.com/MaisySen/nsw-transport-app.git && cd nsw-transport-app   # 1. clone (or git pull --rebase)
node tools/orient.mjs                                    # 2. live state: OTA group, deploys, flags, health, NSW calls, Cloudflare usage
(cd backend && node --test test/*.test.mjs 2>&1 | grep -E '^# (pass|fail)')   # 3. backend tests: fail 0
(cd app && npm ci)                                       # 4. app dependencies (about 1 GB; delete node_modules when done)
(cd app && npx tsc --noEmit)                             # 5. type check: no output
(cd app && OFFLINE=1 node --test test/*.test.mjs 2>&1 | grep -E '^# (pass|fail|skipped)')   # 6. app tests incl. battery: fail 0
curl -s "https://api.transportsydney.app/api/app/config?platform=ios"     # 7. remote config the phones read
curl -s -o /dev/null -w '%{http_code}\n' https://api.transportsydney.app/api/health   # 8. 403 without the key (healthy)
git log --oneline -15                                    # 9. what the other workers just did
sed -n '1,40p' CHANGELOG.md                              # 10. newest changes, with rollback commands
```

`node tools/orient.mjs` reads the Cloudflare and admin keys from the environment (`CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, `ADMIN_KEY`) or from the operator's private files, and skips what it cannot read. It changes nothing and never calls Transport for NSW.

## Every other doc

| Doc | Read it when |
| --- | --- |
| [STATE.md](STATE.md) | Always, second: flags, deploy ids, open bugs, what waits on the owner, what is scheduled next |
| [RUNBOOK.md](RUNBOOK.md) | Doing anything: OTA, deploy, flags, quota, budget, packs, builds, store steps, incidents, credentials |
| [DECISIONS.md](DECISIONS.md) | Before changing behaviour: every owner decision with its date and reason |
| [WORKER_GUIDE.md](WORKER_GUIDE.md) | Working beside other workers on the same repo: clones, rebase, areas, tests, style |
| [FEATURES.md](FEATURES.md) | What the app does today, screen by screen |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the parts fit |
| [API.md](API.md) | Every `/api` endpoint |
| [ENGINE.md](ENGINE.md), [SCALING.md](SCALING.md), [SCALE_1M.md](SCALE_1M.md), [COSTS.md](COSTS.md) | Board engine, limits, the million user plan (paper only), the US$5 budget |
| [DIAGNOSIS_LAG.md](DIAGNOSIS_LAG.md), [PERFORMANCE.md](PERFORMANCE.md), [WIDGET_WATCH_SPEED.md](WIDGET_WATCH_SPEED.md), [TIMETABLE_PACKS.md](TIMETABLE_PACKS.md) | Speed, battery, Watch and widgets |
| [TEST_PLAN.md](TEST_PLAN.md) | Tests, browser checks, device checklists |
| [RELEASES.md](RELEASES.md), [../CHANGELOG.md](../CHANGELOG.md) | Every build, update and deploy with rollback |
| [IOS27.md](IOS27.md) | iOS 26 and 27 notes and the build 209 list |
| [SECURITY.md](SECURITY.md) | Where each secret lives and how to rotate it |
| [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) | First time Cloudflare setup, DNS, email, the switch from the old host |
| [STORE.md](STORE.md), [STORE_READINESS.md](STORE_READINESS.md), [STORE_PRIVACY.md](STORE_PRIVACY.md), [REVIEW-NOTES.md](REVIEW-NOTES.md), [../SUBMIT.md](../SUBMIT.md) | App Store and Google Play |
| [REQUIREMENTS.md](REQUIREMENTS.md), [ROADMAP.md](ROADMAP.md) | Feature list by version, what comes next |
| [WATCH.md](WATCH.md), [LIVE-LABELS.md](LIVE-LABELS.md), [REMINDERS.md](REMINDERS.md), [HOME-REDESIGN.md](HOME-REDESIGN.md), [CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md), [LAST-WAY-HOME.md](LAST-WAY-HOME.md), [PLAN-B.md](PLAN-B.md), [TRACKWORK.md](TRACKWORK.md), [WHY-LATE.md](WHY-LATE.md) | One feature each |
