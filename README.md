# Transport: live Sydney and NSW public transport

Transport shows live departures, plans trips with any number of legs, follows a trip and tells you when to leave, and answers plain questions like "campsie to newcastle via chatswood". It runs on Android and iPhone. Both talk to one backend, which reads Transport for NSW open data.

Owner: Bidur. Repository: https://github.com/MaisySen/nsw-transport-app (public).

## Live links

| What | Link |
| --- | --- |
| Website (store links, support, privacy, terms) | https://transportsydney.app |
| Support | https://transportsydney.app/support/ (support@transportsydney.app) |
| Privacy policy | https://transportsydney.app/privacy/ |
| Terms | https://transportsydney.app/terms/ |
| API | https://api.transportsydney.app (health: `/api/status`) |
| Android APK (direct) | https://api.transportsydney.app/download/transport.apk |
| iPhone builds (unsigned .ipa) | https://github.com/MaisySen/nsw-transport-app/releases |
| Expo project | https://expo.dev/accounts/bidurtab/projects/nsw-transport |

Publisher: Fintex Australia Pty Ltd (ABN 60 688 406 108), https://fintex.au.

## What is in this repo

| Folder | What it is |
| --- | --- |
| `backend/` | The engine: a Cloudflare Worker (`src/worker.js`) with a D1 database, a Cron Trigger and an optional R2 file store, at api.transportsydney.app. Every client calls its `/api` endpoints. `src/public/` holds the data files it reads, the shared live trip page and the older web app files (served only on the first address until the switch). |
| `site/` | The public website at transportsydney.app: plain files on Cloudflare Pages, no build step. |
| `app/` | The Expo (React Native, TypeScript, expo-router) app. Ships as the Android app, and as an iPhone preview in Expo Go. |
| `ios-native/` | The native iPhone app in SwiftUI, with widgets, a Live Activity and Siri shortcuts. Built on GitHub macOS runners. |
| `store/` | App Store and Google Play listing pack, screenshots, privacy answers and the policy audit. |
| `SUBMIT.md` | The exact steps left to submit to both stores once Bidur's keys arrive. |
| `.github/workflows/` | iOS build and test (`ios-native.yml`) and TestFlight upload (`ios-testflight.yml`). |
| `docs/` | Project documentation, listed below. |

## Documentation

| Document | What it covers |
| --- | --- |
| [Requirements](docs/REQUIREMENTS.md) | Every feature by version, with status per platform |
| [Architecture](docs/ARCHITECTURE.md) | How the parts fit: backend, data sources, clients, CI, hosting |
| [API](docs/API.md) | Every `/api` endpoint with parameters and examples |
| [Test plan](docs/TEST_PLAN.md) | Unit tests, UI tests, CI results and known failures |
| [Releases](docs/RELEASES.md) | iPhone builds, Android versions, over the air updates and web publishes |
| [Changelog](CHANGELOG.md) | What changed, newest first |
| [Runbook](docs/RUNBOOK.md) | How to deploy, build, update and look after each part |
| [Store](docs/STORE.md) | App Store and Google Play status and what is waiting on Bidur |
| [Roadmap](docs/ROADMAP.md) | Open items and what comes next |
| [Security](docs/SECURITY.md) | Where secrets live (by name only) and how to rotate them |

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

### Android app (Expo)

```bash
cd app
npm install
npx tsc --noEmit            # type check
npx expo start              # dev server; open in Expo Go or an Android emulator
./build-android.sh          # signed release APK (needs the keystore on the build machine)
./build-android-aab.sh      # signed App Bundle for Google Play
```

JavaScript only changes reach installed apps as an EAS Update; see [Runbook](docs/RUNBOOK.md).

### iPhone app (SwiftUI)

Every push to `ios-native/` on `main` runs `.github/workflows/ios-native.yml` on a macOS runner. It builds for the simulator and for a device, runs the UI tests in light and dark mode, takes App Store screenshots, writes a report to the `ci-out` branch and publishes an unsigned `.ipa` as a release. To build locally on a Mac:

```bash
cd ios-native
python3 Tools/make_icon.py
xcodegen generate
open Transport.xcodeproj
```

Install on a phone without the App Store: [ios-native/INSTALL.md](ios-native/INSTALL.md).

## Data and licence

Live data comes from the Transport for NSW Open Data Hub under Creative Commons Attribution 4.0. Transport is not made or endorsed by Transport for NSW. Map data on the web and Android is from OpenStreetMap contributors. Attribution text: [store/attribution.md](store/attribution.md).

Publisher: Fintex Australia Pty Ltd (ABN 60 688 406 108), New South Wales, Australia. https://fintex.au

Contact: contact@fintex.au
