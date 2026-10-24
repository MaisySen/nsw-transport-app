# Transport: live Sydney and NSW public transport

Transport shows live departures, plans trips with any number of legs, follows a trip and tells you when to leave, and answers plain questions like "campsie to newcastle via chatswood". It runs on the web, on Android and on iPhone. All three talk to one backend, which reads Transport for NSW open data.

Owner: Bidur. Repository: https://github.com/MaisySen/nsw-transport-app (public).

## Live links

| What | Link |
| --- | --- |
| Web app | https://nsw-transport-bot.sites.tab.bot |
| Landing page | https://nsw-transport-bot.sites.tab.bot/?about |
| Android download | https://nsw-transport-bot.sites.tab.bot/download/ |
| Android APK (direct) | https://nsw-transport-bot.sites.tab.bot/download/transport.apk |
| iPhone builds (unsigned .ipa) | https://github.com/MaisySen/nsw-transport-app/releases |
| Support | https://nsw-transport-bot.sites.tab.bot/support/ |
| Privacy policy | https://nsw-transport-bot.sites.tab.bot/privacy/ |
| Terms | https://nsw-transport-bot.sites.tab.bot/terms/ |
| Backend health | https://nsw-transport-bot.sites.tab.bot/api/status |
| Expo project | https://expo.dev/accounts/bidurtab/projects/nsw-transport |

## What is in this repo

| Folder | What it is |
| --- | --- |
| `backend/` | The engine: a Cloudflare style Worker (`src/worker.js`) with a D1 database and an R2 file store, plus the web app and site pages in `src/public/`. Every client calls its `/api` endpoints. |
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

### Backend and web app

Needs Node 20 or later.

```bash
cd backend
# create .env with the six values named in docs/SECURITY.md (never commit it)
node build.mjs site         # writes site/ with the static files and worker.mjs
node --test test/           # unit tests
```

The built `site/` folder is what gets published. See [Runbook](docs/RUNBOOK.md) for the publish step and for local preview.

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
