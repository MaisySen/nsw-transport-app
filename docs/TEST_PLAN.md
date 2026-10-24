# Test plan

How Transport is tested, what runs where, and the current results. Updated 24 Oct 2026, 2:20 PM Sydney time.

## Levels

| Level | Where | Runs |
| --- | --- | --- |
| Backend unit tests | `backend/test/*.mjs`, Node's built in test runner | Every push touching `backend/` or `docs/` (`.github/workflows/backend.yml`), and by hand before each publish: `cd backend && node --test test/*.test.mjs` |
| iPhone UI tests (XCUITest) | `ios-native/Tests/UITests/` | Every CI run of `ios-native.yml`, in light and in dark mode |
| iPhone widget snapshot test | `ios-native/Tests/Snapshots/` | Every CI run, light pass |
| App Store screenshot run | `ios-native/Tests/UITests/StoreShots.swift` | Every CI run, 6.9 inch light and dark, 6.5 inch light |
| Expo type check | `app/`, `npx tsc --noEmit` | Before each EAS Update and APK build |
| Live checks after each web publish | curl | `/`, `/download/`, `/download/transport.apk` (206 for a range), `/privacy/`, `/support/`, `/terms/`, `/robots.txt`, `/sitemap.xml`, `/api/status`, `/api/stations`, `/api/plan`, `/api/ask` and a random path (expects the 404 page) |
| Phone size screenshots | Headless browser at phone width, light and dark | For each feature on web and on the Expo web build; looked at before shipping |
| Web route and accessibility check | Headless browser at 390 x 844, light and dark | Opens every web route (Trips, Search, Ask, Watching, Settings, a stop, a trip, the download, privacy, support, terms and live pages), fails on any page error, and runs axe (WCAG 2.2 AA) on each |
| Lighthouse (mobile) | Landing, support, privacy and web app | After site changes. Last run: 100 in all four categories on landing, support and privacy; web app 100, 100, 100 and 96 for accessibility |
| Writing style check | grep in every test file and before every push | No em dashes, no en dashes, no filler words |

## Backend unit tests

### `backend/test/ask.test.mjs`: 13 tests, 13 pass

Runs offline with recorded stop search answers in `backend/test/fixtures/stopfinder.json`.

1. Ask tab is wired into the web app
2. Ask v2 answers with reply, cards and links
3. No em or en dashes in the Ask files
4. Trip phrasings split into from, to and via (16 phrasings)
5. Bare suburbs and stations resolve to the station or suburb, never a business (49 place names)
6. Bidur's sentence plans Campsie to Newcastle Interchange via Chatswood (checks origin 219410, destination 229310, via 206710)
7. Typos and other phrasings reach the same trip
8. Unclear places get Did you mean choices instead of a guess
9. Multi stop phrasings split into from, stops and to
10. A multi stop question plans every leg, never one merged name
11. Multi stop: unclear stop asks, missing start asks, too many legs says so
12. The single via trip opens and saves as a two leg trip
13. Multi stop reply lists each leg, the changes, total time and arrival

Tests 9 to 13 came with the multi stop Ask (commit 2be460a).

A separate live list of 55 real phrasings (including "I need to go to campsie to newcastle via chatswood", typos, landmarks and suburbs that sound like other words) was run against the live `/api/ask`: 55 of 55 sensible, 7 of 7 Did you mean choices resolve.

### `backend/test/site.test.mjs`: 6 tests, 6 pass

1. Page has title, viewport and local assets: pass
2. No API key in the public files or source: pass
3. No em dashes or en dashes anywhere: pass
4. Live features are present in the app: pass (updated 24 Oct to the current `Live <time>` label)
5. Proactive layer is present: pass
6. Worker merges GTFS realtime feeds: pass

### `backend/test/ask-size.test.mjs`: 3 tests, 3 pass

1. `askSlim` keeps every field the web, Android and iPhone Ask screens read, drops the rest, and brings a 180 KB answer under 30 KB
2. Alert links are links only when they are https
3. `/api/ask` answers carry no internal error text and no top level journeys

### `backend/test/profile-copy.test.mjs`: 3 tests, 3 pass

1. Refuses a missing or wrong admin key
2. Refuses GET and short or identical ids
3. Copies rows to the new id, with fresh commute ids

## Android app logic tests

### `app/test/access.test.mjs`: 7 tests, 7 pass

Station access, Park and Ride and Opal machine helpers (`app/src/lib/access.ts`): car park names without the station name, badge, fill and totals, ticket machine wording, step free and lift out chips on trip legs, outages on a journey, https only links, the stop ids sent for lift outage alerts (digits only, at most 40), and one live check that `/api/station`, `/api/parking`, `/api/topup` and an `acc=1` trip send every field the app reads. `OFFLINE=1` skips the live check.

### `app/test/logic.test.mjs`: 10 tests, 10 pass

Run with `cd app && npm test` (Node's own test runner; the TypeScript files are transpiled on the fly). Covers money and fare wording, the Opal peak hours in Sydney time, the live trip maths (waiting until the vehicle passes your stop, next stop and stops left skipping stops it runs through, done after arrival, spare minutes with tight and missed changes, moving to the next leg), cutting the route between your stops, and one live check that plans a real trip with a Concession fare and runs its live service through the same maths. Set `OFFLINE=1` to skip the live check. `npx tsc --noEmit` must pass before any update.

## iPhone UI tests (XCUITest)

Run on an iPhone 16 Pro simulator with location set to Burwood, against the live backend. Results are written to `r2.txt` on the `ci-out` branch with per test pass or fail. Read the counts there, not only the step result, because the test steps are allowed to fail without failing the job.

| Suite | Test | What it covers |
| --- | --- | --- |
| FlowTests | test01SearchStarAndBoard | Search Central, swipe to star, open the board |
| FlowTests | test02LiveMapAndSheet | Live vehicle map and pull up sheet |
| FlowTests | test03PlanWatchAndSaveTrip | Plan Burwood to Central, watch, save |
| FlowTests | test04HomeWithSavedItems | Trips home with saved trips and stops |
| FlowTests | test05Watching | Watching tab |
| FlowTests | test06SettingsToggles | Settings switches and menus |
| FlowTests | test07DynamicIslandAndLockScreen | Live Activity on the Dynamic Island and Lock Screen |
| FlowTests | test08SwipeToDeleteAndStop | Swipe to delete a trip and stop a watch |
| FlowTests | test09Ask | Ask tab answers |
| FlowTests | test10NewTripByModeConfirmAndReorder | New trip by mode, A to Z side index, Confirm trip, reorder |
| FlowTests | test11NewBusTrip | Bus route, direction and stops |
| OfflineLaunchTests | testStartsWithoutNetwork | App starts with no server and opens every tab |
| WidgetSnapshotTests | testRenderWidgetsAndLiveActivity | Renders every widget size and the Live Activity (light pass only) |
| StoreShots | 2 tests | App Store screenshots |

### CI results

| Run | Build | Commit | Light | Dark | Result |
| --- | --- | --- | --- | --- | --- |
| [16](https://github.com/MaisySen/nsw-transport-app/actions/runs/40042846341) | 7 | e8f387f | 11 of 11 | 10 of 10 | Green, plus 3 of 3 store screenshot runs |
| [20](https://github.com/MaisySen/nsw-transport-app/actions/runs/40049991199) | 8 | ec65e4b | 12 of 13 | 11 of 12 | Build green. test10 failed in the test script: after jumping to B with the side index, Burwood was just below the screen edge. Not an app bug |
| [21](https://github.com/MaisySen/nsw-transport-app/actions/runs/40054505247) | 8 | 696b196 | running | running | test10 now filters the list; bus stop rows use the primary text colour |

Earlier runs: 15 (build 6) 10 of 10 light and 9 of 9 dark. Runs 10 and 11 failed when GitHub Actions minutes ran out, before the repo was made public; runs 8, 12, 13 and 17 to 19 were cancelled by newer pushes.

## Manual and device testing

| Item | Status |
| --- | --- |
| Android "By map" tap, new icons, drag handle feel, Confirm sheet switches on a real phone | Not yet seen on a device; tested in phone size previews only |
| Web Push on a real iPhone home screen app | Not yet proven on a device |
| Android closed app push | Needs a Firebase project (see [Roadmap](ROADMAP.md)) |
| Play phone screenshots | Rendered from the app code at phone size; replace with device captures from the first internal test build |

## Before a release

1. `node --test test/*.test.mjs` in `backend/`: all 80 pass (a clean clone too, since the generated data is committed).
2. `npx tsc --noEmit` in `app/`.
3. iPhone: CI run green, then read `r2.txt` on `ci-out` for per test counts in light and dark.
4. After publishing the web: the live checks above.
5. grep every changed file for em dashes, en dashes and filler words.
