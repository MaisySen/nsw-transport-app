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
