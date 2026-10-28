# Transport: Sydney Live

Transport: Sydney Live shows live departures with honest live labels (Live, Timetable, Not tracking), plans trips with any number of legs, finds buses by stop number and route, follows a trip and tells you when to leave, reminds you on the days you choose, and answers plain questions like "campsie to newcastle via chatswood". It runs on iPhone and Android from one Expo app. Both talk to one backend, which reads Transport for NSW open data. No account, no ads, no tracking.

What it does today, feature by feature: [docs/FEATURES.md](docs/FEATURES.md).

**New here? Start with [docs/START_HERE.md](docs/START_HERE.md)**, then run `node tools/orient.mjs` and read [docs/STATE.md](docs/STATE.md).

Owner: Bidur. Repository: https://github.com/MaisySen/nsw-transport-app (public).

## Live links

| What | Link |
| --- | --- |
| Website (features, iPhone beta, support, privacy, terms) | https://transportsydney.app |
| iPhone public beta (TestFlight) | https://testflight.apple.com/join/ZKZY7PKX |
| Support | https://transportsydney.app/support/ (support@transportsydney.app) |
| Privacy policy | https://transportsydney.app/privacy/ |
| Terms | https://transportsydney.app/terms/ |
| API | https://api.transportsydney.app (health: `/api/health`, 403 without the admin key; full check: `node tools/verify-deploy.mjs`) |
| Android APK (direct) | https://api.transportsydney.app/download/transport.apk |
| Expo project | https://expo.dev/accounts/bidurtab/projects/nsw-transport |

Publisher: Fintex Australia Pty Ltd (ABN 60 688 406 108), https://fintex.au.

## What is in this repo

| Folder | What it is |
| --- | --- |
| `backend/` | The engine: a Cloudflare Worker (`src/worker.js`) with a D1 database, a Cron Trigger and an optional R2 file store, at api.transportsydney.app. Every client calls its `/api` endpoints. `src/public/` holds the data files it reads, the shared live trip page and the older web app files (served only on the first address until the switch). |
| `site/` | The public website at transportsydney.app: plain files on Cloudflare Pages, no build step. |
| `app/` | The Expo (React Native, TypeScript, expo-router) app. Ships as the Android app and as the iPhone app (EAS Build, TestFlight builds 201 and later); JavaScript changes reach both as over the air updates. `app/targets/` holds the iPhone widgets, Live Activity and Apple Watch app; `app/modules/transport-ios/` the native bridge. |
| `ios-native/` | The earlier native iPhone app in SwiftUI (builds up to 104, GitHub macOS runners). No longer shipped: the iPhone app has been built from `app/` since build 201. Kept for reference. |
| `store/` | App Store and Google Play listing pack, screenshots, privacy answers and the policy audit. |
| `SUBMIT.md` | Store submission steps for both stores. |
| `.github/workflows/` | Backend tests (`backend.yml`), the Android App Bundle release (`android-aab-release.yml`) and the older SwiftUI build and TestFlight workflows (`ios-native.yml`, `ios-testflight.yml`). |
| `docs/` | Project documentation, listed below. |

## Documentation

| Document | What it covers |
| --- | --- |
| [Start here](docs/START_HERE.md) | The one page entry point: state, standing rules, first commands, every doc |
| [State](docs/STATE.md) | What is live now, flags, open bugs, what waits on the owner, what is next |
| [Decisions](docs/DECISIONS.md) | Every owner decision with its date and reason |
| [Worker guide](docs/WORKER_GUIDE.md) | How parallel workers share the repo: clones, rebase, areas, tests, style |
| [Features](docs/FEATURES.md) | What the app does today, where to find it, what needs build 208 or 209 |
| [Requirements](docs/REQUIREMENTS.md) | Every feature by version, with status per platform |
| [Architecture](docs/ARCHITECTURE.md) | How the parts fit: backend, data sources, clients, CI, hosting |
| [API](docs/API.md) | Every `/api` endpoint with parameters and examples |
| [Test plan](docs/TEST_PLAN.md) | Unit tests, browser checks, device checks and known failures |
| [Releases](docs/RELEASES.md) | iPhone builds, Android versions, over the air updates and web publishes, with rollback commands |
| [Changelog](CHANGELOG.md) | What changed, newest first |
| [Runbook](docs/RUNBOOK.md) | Every routine operation and incident, as copy and paste steps with checks and rollback |
| [Costs](docs/COSTS.md) | The US$5 a month budget, usage against the included amounts, the budget guard |
| [Deploy on Cloudflare](docs/DEPLOY_CLOUDFLARE.md) | The API Worker, the public site on Pages, DNS, email, checks after each deploy |
| [Performance](docs/PERFORMANCE.md) | Battery rules for polling, location, widgets and the watch |
| [iOS 26 and 27](docs/IOS27.md) | Liquid Glass, the floating tab bar and resizable windows |
| [Live labels](docs/LIVE-LABELS.md), [Reminders](docs/REMINDERS.md), [Home](docs/HOME-REDESIGN.md), [Watch](docs/WATCH.md) | One feature each |
| [Store](docs/STORE.md) | App Store and Google Play status and what is waiting on Bidur |
| [Store privacy](docs/STORE_PRIVACY.md) | What the app and server keep, and the App Privacy and Data safety answers |
| [Review notes](docs/APP_REVIEW_NOTES.md) | The App Review notes text, every server feature and its switch, and when to change it |
| [Roadmap](docs/ROADMAP.md) | Done today, open items and what comes next |
| [Security](docs/SECURITY.md) | Where secrets live (by name only) and how to rotate them |
| [Engine](docs/ENGINE.md), [Scaling](docs/SCALING.md), [Scale to 1M](docs/SCALE_1M.md), [Lag diagnosis](docs/DIAGNOSIS_LAG.md), [Timetable packs](docs/TIMETABLE_PACKS.md), [Widget and Watch speed](docs/WIDGET_WATCH_SPEED.md) | The board engine, limits, the million user plan (paper only), why the app lagged on 26 Oct, timetables on the phone |

## Run each part

### Backend

Needs Node 20 or later.

```bash
cd backend
node --test test/*.test.mjs             # unit tests
node build.mjs --cloudflare dist        # dist/worker.mjs and dist/public, no secrets in them
tools/deploy-cloudflare.sh --dry-run    # everything short of deploying
```

Deploying, DNS, email and the switch to the new address: [Deploy on Cloudflare](docs/DEPLOY_CLOUDFLARE.md). Day to day: [Runbook](docs/RUNBOOK.md).

### The app (Expo, iPhone and Android)

```bash
cd app
npm ci
npx tsc --noEmit                        # type check
OFFLINE=1 node --test test/*.test.mjs   # logic tests, including test/battery.test.mjs
npx expo start                          # dev server; open in an emulator or the web preview
./build-android.sh                      # signed release APK (needs the keystore on the build machine)
./build-android-aab.sh                  # signed App Bundle for Google Play
```

JavaScript only changes reach installed apps on both platforms as an EAS Update (preview first, then production); iPhone builds are made with EAS Build. Both are in the [Runbook](docs/RUNBOOK.md).

## Data and licence

Live data comes from the Transport for NSW Open Data Hub under Creative Commons Attribution 4.0. Transport is not made or endorsed by Transport for NSW. Map data on the web and Android is from OpenStreetMap contributors. Attribution text: [store/attribution.md](store/attribution.md).

Publisher: Fintex Australia Pty Ltd (ABN 60 688 406 108), New South Wales, Australia. https://fintex.au

Contact: contact@fintex.au
