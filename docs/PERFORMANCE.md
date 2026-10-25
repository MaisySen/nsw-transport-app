# Battery and performance rules

Rules for every change to the app (app/). The tests in app/test/battery.test.mjs check the ones a machine can check.
Written 25 Oct 2026 after the battery, smoothness and iOS audit (report: files/qa-25oct/C-perf-report.md on the build box).

## Battery

1. **No bare timers that repeat.** `setInterval` is not used in src/ or platform/ (a test fails if it comes back).
   Repeating work goes through src/lib/activity.ts:
   * `useScreenPoll(run, everyMs)` for a screen: runs only while the app is in front AND the screen is on view.
     A screen under another one in the stack, a tab you left, a locked phone: no timer, no request.
   * `startAppPoll(run, everyMs)` for app wide jobs (alerts poll, live trip engine, iPhone trip card refresh):
     runs only while the app is in front. Call `setEnabled(false)` when there is nothing to do (no trip).
   * `useNow(ms)` for countdowns: ticks only while the screen is on view and the app is in front, on whole
     multiples of the clock. Default 5 s (countdowns show whole minutes). Do not pass 1000.
2. **Back off on failure.** A poll job returns `false` (or throws) when it failed; the wait then doubles each time,
   up to 5 minutes, and resets after a success or a pull to refresh. Never retry in a tight loop.
3. **Catch up once.** Coming back to the app or the screen runs a stale job once at once, never once per missed tick.
4. **Gaps in use today:** trip list batches only on scroll near the end or a pull at the top (at most 8 later and 3 earlier per visit, one at a time, stopped at 4am, never while the screen is off view), departures and trip results 15 to 20 s, live trip engine 15 s, iPhone trip card 30 s,
   alerts poll 20 s (60 s when the phone has a push token, since push brings the alert), station info and walking
   position 2 min, car parks 2 min. Ask for longer gaps when the data changes slowly. The phone's own Last way home
   reminder: an app poll every 60 s that does nothing without a reminder, and with one asks live times every 5 min
   (every minute in the last 25 min), only while the app is open (docs/LAST-WAY-HOME.md). Weekend trackwork on the
   current server: one `/api/alerts` read per line (at most 6), kept 30 min; the Thursday heads up reads at most every
   6 hours while Home is open (docs/TRACKWORK.md). Plan B on Home makes no request (docs/PLAN-B.md).
5. **Location.** Foreground only ("When In Use"); no background location, no geofencing (a test checks).
   Use `getLastKnownPositionAsync` first (up to 2 minutes old is fine for nearby stops and walking minutes), then
   `getCurrentPositionAsync` with `Accuracy.Balanced` (about 100 m: wifi and cell, little GPS). Never `High`,
   `Highest` or `BestForNavigation` (a test checks). The live trip map watch is Balanced, every 10 s or 30 m, and
   runs only while the live trip screen is on view with the app in front.
6. **Screen wake lock** only on the full screen board, taken on focus and released on blur (a test checks). Since 25 Oct the board checks for the native keep awake module first (`requireOptionalNativeModule('ExpoKeepAwake')`) and skips the wake lock on a build without it. Where trains stop after the station is read once per service (`/api/service`, at most 3 at a time, kept for the session), not polled.
7. **Why it's late** asks `/api/alerts?q=<line>` only when a screen's own live data shows a late, cancelled or changed service with linked alerts, once per line, kept 3 min; no timer of its own ([WHY-LATE.md](WHY-LATE.md)).
7. **Background.** Nothing in JS runs in the background. The lock screen trip card is moved by server push
   (build 205), not by the app waking up. UIBackgroundModes stays empty unless a feature truly needs one (a test
   checks app.json).
8. **Network.** Reads go through `req` in src/lib/api.ts, which shares a request already in flight for the same
   address and reuses a good answer for 4 s (src/lib/pollCore.ts `createReadCache`). `refresh=1` reads always go
   out. Any write empties the cache. Every request has a timeout (20 s default); reads get one quiet retry on a
   network error, writes never retry on their own.

9. **Adaptive polling (25 Oct, 9:40 PM update).** Screens with departures ask again every 15 s while the next service
   is within 5 minutes, every 30 s up to 15 minutes and once a minute beyond that, or when nothing is coming
   (`adaptiveGapMs` in src/lib/pollCore.ts; Home card, stop screen, full screen board, Simple mode). Home's lists
   (saved trips, watches, commutes) read once a minute, not every 15 s.
10. **Countdowns redraw at whole minutes.** `useCountdownNow()` (src/lib/activity.ts) wakes only when a countdown
    the screen reported (`useReportCountdowns`) changes its whole minute, or at the next clock minute. No 5 s tick on
    Home, the stop screen, the board or Simple mode.
11. **Kept copy first.** `useLive` shows the copy kept on the phone at once on a fresh start ("Updated 4 min ago,
    refreshing") while the live answer loads (see 14).
12. **Simple mode** polls only the page on view; the pages beside it read once when drawn. Location there is the
    phone's last fix (up to 5 minutes old) or one `Accuracy.Low` fix, only when location is already allowed.

13. **Latest answer only (26 Oct, item 1).** Every change of what a screen shows (stop, service, time, query, trip)
    starts a new round in `useLive` (`createLatest` in src/lib/pollCore.ts). An answer that comes back for an earlier
    round is dropped, so data asked for one stop, service or time never lands under another, and the new round asks at
    once instead of waiting behind the old request. Before, only screens with a cache key checked the key, and a
    request still out blocked the new one until the next poll (a stop list under the wrong train on 25 Oct, 11:59 PM).
    One off loads beside it use `useStamp` (src/lib/hooks.ts): the trip list's next and earlier batches and Plan B,
    Simple mode's Earlier and Later, the walk stop search in New trip, the next way on after a missed change; the live
    trip engine drops service answers for legs that changed while they were out. Tests: app/test/race.test.mjs.
14. **Kept copies are labelled.** A kept copy shown while the live answer loads says how old it is ("Updated 4 min
    ago, refreshing", `staleText` in src/lib/offlineCore.ts) on Home, the stop screen, the board, Platform view, the
    trip list, Simple mode and the service screen; with no signal it says "Offline, showing times from 8:05am"
    (`offlineText`), on the trip list as a banner over the trips (`KeptBanner`). It is never shown as live. Services
    already gone are taken out when it is read. A copy kept in memory this session shows on the first frame when a
    screen opens again. The service screen keeps its own copy (`cacheKey('svc', ...)`); 32 copies at most.
15. **Startup.** The first screen asks for its own times first: the fresh config, the alerts poll for watched
    services and the Last way home recheck start 1.5 s after the app is ready (`STARTUP_DEFER_MS` in
    src/app/_layout.tsx). The cached config is in use from the start.

16. **Alerts timer (26 Oct, item 2).** The app wide alerts check (`pollNotesTick` in src/lib/push.ts, a 20 s app poll)
    asks `/api/watches` once a minute when the phone has a push token (as before) and also when it has none but
    nothing is watched (`notesWaitMs` in src/lib/pollCore.ts); the server writes notes on its minute tick, so nothing
    is lost. Watching with no push token: every 20 s. A watch started (`api.watch`) counts at once.
17. **One device id (26 Oct, item 2).** `getDevice` loads through `sharedOnce` (pollCore.ts): calls made while the
    first is loading share it. A fresh install made 2 to 4 ids in its first second and the first requests went out
    under ids the phone then forgot.
18. **Boards for one mode (26 Oct, item 2).** A board answer is 40 services. At a stop with several modes, the mode
    chip or a route chip asks for that mode alone (`boardAsk` in src/lib/stopBoardCore.ts, `departuresFor` in
    src/lib/api.ts): one request when the chip is tapped, then the same adaptive gap. All is unchanged.

### Freshness and the server move (26 Oct, 9:31 to 9:53 AM, live data)

Bidur at 9:13 AM: "App still loads data slower and updates late. Almost missed the train." Two measurements:

**How far each server is behind the Trip Planner.** A script asked the Trip Planner's departure monitor and both
servers (`/api/departures?refresh=1`, as the app's polls do) every 3 s for Central (200060) and Strathfield Station
(213510), and timed how long each change of a live time took to show on each server.

| Server | Lag median | 90th percentile | Worst | Changes later than 15 s | Answer time median (90th) |
|---|---|---|---|---|---|
| First server (phones until this update) | 2.4 s | 9.7 s | 16.8 s | n/a | 473 ms (1474 ms) |
| api.transportsydney.app before (15 s edge copy on a 12 s departures copy) | 8.4 s | 20.8 s | 26.8 s | 78 of 306 | 108 ms (1849 ms) |
| api.transportsydney.app after (a refresh takes a copy up to 5 s old) | 1.1 s | 10.1 s | 34.5 s (once) | 1 of 222 | 163 ms (1589 ms) |

**How often the app asks** (web export at 390 x 844, real data, Strathfield, 100 s on view):

| Screen | Before (production, main de4b1c1) | After |
|---|---|---|
| Stop screen: first refresh after opening | 60 s | 15 s |
| Stop screen: gap with a service under 10 min | 15 s while under 5 min, 30 s from 5 to 15 min | 15 s up to 10 min, 30 s to 20 min |
| Home: first refresh of the commute and stop cards | 60 s | 15 s |
| Home stop card (starred stop) | 20 s fixed | 15 s while a service is under 10 min |
| Trip list and Home trip card | 20 s fixed | 15 s while the first service leaves within 10 min, else 20 s |
| Simple mode | 30 s, 60 s past 15 min | 15 s within 10 min, else 20 s |

The first refresh was a bug: the poll's first wait was set before the first answer, when the adaptive gap read "nothing
due" and chose a minute. `retime` in `pollCore.ts` now reads the gap again when each answer lands.

**From a change in the feed to the phone** (server lag plus the wait for the next poll plus the answer):
with a train 6 to 10 minutes away, before: up to about 41 s (9.7 + 30 + 1.5), and up to about 70 s in the first minute
after opening the stop; after: up to about 27 s (10.1 + 15 + 1.6), typically about 9 s. Target was 30 s.

**Opening a stop** (median of 3, web export, time until "Live, updated" shows): first start 1104 ms before, 1086 ms after;
with a kept copy 1245 ms before, 1216 ms after. Home first start 1430 ms before (703 to 1581), 719 ms after (718 to
733). The web export runs on this build box; the first server's answers vary more (90th percentile 1.5 s) than the new
one's shared copies. Not yet measured on a phone.

### Battery and data audit (26 Oct, 7:55 to 8:29 AM, item 2)

Web export at 390 x 844 with live data, each screen in its own browser, every request to the servers counted with its
bytes on the wire (compressed). Home has Parramatta and Central set and Hornsby starred. No push token (web), so the
alerts timer runs at its no token rate. "Hidden" is the page hidden the way a locked phone or another app hides it.

| Screen | Before (main 8ae6b06) | After (4ce801b) |
|---|---|---|
| Stop screen, Central, 15 min on view | 118 requests, 229 KB (departures 48, watches 45, alerts 16, station 8) | 93 requests, 235 KB (departures 51, watches 16, alerts 17, station 8) |
| Home, 5 min | 64 requests, 370 KB (watches 15) | 62 requests, 367 KB (watches 10: 5 of them Home's own watch list) |
| Full screen board, Central, 5 min | 54 requests, 107 KB (watches 15) | 48 requests, 131 KB (watches 6) |
| Platform view, Hornsby, 5 min | 42 requests, 145 KB (watches 15) | 31 requests, 101 KB (watches 6) |
| Trip list, Parramatta to Central, 5 min | 32 requests, 109 KB (watches 15) | 25 requests, 103 KB (watches 6) |
| Stop screen, Parramatta, 5 min | 38 requests, 58 KB (watches 15) | 31 requests, 75 KB (watches 6) |
| Any screen hidden (2 to 3 min) | 0 requests | 0 requests |
| Back from hidden, first 30 s | 8 requests (one catch up each) | 7 requests |
| Device ids in the first second of a fresh install | 4 | 1 |
| Buses at Strathfield (Buses chip) | 11 buses, 7:51 to 8:02 | 40 buses over 53 min |

Bytes move with the live data (row counts, delays, alerts), not with the change; requests are the radio wakes. With a
push token (most phones) the alerts timer was already once a minute, so there the change is the device id only.

Poll gaps in use (from the code): departures 15 s while the next service is within 5 min, 30 s up to 15 min, 60 s
beyond; trip results 20 s (2 min for long trips); Home lists 60 s; alerts 20 s ticks, asking at most once a minute
unless something is watched with no push token; live trip engine 15 s, only with a trip; station info, car parks and
Smart cards 2 min; countdowns redraw on whole minutes; Last way home 60 s app poll that asks nothing without a reminder.
Location: last known fix first, then Balanced or Low accuracy, foreground only; the live trip map watch is Balanced,
10 s or 30 m, only on view. Widgets reload every 5 to 15 min (1 to 5 during a live trip), watch complications 5 or
15 min, Android widgets every 30 min plus app pushes; the Lock Screen trip card moves by server push, at most every
50 s, for at most 7 hours. Nothing in JavaScript runs in the background.

Server: every main endpoint answers compressed (brotli: departures about 4 KB for 40 rows, trip about 7 KB); live
answers are cached at the edge for 15 s on api.transportsydney.app (`x-edge-cache: hit`); station lists for a day,
car parks for 2 min. The first address (still in use by the app) compresses but has no edge cache. No change needed.

Not measurable here (needs a phone): radio wake time and tail energy per request, CPU time of Hermes renders, widget
and Live Activity reloads as iOS budgets them, location energy, and push delivery.

### Before and after (26 Oct, 12:56 to 1:01 AM, item 1: speed and offline)

Web export at 390 x 844, median of 3 runs with live data. Home has Parramatta and Central set and Hornsby starred;
the stop screen is Central. "On screen" is the first departure or trip on screen.

| Measure | Before (main c4c573e) | After |
|---|---|---|
| Stop screen, first start, on screen | 2263 ms | 1987 ms (the server's answer time; varies run to run) |
| Stop screen, second start (kept copy), on screen | 839 ms, no label (looked live) | 833 ms, "Updated just now, refreshing" |
| Stop screen, no signal, on screen | 830 ms, offline line at 927 ms | 809 ms, offline line at 899 ms |
| Home, first start, on screen | 998 ms | 1128 ms (server time; same work) |
| Home, second start and no signal, on screen | 460 ms and 469 ms | 461 ms and 455 ms |
| Requests before the stop screen's first content (second start / no signal) | 7 / 13 | 5 / 10 |
| Requests before Home's first content (first start / no signal) | 14 / 20 | 11 / 17 |
| JS work to first content (stop screen, first start) | 373 ms script, 552 ms tasks | 362 ms script, 539 ms tasks |
| iPhone bundle (Hermes) | 6,094,802 bytes | 6,102,780 bytes (+7,978) |
| Android bundle (Hermes) | 6,225,665 bytes | 6,233,697 bytes (+8,032) |

First start time is the server's answer time and is not something the app can shorten; the kept copy is what makes
a start instant. Not measured here (needs a phone): native start to first frame, Hermes module load time, AsyncStorage
read time on a real device, and how often the radio wakes. Screens are not lazy loaded on iPhone and Android: Expo
Router loads every route at start on native and async routes are not supported there for production, so that would
need a build; the maps already load after the first frame.

### Before and after (25 Oct, web export at 390 x 844, Home with Strathfield and Kings Cross set)

| Measure | Before (main a6b98ca) | After (main a1d7581) |
|---|---|---|
| Home card on screen, fresh start | 4615 ms | 4427 ms |
| Home card on screen, second open (kept copy) | 2123 ms | 211 ms |
| Requests while Home sits idle for 90 s | 27 (trip 6, commutes 6, saved 6, watches 9) | 7 (trip 1, commutes 1, saved 1, watches 4) |
| Screen changes while Home sits idle for 90 s | 31 | 19 |
| Stop board scroll, Strathfield | 60 fps, 1 frame over 20 ms, worst 50 ms | 60 fps, 0 frames over 20 ms, worst 17 ms |
| iPhone bundle (Hermes) | 5,636,021 bytes | 5,673,156 bytes (the Voice screen and speech; maps now load after the screen's first frame) |
| Android bundle (Hermes) | 5,907,791 bytes | 5,945,386 bytes |

Measured with a browser on the web export; a phone will differ. Not yet measured on a device.

## Smoothness

1. Long lists use `FlatList` (Ask, new trip). Short fixed lists inside a ScrollView (departures, up to about 40
   rows) are fine when each row is memoised.
2. Rows that show a countdown are memoised on what they show: `DepartureRow` redraws only when its data, watch
   state, note or the countdown text changes (`countdownKey` in src/lib/format.ts). Callbacks passed to memoised
   rows must only use values the row compares, or read the latest value at tap time (`store.watchedId`).
3. No heavy work in render: sort, filter and group in `useMemo` keyed on the data, not on `now`.
4. Images: SF Symbols and Material icons, no large bitmaps. Size any new image to its slot.
5. Startup: the first screen waits only for the profile and the cached config (both on the phone). Everything
   else loads after first paint. Web export splits every screen into its own chunk.

## Responsiveness

1. Every tappable thing shows it was pressed: iOS dims or highlights (`pressed` style), Android ripples.
2. Hit targets at least 44 x 44 pt on iOS and 48 x 48 dp on Android; small icons get `hitSlop`.
3. `Button` (src/components/ui.tsx) shows a spinner and ignores taps while the promise its onPress returns is
   pending, so no request is sent twice. Use it, or a `busy` state, for every action that talks to the server.
4. Every async action has a loading state, an error the person can read, and a timeout.
5. Haptics only where the HIG suggests: selection changes, success of a real action, warnings. Not on every tap.
6. Every Pressable has an `accessibilityRole` and a label when it has no text.

## Checking

* `npm test` (battery.test.mjs among them) and `npx tsc --noEmit`.
* Tap sweep: build the web export, serve it, run the sweep script from the audit (every tappable thing on each
  screen at 390 x 844 is tapped once and must do something).
