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

### `backend/test/trip-modes.test.mjs`: 6 tests, 6 pass

`/api/trip` modes and date: known modes only; Bus only leaves out train, metro, light rail and ferry (exclMOT 1, 2, 4, 9) and keeps bus, coach and school bus; Train and Bus keeps both; every journey checked again (a train leg in a bus only answer is dropped); date from today to 14 days ahead; the long trip cache keeps modes and date apart.

## Android app logic tests

### `app/test/tripmodes.test.mjs`: 9 tests, 9 pass

Trip screen mode chips (Any clears, toggles, several at once, every chip on is Any, which chips show), bus only filter (coach and school bus count, walks are fine), an honest empty state that depends on who filtered, the endless list's caps (8 later batches at most even when scrolled 100 times, one at a time, none off screen, stop at 4am or when a batch brings nothing new, earlier never before half an hour ago), Sydney days for the picker (AEDT and AEST) and when a date must go to the server, and When carrying a day through route params, the request and the label.

### `app/test/access.test.mjs`: 7 tests, 7 pass

Station access, Park and Ride and Opal machine helpers (`app/src/lib/access.ts`): car park names without the station name, badge, fill and totals, ticket machine wording, step free and lift out chips on trip legs, outages on a journey, https only links, the stop ids sent for lift outage alerts (digits only, at most 40), and one live check that `/api/station`, `/api/parking`, `/api/topup` and an `acc=1` trip send every field the app reads. `OFFLINE=1` skips the live check.

### `app/test/logic.test.mjs`: 10 tests, 10 pass

Run with `cd app && npm test` (Node's own test runner; the TypeScript files are transpiled on the fly). Covers money and fare wording, the Opal peak hours in Sydney time, the live trip maths (waiting until the vehicle passes your stop, next stop and stops left skipping stops it runs through, done after arrival, spare minutes with tight and missed changes, moving to the next leg), cutting the route between your stops, and one live check that plans a real trip with a Concession fare and runs its live service through the same maths. Set `OFFLINE=1` to skip the live check. `npx tsc --noEmit` must pass before any update.

### `app/test/livelabel.test.mjs`: 16 tests

Live labels (`liveLabelCore.ts`): Live with the age of the live time in 15 s steps, Timetable for services with no live time (a passed timetable time shows the time, never Gone or Left), Not tracking when the GPS position is over 3 min old, our copy is over 2 min old with the service due within 10 min, or a live time passed while the service is still listed; cancelled; the row redraw key; `stampSeen`. Recently departed (`recentCore.ts`): Left only when a live time tracked the service to its departure, Due and not tracked otherwise, nothing across a gap between reads, nothing for a service that dropped off early, cancelled rows skipped, newest first, aged out after 10 min. See [Live labels](LIVE-LABELS.md).

### `app/test/stopboard.test.mjs`: 4 tests

GET ON and GET OFF only when a service is opened from a trip or plan, the server's alight flag first, a get off stop before the get on stop not tagged; route chips filter the board and drop a route the board no longer runs.

### `app/test/whylate.test.mjs`: 9 tests

Why it's late (`whyLateCore.ts`): alert ids from transportnsw.info links, linked alerts resolved from a board's list; causes read from "due to" and similar or an alert that starts with the cause, and none from trackwork timetable notes, bare titles, station updates or lift outages; a delayed T4 leg on Strathfield to Kings Cross gets "Delayed: incident requiring emergency services at Allawah" from its own linked alert (alert shapes from the current server on 25 Oct); a trip alert ("Running late") comes first; nothing for an on time service, a 1 min delay, a delay with no live time, low priority alerts or no alerts; Cancelled and Changed services, case of the first word, the 80 character cut; the line named on a trip with more than one ride ("T4 delayed: ..."); which lines are asked for full text; no dashes. See [Why it's late](WHY-LATE.md).

### `app/test/board.test.mjs`: 6 tests

Departure board (`boardCore.ts`): platform words, big times, rows soonest first with the shared live label (Live, Timetable, Cancelled) and the VoiceOver words, a live time gone quiet showing Not tracking with its timetable time instead of a countdown, stopping patterns only from descriptions that read as one ("Strathfield, then all stations to Central", not "City to Emu Plains or Richmond"), stop list summaries ("Burwood, Redfern and Central"), the type size growing with Dynamic Type while rows still fit (portrait and landscape), rows that fit. `battery.test.mjs` still checks the wake lock is only on the board and released on leave.

### `app/test/usual.test.mjs`: 5 tests

Usually N min late (`usualCore.ts`, `usual.ts`): the words come from the numbers only (minute 0 to 10, 10+, on time for 0 or 1, day type and part of the day, nothing under 8 services or for a value out of range), the batch query and its cache key per line, stop and hour, the quiet off switch on a 404 (the old host) and the usualLate flag, and the three screens that show it.

### `app/test/planb.test.mjs`: 9 tests

Plan B: cancelled, suspended, missed change, trackwork (replacement bus legs, the 10 min slack), replacement buses as a way round a cancellation, the Home sentence ("T1 suspended. Try the 8:04am M1 from Epping, arrives 8:41am."), and the morning alert tap opening its trip. See [Plan B](PLAN-B.md).

### `app/test/lasthome-local.test.mjs`: 7 tests

Last way home on the phone: the hint from a real Ask answer of the current server (fixture `test/fixtures/ask-last-home-old-host.json`), not offered on a "Latest I can see" answer, server push or phone per platform, the notification and Home card words (with a walk to the station), a late service moving it, a cancelled one followed by the last one still running or none left, the night gap, the recheck schedule. See [Last way home](LAST-WAY-HOME.md).

### `app/test/trackwork-alerts.test.mjs`: 5 tests

Weekend trackwork from `/api/alerts` on the current server: Sydney weekend dates and daylight saving, dates in alert words, real alerts of 25 Oct (fixture `test/fixtures/alerts-old-host-25oct.json`: the T4 work touches Strathfield to Kings Cross, the T1 North Shore and Western work does not), named places, the Thursday 6pm heads up plan. See [Weekend trackwork](TRACKWORK.md).

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
| Speak alerts (update 25 Oct, 3:15 PM): on a real trip, each line spoken once ("Your bus leaves in 2 minutes from stand X1", the next stop and change lines, "You've arrived"), music lowered and not stopped, the switch remembered for the next trip. On build 206 Silent mode mutes the speaker (headphones work); build 207 should speak with Silent mode on (Build 207 device checklist, items 9 to 11) | Not yet heard on a device |
| Bus route view and stop numbers (update 25 Oct, 3:15 PM): search 410 and 2046100 in Plan, Route on a bus service and on a bus leg, "Stop 2046100" on bus rows, Home stop cards, bus legs and the live trip | Not yet seen on a device; checked in the web build |
| Station picker and bus picker (updates 25 Oct, 3:06 PM and 3:30 PM): no Back button or title over the screen on iPhone, the question in the search field, no caps lock in search fields; the bus picker opening on Near you (only when location is already allowed), then saved and recent stops, then Sydney routes, with trackwork, school and regional routes closed at the end | Not yet seen on a device; checked in the web build |
| Website (25 Oct, 5:10 PM, Pages deployment 6a3ba944): home, support, privacy and terms answer 200, the four screens load, www redirects, /beta 302, /plan and /stop links show the Open in the app page, a random path 404 | Done with curl after the deploy |
| Plan B on Home (update 25 Oct, 5 PM): a "Plan B:" line under a trip card when its next service is cancelled, on a suspended line, will miss a change or uses replacement buses; the tap opens the trip with its Plan B card. A tapped morning check alert opens that trip (the check must be in More > Check my trip on this phone) | Not yet seen on a device; checked in the web build with a real Strathfield to Kings Cross answer whose first T1 was marked cancelled (`files/commuter-25oct/`) |
| Last way home on the phone (update 25 Oct, 5 PM): Ask "Last train home" (location allowed) or the last service in trip results, Remind me, the notification permission prompt at the tap, the notification 15 min before leaving with the app closed, Home card with Leave by and the service time, a later live time moving it after opening the app, Android getting a real notification. Cancel from the button and the Home card | Not yet seen on a device; checked in the web build with the current server's real answer for Kings Cross to Strathfield (12:54am T4, reminder 12:30am; the web build logs the schedule instead of ringing) |
| Weekend trackwork on the current server (update 25 Oct, 5 PM): the Trackwork this weekend card from Thursday 6pm with Sat and Sun rows for the T4 work on Strathfield to Kings Cross; More > Weekend trackwork heads up asking for notifications, then one notification on Thursday 6pm when work touches a trip (Home opened earlier in the week) | Card seen in the web build with live alerts on Sunday 25 Oct; the Thursday notification not yet seen on a device |
| Why it's late (update 25 Oct, 5:43 PM, group 0c0bffd6): the reason line on a late service on a stop screen, a trip leg and service row (Strathfield to Kings Cross), the Home Next trip card and the live trip card; tap opens the alert in the browser; VoiceOver reads the reason with the row and offers the "Why it's late" action; nothing on an on time service. Seen in the web build with live data on 25 Oct (a T4 13 min late, incident at Allawah) | Not yet seen on a device |
| Departure board (update 25 Oct, 5:43 PM, group 0c0bffd6): Board on Strathfield station and a bus stop, portrait and landscape (rotate while open), dark by default and Light board, the close button clear of the Dynamic Island and the home indicator on iOS 26 and 27 and on Android, the screen staying on while open and sleeping again after Close (on builds 201 to 206; feature detected), stops after this station on the first trains, Live, Timetable and Not tracking, VoiceOver row by row, text size at the largest Dynamic Type sizes | Not yet seen on a device; checked in the web build at 390 x 844 and 844 x 390 with live data |
| Trip screen modes, endless list and time chip (update 25 Oct, see RELEASES): Strathfield to Town Hall, tap Bus: bus trips with stand and stop numbers (seen in the web build with live data: 415, 492, 52 and 461X with changes, there is no direct bus); Train and Bus together; the choice still there after closing the trip and opening it again; Any back. Scroll to the end: a small Loading later services row, more services, then No more services found for this day (seen in the web build: 8 batches to about 4am). Pull at the top: earlier services. The Leave now chip: the iOS sheet with the day row on iOS 26 and 27, the Material dialog on Android, VoiceOver reads each chip as selected or not, Dynamic Type at the largest sizes wraps the time chip, Now one tap back. Not yet seen on a device |
| Android closed app push | Needs a Firebase project (see [Roadmap](ROADMAP.md)) |
| Play phone screenshots | Rendered from the app code at phone size; replace with device captures from the first internal test build |

## Build 207 device checklist

Build 207 is on TestFlight (25 Oct, 6:15 PM): EAS build cfa52f8c-d54e-49ce-b2ab-eb30f7101a63, App Store Connect build f2614902-1e63-4399-8e73-87ec2a7931b7, Internal and Public groups, Beta App Review approved, external state In Beta Testing. Nothing below has been ticked yet. Not in 207 (follow up on `native-207` for the next build, from Bidur's 206 widget screenshots): trip widget times in one column, the alert on more lines, the Start button inside the margins, status words never cut, and a bigger countdown on the small widget.

Run on a real iPhone (iOS 26 and iOS 27.1) and a real Apple Watch paired with it, after installing 207 from TestFlight. The EAS simulator check (watchshots profile) compiles everything and draws the widgets, but none of this has been seen on a device. Tick each line in the release record in [RELEASES.md](RELEASES.md).

**Install and update**
1. Settings, About shows version 1.0.0 (207). Over the air updates still arrive: the latest production group loads after two restarts (runtime 1.0.0).
2. Upgrade over 206 keeps saved trips, starred stops, Home and Work, reminders and the Speak switch.
3. The app icon on light, dark, clear and tinted Home Screens (Liquid Glass, Icon Composer file); no white frame.

**iPhone widgets**
4. Trip widget small, medium and large: whole minutes only (no seconds), each service gone the minute it leaves, the line badge in its official colour (buses always bus blue), live or timetable status.
5. Stop board widget on a bus stop (star Five Dock Shops, Great North Rd, then Edit Widget): "Stop 2046100" next to the name; a station board shows no stop number.
6. Edit Widget, Stop: starred bus stops show "Stop 2046100" and their routes under the name; choosing one still works after the app is updated again.
7. Tinted and clear Home Screens: outlined badges with readable text. Lock Screen inline, circular and rectangular widgets, StandBy at night: readable, one tint.
8. Battery: over a normal day the widgets refresh about every 5 to 15 minutes (every 1 to 5 during a live trip) and keep counting down between refreshes; Settings, Battery shows no unusual Transport background use.

**Speak alerts (needs 207)**
9. Silent switch on, no headphones: start a trip with Speak alerts on; the lines are spoken through the speaker.
10. Music or a podcast playing: music is lowered while a line is read and comes back to full volume after; a podcast pauses and can be resumed.
11. Locking the phone stops speech (no background audio by design); unlocking and opening the app speaks the next line.

**Apple Watch**
12. The watch app installs with 207 and opens to the saved trips list (Home to Work first when set), scrolled with the Digital Crown.
13. Tap a trip: the next 6 services as cards with a big countdown in whole minutes, platform, lines and "11:56 to 12:18"; amber or red when late. Tap a card for its legs.
14. watch trip screen: first card fully visible above Swap and Refresh. Nothing floats over the cards: Swap direction and Refresh are rows at the end of the list (the simulator check 70dd1762 had them as bottom bar buttons over "8 min late" and "Next: 5, 16 mins"). Check on a 42 mm or 41 mm watch and at the largest text size too.
15. Swap direction, Refresh and pull to refresh respond at once with a haptic; swipe a row to swap.
16. Times refresh every 30 seconds only while the app is on screen; with the wrist down nothing loads (check with Low Power Mode off and on).
17. No signal (Airplane Mode on the watch, phone away): the times the iPhone last sent show, marked with when they were updated.
18. Complications on a face (Modular, Infograph) and in the Smart Stack: rectangular "T1 Strathfield 2, 16, 18 min", inline, circular and corner; whole minutes; a tap opens that trip, also from a cold start.
19. A new or reordered saved trip on the phone reaches the watch within a minute while both are awake.
20. VoiceOver on the watch reads each card as one element; the largest Dynamic Type size wraps without cutting the countdown.

**Unchanged in 207 (regression)**
21. Live Activity and Dynamic Island on a trip, trip reminders ringing with the app closed, last train home reminder, notifications permission asked only on the first reminder, location asked only when in use (no Always prompt).

## Before a release

1. `node --test test/*.test.mjs` in `backend/`: all 80 pass (a clean clone too, since the generated data is committed).
2. `npx tsc --noEmit` in `app/`.
3. `OFFLINE=1 node --test test/*.test.mjs` in `app/`: all pass. iPhone builds: the EAS simulator compile check is green before the production build ([Runbook](RUNBOOK.md), section 4).
4. After publishing the web: the live checks above.
5. grep every changed file for em dashes, en dashes and filler words.
