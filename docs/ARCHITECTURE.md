# Architecture

One backend does all the work. The web app, the Android app and the iPhone app are thin clients that call its `/api` endpoints. Updated 24 Oct 2026.

```
 Transport for NSW Open Data                 cron-job.org (every minute)
 (trip planner, GTFS realtime,                        |
  vehicle positions, alerts)                          | GET /api/tick (x-admin-key)
            ^                                         v
            |  API key (server only)        +-------------------------+
            +-------------------------------|  Backend Worker          |
                                            |  backend/src/worker.js   |
                                            |  D1 database, R2 files   |
                                            |  static site and web app |
                                            +-----------+-------------+
                                                        | HTTPS JSON
             +--------------------+---------------------+--------------------+
             |                    |                                          |
        Web app (PWA)       Android app (Expo)                         iPhone app (SwiftUI)
        src/public/         app/  EAS Update                           ios-native/  GitHub Actions
        Web Push            Expo push                                  widgets, Live Activity, Siri
```

## Backend: the engine

* **Code:** `backend/src/worker.js`, one file of about 3,400 lines. Routes are a `switch` on the path inside `fetch()`. The Ask chat lives between the markers `// ---- ask v2 start` and `// ---- ask v2 end`.
* **Runtime:** a Worker (Cloudflare Workers API, `nodejs_compat`, compatibility date 2026-08-01), hosted on Tab's site hosting at `nsw-transport-bot.sites.tab.bot`. `backend/build.mjs` writes the deployable `site/` folder: static files, `worker.mjs` with secrets filled in, and `tab-site.json` naming the bindings.
* **Bindings:** `DB` (D1 database) and `FILES` (R2 bucket that holds the Android APK).
* **Secrets:** filled in at build time from `backend/.env`: `TFNSW_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `TICK_KEY`, `ADMIN_KEY`. The source in git holds only placeholders like `__ADMIN_KEY__`. See [Security](SECURITY.md).
* **Caching:** in memory per isolate (stop boards for 12 seconds, realtime feeds briefly). The hosting does not allow the default cache.
* **Static data:** station lists (`src/public/stations/`, built by `tools/build_stations.py` from the TfNSW GTFS timetable: 359 train, 31 metro, 78 ferry and 63 light rail stations, 931 bus routes), the suburb list for Ask (`stations/places.json`, 5,087 suburbs and localities, `tools/build_places.py`) and stop search data (`src/public/stops/`, `tools/build_stops.py`). The generated JSON is not committed; rebuild it with the scripts.

### D1 tables

| Table | Holds |
| --- | --- |
| `saved`, `saved_legs` | Saved trips per profile, including multi leg trips |
| `searches` | Recent trip searches per profile (deleted after 90 days), used for commute memory |
| `commutes`, `dismissed` | Commutes and dismissed suggestions |
| `watches`, `notes` | Watched trips with their live snapshot, and every alert sent (finished watches deleted after 30 days) |
| `push_subs`, `expo_tokens` | Web Push subscriptions and Expo push tokens per device |
| `obs` | Recorded live times at busy stops, used for delay predictions |
| `usage`, `meta` | Daily upstream call counts, last tick time, the scheduler lease |
| `hits` | Page counter: one total per day, page and referring site. No cookies, IP or IDs |
| `feedback` | Messages from the contact form on /support/ |

### The scheduler

Worker sites here have no cron of their own, so cron-job.org calls `GET /api/tick` with `TICK_KEY` in an `x-admin-key` header every minute (job "NSW Transport Bot heartbeat"). Each tick follows every active watch and commute, sends alerts, samples a few busy stops for the delay history and runs the retention clean up. A D1 lease stops two ticks overlapping. If the scheduler goes quiet for more than 100 seconds, an open app's `/api/watches` call runs a tick for its own device.

### Notifications

Every alert goes to each place a device is registered: Web Push (VAPID, ES256, aes128gcm payload encryption, written with WebCrypto, no libraries) and Expo push (APNs for iPhone, FCM for Android). Alerts are also stored in `notes`, so an app that missed a push shows them as a banner.

## Data sources

All from the Transport for NSW Open Data Hub (`api.transport.nsw.gov.au`), one API key, Bronze plan (60,000 calls a day, 5 a second).

| Source | Used for |
| --- | --- |
| Trip Planner API (`/v1/tp/`: stop finder, departure monitor, trip, service alerts) | Stop search, boards, trip plans, alerts |
| GTFS realtime trip updates (`/v2/gtfs/realtime/sydneytrains`, `metro`, `lightrail/innerwest`; `/v1/gtfs/realtime/buses`, `ferries/sydneyferries`, `lightrail/cbdandsoutheast`, `newcastle`, `parramatta`) | Live times the trip planner is missing, matched by trip id |
| GTFS realtime vehicle positions (same modes, `vehiclepos`) | Live vehicle on the map, crowding |
| GTFS static timetable (offline, via the build scripts) | Station lists, bus routes and their stops |
| OpenStreetMap (map tiles on web, MapLibre on Android) | Maps. Apple Maps on iPhone |

## Clients

### Web app (`backend/src/public/`)

* Plain JavaScript, no framework: `app.js` (Trips, Search, Watching, Settings, trip and service screens), `ask.js` (Ask chat), `sw.js` (offline shell, caches only `/`), `hit.js` (page counter).
* Routes are hash based: `#/`, `#/search`, `#/ask`, `#/watching`, `#/settings`, `#/stop/...`, `#/trip...`, `#/alerts`, `#/near`.
* First time visitors in a browser see a landing page; the installed app, deep links and returning users go straight into the app. `/?about` always shows the landing page.
* Site pages: `/download/`, `/support/` (with a contact form and `/support/thanks/`), `/privacy/`, `/terms/`, a custom 404, `robots.txt`, `sitemap.xml`, `og.png`.

### Android app (`app/`)

* Expo SDK 58, React Native 0.88, React 19, TypeScript, expo-router. Package `com.maisysen.nswtransport`, versionName 1.0.0, versionCode 4, target API 36, minimum Android 7.0 (API 24).
* Routes in `src/app`: `(tabs)/home`, `(tabs)/search`, `(tabs)/ask`, `(tabs)/watching`, `(tabs)/settings`, `stop/[id]`, `trip`, `service`, `watch/[id]`. API client and helpers in `src/lib`.
* Native extras: the Next trip home screen widget (config plugin in `plugins/`).
* Updates: EAS Update, project id `cf1f4c4c-5157-41bf-a254-4480223f6368`, owner `bidurtab`. Channel `production` (runtime 1.0.0) for the installed APK; channel `expo-go` (runtime exposdk:58.0.0) for the iPhone preview in Expo Go. The app checks for an update each time it opens.
* Signing: one upload key (`nsw-transport-release.jks`, alias `nswtransport`), kept outside the repo.

### iPhone app (`ios-native/`)

* SwiftUI, iOS 17.0 and later, iPhone only. Bundle id `com.maisysen.nswtransport`, widget `com.maisysen.nswtransport.widget`, app group `group.com.maisysen.nswtransport`. Version 1.0, build 8.
* Targets: `Transport` (the app: Home, Search, Ask, Watching, Settings, new trip flow, Siri intents, background refresh), `TransportKit` (API client and models shared with the widget), `TransportWidget` (widgets and the trip Live Activity).
* Project generated by XcodeGen from `project.yml`. Privacy manifests for the app and the widget.

## CI

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ios-native.yml` | Push to `main` touching `ios-native/`, or manual | Builds for simulator and device (unsigned, Release compiles one file at a time), runs XCUITest flows in light and dark on an iPhone 16 Pro simulator, renders widget snapshots, takes App Store screenshots at 6.9 and 6.5 inch, writes a report to the `ci-out` branch and publishes `ios-native-build-N` with `Transport-unsigned.ipa` |
| `ios-testflight.yml` | Manual | Signs with an App Store Connect API key and uploads to TestFlight. Needs four repo secrets (see [Store](STORE.md)) |

The repo is public, so GitHub's macOS runners are free. Android builds and web publishes run on the build box, not in CI (see [Runbook](RUNBOOK.md)).

## Hosting

| Part | Where |
| --- | --- |
| Backend, web app, site pages | Tab site hosting, `nsw-transport-bot.sites.tab.bot` (Worker with D1 and R2). No separate account or bill |
| Android APK | R2 bucket `FILES`, served at `/download/transport.apk` with range support |
| Android over the air updates | Expo (EAS Update), account `bidurtab` |
| iPhone builds | GitHub Releases on this repo |
| Scheduler | cron-job.org, free plan |
| Source | GitHub, `MaisySen/nsw-transport-app` (an older v1 copy of the backend is in the private repo `MaisySen/nsw-transport-bot`) |
