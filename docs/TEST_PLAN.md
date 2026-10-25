# Test plan

How Transport is tested, what runs where, and the current results. Updated 25 Oct 2026, 5:25 PM Sydney time.

## Levels

| Level | Where | Runs |
| --- | --- | --- |
| Backend unit tests | `backend/test/*.mjs`, Node's built in test runner | Every push touching `backend/` or `docs/` (`.github/workflows/backend.yml`), and by hand before each publish: `cd backend && node --test test/*.test.mjs` |
| App logic tests | `app/test/*.test.mjs`, Node's built in test runner | Before every over the air update and build: `cd app && OFFLINE=1 node --test test/*.test.mjs` (includes `battery.test.mjs`, the battery rules in [PERFORMANCE.md](PERFORMANCE.md)); without `OFFLINE=1` a few tests also call the live server |
| Browser checks on the web export | `app/test/e2e/` | Before each over the air update, at 390 x 844 with real data |
| Public site test | `backend/test/public-site.test.mjs` | With the backend tests: no scripts, publisher and links on every page, app link files, no old names or dashes in `site/` |
| iPhone UI tests (XCUITest), SwiftUI app only | `ios-native/Tests/UITests/` | Every CI run of `ios-native.yml`, in light and in dark mode. The SwiftUI app is no longer shipped, so these do not cover the iPhone app built from `app/` |
| iPhone widget snapshot test | `ios-native/Tests/Snapshots/` | Every CI run, light pass |
| App Store screenshot run | `ios-native/Tests/UITests/StoreShots.swift` | Every CI run, 6.9 inch light and dark, 6.5 inch light |
| Expo type check | `app/`, `npx tsc --noEmit` | Before each EAS Update, EAS Build and APK build |
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

### `backend/test/usual-late.test.mjs`: 5 tests

Usual lateness on the server: a day folds into late_agg with the right minute counts (only live times read within 10 minutes of departure), older days fade by 0.95, a day is folded once (the meta claim), the median minute and the fallback from the part of the day to the whole day type (8 services or more), `/api/usual` batch and single forms, flag off answers null.

## Android app logic tests

### `app/test/access.test.mjs`: 7 tests, 7 pass

Station access, Park and Ride and Opal machine helpers (`app/src/lib/access.ts`): car park names without the station name, badge, fill and totals, ticket machine wording, step free and lift out chips on trip legs, outages on a journey, https only links, the stop ids sent for lift outage alerts (digits only, at most 40), and one live check that `/api/station`, `/api/parking`, `/api/topup` and an `acc=1` trip send every field the app reads. `OFFLINE=1` skips the live check.

### `app/test/logic.test.mjs`: 10 tests, 10 pass

Run with `cd app && npm test` (Node's own test runner; the TypeScript files are transpiled on the fly). Covers money and fare wording, the Opal peak hours in Sydney time, the live trip maths (waiting until the vehicle passes your stop, next stop and stops left skipping stops it runs through, done after arrival, spare minutes with tight and missed changes, moving to the next leg), cutting the route between your stops, and one live check that plans a real trip with a Concession fare and runs its live service through the same maths. Set `OFFLINE=1` to skip the live check. `npx tsc --noEmit` must pass before any update.

### `app/test/livelabel.test.mjs`: 16 tests

Live labels (`liveLabelCore.ts`): Live with the age of the live time in 15 s steps, Timetable for services with no live time (a passed timetable time shows the time, never Gone or Left), Not tracking when the GPS position is over 3 min old, our copy is over 2 min old with the service due within 10 min, or a live time passed while the service is still listed; cancelled; the row redraw key; `stampSeen`. Recently departed (`recentCore.ts`): Left only when a live time tracked the service to its departure, Due and not tracked otherwise, nothing across a gap between reads, nothing for a service that dropped off early, cancelled rows skipped, newest first, aged out after 10 min. See [Live labels](LIVE-LABELS.md).

### `app/test/stopboard.test.mjs`: 4 tests

GET ON and GET OFF only when a service is opened from a trip or plan, the server's alight flag first, a get off stop before the get on stop not tagged; route chips filter the board and drop a route the board no longer runs.

### `app/test/usual.test.mjs`: 5 tests

Usually N min late (`usualCore.ts`, `usual.ts`): the words come from the numbers only (minute 0 to 10, 10+, on time for 0 or 1, day type and part of the day, nothing under 8 services or for a value out of range), the batch query and its cache key per line, stop and hour, the quiet off switch on a 404 (the old host) and the usualLate flag, and the three screens that show it.

### `app/test/reminders.test.mjs`: 7 tests

Trip reminders (`reminderCore.ts`, `reminders.ts`): clean reminders, clock and day words (Weekdays, Weekends, Every day, Mon, Wed, Fri), one weekly notification per day of each reminder with ids keyed by trip, the next ring time, the WEEKLY trigger feature detected, notification permission asked only when a reminder is saved (once in the code, after the feature check), no polling, reminders dropped 8 s after a trip is deleted (after Undo) and all of them on Delete all my data, a tap opening the trip.

## iPhone UI tests (XCUITest)

Run on an iPhone 16 Pro simulator with location set to Burwood, against the live backend. Results are written to `r2.txt` on the `ci-out` branch with per test pass or fail. Read the counts there, not only the step result, because the test steps are allowed to fail without failing the job.

| Suite | Test | What it covers |
| --- | --- | --- |
| FlowTests | test01SearchStarAndBoard | Search Central, swipe to star, open the board |
| FlowTests | test02LiveMapAndSheet | Live vehicle map and pull up sheet |
| FlowTests | test03PlanWatchAndSaveTrip | Plan Burwood to Central, one Start trip button (no Watch trip, no Lock Screen button), save |
| FlowTests | test04HomeWithSavedItems | Trips home with saved trips and stops |
| FlowTests | test05Watching | Watching tab |
| FlowTests | test06SettingsToggles | Settings switches and menus |
| FlowTests | test07DynamicIslandAndLockScreen | Live Activity on the Dynamic Island and Lock Screen |
| FlowTests | test08SwipeToDeleteAndStop | Swipe to delete a trip and stop a watch |
| FlowTests | test09Ask | Ask tab answers |
| FlowTests | test10NewTripByModeConfirmAndReorder | New trip by mode, A to Z side index, Confirm trip, reorder |
| FlowTests | test11NewBusTrip | Bus route, direction and stops |
| FlowTests | test15TripScreenButtonsAct | Every trip screen button acts on the first tap: map, Start trip, End trip, Start again, Save, every tab |
| FlowTests | test16ReplayBurwoodToStrathfield | Plans Burwood to Strathfield with live data, Start trip, replays on a fake clock (2 min late) to 15 min after arrival; each alert once, one You've arrived, ends at arrival, nothing after; timeline and stage screenshots |
| FlowTests | test17ReplayWithChange | Replays Strathfield to Redfern (T1 3 min late), change to the T4 (1 min early), off at Kings Cross; same checks |
| FullJourneyTests | testFullJourney | Walks every screen in light and dark for the before and after contact sheet |
| LiveTripLogicTests | 5 tests | Live trip ends at arrival, no rollover to the next service, each alert once |
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
| iPhone floating tab bar (iOS 26 and 27): Ask field above the tab bar with the keyboard closed, sitting right on the keyboard when open (no gap, not covered), Ask opens on its latest message after switching tabs, Home Undo bar above the tab bar after deleting a trip, last rows of Home, Plan and More clear of the bar, search results above the keyboard (update 25 Oct, 3:26 PM; test/overlap.test.mjs checks the code) | Not yet seen on a device; the web preview has no native tab bar |
| Live labels on a phone: "Live, updated 15 s ago" on a departure row, Timetable on a service with no live time, Not tracking when a bus's GPS stops (hard to force; seen in tests and the web build only), the live trip badge (update 25 Oct, live labels) | Not yet seen on a device; checked in the web build at 390 x 844 with live data |
| Bus stop boards: route chips filter, Recently departed row above the list (Left 4:21pm, Live, on time, seen with live data at Strathfield in the web build), GET ON and GET OFF on a bus or train leg opened from Strathfield to Five Dock Shops or Kings Cross | Not yet seen on a device |
| Home, Option A (update 25 Oct, 4:34 PM, group 0b1d956d): the plus button in the iOS 26 and 27 glass navigation bar (one glass group with the live stamp, nothing clipped, the action sheet opens from it) and as an Android top app bar action (bottom sheet with 4 choices); Next trip card with VoiceOver (one element, the Delete action) and at the largest Dynamic Type sizes (badges and platform wrap under the countdown, names wrap to two lines); swipe Delete on a row and on the card, then Undo above the floating tab bar within 5 s, and a saved trip that stays deleted after 5 s or after going to the home screen; Show first from a hold menu; dragging rows under the card; widgets and the watch still list the same saved trips after a delete and an Undo; light and dark, 390 and 430 pt wide (test/homea.test.mjs checks the logic and the source) | Not yet seen on a device; checked on the web export at 390 x 844 and 430 x 932, light and dark, with Bidur's trips and live data (`files/home-a-ship/`) |
| Usually N min late: hidden on today's address (checked: 0 lines on the web build with the old host); shown on the stop board with a route chosen, the service screen and each trip leg once api_base moves (checked with a mocked answer in the web build only). Real answers need weeks of live times on the new host | Not yet seen on a device |
| Trip reminders: the permission prompt on the first reminder only, a reminder ringing at the set time on the set days with the app closed, a tap opening the trip, Undo after deleting a trip keeping its reminders (update 25 Oct; the web build logs the weekly schedule instead of ringing) | Not yet seen on a device |
| Speak alerts (update 25 Oct, 3:15 PM): on a real trip, each line spoken once ("Your bus leaves in 2 minutes from stand X1", the next stop and change lines, "You've arrived"), music lowered and not stopped, the switch remembered for the next trip. On build 206 Silent mode mutes the speaker (headphones work); build 207 should speak with Silent mode on | Not yet heard on a device |
| Bus route view and stop numbers (update 25 Oct, 3:15 PM): search 410 and 2046100 in Plan, Route on a bus service and on a bus leg, "Stop 2046100" on bus rows, Home stop cards, bus legs and the live trip | Not yet seen on a device; checked in the web build |
| Station picker and bus picker (updates 25 Oct, 3:06 PM and 3:30 PM): no Back button or title over the screen on iPhone, the question in the search field, no caps lock in search fields; the bus picker opening on Near you (only when location is already allowed), then saved and recent stops, then Sydney routes, with trackwork, school and regional routes closed at the end | Not yet seen on a device; checked in the web build |
| Website (25 Oct, 5:10 PM, Pages deployment 6a3ba944): home, support, privacy and terms answer 200, the four screens load, www redirects, /beta 302, /plan and /stop links show the Open in the app page, a random path 404 | Done with curl after the deploy |
| Android closed app push | Needs a Firebase project (see [Roadmap](ROADMAP.md)) |
| Play phone screenshots | Rendered from the app code at phone size; replace with device captures from the first internal test build |

## Before a release

1. `node --test test/*.test.mjs` in `backend/`: all 80 pass (a clean clone too, since the generated data is committed).
2. `npx tsc --noEmit` in `app/`.
3. `OFFLINE=1 node --test test/*.test.mjs` in `app/`: all pass. iPhone builds: the EAS simulator compile check is green before the production build ([Runbook](RUNBOOK.md), section 4).
4. After publishing the web: the live checks above.
5. grep every changed file for em dashes, en dashes and filler words.
