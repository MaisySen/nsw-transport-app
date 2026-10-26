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
4. **Gaps in use today:** trip list pages (27 Oct: about 10 trips a page, asked for a screen and a half before either end, one at a time each way, up to 7 days either way, never while the screen is off view; a trip via a stop still loads batches at the end, at most 8 a visit, stopped at 4am), departures and trip results 15 to 20 s, live trip engine 15 s, iPhone trip card 30 s,
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

### 26 Oct, speed (g13): app side, measured (12:59 to 1:09 PM, web export at 390 x 844, 4x CPU slowdown, live data)
Paired runs, the production code (main 05f9d77, the 12:54 PM update) against this change, one after the other three times, medians. Home with Burwood and Strathfield set and Central starred; stop = tapping Central on Home; trip = Burwood to Strathfield list; refreshes = Central's stop screen on view for 65 s. The build box's address was rate limited by the API during other workers' load tests, so the runs send the load test key (no other change to the requests).

| | before | after |
| --- | --- | --- |
| Home, first start, to times on screen | 2,928 ms | 2,259 ms |
| Home, start with kept copies, to times | 2,018 ms | 1,977 ms |
| Home, start with kept copies, layout shift (CLS) | 0.21 to 0.29 | 0.012 |
| Stop screen from Home, to times | 1,313 ms | 1,402 ms (runs of 1.2 to 1.5 s both sides: no change) |
| Stop screen opened with nothing kept, layout shift | 0.625 | 0.01 |
| Components drawn on opening the stop screen | 11,710 | 10,212 |
| Components drawn per refresh on the stop screen | 4,963 | 3,613 |
| Trip list to times | 2,461 ms | 2,338 ms |
| Tab switch Plan / Home | 265 / 167 ms | 262 / 141 ms |
| JS bundle (Hermes, iOS / Android) | 6,182,563 / 6,312,886 B with this change; 6,159,227 / 6,290,322 B at 639608f before the timetable packs | |

What changed:
* One boot (`src/lib/boot.ts`): the profile, cached config, saved places, every kept copy of the last answers (`warmOffline`: the index, then one `multiGet`) and the kept timetable packs are read side by side before the first frame, the copies waiting at most 400 ms. Before: profile and config, then the saved places after the first screen was drawn, then one storage read per Home card after it mounted, so Home drew empty cards and filled them a few frames later (the 0.21 to 0.29 shift above). `peekOffline` answers from the copies read at start; each is parsed only when a screen asks for it.
* Rows of live lists keyed by their own service (`src/lib/rowKeysCore.ts`): stop screen, Home stop cards, the full screen board and the trip list had the row number in the key, so when the first service left every row below got a new key and React drew the whole list again on each refresh.
* Widgets and the trip card (`platform/iosBridge.ts`): each value shared with the app group is written only when it differs from the last write, and the widgets reload when something on them changed or when the app comes to the front; before, every store write (a recent search, a setting) rewrote Home, Work and starred stops and reloaded every widget, and every card tick rewrote the Next trip card.
* The opening route draws no header (it showed an empty screen titled "index" for a frame on web and Android).
* A compact live status ("On time · Live 30 s ago") stays on one line, so a row keeps its height between refreshes; the full words are in the accessibility label.

Checked and left as they are: requests at start already go out together (7 at about 930 ms on web, none waits for another except the line status for the trip's lines); answers are compressed (brotli to a phone that asks for it, gzip otherwise; Central's board 32.6 KB as JSON, 4.7 KB brotli); lists are short enough not to need a virtualized list (40 rows at most). Not done: `inlineRequires` in a metro config (lazy module loading at start) changes the order modules run in, and nothing here can check a side effect that depends on that order without a phone; worth trying with the 1 November build. The bundle is not smaller: the big parts (react-native, reanimated, expo-router, gesture-handler, bottom sheet) are used by the first screens.

Known: on the stop screen the copy kept on the phone now shows on the first frame of a fresh start too, and when the live answer lands with services added or gone the rows move (layout shift over the 65 s refresh run 0.24 to 0.50, was 0.12 to 0.26). On web the live dot's pulse redraws its view on every animation frame (the native driver is off on web only); phones are not affected.

### 26 Oct, speed (g10): search and server (11:21 AM to 11:50 AM, live data, from this build box in the US west)

Bidur at 11:20 AM: "app still slow as hell right now. Keep loading in every search". Measured with `meas.mjs` (task folder, not shipped): 10 messy NSW names (wollongong stn, newcastle interchnge, katoomba station, byron bay, albury stn, coffs harbour, port macquarie, wagga wagga, orange station, tamworth stn; no Sydney commute names) and 10 stops across NSW (Wollongong, Newcastle Interchange, Gosford, Katoomba, Albury, Wagga Wagga, Manly Wharf, Randwick Light Rail, Tallawong, Strathfield Stand G), 5 runs 20 s apart. Cold is the first request for a query or stop with a new cache key (`cb=`), warm the same request again at once. The box is in the US, so every answer also pays about 150 ms each way across the Pacific; Sydney phones see less.

| Request | Before (transport-api 6021d6aa) p50 / p90 / max | After (863d521d) p50 / p90 / max |
|---|---|---|
| Search, cold | 453 / 883 / 1,364 ms | 239 / 749 / 1,029 ms (server answers clear names from its own index, no Trip Planner call) |
| Search, warm | 38 / 58 / 401 ms | 37 / 77 / 732 ms (copies now kept 6 h, not 15 s) |
| Search on the phone, as you type (web export, 390 x 844) | server answer plus a 220 ms pause, spinner meanwhile | 19 to 41 ms for 9 of 10 names from the lists kept on the phone, no spinner; 748 ms for the slip "newcastle interchnge" before the fix in f9dc27e (now local too) |
| Stop board, first open with no copy anywhere | 1,255 / 1,547 / 2,502 ms | 634 to 2,891 ms (unchanged: nobody had opened these stops in 15 min) |
| Stop board, first open of a stop opened or warmed in the last 15 min | same as above | 207 / 469 / 671 ms (saved board at once, `x-edge-cache: saved`, real age shown; fresh board 1 to 3 s later) |
| Stop board, repeat at once | 22 / 51 / 58 ms (edge hit) | 194 / 224 / 684 ms while the fresh board is still being fetched (saved again); an edge hit (about 20 to 40 ms) once it lands, 4 s later in a spot check |

Warming: the minute tick saved the 50 busy interchanges within 8 minutes of the deploy (54 boards saved by 11:47 AM, 11 of them opened by a phone). It adds at most 8 Trip Planner calls a minute (0.13 a second, under 10,000 a day; the key allows 5 a second and 60,000 a day; the day's count was 18,660 at 11:46 AM), none from 1:00 to 4:30 AM, none while a server copy is busy and none past 40,000 for the day.

Smart Placement is on but Cloudflare was still deciding at 11:50 AM (`cf-placement: local-SEA` from the US box), so it is not in these numbers. Phones in Sydney already run next to the hub and D1; the change helps phones elsewhere once it is applied. To check later: the `cf-placement` header and the same script.

### 26 Oct, speed (g10): app side
* Quick ask after a saved copy: `pollCore.quickReaskMs(body, now, done)` returns 2000 when the answer's `dataAt` is more than 20 s old and no quick ask has run since the screen opened, else null. `useLive` passes it to `useScreenPoll` as `soon`, which calls `Poller.soon(ms)`: one run after `ms`, then the normal gap. Nothing runs while the app is away or the screen is off view. One extra request per opening at most.
* Prefetch on press in: `prefetchStop(id, mode?)` in `src/lib/prefetch.ts`. It goes through the shared read cache in api.ts (a stop screen opened while it is out joins it; a good answer is reused for 4 s) and keeps the answer under `cacheKey('dep', id)`, which `useLive` reads with `peekOffline` on the first frame. The same stop is asked at most once every 10 s (`prefetchCore.prefetchDue`), so scrolling over rows costs at most one request per stop.
* Trip list countdowns: `useCountdownNow` with `useReportCountdowns('trip', ...)` for the first 6 trips, in place of `useNow()` (5 s). Wakes at each shown countdown's minute change instead of 12 times a minute.
* Window background: `expo-system-ui` `setBackgroundColorAsync(c.bg)` on each theme change, loaded with a guarded `require` so a build without the module skips it.
* Not measured on a device or in the web export in this pass (see the report): tap to content numbers for the quick ask and prefetch are still to take.

### Many phones (26 Oct, 10:14 to 10:48 AM, load test)

100 and 1,000 simulated phones against the new server: p95 783 ms and 678 ms, server CPU about 1 ms a request. The limit is Transport for NSW's 5 calls a second, not the server. Every number and the plan: [SCALING.md](SCALING.md).

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

### Trip lists a day at a time (27 Oct, local, OWN_PLANNER off)

Local wrangler dev with the fake NSW (planner answers at 0 ms, so the Trip Planner page time is our overhead only; the live planner adds 3 to 5 s for a new pair). Synthetic pack: 3,621 stops, 324 patterns, 28,674 trips, 590,100 stop events. First page of a new pair: Trip Planner mode 26 to 128 ms (10 trips, one outlier 535 ms); our planner's whole day 45 to 57 ms (70 to 114 trips, planner object 11 to 18 ms with the pair's lines worked out, live step 4 to 12 ms), the same day again 27 to 39 ms, the next day 31 to 37 ms. In Node on the same pack: 18 to 26 ms for the lines (14 RAPTOR searches) and 0 to 3 ms for a day's scan. On the real network one RAPTOR search is about 34 ms (SCALE_1M.md), so a new pair's lines are about 0.5 s once per pair and pack, and every day after that a few ms. A day's answer is 100 to 240 KB of JSON before compression. Storage rows read per day request: none once the pack is in memory (the pack's parts once when an object starts).

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
