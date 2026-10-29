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



### `app/test/newtrip.test.mjs`: 12 tests, 12 pass (30 Oct, new trip first look, app, branch newtrip-app)
* When it asks (served, plain, not step free, not long, nothing on screen) and the query (tt=1, never page, days, refresh or acc).
* R1 stray live fields from a server are taken off and the answer is labelled phone built; only a timetable answer paints (a live answer, a 204, an error do not); R3 gone services drop; R4 trip id keys in time order, at most 10; arrive by and leave at windows; R5 never kept, never seeds; R6 Start trip arms timetable times; R2 cap still 5 min; paints only while nothing is on screen.
* Source checks: `api.tripFirst` is feature detected and one try; `useLive` asks it after the kept copy read and never keeps it; `trip.tsx` wiring; the new module is JavaScript only.
* Results (30 Oct, about 4:40 AM, on newtrip-server): app 906 pass, 3 skipped offline, 0 fail (`OFFLINE=1 TZ=Australia/Sydney`), battery 17 of 17, `npx tsc --noEmit` clean. Device check after deploy and update: a pair never searched before shows timetable rows within about a quarter second, labelled "Timetable times. Getting live times.", then Live badges arrive in the same rows with no jump; with `TRIP_TT=off` the old placeholder rows show and no `tt=1` request goes out.

### `backend/test/trip-tt-first.test.mjs`: 8 tests, 8 pass (30 Oct, new trip first look, server, branch newtrip-server)
* `tt=1` from the newer app: timetable trips in under 0.8 s while the fake Trip Planner takes 8 s; no Trip Planner call and no feed read; every trip timetable, every leg Scheduled with no live fields; `no-store`, `tt-first`; nothing kept.
* `tt=1` beside the normal request: one Trip Planner call in all, the normal answer live.
* Paging, `days` and `refresh` are dropped; older apps get 204 `app` and an unchanged normal answer; `TRIP_TT=off` and the budget guard: 204 `off` and no `trip-tt` in x-serves; step free, long, via: 204 `kind` (with x-serves); no timetable: 204 `none`; a slow timetable gives up at 1.5 s.
* Changed: `speed-part2.test.mjs` expects `trip-tt` in x-serves.
* Results (30 Oct, about 4:30 AM, on main 485fad7 plus this change): backend 629 of 629 (`TZ=Australia/Sydney`, `OFFLINE=1`).

### `backend/test/live-activity.test.mjs`: 5 new tests (30 Oct, trip card push, server, branch liveact-push, live as transport-api d5ee76f9)
* Priority: 10 for an end, a change, a warning or a stale date under 3 minutes away (edge at 180 s), 5 otherwise.
* The row is written on a change, a new Apple status, the end, a gone token, a first push or after 5 minutes, not on every push; the push count stays whole.
* "Updated" from the current leg and later legs; too old, future and missing feed times are left out.
* A second push 30 s later goes as priority 10 with the stale date moved on and no row write.
* `laPasses`: a second pass about 30 s after the cron's minute only while a card is active; none with `LA_HALF=off`.
* Changed: "register, tick, skip within 25 s, end on arrival" (the unchanged push is priority 10 now); `hosts.test.mjs` "the Cron Trigger runs the minute tick" expects two scheduled jobs.
* Results (30 Oct, 12:35 AM, on main c7a2a11 plus this change): backend 621 of 621 (`TZ=Australia/Sydney`). No app change. Device check after deploy: docs/LIVE_ACTIVITY_PUSH.md, "Deploy and check".
### `app/test/livefresh.test.mjs`: 5 tests, 5 pass (30 Oct, live trip freshness, app, branch liveact-ota)
* First ask for a leg is a plain open, later asks carry `refresh=1` (and match the shared read cache's fresh rule); the ask passed in is not changed.
* The trip card: going to the background or with no push the app always writes it; while the server pushes it, only live times from the last 20 s overwrite it (edge at 20 s, a clock that moved back is not fresh).
* The engine and the iPhone bridge call these rules in the right place (source check).
* Results (30 Oct, 12:30 AM, on main c7a2a11 plus this change): app 885 pass, 3 skipped offline, 0 fail (`OFFLINE=1 TZ=Australia/Sydney`, includes battery), `npx tsc --noEmit` clean. Device check after the update: start a trip on an iPhone (build 205 to 208), lock for 3 min, open the app: the card keeps its times and does not flash "Updated"; the trip screen's "Updated" age stays under about 20 s.

### `backend/test/feed-fresh.test.mjs`: 9 tests, 9 pass (28 Oct, liveness pass, server)
* A good fetch is counted per feed and per mode with the copy's own header time (age and header lag); a header in the future is not trusted.
* A failed fetch counts an error with words that carry no key, and the last good copy is marked served old.
* A feed copy over `FEED_LIVE_MAX_MS` (5 min) by its header gives no live times (`staleDropped`), a fresh one does, and `dataTs` is the header time; the last good copy stops giving live times once it is 5 minutes old.
* `capLiveRows`: kept board rows with a live time over 5 minutes go out as timetable rows (no estimate, delay or vehicle, `liveOld`); fresh, timetable and cancelled rows do not change; a copy with no `liveAt` uses its `dataAt`. The cheap check reads a copy only when it may hold such a row.
* Older apps never see `feedTs` or `liveOld` (`oldAppText`); `old-client-compat.test.mjs` still matches server B's shape.
* `/api/health` shows `feedFresh` with the admin key only.

### `app/test/liveness.test.mjs`: 6 tests, 6 pass (28 Oct, liveness pass, app)
* A live time over `LIVE_MAX_MS` (5 min) is Not tracking with its timetable clock time, however far off the service is; 4 minutes far off stays Live with its age; within 10 minutes the 2 minute rule stays.
* The GPS age is counted from the answer when the row has its own read time (`liveLead`), not twice.
* `stampSeen` gives each row its own read time from `liveAt` on the server's clock and the lead, never younger than the answer.
* `copyTime`: a kept copy's `dataAt` on the server's clock, at most 15 minutes back, never in the future; a 6 minute old saved board's live rows are Not tracking.
* `answerTime` keeps an older answer's time; `LIVE_DATA_AGE` is on; the "Live, updated" line is not said past 5 minutes; board rows and row keys pass the lead.

### Speed, measured offline (28 Oct): `backend/tools/speed-local.mjs` and `app/test/e2e/paintcache.mjs`
* Server: `node backend/tools/speed-local.mjs 5` times each main endpoint of the built worker against the fake Transport for NSW (cold, warm copy, poll), no NSW call. Numbers in [PERFORMANCE.md](PERFORMANCE.md) "Liveness and speed (28 Oct)".
* App: `MOCK_API=<port> CHROME=<chrome> node app/test/e2e/paintcache.mjs <dist-web> OUT.json` opens each main screen with nothing kept and with a kept copy while the local server answers 4 s late, and times the first frame with times on it.

### `app/test/offpeak.test.mjs`: 9 tests, 9 pass (28 Oct, off peak hint, app)
* Server times ("10am", "7pm", "9:30 am", "19:00") read as hour and minute; bad ones read as nothing; the app's 12 hour clock.
* Fare objects come from the server's own `fareOf`: a Wednesday 8am trip with a 10:05am trip loaded gets "Leave after 10:00am and pay about $x less" with the server's saving and a Leave at 10:00 on the same day; 5:30pm gets 7:00pm.
* No line: no trip after the peak loaded, only tomorrow's, a later trip with no Opal fare, off peak already, Saturday, a ferry, an older server without `offPeak`, broken savings (zero, negative, not a number, more than the fare, a bad time), Arrive by, every shown trip already gone. A trip that has left is skipped for the amount. Concession uses the concession saving.
* Source checks: the trip screen line is a button with the hint as its label, 44 point tall, grey footnote text, sets Leave at; the list never reads the hint; no timer, no fetch, no dashes.
* On a device (not done yet): a weekday morning trip before 10am shows the line once the list has a trip after 10am (scroll down if needed); tapping it shows trips from 10:00am; VoiceOver reads "Opal fare estimate..."; no line on Saturday or after 10am.

### `backend/test/not-stopping.test.mjs`: 9 tests, 9 pass (28 Oct, not stopping today, server)
* Digest keeps a route and stop named in one entity as a pair (`ls`); alerts without such entities keep their old shape.
* Which alerts count (detour, stop moved, no service; changed or reduced service only with not-stopping words, including the stop closure shapes seen in the live digest on 28 Oct; delays, plain service changes, line-only alerts and stop-only rail notices never).
* Matching: line and stop, stop-only alerts for every bus, pairs as given, a G prefix ignored, only inside a period.
* Departures: bus and coach rows marked with the board's stop name, trains and other lines untouched, an old mark on a kept copy cleared. Trip legs: get-on stop first, else get-off stop.
* Reads only the kept digest: no digest, a digest over 2 hours old, or the switch off marks nothing; no outside request.
* `GET /api/departures` end to end with a fake planner: the marked bus row carries `notStopping`, the other keeps its shape, the alerts feed is not read. `GET /api/detours`: the line's stops, stop-only alerts limited to the route's stops, a week-ahead alert left out, buses only, 400 without a line. `until` when every period ends.

### `app/test/notstopping.test.mjs`: 6 tests, 6 pass (28 Oct, not stopping today, app)
* Row text: "Not stopping at <stop> today" for marked buses and coaches; nothing for unmarked rows, bad shapes or trains; "Not stopping here today" with no stop name; another day names the day. Leg text for the get-on and get-off stops; the alert's words for VoiceOver.
* Route view: `/api/detours` to stop marks and one summary line; bad answers mark nothing; a closed stop the timetable already dropped shows the alert's words, a stop on the other direction is left to that direction. Screens use it; the route view asks once, outside the 30 s poll, and catches a missing endpoint.
* On a device (not done yet): a stop with a live bus detour alert shows the line on its rows, the trip leg and the route view.

### `backend/test/noshow.test.mjs`: 11 tests, 11 pass (28 Oct, often does not run, server; bar tightened the same day)
* Next day to fold (backfill 14 days, yesterday from 1am, never today) and the same day type window.
* Pure fold: fading by 0.95, adding a day, dropping faded keys, one more distinct day per day that counted a bus; marked only at 12 watched over 4 days and 30 percent.
* Two of four 8 o'clock buses never live on four weekdays: 8 o'clock marked (share 40 to 50), 7 o'clock not, the last bus of the run not counted; one day per tick; idle after; departures get `noShow` only on the marked line, hour and day type, other rows keep exactly their shape.
* A service nobody was watching is not a miss. A day where nearly everything missed is skipped as another timetable.
* Switch `noShow` off: no fold, no `noShow`. Budget guard: waits on a D1 meter over the hold, not on a Durable Object hold.
* The bar: 3 of 9 missing over 2 days gets no label (the old bar of 8 would have marked it), nor do 12 or more over 3 days; 4 days with 12 or more counted and 50 percent missing is marked, 4 days under 12 is not.
* After the change: a mark left by the old version (meta `noshow` v 1) is never read, the old counts and claim are dropped, and every stored day is folded again into `noshow_agg2` from the backfill start.

### `app/test/noshow.test.mjs`: 7 tests, 7 pass (28 Oct, often does not run, app)
* Floors (30 percent, 8 watched); timetable rows count down and say "Often does not run"; stale rows show the timetable clock time with the age kept; Live and Cancelled never change; rows without `noShow` are exactly as before; the row redraws when `noShow` arrives; board rows carry the label and the VoiceOver and TalkBack words.
* On a device (not done yet): a stop where a bus hour is marked shows "Often does not run" in amber on its rows.

### `app/test/localsearch.test.mjs`: 6 tests, 6 pass (26 Oct, speed (g10), search as you type)
* 15 messy names from all over NSW find the right stop first (wollongong stn, newcastle interch, newcastle interchnge, wolongong, katoomba, albury, wagga wagga, strathfeild, parra, kings x, manly wharf, tallawong, bondi jnct, circular quay, gosf).
* Every mode: light rail (randwick light), ferry (manly wharf), metro (tallawong), a bus stop by street (warnervale rd), a stop number (213516); Central carries train, metro and light rail.
* A whole word first: "kings" is Kings Cross Station.
* Bus stands never crowd out stations ("wynyard": Wynyard Station first).
* Speed: under 30 ms a keystroke over all 35,000 stops (about 2 ms measured).
* Merge: the local answer stays on top, the server adds only new stops and places (by id and by name); spinner only with nothing shown; the server pause is 250 to 300 ms.
* On a device (not done yet): Plan, Departures, type "kat": Katoomba Station shows with no spinner, in airplane mode too once the lists are kept; type "12 george st" in Trip: stops first, then the server's street and address rows.

### `backend/test/speed.test.mjs`: 6 tests, 6 pass (26 Oct, speed (g10), server)
* Stop search from our own index without a Trip Planner call (wollongong stn, katoomba, kings x, parra, manly wharf, 213516; albury stn through the route with no upstream call); an unknown name is not clear.
* Search copies: one per query in lower case with single spaces, only `q` on search routes folded, 6 hours; live boards stay at 15 s.
* Saved board keys: a live board for now (with mode) is saved, a board at another time or a trip is not.
* A first open with no edge copy gets the saved board at once with its real `dataAt`, services that left taken out, the fresh board still fetched in the background.
* Warming limits: 50 hubs, all real names in our station lists, at most 8 calls a minute, a day cap under 45,000, none at night, none while busy.
* Smart Placement in `wrangler.toml.template`.

### `app/test/speed10.test.mjs`: 4 tests, 4 pass (26 Oct, speed (g10), app side)
* Quick ask: 2000 ms for an answer whose dataAt is 21 or 45 s old, null at 20 s or newer, null once done, null with no dataAt or a dataAt ahead of the phone.
* `Poller.soon`: one run 2 s later, then the 15 s gap again; nothing while the screen is off view.
* `prefetchDue`: the same stop at most once every 10 s; the map stays at 30 entries or fewer.
* Wiring: `prefetchStop` exported and called on press in (Ask, route stops, Opal machines), `useLive` asks again once per opening, the trip list uses `useCountdownNow`, the window background is set through a feature detected `expo-system-ui`.
* On a device (not done yet): open a stop that nobody has opened for a minute, see "Updated N s ago" then fresh times within about 3 s; touch and hold a stop row in Ask, release, the stop screen opens with departures and no spinner; trip list "1 min" turns to "Now" on the minute; dark mode, push and pop a stop, no white strip.

## Tonight's update (27 Oct, 11:34 PM, `f5b9ac08-d95b-4f95-8cbb-35b744ed58bb`)
No new tests. Run on main 75dc077 before publishing: backend 559 of 559 (`TZ=Australia/Sydney`, real clock at 11:20 PM, no fake clock needed), app 814 tests, 811 pass, 3 skipped offline, 0 fail (`OFFLINE=1 TZ=Australia/Sydney`), battery 17 of 17, `npx tsc --noEmit` clean. Preview and production manifests: runtime 1.0.0, launch asset hashes equal to the export. Device checks still to do: every device check listed for the 27 Oct sections above, on an iPhone (build 201 to 208) and an Android phone after closing and reopening twice.

## Network pass (27 Oct, 9 PM, poll tags)
### `backend/test/net-pass.test.mjs`: 8 tests, 8 pass
Newer app board rows lose modeName and wheelchair and keep the rest (nulls too); an old app gets the same bytes, no tag and no-store (and a full answer to a tag it never got); the tag leaves out only "now" (a moved time and dataAt change it); a matching tag (weak or strong) is a 304 with no body, x-now, x-edge-cache and x-serves; every polled path is tagged and saved, watches, home and search are not, errors are not; POLL_TAGS=off and kill.pollTags turn tags off and keep the trim; search and places are public for an hour with x-public-ok or the ids, never for stand ins or errors; trimBoard leaves anything not a board as it was. `speed-part2.test.mjs` expects poll-tags in x-serves.
### `app/test/polltags.test.mjs`: 6 tests, 6 pass
Which addresses are polled; tag header values; a kept answer comes back on a 304 with x-now (dataAt never moved, no now added); old, oversized and untagged answers are not kept; bounded by count and size, oldest out first; api.ts sends the tag only for polled GETs while the server says poll-tags, keeps the answer on a 304, search and places send x-public-ok, and Delete all my data clears it.
### On a device (not done)
Open a board, wait for two refreshes with no change: the second should be a 304 (Workers Logs or a proxy), the countdowns keep moving, the Updated line stays honest. Type a stop name, clear it, type it again in a new session: answered with no request.

## Home in one request and recovery (27 Oct, home bundle)
### `backend/test/home-bundle.test.mjs`: 7 tests, 7 pass
x-serves names home-bundle; parts come back in order and each equals the same read asked on its own; one Trip Planner call per board, and the same read twice runs once; only Home's reads (ask, budget, another host, format=text, trip/live are refused per part with no upstream call); no reads or more than 10 is 400; a part still waiting at 2.5 s is answered late and handed to waitUntil; HOME_BUNDLE=off is a 404 and the word leaves x-serves. `backend/test/speed-part2.test.mjs` expects the word too.
### `app/test/homebundle.test.mjs`: 10 tests, 10 pass
Which reads may be bundled (no paging or refresh trips, no text answers); the bundle address; first start sends nothing and keeps the reads of the 6 s window; next start sends one bundle and each read takes its part once, waiting while it is out; a late part, a failed bundle or a wrong part count send the read on its own; another server never takes a part; parts expire after 10 s; one read is not a bundle; config only when due; a write empties bundle answers; an empty window keeps the old list; at most 10 reads; the recovery waits (any stand in, slow planner first as Getting live times, then 5, 10, 20, 40, 60 s; failures the same after the quick asks); wiring in api.ts, config.ts, boot.ts, _layout.tsx, Home and hooks.ts (foreground re-ask with a plain read, never later than the normal gap). `app/test/coldopen.test.mjs` now checks the general stand in ask.
### Results (27 Oct, about 2 PM): app 782 tests, 779 pass, 3 skipped offline, 0 fail (`TZ=Australia/Sydney OFFLINE=1`, includes battery 17 of 17), `npx tsc --noEmit` clean; backend 518 of 518 (`TZ=Australia/Sydney`).
### On a device (not done yet)
After tonight's update: open the app twice (the first open notes Home's reads); on the second, Home should paint from the kept copy and its cards turn live together. Then put the phone in Airplane mode on Home for a minute and turn it off: the cards go live again within about 5 to 20 s without a pull. Leave the app on a timetable stand in and come back: it asks at once.

## Home cold open (27 Oct, after the 8:35 AM "No live times")
### `app/test/coldopen.test.mjs`: 12 tests, 12 pass
Quick asks after a timeout, a 5xx or a slow answer (1.5 s, 4 s, then the failure shows on the third in a row; no connection: the second); a live answer over a minute old is not kept through one; the slow planner stand in asked again at 6 s and 10 s (an outage stand in is not); the header says Updating while any first request is out, never "No live times", and "No live times" once every card has had its answer or its failures; the 8:35 AM sequence replayed (timeout, quick ask, stand in, live) never shows unavailable; a real outage still says so; `TRIP_MS` at least 4 s over the server's `TRIP_QUICK_MS` plus `TRIP_STANDIN_MS` (read from backend/src/worker.js); one slow trip does not mark its pair long, the second does; the poller takes a run's own next wait once, does not count it towards the back off, and runs nothing while the app is away; the commute card's trip for now; source checks (the quick ask is decided before any error is set, the commute request goes out before Home draws and is the same request as the card's). `outage16.test.mjs` now expects `TRIP_MS` 13000.
### Results (27 Oct, about 9:10 AM): app 715 tests, 712 pass, 3 skipped offline, 0 fail (`TZ=Australia/Sydney OFFLINE=1`, includes battery 17 of 17), `npx tsc --noEmit` clean. No backend change.
### On a device (not done yet)
Turn on Airplane mode for 20 s after opening Home with a kept copy: the card shows "Updating, times from ..." and the header "Updating", then "Offline" after the second failure. Open Home on a cold pair: "Updating" until the first answer, timetable trips with "Timetable times for now. Getting live times." if the planner is slow, live within about 10 s more.

## Get off alert and the delay once on Home (26 Oct, g32)
### `app/test/getoffspoken.test.mjs`: 16 tests, 16 pass (28 Oct)
Get off alert you choose, spoken. Replays an express T9 that runs through two stops, every 15 s with the phone's scheduled alerts simulated. Stop counting: 1 early is the last stop it calls at, 2 early skips the stop it runs through, 3 early on a ride with only 2 calls gives no heads up (Get off now still once); an all stops run counts every stop. 2 stops early, on time and 3 min late: rings as it leaves the stop 2 calls before yours. Spoken Get off now with Speak alerts off, on time, 2 min late and 1 min early: said once as "Get off now at Rhodes.", marked quiet (follows Silent mode), in the 30 s before the live arrival; the heads up is not spoken. Speech off: nothing said, the alert still rings on time. Get off now off: nothing said. Speak alerts on: both said, not quiet. Never after arrival: opened after arrival, nothing rings or is said; rung by the phone with the app closed and opened after arrival, not said late; opened before arrival, said before arrival. No live times: said with the timetable alert, before arrival. Words, stored choice (on unless false), menu labels, change words. Source checks: speech feature detected, quiet skips the app session, menu item only where it can speak, no `setInterval`.
### Results (28 Oct, morning, on main 007b877 plus this change): app 857 pass, 3 skipped offline, 0 fail (`OFFLINE=1 TZ=Australia/Sydney`, includes battery), `npx tsc --noEmit` clean. getoff30 12 of 12 and getoff 20 of 20 still pass.
### On a phone after the update (not done)
Ride with Speak alerts off and the ring switch on: hear "Get off now at <your stop>" about 30 s before arrival with the app open. Flip to Silent: the alert still shows, nothing is said. Turn off Speak Get off now in the menu: nothing said. Pick Alert 3 stops early on an express: the heads up comes 3 calling stops before yours.

### `app/test/getoff30.test.mjs`: 12 tests, 12 pass (28 Oct)
Get off now 30 s before the realtime arrival, from a rider who got it after getting off. Replays an Epping to Rhodes T9 every 15 s with the phone's scheduled alerts simulated. Lead times (30 s live, 60 s timetable) and the default on. On time: once, in the 30 s before arrival, with the app open, closed at the start, or closed mid ride. A stop list trailing the train by 90 s (the cause of the late alert): still in the 30 s before arrival. 3 min late from minute 3: follows the realtime arrival and is set again. 1 min early: moves earlier and rings before arrival. Opened after the arrival: nothing rings or is set. Opened inside the last 30 s: rings at once, before arrival. No live times: a minute before the timetable arrival. Turned off from this version: nothing set. Every set time is before the arrival it was set for (lag 60 s, late, early). Trip card stale date: at the arrival where you get off while on board, unchanged while waiting and on builds without the honest stale card. The notification is time sensitive (source check).

### `app/test/getoff.test.mjs`: 20 tests, 20 pass (updated 28 Oct for Get off now on by default)
Replays a Strathfield to Central T1 (5 stops ridden) every 15 s with the phone's own scheduled alerts simulated (they ring at their time, app open or closed). Default (1 stop, Get off now, 28 Oct): the Next stop alert, once, as the train leaves Redfern, and Get off now once. A choice saved before 28 Oct with Get off now off reads as on; one turned off from this version stays off. 2 and 3 stops before, on time and 4 min late: one heads up as the train leaves that stop (within one refresh), before Next stop, nothing left set. 2 stops with the app closed: the phone rings it at the live time. A delay that shows up mid ride moves both alerts. Get off now: once, after Next stop, in the minute before arrival, app open and closed; on a 1 minute last stretch it waits for the train to leave the stop before. A ride shorter than the choice: no heads up. No live times: nothing set. Back to 1 stop before it rings: both taken back, Next stop stays. Turned on past the moment: no late heads up, Get off now still comes. Speak alerts: each read out once, the existing "Your stop is next" line stays. Words at a change name the next line. Switch to this drops the replaced legs' alerts. Source checks: engine, row, End trip cancel, no `setInterval`, high accuracy, location watch or native module call, no dashes. Where the bus is beside a status that shows the delay: "3 stops away" only (a11y too), the delay still colours it; Home's two call sites pass it.
### Results (26 Oct, about 9:20 PM, on main 1dca4d5): app 688 pass, 3 skipped offline, 0 fail (`OFFLINE=1`, includes battery), `npx tsc --noEmit` clean. No backend change.
### Screens
`app/test/e2e/getoff.mjs` on the web export against `test/e2e/mockapi.mjs` (no NSW call), with a seeded live trip Strathfield to Central and its run answered by the script. At 390 x 844 and 430 x 932, light and dark: the row reads "Get off alert, 1 stop before" with "As you leave the stop before Central"; the menu opens; 3 stops before and then Also Get off now are kept on the phone; the app set "3 stops to Central" for Croydon's live time and "Get off now: Central" for a minute before the live arrival; Home shows "4 min late" once and "3 stops away". All four passed with no page errors. `app/test/e2e/riderwins.mjs` now expects "3 stops away" alone.
### On a phone after the over the air update (not done)
1. Start a trip of 4 or more stops with live times, choose 3 stops before and Get off now, lock the phone: "3 stops to ..." as the service leaves that stop, Next stop at the stop before, Get off now about 30 seconds before arriving, never after (a minute before the timetable arrival with no live times). Each once.
2. With Speak alerts on and the app open (build 206 or later): "3 stops to ..." and "Get off now. ..." are heard once each. On a build without the speech module the row still works and nothing is said.
3. Change back to 1 stop before mid trip: no heads up or Get off now arrives.
4. Home with a live bus trip: "N min late" in the status line, "N stops away" under it, the delay not repeated; VoiceOver reads it once.

## Four rider wins (26 Oct, g31)
### Max walk chips (28 Oct)
* `cd app && TZ=Australia/Sydney OFFLINE=1 node --test test/maxwalk.test.mjs`: 6 tests. Per trip choice first, else the older one for every trip, else Any; Any set on purpose for one trip stays; broken values read as Any; setting one trip leaves the others, newest kept, at most 100; chips 5, 10, 15 with a kept 20 shown while on; pressing the chip that is on goes back to Any; `walkKey` changes with either part; the server echo read (none from an older server); a 22 min walk left out with a 10 min cap, every trip over keeps them all and suggests Prefer bus; source checks that the trip screen reads `tripWalk` for its trip, asks again and drops old batches when the choice changes, the chips are buttons with a selected state and no timers or location, and Home's read ahead reads the same trip's choice.
* `cd backend && TZ=Australia/Sydney node --test test/trip-walk.test.mjs`: 8 tests, fetch stubbed, no NSW call. `maxWalk` and `lessWalk` parsed (5, 10, 15, 20 only), the planner options, refusal means a 4xx other than 403, 408, 429; the page window, long trip and copy keys apart from the plain trip; an older app's request asks the planner with no walking option and has no `walk`; the chips' request carries all five options in one call and echoes `walk`; a refused or empty answer is asked once more without them (`dropped`); `WALK_PLANNER=off` sends none.
* `app/test/riderwins.test.mjs` and `app/test/speed27b.test.mjs` updated for the chips and Home's per trip read ahead. `app/test/e2e/riderwins.mjs` now taps "Max walk 5 min" and reads `tripWalk` (not run in this change).
* On a phone (not done yet): open a trip, tap Max walk 10 min; trips with a longer walk go with a note; open another trip, it is still Any; close and reopen the app, the first trip is still 10 min. Tap Prefer bus on a trip that offers a long walk and a bus, the bus trip comes first. VoiceOver reads "Max walk 10 min, on".

### `app/test/riderwins.test.mjs`: 13 tests, 13 pass
Where the bus is: words for 0, 1 and several stops, late, early and on time, the delay at your stop from `ahead`, and nothing for a timetable row, no position, no stop count, more than 20 stops, a passed stop, a cancelled service, a position over 3 min old, a row that is Not tracking, or a walk. Walking: longest walk, the limit with the count left out, every trip over the limit (all stay), Prefer a bus moving a long walk below a shorter one arriving within 10 min and not otherwise, stored values read back safely, query words only when set. Get me home: no Home, no location, outside NSW, the point id in the server's own format (longitude first). Stand pin: the path's first point, stand, wharf and platform names, no pin without a path, across the road only from the right side of a bus's road within 12 to 300 m and never for trains, maps links per platform. Source checks: the three Home and trip row places, the Walking row and filter, stand pins, no recent trip or Save for a trip from your position, Get me home on Home with balanced accuracy, no `setInterval` or high accuracy. Cases from Parramatta, Newcastle, Wollongong, Manly and Penrith.
### `app/test/plan.test.mjs`
The trip screen's request check now includes the Walking choice (`walk: wp`).
### Results (26 Oct, about 9:00 PM, rebased on main c57af63): app 668 pass, 3 skipped offline, 0 fail (`OFFLINE=1`, includes battery), `npx tsc --noEmit` clean. No backend change.
### Screens
`app/test/e2e/riderwins.mjs` on the web export against `test/e2e/mockapi.mjs` (the real server code, fake Transport for NSW, no NSW call). The mock has no live vehicle feed, so the script gives the first ride of each trip answer a live position (3 stops away, 4 min late), a bus stand, a short northbound path and a walk from the far side of the road. At 390 x 844 and 430 x 932, light and dark, it checks: the Home card line, the Get me home row, its tap opening the trip from your position (no Save button), the Walking row, the row line, the stand pin row with the across the road hint, the map and Walk there in Maps, the Walking menu and Up to 5 min kept on the phone. All checks passed in all four, no page errors. Not tried on a real phone.
### On a phone after the over the air update (not done)
1. A saved bus trip with a live bus: the Home card shows "N stops away" and it counts down as the bus moves; it goes when the row shows Not tracking.
2. Trip screen: Walking, Up to 10 min; trips with a longer walk go with a note; close and reopen the app and it is still Up to 10 min.
3. Get me home from away from your Home stop: the trip screen opens from Your location; with location off, the message and Open Settings.
4. An open bus trip: Stand on the map opens a pin on the right kerb; Walk there in Maps opens Apple Maps walking (iPhone) or the maps app (Android).
## Button and screen check (26 Oct, g23 and g23b)
Full results and how to run it: [BUTTON_CHECK.md](BUTTON_CHECK.md). `app/test/e2e/buttons.mjs` (54 main path buttons) with `app/test/e2e/mockapi.mjs` (this repo's server code, a fake Transport for NSW, a clock set with `AT`, services `HEADWAY` minutes apart, `LATENCY` ms on every answer): 54 of 54 at 1:00 AM, 8:10 AM and 5:30 PM busy (2 minutes apart, 0.8 s late), 12:48 PM, and with the iPhone look; 51 of 54 at 8:10 AM busy on the export before the leave line fix. `app/test/e2e/sweep.mjs`: 27 screens at 390 x 844 and 430 x 932, light and dark, both looks, no page errors or bad words; every control tapped once (each tap with no visible change explained in BUTTON_CHECK.md). `app/test/buttoncheck.test.mjs`: 2 tests, 2 pass (an ended watch, an empty car park list). On a phone (not done): open an old watch from a notification after it ended; More > Car parks with no signal.

## Limited stops and alerts for my trips (26 Oct, g22)
### `backend/test/limited-stops.test.mjs`: 4 tests, 4 pass
Rail patterns that skip stations a third of the trips stop at are limited; all stops and short runs are not; buses need 4 skipped stops and a quarter of the stretch; route names with express or limited stops count. Generic made up networks.
### `backend/test/raptor.test.mjs`: 2 more tests (11 pass)
`rpLegs` marks a limited trip's leg; `markLimited` marks departures and legs from the cached id list and from the description, never waits on the planner, and does nothing with `LIMITED_STOPS=off`.
### `backend/test/trip-alerts.test.mjs`: 6 tests, 6 pass
Trips are cleaned; which alerts touch a trip (its line on its stretch, the whole line, its own stops, platform ids mapped to the station; not the same line past where it gets off, not another line); live problems only from an hour before to two hours after a travel time, once a day, none for a trip with no times; planned work once from 6 PM the evening before, nothing at night outside a travel time; one push for several; turn on, push when due, once, turn off (real SQL on node:sqlite).
### `backend/test/history.test.mjs`
Delete all my data also deletes the device's `ta:` row.
### `app/test/limited.test.mjs`: 2 tests, 2 pass; `app/test/tripalerts.test.mjs`: 4 tests, 4 pass
The tag shows from the server mark or "Limited stops" in the description only, sits on departure rows and trip legs, has a label and no tap target. Trip legs from the Home card, reminder and morning check days, at most 8 trips, the change key; no `setInterval` or polling in the sync, the switch asks for notifications and shows only with `flags.tripAlerts === true`.
### Results (26 Oct, about 6:10 PM): app 674 of 674 (`OFFLINE=1`, includes battery), `npx tsc --noEmit` clean, backend 396 of 396 (after rebasing on main 52b235c)
### Screens
Web export against a local copy of the server with a fake Transport for NSW and a fake limited list: a station board, a trip and More, at 390 x 844 and 430 x 932, light and dark, iPhone and Android look (24 images, g22 task folder). Not yet seen on a real phone.
### On a phone after the server deploy (not done)
1. More > Alerts for my trips: switch on, allow notifications; `GET /api/trip-alerts?device=` says `on: true` with the number of trips on Home.
2. Add a reminder to a saved trip; the trips are sent again once (one POST) and not on the next app open.
3. A real alert on a saved trip's line within an hour of its reminder time gives one push; an alert on another line gives none.
4. Switch off: the row is gone (`on: false`).
5. A board with a limited service (for example an express on an intercity line) shows the tag after the nightly pack has `tripLim`.

## Live checks after a deploy and of the live state (26 Oct, g21)

* `node tools/verify-deploy.mjs`: 12 checks against api.transportsydney.app with no Transport for NSW call (`/api/lines`, `/api/trackwork`, `/api/health` 403 without the key, `/api/usual`, `/api/stations`, `/api/parking?live=0`, `/api/app/config`, `/live/`, a 404, and a shared live trip link made, opened and ended). `--live` adds departures at Central and a Central to Strathfield trip. Exit 1 when any check fails. Run on 26 Oct, 4:12 PM: 12 of 12 ok.
* `node backend/tools/match_x.mjs --dry --load` (with `tools/local-dev.mjs` running): the board engine match check against the fake network, staggered warm up and stand names included, no NSW call. 27 Oct, 8:27 AM: 370 of 370, 12 planner boards read for names in 32 s. The live run (`--live`, 11 PM to 5 AM only) is in docs/ENGINE.md.
* `node tools/orient.mjs`: read only state (see docs/START_HERE.md). Run on 26 Oct, 4:18 PM: every section read.

## Backend unit tests

Time of day (27 Oct): tests that build a timetable around "now" pin their own clock where the hour matters (`engine.test.mjs` "a bus after midnight" at 00:35; `trip-days.test.mjs` packs on the planner day, 3 AM to 3 AM). To check a change for this, run the suite with `Date` shifted to other hours: a preload that offsets `Date.now()` and `new Date()` by `FAKE_AT` (epoch ms), `FAKE_AT=<ms> TZ=Australia/Sydney node --import ./fakeclock.mjs --test test/*.test.mjs`, at least once before 3 AM and once after 2 PM. Use a future time: `trips-compare.test.mjs` "a run end to end" starts a child process on the real clock and fails with a clock moved back.

Board engine (`backend/test/engine.test.mjs`, `engine-metro.test.mjs`, `pack.test.mjs`, `outage-fallback.test.mjs`): since 28 Oct also Sydney Metro from its own feed (`engine-metro.test.mjs`, 5 tests): a copy of another timetable version found by sampling (at most 12 lookups, 3 needed, 20% found or less), its trips listed live on their own platform at the whole planned minute with the update's destination, the other version's rows dropped up to the copy's last time at the stop and kept after it, a cancelled trip left off, an unknown route id taking the feed's one route, a shard's board the same as the core's, a copy whose trip ids match used as before, a train copy of another version still listing none, `ENGINE_FEED_ONLY` off. since 27 Oct, 8 AM also stand names (7 tests): names per stop id from a planner board (one name agreed, conflicts teach nothing, a moved stand only when every service shows it, never a train platform change), a moved stand learnt by the core from the shards' queue and reaching the shard as a change with no window read again, kept across a restart and not asked again, never over a stand the timetable names, ended by a plain planner board or after 36 hours, `ENGINE_LEARN_MOVED` off, the planner read budget (a bucket a minute, a cap a day, a failed read waits 30 minutes), `ENGINE_LEARN_CORE` off keeping the old first read rule, a shard whose windows were dropped still building every board that tick, and Empty Train rows left off listed in `engine.emptyHidden`. Since 27 Oct, 2 AM also an Empty Train run listed only with a live time here (to the update's last stop; off with no update, cancelled, no live time or `ENGINE_EMPTY_LIVE` off), a train the timetable lacks listed from the feed (whole minute planned time plus the delay, its platform, only on train boards, the older trip id of the same run dropped, through a shard too, none listed when most of a copy is unknown or `ENGINE_ADD_UNKNOWN` is off); CPU by `tools/engine-cpu.mjs`. Since g14 also the delay winning over the update's own time, whole minute planned times with the live time the minute plus the delay, Empty Train and Not In Service left off, a shard's board the same as the core's, shards spread over stops, a stop with a line the timetable lacks marked (engine.gap) and cleared, the outage fallback (labelled timetable rows, live rows only from a feed copy under 60 s, never stored as a copy, not for set times). Earlier (15 tests): boards from the timetable plus trip updates, delays carried down the line, cancelled, skipped, platform change, replacement and added services, loop services (the stop sequence decides which call an update is for), feed calls per feed not per phone (200 reads of 3 boards), and the feed bucket after a crowd of first reads (it is charged for fetches started, not for waits). Live checks that are not unit tests: `match_api.mjs` (engine against the Trip Planner, 30 stops) and `load_engine.mjs` (simulated phones), both in the g11 task folder; results in docs/ENGINE.md and docs/SCALING.md.

### `backend/test/service-runs.test.mjs`: 14 tests, 14 pass (26 Oct, g24 stop lists from the timetable run)
Builds a real planner pack with `tools/build_planner.py` from `backend/test/fixtures/gtfs-runs` (a cut of the 23 Oct NSW GTFS bundle: T1, T2, T5, T8, T9, M1, L2, F1 and buses). Checks: `tripNext` links split train runs and nothing else; a T9 via Central from Gordon runs on to Hornsby with Central once and times only going forward; asked from the second trip, the run reaches back through the first; a T5 keeps every stop to Blacktown; a T1 via Gordon from Penrith reaches Hornsby; a City Circle run is not followed (`reached` false); light rail, metro, bus and ferry trips give their whole list; unknown trip or stop gives null; a pack without `tripNext` keeps a split train on the old way; `runDest` drops a passed via; `runStops` lays each trip's feed on its own stops and refuses a changed trip; the planner object's `/run` and `ownRun`'s edge copy and `OWN_RUNS=off`; `/api/service` takes a T9 list from the run with no trip search; the outage fallback answers Circular Quay to Manly on the F1 (the service's last stop), labelled. Full 27 Oct pack check by hand: 10,470 trips, 0.7 ms a run, no times going backwards. Not checked: a phone against the live server (needs the deploy, the nightly pack and the budget guard lifted).

### `backend/test/shared-fetch.test.mjs`: 13 tests, 13 pass (26 Oct, shared fetching for many phones)

1. 50 phones asking for one stop at once make one upstream call; every phone gets the answer (1 miss, 49 shared), stored once keyed by the stop only
2. A second stop is its own key and its own call
3. A refresh skips a 20 s old copy while upstream has room, is served that copy when upstream is busy (no upstream call, honest dataAt), never a copy over a minute old just for being busy
4. Transport for NSW over its rate limit: the last copy instead of an error, then a 2 s back off; with no copy the usual 502
5. A load test request counts as busy from 1 call a second, a phone from 3
6. Over the day's quota backs off a minute; other 403s do not count; the hub's 429 counts (2 s with a good answer in the last minute, a minute without)
7. Rate and quota headers from the hub are kept for /api/health
8. The per address limit turns a phone away; the load test key is counted the same but not turned away; a wrong key or no secret matches nothing
9. With a copy in hand a slow upstream answer is waited for 700 ms at most, then the copy; the answer is stored for the next poll
10. With no copy a phone waits for the answer however long it takes
11. A 429 over the hub limit is asked again after a short wait, so a phone with no copy gets the answer
12. Over the day's quota is not asked again
13. At most 4 Trip Planner calls start in any second in one copy; the fifth waits for room

Also changed: `fresh-refresh.test.mjs` (a refresh that skips an old copy says `x-edge-cache: miss`) and `profile.test.mjs` (copies stored with a 120 s lifetime). Whole backend suite on 26 Oct, 10:44 AM: 295 of 295 pass.

### Load test (26 Oct, 10:14 to 10:48 AM, live server)

Simulated phones against api.transportsydney.app with the `LOAD_TEST_KEY` secret set for the test only: 100 phones for 2 min and 1,000 phones for 3 min (30 s ramp), polling every 15 s like the app, Zipf weighted over 125 real stops and 20 trip pairs. Last runs: 100 phones p95 783 ms, 0 errors; 1,000 phones p95 678 ms, p99 2.6 s, 18 errors of 11,375 (Transport for NSW's limit in the first 15 s), 0 errors after the ramp. Method, every run and the quota maths: [SCALING.md](SCALING.md).

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

### `app/test/servermove.test.mjs`: 9 tests (added 26 Oct, the server move)
Start address (a stored first server is replaced once, then a stored address is kept so remote config can move the app back), fallback only on no answer or a 5xx (never a 4xx), the one minute hold on the first server and its end on a new server answer, `getJson` with a mocked fetch, reads fall back and writes do not, no second try after a time out, honest "Updated" from `dataAt`, and the morning checks carried over once within the per phone limit.

### `app/test/perf.test.mjs` and `app/test/battery.test.mjs`: 3 more tests (26 Oct, freshness)
Adaptive gap 15 s up to 10 minutes, 30 s to 20, a minute beyond; trip lists 15 s within 10 minutes, else 20 s, on the trip screen, Simple mode and Home cards; `retime` makes the first refresh 15 s after opening instead of 60 s, and adds no run while the app is away.

### `backend/test/fresh-refresh.test.mjs`: 4 tests (added 26 Oct, freshness)
A stored copy carries `x-stored-at`; a cached answer carries `dataAt`; `refresh=1` takes a copy up to 5 s old and skips an older one or one with no time, while a plain open still takes the 15 s copy; the departures copy is 5 s for a refresh.

Live freshness check (26 Oct, 9:31 to 9:53 AM, before and after the server change): the Trip Planner and both servers asked every 3 s for Central and Strathfield for 7 minutes each; results in [PERFORMANCE.md](PERFORMANCE.md).


### `app/test/race.test.mjs`: 12 tests, and 2 more in `app/test/offline.test.mjs` (26 Oct, item 1: speed and offline)
The latest answer rule (`createLatest`, `createStamp` in `pollCore.ts`, used by `useLive` and `useStamp`): an answer for the service shown before never lands under the new one, the new key asks at once, the old round's signal is aborted, one request out per round, an old round's failure is not shown, a closed screen drops what is on its way, six quick switches keep only the last answer whatever order they come back in, a batch for an old query is not added to the new list; every screen's one off loads are guarded (trip list batches and Plan B, Simple mode, walk search, next option, live trip engine); every screen with a kept copy labels it; startup work waits for the first screen. Offline: "Updated 4 min ago, refreshing" wording, 32 copies, the service screen's own copy.
Browser checks (26 Oct, 1:00 AM): 6 stations (Central, Parramatta, Hornsby, Chatswood, Liverpool, Gosford) at 390 x 844 and 430 x 932, light and dark, live; kept copy 12 min old and no signal at Central, Hornsby and Liverpool; the trip list Parramatta to Central with no signal and Hornsby to Chatswood with an 8 minute old copy; Home and the board with no signal; Platform view at Hornsby with a kept copy: 68 screens, every one shows its label, none shows kept times as live. Screenshots: files/item1-speed/ on the build box.
`test/e2e/buttons.mjs`: Later services now scrolls to the end of the list (the list loads later services by itself since the endless list; there is no button) and Save trip taps the star, then Save trip in its menu (Save trip, Save as Home, Save as Work). The two Morning checks that failed at about 12:20 AM passed on the old and new builds at 1:02 and 1:06 AM.
Device checks still to do: a fresh start with no signal on an iPhone and an Android phone shows the kept times with the Offline line on Home and a stop; the Updated line goes once the live answer lands; switching quickly between two stops or two trains never shows the first one's times under the second.

### `app/test/platform.test.mjs`: removed 26 Oct with Platform view (was 13 tests, added 25 Oct, 11:17 PM)

Platform view and the wide window fixes. Which service shows (the next train or metro, or the held one while it is still on the board) and the next two on any platform; platform numbers and Platform not given yet; carriages only for a sensible live count; Limited Stops or All stops only from the service's own words; the stops after this station from a real T8 stop list read at Central (its two airport stops came back with no name and are named from the station list; skipped stops left out and said); a stop list without this station gives no list; the screen reader and Speak lines; two columns by width; the portrait lock only on a phone sized window; Platform view in the hold menu only for rows that pass it; the header button only at a station with trains or metro; side safe areas in TabBarSafe and Simple mode.

Platform view station board look (25 Oct, 11:57 PM update): `app/test/platform.test.mjs` adds the "via" split of the destination, what the stop list says when it has no names (Loading stops, Full stop list not available yet for an empty, busy or mismatched list, This service is cancelled, Stop names not given, This station is the last stop) and the board's parts (orange Next train bar with Time now, the stop list in its own ScrollView with its screen reader label, Departs, Next service, Speak with the voice offer, Reduce Motion, no dashes). `backend/test/service-planner-busy.test.mjs`: a 429 from the trip planner is retried and the list comes back; still busy gives `stopsStatus: busy`; a list from the last minute is reused without a planner call (in memory and from the edge cache); a later busy answer uses the kept list marked `stale`; no such run is `notFound`; two identical requests at once share one planner call. Live checks on 25 Oct 11:37 PM to 11:53 PM at Central, Chatswood, Liverpool, Town Hall, Redfern, Parramatta, Hornsby and Gosford (see docs/API.md, stopsStatus).

Platform view fixes (26 Oct, after Bidur's phone at 11:59 PM and 12:00 AM): `app/test/platform.test.mjs` adds gone services (an untracked row past its timetable minute, a not tracking row past its timetable time, both left out of the next train and the Next service rows; the same row with a fresh position stays), the minute boundary (a live delayed train until a minute after its live time, an untracked one until its own minute ends), ordering by the time shown, two different trips at the same stop never sharing a stop list (`serviceKey`, `serviceFits`), a list without this station not shown, clock times fitting one line at text sizes 1, 1.2 and 1.4 (`fitSize`), and the board source (Departs under the platform, no stretched board, the shared live label, the keyed stop list). Live check: 12 stations (Central, Town Hall, Parramatta, Hornsby, Epping, Chatswood, Liverpool, Penrith, Gosford, Wollongong, Bondi Junction, Tallawong) at 390x844 and 430x932, light and dark, plus 1000x760, with every shown stop list checked against the trip planner's own run; results in the task's test report.

Device checks for the station board (not done yet): on iPhone and Android, the stop list scrolls while the bar, destination, platform, departs and next services stay still; the fade shows only on a long list; the largest text size switches to a whole board scroll; dark mode; VoiceOver reads the destination line, then platform, departs, the stop list and each next service; Speak and the voice offer; an open Duo or fold in two columns.

Train stop lists, 26 Oct (live, the next 8 train or metro services at Blacktown, Parramatta, Central, Hornsby, Chatswood, Liverpool, Penrith and Wollongong, asked the way the app asks): 8:07 AM before any change, 39 of 63 lists reached the end of the line (24 stopped at Central or Strathfield, or were empty); 8:36 AM after transport-api 12a75142, 59 of 63 reached the right end, 54 of 63 match the trip planner's own list for the same run stop for stop (43 against the live planner, 11 against the timetable), 3 more come from the realtime feed with every stop and the right end (the planner had no such run to compare), 2 are right but with blank airport stop names. Not right: 2 City Circle runs at Central (no list), 1 T9 at Hornsby (no list), 1 T2 at Central with 11 of the timetable's 30 stops (the live feed marks the rest skipped). `backend/test/service-dest.test.mjs` and `service-train-feed.test.mjs` cover the destination id, direct services, the timetable second ask, no guess by line and time, the platform of the run's first stop and the feed's partial list. Regional badges: `test/badges.test.mjs`; browser check at Moss Vale (631 Canberra, 623 Melbourne) and Dubbo (592 and 4591 coaches), 390 and 430, light and dark: Regional and Coach fit the badge column, route chips keep the numbers.

Item 3, 26 Oct (brief g7e). Automatic: `app/test/didyoumean.test.mjs` (49 messy station names from all over NSW: slips, parts of names, suburbs with no station, nonsense; all 49 as expected, of which 2 expectations were set after a first run: "Grenwich" picks Greenwich Wharf, "Kings Langly" has no station so it offers stations near Kings Langley; options are real places with modes, at most 5; a suburb choice resolves; Ask fare questions ask Did you mean for From and To and each choice resolves), `app/test/simple.test.mjs` (was due wording, arrive counts a delay once, on demand rows, rankTrips keeps every trip), `app/test/htmltext.test.mjs` and `backend/test/alert-text.test.mjs` (tags, encoded and cut off tags, entities), `backend/test/trip-legs.test.mjs` (on demand legs, airport platform names), `backend/test/service-loops.test.mjs` (City Circle in parts, a run ending at Circular Quay, skipped stops, a via run asked in parts), `backend/test/hosts.test.mjs` (station lists served on the API host with open CORS). App 611 pass, backend 282 pass, tsc clean. Train stop lists live (8 stations, next 8 trains, same minutes, 26 Oct 9:50 AM): old server 54 of 64 whole, new code 61 of 64; left: two runs the trip planner does not return at all (T5 Parramatta to Blacktown, T9 Hornsby "Central via Strathfield") and one that really ends early (T1 at Gordon). Browser shots (web build, 390 x 844, light), files/item3-fares/: Simple mode Strathfield to Five Dock Shops before and after (the live 10:00 AM answer with the 8:50 AM delays put back on the first two T2 trips: 27 and 22 min), and "fare from central to kings" before (picked Kings Cross without asking) and after (Did you mean with 5 choices). Device checks (not done yet): on iPhone, Ask "fare from Strathfeild to Kings" by typing and by dictation, tap a choice; Simple mode at a busy time; an alert with a link in its text.

Platform view was removed on 26 Oct (owner, 5:36 PM; g23, main `e33c2fe`): `app/test/platform.test.mjs` went with the screen; `test/features.test.mjs` now checks that no switch, entry point, menu item or request for it is left, and that `app/+not-found.tsx` answers an old `/platform` link (or any unknown address) with a plain screen and Go to Home.

### `app/test/ask-corpus.test.mjs`: 2 tests, 2 pass (added 25 Oct, 10:45 PM)

309 real world questions with their intent and slots, across the CBD, inner west and south, eastern suburbs, north shore and northern beaches, west, south west, St George and the Shire, the Hills and north west, and regional NSW (Blue Mountains, Central Coast, Newcastle and the Hunter, Illawarra and South Coast, Southern Highlands, country towns), every mode (train, metro, light rail, ferry, bus, coach). Typos, lower case, no punctuation, slang and short forms. At most 5% may name one commute. Run against `askBrain.ts` with the station and suburb lists from `backend/src/public/stations`, a fixed clock (Monday 26 Oct 2026, 7:30 am) and saved places. Prints the pass rate by region, by mode and by batch, and the old path's rate for comparison; fails under 90%. On 25 Oct: before 192/309 (62%), after 309/309 (100%); by region and mode all 100% after. Set `ASK_CORPUS_JSON=<file>` to write the full result.

### `app/test/askbrain.test.mjs`: 10 tests, 10 pass (added 25 Oct, 10:45 PM)

Typo and short form matching against the published lists (and landmarks kept as typed), the clear question sent for each intent, another day and no changes going to the planner, home and work (and the Settings hint when unset), clarifying questions with 1 to 3 choices and under 60 characters, follow ups starting from the times shown and the 30 minute limit, time words, chips from your own trips only, the no change filter, the reply built from the card's own legs, the actions under a card (Open trip, Speak, Directions to Apple Maps or Google Maps), and the engine staying pure (no timers, no network, under 15 ms a question, no dashes).

Device checks (not yet done on a phone): on iPhone and Android, type "chatswod to wynyrd" (Chatswood to Wynyard shown above the answer), ask a trip then "and the one after" (the next service), "katomba to central tomorrow morning" (tomorrow's trips from 6 am), "fastest way to the airport" (International or Domestic chips), "any delays on the t4"; with airplane mode after one use, the question is still understood and the error says no connection; Speak reads the card in the chosen voice; Directions on a car park opens the maps app; VoiceOver reads the understood line, the card and each button.

### `app/test/tripmodes.test.mjs`: 9 tests, 9 pass

Trip screen mode chips (Any clears, toggles, several at once, every chip on is Any, which chips show), bus only filter (coach and school bus count, walks are fine), an honest empty state that depends on who filtered, the endless list's caps (8 later batches at most even when scrolled 100 times, one at a time, none off screen, stop at 4am or when a batch brings nothing new, earlier never before half an hour ago), Sydney days for the picker (AEDT and AEST) and when a date must go to the server, and When carrying a day through route params, the request and the label.

### `app/test/trippast.test.mjs`: 8 tests, 8 pass (Earlier services row and the 4am floor added 25 Oct, 7:35 PM)
A chosen time in the past on the trip screen (Bidur, 25 Oct 7:09 PM: Leave 6:15pm at 6:27pm showed the 6:30 first). The day is pinned when picked (today, or tomorrow for a time over 30 min ago with no day); the request is worked out when sent (a plain time within 30 min, today's date after that, so Leave 6:15pm picked at 6:27pm is still today's at 7pm); a chosen time keeps the planner's whole answer, gone services included, while Now keeps its 2 min and 30 min rules; Earlier reaches back to the start of the service day (4am) on Now and from a chosen time, stepping 40 min, 90 min, then 3 hours over a quiet stretch, one batch a tap; Left words with the live delay, Scheduled without a live time, Cancelled; no em or en dashes.

Browser check (web export, 390x844, real data, 25 Oct 7:25 PM; screenshots and results.json in files/trip-past-25oct): Kings Cross to Strathfield Leave 15 min ago, light and dark (a Left row with its live delay, the next train open); Leave 45 min ago on Today (5 to 6 Left rows, planned on api.transportsydney.app with `date`); the same with api.transportsydney.app blocked (the "Earlier trips need a newer server" note, nothing wrong shown); Leave 15 min ago with api.transportsydney.app blocked (works on the first server alone); Arrive by 10 min ago (all Left); Strathfield to Five Dock Shops Leave 15 min ago, light and dark (bus Left rows with stand); Now unchanged (no Left rows). Not checked in the browser: the pull down gesture for Earlier (React Native Web has no pull to refresh; covered by the unit tests), and the time picker taps (the route's time and date parameters were used).

### `app/test/boardtime.test.mjs`: 6 tests, 6 pass (added 25 Oct, 9:00 PM)
Earlier departures on a stop's board (`app/src/lib/boardTimeCore.ts`): a picked time is that clock time in the service day of now (1:30am picked at 8:46pm is tonight, 11pm picked at 1:30am is the evening before); the request is Sydney HHMM and its day; only an answer that echoes `at` counts (an older server answers for now without it); Now keeps today's board exactly (gone over a minute ago drops off) with earlier batches above it and no duplicates, a picked time keeps its whole answer; Left words with the live delay, Scheduled, Cancelled and On time; the 4am floor, the 40 min, 90 min and 3 hour steps, a short batch filled from its last service up to the list (a board answer is 40 services), only new services before the first one added; the row hidden while loading, when done, at the floor and on a server without earlier times; the exact "newer server" words.

### `backend/test/departures-at.test.mjs`: 4 tests, 4 pass (added 25 Oct, 9:00 PM)
`/api/departures` with `time`: no time is the board for now as before (gone services dropped, no `at`); with a time the planner is asked for it, services that left are kept with `departed: true` and the live delay they left with, and `at` is echoed; `boardAt` uses the current service day with no date, clamps before 4am to 4am, ignores bad input and handles daylight saving; a bad time is still refused.

Browser check (web export, 390x844, real data, 25 Oct 8:51 PM to 8:56 PM; screenshots and results.json in files/board-earlier-25oct): Strathfield from 30 min ago, light and dark (19 Left rows with live delays, then the next services); Kings Cross from 40 min ago, light and dark; Strathfield and Kings Cross from 10 min ago (the change from Left rows to countdowns); Strathfield Now untouched (no Left rows, only the usual server asked); Now with Earlier departures tapped once (Strathfield, 27 Left rows) and twice (Kings Cross, 31); the new server blocked (the newer server note, the row stays for another try); an answer with `at` taken out (the row and the chip hidden, the board stays on now); the time picker with Now and From.

### `app/test/access.test.mjs`: 7 tests, 7 pass

Station access, Park and Ride and Opal machine helpers (`app/src/lib/access.ts`): car park names without the station name, badge, fill and totals, ticket machine wording, step free and lift out chips on trip legs, outages on a journey, https only links, the stop ids sent for lift outage alerts (digits only, at most 40), and one live check that `/api/station`, `/api/parking`, `/api/topup` and an `acc=1` trip send every field the app reads. `OFFLINE=1` skips the live check.

### `app/test/logic.test.mjs`: 10 tests, 10 pass

Run with `cd app && npm test` (Node's own test runner; the TypeScript files are transpiled on the fly). Covers money and fare wording, the Opal peak hours in Sydney time, the live trip maths (waiting until the vehicle passes your stop, next stop and stops left skipping stops it runs through, done after arrival, spare minutes with tight and missed changes, moving to the next leg), cutting the route between your stops, and one live check that plans a real trip with a Concession fare and runs its live service through the same maths. Set `OFFLINE=1` to skip the live check. `npx tsc --noEmit` must pass before any update.

### `app/test/livelabel.test.mjs`: 16 tests

Live labels (`liveLabelCore.ts`): Live with the age of the live time in 15 s steps, Timetable for services with no live time (a passed timetable time shows the time, never Gone or Left), Not tracking when the GPS position is over 3 min old, our copy is over 2 min old with the service due within 10 min, or a live time passed while the service is still listed; cancelled; the row redraw key; `stampSeen`. Recently departed (`recentCore.ts`): Left only when a live time tracked the service to its departure, Due and not tracked otherwise, nothing across a gap between reads, nothing for a service that dropped off early, cancelled rows skipped, newest first, aged out after 10 min. See [Live labels](LIVE-LABELS.md).

### `app/test/stopboard.test.mjs`: 7 tests, 7 pass (3 added 26 Oct, item 2)

GET ON and GET OFF only when a service is opened from a trip or plan, the server's alight flag first, a get off stop before the get on stop not tagged; route chips filter the board and drop a route the board no longer runs. One mode boards (`boardAsk`): only at a stop with several modes and with a mode chip or a route chip on (a route chip asks for buses, the mode chip wins), never for another time or a mode the stop does not serve; a board for one mode is noted apart for Recently departed (`boardKey`); the modes a stop serves change only from a board for every mode (`modesServed`).

### `backend/test/departures-mode.test.mjs`: 4 tests, 4 pass (added 26 Oct, item 2)
`/api/departures` with no `mode` asks the planner for every mode as before; `mode=bus` leaves out classes 1, 2, 4 and 9 at the planner and keeps school buses; `mode=train` asks for trains only; an unknown mode asks for everything.

### `app/test/race.test.mjs`: 4 more tests (26 Oct, item 2: battery and data)
`sharedOnce`: three calls at once on a fresh install make one device id; a failure is not kept. `notesWaitMs`: no push token and nothing watched asks once a minute, watching with no token every tick; a watch started counts at once.

Browser check (web export, 390x844, real data, 26 Oct 8:09am): Strathfield Station, Buses then route 415. Before: 2 rows for the 415 (Chiswick 8:10 and Campsie 8:16). After: 6 (Chiswick 8:10, Campsie 8:16, Five Dock Shops 8:23, Burwood 8:35, Campsie 8:48, Chiswick 8:51), one request to api.transportsydney.app with `mode=bus`. Device check still to do: on a phone at a station with trains and buses, tap Buses, then a route; the list reaches further ahead and All goes back to the mixed list.

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

### `app/test/cardskin.test.mjs`: 11 tests, 11 pass (25 Oct, 8:34 PM update)

The commute card looks (`cardSkinCore.ts`, [HOME-REDESIGN.md](HOME-REDESIGN.md)): the development switch words; colour mixing; plain is the old card; Titanium and Glass keep a ring and go solid on request; Line glow: a 2 pt ring between the line colours in order (two colours meet in a light sheen that is clearly lighter than their straight mix, three are even stops, a repeat counts once, at most three), one line into silver, none is silver, bad colours skipped; in dark both colours in the glow and the #232326 lifted surface (Android's card 3% lighter); in light no lifted surface and a soft shadow; under Reduce Transparency or Increase Contrast a solid 1.5 pt border in the first line colour and no ring, glow or highlight; Line glow is the shipped look; the system action sheet on iPhone, anchored to the + button. Also `app/test/homea.test.mjs` ("Next now, 13 min", "1 minute" spoken) and `app/test/header.test.mjs` (the web header clears expo-router's floating tab pill; iPhone and Android headers unchanged).

### `app/test/plusmenu.test.mjs`: 6 tests, 6 pass (25 Oct, 8:56 PM update)

The + menu on Home (`menuPlace.ts`, `AnchoredMenu.tsx`): the menu sits under the +, right edges lined up, 8 pt below on iPhone and 4 dp on Android, inside the screen, above the button when there is no room below, narrower on a narrow screen; iPhone uses a `Stack.Toolbar.Menu` with SF Symbols and no action sheet or Cancel; the drawn menu has button rows, a Close menu backdrop, 13 pt and 4 dp corners, the solid look and the action after the menu has gone; no dashes or repeating timers.

### `app/test/nativemenus.test.mjs`: 13 tests, 13 pass (9:20 PM update)

Native menus (`menuCore.ts`, `HoldMenu.tsx`, `RowMenu.ios.tsx`, `EditorSheet.tsx`): Cancel rows dropped, destructive rows red and last, rows with no action dropped; SF Symbol and Android icon per action, every Android icon key exists; given symbols kept and an empty one means none; older builds get the old sheet with Cancel last; every menu row is a VoiceOver action after the row's own and never twice, and only menu actions run a menu row; which menu each phone gets; no ActionSheetIOS outside Sheet.tsx and no direct nativeMenu calls; feature checks before any native view, the debug switch __DEV__ only, @expo/ui required only after the check; Save this trip as a bar button menu; the editors have the grabber and drag to close; no dashes.

### `app/test/voice.test.mjs`: 9 tests, `app/test/perf.test.mjs`: 7 tests, `app/test/simple.test.mjs`: 6 tests (25 Oct, 9:40 PM update)
Voice ranking (Premium, then Enhanced, then default; en-AU first; novelty voices out; compact only tip), announcer sentences and the sample; adaptive polling gaps, the whole minute countdown clock, the kept copy first, Reduce Motion on the live dot, one haptic at leave now and arrival; Simple mode rows, stand chips from `/api/nearby`, the page it opens on, off by default, only the page on view polls, `Accuracy.Low`. 500 pass in all.
Device checks still to do: on an iPhone with only the default voices, Speak departures on the board sounds natural (not the robotic compact voice); Simple mode at a Strathfield bus stand picks the right stand; VoiceOver reads a Simple row as one sentence; Reduce Motion stills the live dot.

### `app/test/simple.test.mjs`: 9 tests (25 Oct, Simple mode Plan Your Trip update)
Simple mode is one plain screen again: your places and their order (Home, Work, recent places newest first, starred stops, each once), which field a tapped place fills, Current location as the nearest station, the trip row (leave, arrive, duration, changes, lines, live status, whole minutes to go), the trip list order and Earlier, steps from real legs (walk, take, change, get off; a bus with walks; late and cancelled services), the screen rules (no swipe pages or chips, the list polls only on view, `Accuracy.Low`, no location prompt on launch, every Pressable has a role, no dashes), and the heading: it reads Plan Your Trip, and no Simple mode file says Trip planner or names another app or site. Screenshots with live data, Strathfield to Kings Cross, 390 x 844: files/simple-v3-25oct/ (start light and dark, results and steps light and dark, trio-light.jpg).
Device checks still to do: on iPhone and Android, the heading reads Plan Your Trip and VoiceOver or TalkBack announces it as a heading; tapping Work fills To and lists trips; a trip opens big steps and Speak reads them; Earlier and Later load more; the gear leaves Simple mode after the confirm; the largest text sizes do not clip the heading.

### `app/test/buslive.test.mjs`: 9 tests, `backend/test/bus-ahead.test.mjs`: 4 tests, `app/test/voicehelp.test.mjs`: 9 tests (25 Oct, live bus status update)
Slow traffic rule (`busLiveCore.ts`): slow only when the delay grows by 3 min or more along the stops ahead and ends 3 min or more late; late all the way, getting later but still under the late line, one odd last stop, catching up, fewer than 3 live stops and no data are all not slow. Stop delays from planned and estimated times, the stretch from the bus's next stop to your stop (else where you get off, else the end), trips not live, with no vehicle, cancelled or not a bus say nothing. Live trips captured on 25 Oct at Strathfield North, Strathfield and Central (`app/test/fixtures/bus-live-sydney.json`) read the same as the rule computed by hand; the 410 about 5 min late at every stop is not slow. Rows use the server's `ahead`. Board words ("4 min late" and "3 stops away", "Timetable only"). The bus marker at the stop the bus is at, else before its next stop. Server: `ahead` in minutes, null for stops with no live time, nothing under 3 live stops, no feed time or a cancelled trip, cut to 24 values keeping both ends, added to live bus rows only, never to trains. Simple mode's Speak takes the once only better voice prompt like the other Speak buttons, and its heading is still Plan Your Trip.
Checked against the live server after deploy (25 Oct, about 10:20 PM, Sunday night): bus rows with `ahead` at Central (7), Wynyard (11), Burwood (8), Bondi Junction (2), Hurstville (2), Liverpool (1); Strathfield, Parramatta, Chatswood and Hornsby had live buses but none carrying `ahead` at that moment (no position, the bus at the stop or under 3 live stops); Wollongong, Newcastle and Gosford had no live buses (Timetable only). No bus met the slow rule at that hour.
Device checks still to do: on an iPhone and an Android phone, a stop screen with live buses (for example Burwood Station, Burwood Rd, Stand E): "N min late" and "N stops away" on live rows, "Timetable only" on the others; the departures board for that stop shows the delay beside the stand and the stops away under it; tap a live bus: the bus marker sits on its line of stops and moves on the next refresh. At a weekday peak, find a bus row that says "Running slow in traffic" and check its trip screen says the same. Simple mode: Plan Your Trip, a trip, Speak on a phone with only the basic voice: the Get a better voice sheet shows once, never again.

### `app/test/voicehelp.test.mjs`: 8 tests (25 Oct, Get a better voice update)
Voice quality (`voiceHelpCore.ts`): basic with only compact voices, good with an Enhanced or Premium one (Premium found by its identifier), none with no English voice (network and other language voices left out); the new voice check after Settings (a new Enhanced or Premium voice at least as good as the best before, never a compact one, nothing while a download runs); the Speak prompt once only (only with the basic voice, only where the phone can speak, saved as seen before it shows, so a dismiss means never again); the iPhone steps (Read & Speak from iOS 26, Spoken Content before, three steps, VoiceOver hears "and" for "&"); the Android chain (text to speech settings, Accessibility, then the app's settings; a thrown or rejected intent falls through; sendIntent looked up first); the Voice row always shown; no private settings URL, no dashes and no setInterval in the voice help files. Screenshots, web stand in at 390 x 844: files/voice-help-25oct/ (voice-row and iphone-steps-sheet, light and dark).
Device checks still to do: on an iPhone with only the basic voices (iOS 26 and 27), the first Speak departures tap speaks and shows the sheet once; Not now, then Speak again: no sheet; More > Voice > Get a better voice > Open Settings opens the app's page in Settings; the steps match the Settings screens (Accessibility > Read & Speak > Voices > English); download a Premium voice, come back: Better voice found with the voice's name and a sample from the live board, and Speak departures then uses it (if the download is still running when you come back, the quiet line shows; leave and come back again once it is done). On Android (Pixel and Samsung): Get a better voice opens Text to speech output; Download voice data opens the engine's voice list (or Text to speech output); back in the app a newly installed voice shows Better voice found. VoiceOver reads each step as "Step 1. ...".

### `app/test/carparks.test.mjs`: 8 tests, `app/test/nativemenus.test.mjs`: 15 tests (25 Oct, about 10:00 PM update)
Car parks (`carparkCore.ts`, `CarParkRow.tsx`, `app/carpark.tsx`, `app/parking.tsx`): no row for a station without a car park; "Car park: N free of M" with the reading time and minutes ago; several car parks add up only the live ones and say how many are live; a stale or missing count says no live count and never a number; Directions to Apple Maps on iPhone and Google Maps elsewhere, none without coordinates; the list closest first with a position, A to Z without, never asking for location; no setInterval, no fast clock, no high accuracy, no dashes. Departure row hold menu (`menuCore.ts` `departureMenu`, `Transit.tsx`): Watch or Stop watching then Show stops with bell and list symbols, the title from the service, VoiceOver lists Watch once; the row has no direct long press and no action sheet.
Device checks still to do: on an iPhone, hold a departure on Strathfield's stop screen and on the full board: the row lifts with the menu under it, Watch then shows the bell; a swipe still watches. Ashfield (or any Park and Ride station) shows the car park row; tap opens the sheet; Directions opens Apple Maps with driving directions (Google Maps on Android). More > Car parks with location allowed is closest first and does not prompt with location off.

### `app/test/calendarleaveby.test.mjs`: 10 tests

Calendar leave by (`calendarLeaveByCore.ts`, [CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md)): the event location cleaned (room and level dropped; Zoom, Teams, Meet and links skipped), events in the next 6 hours only (no all day, cancelled or started ones), a search result used only when it shares a word with the location, the place cache (30 days, misses after a day, at most 60), the start place (commute, first trip, home or work), the trip that leaves last and still arrives in time, "Leave by 8:12am for Team meeting (Barangaroo Wharf 1)", trip screen params with the day only after midnight, the trip screen opening the Arrive by trip you would take, the build gate (iPhone 208 and later with CalendarNext, Android with the module, never web), and source checks: off by default, read only, the trip query with no install id or profile, polling only through useScreenPoll every 5 minutes.

### `app/test/timetablepack.test.mjs`: 12 tests, `backend/test/pack.test.mjs`: 6 tests (26 Oct, timetable on the phone)
App: a pack reads into board rows from now on, in order, with no live data (realtime false, Scheduled, no trip id); trains run with no passengers left out; one mode, a row cap, bus taking coaches; a bad or run out pack is refused; when a pack is due again (a day old, or less than 20 hours left); which stops keep a pack (starred, saved trips, home and work, recent, 24 at most); first paint (a live copy under 10 minutes, else the pack, else an older live copy); the labels; the stop screen, Home's stop cards and the full screen board pass `pack` to `useLive`; no setInterval. Server: the pack's rows decode to the engine's board rows at the same second, line, headsign and platform; one platform's pack; stand codes; 404 and 503 cases; /api/pack's cache headers. `app/test/perf.test.mjs` now checks the kept copy and the pack are read together at once on a fresh start.
Manual (web build): `docs/TIMETABLE_PACKS.md` has the cross check against the Trip Planner (20 stops) and the before and after timings.
On a device: put the phone in airplane mode, kill the app, open a starred stop: departures show at once with "Live times unavailable, showing timetable times"; turn airplane mode off: the live board replaces them within 15 s.

### `backend/test/livehub.test.mjs`: 10 tests (26 Oct, g17, live push for Trip Planner boards)
The board the HTTP path has, with dataAt and no data call when the copy is under 5 s; a changed board to every phone and the same rows at a new moment to none; 4 sockets per address then 429, 503 at the object's limit; renewal after 10 minutes; no asks with nobody on the stop; no socket when the Trip Planner refuses and nothing is kept, two hubs on one stop cost one; `full` once in 10 s; the route between hub and shards; 404 with both pushes off and 30 opens a minute; the shards share the limits.
`backend/test/reqlog.test.mjs`: 5 tests: one line per /api request with no query in it, `app` or `ext`, NSW calls timed in the request that made them, `REQ_LOG` off, a watch ask takes a kept copy at once while the phone app waits up to 700 ms, Workers Logs on and sampled.
`app/test/livelabel.test.mjs`: data age from `liveAt` on the phone's clock (server 40 s ahead), clamps, and the old behaviour without the flag.

Device checks after 1 AM (NSW key back), flags on for one test phone only: open Central with `LIVE_PUSH` on and remote `livePush` true; the "Updated" stamp should move about every 15 s with no pull to refresh; background the app and check `/api/live` sockets go to 0 (hub `/status`); with `LIVE_DATA_AGE` true the row ages should match the board engine's feed age within a few seconds.

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
| Native menus (update 25 Oct, 9:20 PM, group 42b8a9e7): on iPhone (builds 201 to 208, iOS 26 and 27) hold the commute card, a saved trip, a recent trip, a starred stop's name, and a Recent row in Search: the row lifts and the system context menu opens under it (no panel mid screen), destructive rows red, SF Symbols, no Cancel; a tap on each row still opens the trip or stop; each action works (Show first moves the trip up, Delete trip shows Undo); the trip screen's star opens Save trip, Save as Home, Save as Work from the star; Settings: Opal fare type, Privacy and data and a commute drop the pull-down menu from the row, the commute switch still toggles on its own; VoiceOver: on a trip, swipe up or down lists Show first and Delete trip as actions; the time picker and reminder editor show a grabber and close with a drag down; light and dark. On build 201 the same (all have the views); with `__legacyMenus` in a development build the old sheet shows. Android: hold a trip: a Material 3 menu under it; the star and the Settings rows: a menu under them; Back closes | Not yet seen on a device; checked on the web build at 390 x 844 (files/native-menus-25oct: trip hold menu and Save trip menu, light and dark) |
| The + on Home (update 25 Oct, 8:56 PM, group ffda4f33): on iPhone (builds 201 to 208, iOS 26 and 27) tap +: the system menu drops from the button (not a panel mid screen) with New trip, Star a stop, Change Home, Change Work and their symbols, no Cancel; each item opens its screen; the live time still shows beside the +; VoiceOver reads "Add, button" and each item as a button; light and dark. On Android tap +: a Material 3 menu under the button, a tap outside closes it, Back closes it | Not yet seen on a device; checked in the web build (files/plus-menu-25oct: menu under the +, outside tap closes, Star a stop opens search) |
| Commute card Line glow and iPhone menus (update 25 Oct, 8:34 PM, group c9a4913d): in dark the 2 pt ring runs T4 blue into T1 orange (Kings Cross to Strathfield) and T1 into T4 the other way, the glow behind the card shows both colours and the card is lighter than the cards below it; in light a white card with a soft shadow; Settings > Accessibility > Display & Text Size > Reduce Transparency, then Increase Contrast, each gives a solid 1.5 pt border in the line colour with no glow (Android: High contrast text); no frame drops while scrolling Home with the glow; the + button's system action sheet grows from the button on iOS 26 and 27; the hold menus, Save this trip and Recent rows show the system action sheet; "Next 12 min, 19 min"; the countdown is not red at 1 min; VoiceOver reads "1 minute" | Not yet seen on a device; checked on the web export at 390 x 844, light and dark, both directions with live data (`files/home-commute-hero-25oct/shipB/`) |
| Home, Option A (update 25 Oct, 4:34 PM, group 0b1d956d): the plus button in the iOS 26 and 27 glass navigation bar (one glass group with the live stamp, nothing clipped, the action sheet opens from it) and as an Android top app bar action (bottom sheet with 4 choices); Next trip card with VoiceOver (one element, the Delete action) and at the largest Dynamic Type sizes (badges and platform wrap under the countdown, names wrap to two lines); swipe Delete on a row and on the card, then Undo above the floating tab bar within 5 s, and a saved trip that stays deleted after 5 s or after going to the home screen; Show first from a hold menu; dragging rows under the card; widgets and the watch still list the same saved trips after a delete and an Undo; light and dark, 390 and 430 pt wide (test/homea.test.mjs checks the logic and the source) | Not yet seen on a device; checked on the web export at 390 x 844 and 430 x 932, light and dark, with Bidur's trips and live data (`files/home-a-ship/`) |
| Usually N min late: hidden on today's address (checked: 0 lines on the web build with the old host); shown on the stop board with a route chosen, the service screen and each trip leg once api_base moves (checked with a mocked answer in the web build only). Real answers need weeks of live times on the new host | Not yet seen on a device |
| Trip reminders: the permission prompt on the first reminder only, a reminder ringing at the set time on the set days with the app closed, a tap opening the trip, Undo after deleting a trip keeping its reminders (update 25 Oct; the web build logs the weekly schedule instead of ringing) | Not yet seen on a device |
| Speak alerts (update 25 Oct, 3:15 PM): on a real trip, each line spoken once ("Your bus leaves in 2 minutes from stand X1", the next stop and change lines, "You've arrived"), music lowered and not stopped, the switch remembered for the next trip. On build 206 Silent mode mutes the speaker (headphones work); build 207 should speak with Silent mode on (Build 207 device checklist, items 9 to 11) | Not yet heard on a device |
| Bus route view and stop numbers (update 25 Oct, 3:15 PM): search 410 and 2046100 in Plan, Route on a bus service and on a bus leg, "Stop 2046100" on bus rows, Home stop cards, bus legs and the live trip | Not yet seen on a device; checked in the web build |
| Station picker and bus picker (updates 25 Oct, 3:06 PM and 3:30 PM): no Back button or title over the screen on iPhone, the question in the search field, no caps lock in search fields; the bus picker opening on Near you (only when location is already allowed), then saved and recent stops, then Sydney routes, with trackwork, school and regional routes closed at the end | Not yet seen on a device; checked in the web build |
| Website, simple home page (25 Oct, 8:50 PM, Pages deployment 564bc47c): home, support, privacy, terms, both Home screen images, apple-app-site-association, /open/, /stop/..., /plan answer 200; /beta and /trip/<id> 302; random path 404; the home page at 390 x 844 and 1440 x 900 in light and dark (files/site-simple-25oct/after/) | Done with curl and screenshots after the deploy |
| Website (25 Oct, 5:10 PM, Pages deployment 6a3ba944): home, support, privacy and terms answer 200, the four screens load, www redirects, /beta 302, /plan and /stop links show the Open in the app page, a random path 404 | Done with curl after the deploy |
| A time in the past on the trip screen (update 25 Oct, about 7:45 PM): at 6:27pm pick Leave 6:15pm on Today; the 6:18 and 6:24 show as greyed Left rows with their live delay, the next train opens, VoiceOver reads "Left 6:21, 3 min late ... Already gone"; the Earlier services row (and a pull down) reaches services before 6:15pm, and on Now back to 4am; Arrive by a past time lists Left rows; stay on the screen past 6:45pm and the list is still today's 6:15pm (no jump to tomorrow) | Not yet seen on a device; checked in the web build (trippast.test.mjs, files/trip-past-25oct) |
| Plan B on Home (update 25 Oct, 5 PM): a "Plan B:" line under a trip card when its next service is cancelled, on a suspended line, will miss a change or uses replacement buses; the tap opens the trip with its Plan B card. A tapped morning check alert opens that trip (the check must be in More > Check my trip on this phone) | Not yet seen on a device; checked in the web build with a real Strathfield to Kings Cross answer whose first T1 was marked cancelled (`files/commuter-25oct/`) |
| Last way home on the phone (update 25 Oct, 5 PM): Ask "Last train home" (location allowed) or the last service in trip results, Remind me, the notification permission prompt at the tap, the notification 15 min before leaving with the app closed, Home card with Leave by and the service time, a later live time moving it after opening the app, Android getting a real notification. Cancel from the button and the Home card | Not yet seen on a device; checked in the web build with the current server's real answer for Kings Cross to Strathfield (12:54am T4, reminder 12:30am; the web build logs the schedule instead of ringing) |
| Weekend trackwork on the current server (update 25 Oct, 5 PM): the Trackwork this weekend card from Thursday 6pm with Sat and Sun rows for the T4 work on Strathfield to Kings Cross; More > Weekend trackwork heads up asking for notifications, then one notification on Thursday 6pm when work touches a trip (Home opened earlier in the week) | Card seen in the web build with live alerts on Sunday 25 Oct; the Thursday notification not yet seen on a device |
| Why it's late (update 25 Oct, 5:43 PM, group 0c0bffd6): the reason line on a late service on a stop screen, a trip leg and service row (Strathfield to Kings Cross), the Home Next trip card and the live trip card; tap opens the alert in the browser; VoiceOver reads the reason with the row and offers the "Why it's late" action; nothing on an on time service. Seen in the web build with live data on 25 Oct (a T4 13 min late, incident at Allawah) | Not yet seen on a device |
| Departure board (update 25 Oct, 5:43 PM, group 0c0bffd6): Board on Strathfield station and a bus stop, portrait and landscape (rotate while open), dark by default and Light board, the close button clear of the Dynamic Island and the home indicator on iOS 26 and 27 and on Android, the screen staying on while open and sleeping again after Close (on builds 201 to 206; feature detected), stops after this station on the first trains, Live, Timetable and Not tracking, VoiceOver row by row, text size at the largest Dynamic Type sizes | Not yet seen on a device; checked in the web build at 390 x 844 and 844 x 390 with live data |
| Earlier departures on stop boards (update 25 Oct, see RELEASES): Strathfield and Kings Cross, tap Earlier departures: greyed Left rows above the next services, live delay where known, again and again back to 4am; the time chip on iOS 26 and 27 (the sheet with Now and From) and Android (the dialog), From a time 30 min ago shows the gone services first, Now one tap back; pull down after the newer server note tries again; VoiceOver reads "T1 to Central. Left 8:25, 2 min late, Plat 3. Already gone"; Dynamic Type at the largest sizes; the full screen Board is unchanged | Not yet seen on a device; checked in the web build (boardtime.test.mjs, files/board-earlier-25oct) |
| Trip screen modes, endless list and time chip (update 25 Oct, see RELEASES): Strathfield to Town Hall, tap Bus: bus trips with stand and stop numbers (seen in the web build with live data: 415, 492, 52 and 461X with changes, there is no direct bus); Train and Bus together; the choice still there after closing the trip and opening it again; Any back. Scroll to the end: a small Loading later services row, more services, then No more services found for this day (seen in the web build: 8 batches to about 4am). Pull at the top: earlier services. The Leave now chip: the iOS sheet with the day row on iOS 26 and 27, the Material dialog on Android, VoiceOver reads each chip as selected or not, Dynamic Type at the largest sizes wraps the time chip, Now one tap back. Not yet seen on a device |
| Calendar leave by (update 25 Oct, 6:40 PM, group f773ab8e; hidden until build 208): More shows no Calendar leave by on 201 to 207 and on Android versionCode 5; on 208 see Build 208 checklist: Calendar leave by (in this file on branch native-207, merged back with 208). Checked in the web build (Metro dev server) at 390 x 844 and 844 x 390 with a labelled mock calendar and live trips: Barangaroo and Five Dock lines on Home, a Teams event skipped, the tap opening Strathfield to Barangaroo at Arrive by 8:15pm with the 7:44pm trip open, the trip queries sent with no install id or profile (`files/calendar-leaveby-25oct/`) | Not yet seen on a device |
| Home commute first and Notifications chips, Ask long chat and Clear chat (update 25 Oct, evening; see RELEASES): the commute card fully on screen without scrolling on a 6.1 inch iPhone with a trip in progress, a watch, trip alerts and weekend trackwork all showing; the In transit bar opening the live trip; each chip opening and closing in place, its links opening Transport for NSW's page; VoiceOver reading the card, then the Notifications header, then each chip with its full text and expanded or collapsed; the largest Dynamic Type sizes (countdown and status not cut, chips scroll sideways); light and dark; When to leave asking for location, then the one line with the bell; Ask with a long chat opening on its latest message, Load earlier keeping your place, Clear chat with the system alert on iPhone and the Material dialog on Android, the chat empty in Ask after clearing it in More (test/notices.test.mjs and test/askchat.test.mjs check the logic and the source) | Not yet seen on a device; checked in the web build at 390 x 844, light and dark, with Bidur's commute and live data (`files/home-commute-hero-25oct/`) |
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

## Lag diagnosis device checks

From docs/DIAGNOSIS_LAG.md, 26 Oct. Nothing in that plan has been measured on a phone or a watch; these give the numbers it is missing.

1. iPhone on build 208 with the newest production update, cold start after the update has been applied once: time from tap to times on Home, on Wi-Fi and on 4G, 3 runs each.
2. Same phone, open a stop with nothing kept: time to live times, and whether a spinner shows for more than 8 s.
3. Search a trip at 8 AM on a weekday: time to the first trip; note any "still searching" and any error text.
4. Apple Watch with the phone nearby, then with the phone off or away: open the watch app at 8 AM, time until the times change from "Updated" to the new time; note any "Offline".
5. Watch complication: note the time it shows against the next real departure after the watch app has been closed for an hour.
6. Stop board widget with Airplane mode on, then off: does it go empty ("Live times will be back shortly") or keep its rows.
7. While a watch opens, run `wrangler tail transport-api` and record the User-Agent of the watch's and the widget's requests (needed for fix 4).


## Outage mode checks (g16, 26 Oct)

Automated: `backend/test/outage-trips.test.mjs` (timetable trips direct and with one change, train to metro through a
hub, no made up trips, Empty Train never offered, honest 503 with no list, nearby from our stop list with no NSW call,
timetable answers never kept, trip copies) and `app/test/outage16.test.mjs` (trip card and board notes, no status
codes in any message, Ask's words, slow vs offline, kept times on a 5xx or 429, old server only when unreachable,
10 s trip deadline).

Checked against production with the NSW key refused (26 Oct, 3:10 to 3:30 PM): Kings Cross to Strathfield (T4 then
T1 or T9 at Central), Flemington to Campsie (T2 then the 420 at Burwood), North Sydney to Strathfield (T1 or T9 then
T2 at Wynyard), Circular Quay to Bondi Junction (333), Circular Quay to Drummoyne Wharf (F3), Nearby at Martin Place,
Parramatta and Manly Wharf, Ask "Kings Cross to Strathfield", "departures Central", "next bus from Circular Quay to
Bondi Junction". Circular Quay to Manly has no timetable trip (terminus gap) and says live trips are unavailable.

Last stops (28 Oct): `backend/test/outage-terminus.test.mjs` (10 tests) builds tiny GTFS bundles per mode with the
real `tools/build_timetable.py`, loads them into the engine object (real SQLite) and asks `/ttplan`, `/board`,
`/trip` and `/api/trip` with every NSW call refused. Checks: the build keeps last stop and set down only rows apart
with the arrival time and marks pick up only rows; a trip to the last stop of a ferry, metro, light rail, bus and
train line has timetable trips (and none from a load without the new rows, as in the bug); from a stop that is both a
first and a last stop only leaving services are boarded; a loop back to its first stop ends at the loop's last call;
a last stop served by two lines at two stands gives both lines; never ending where nobody gets off; one change at a
station where the first service ends; boards never list a service ending at the stop; a train's stop list gets its
last stop's planned time; `/api/trip` with the planner refused answers 200 labelled. Every test fails without the
fix. On production (after the next nightly timetable load, 2:40 AM): with the planner refused, Circular Quay to
Manly should give F1 timetable trips; not checked yet (no live NSW calls allowed today).

On a phone (not done yet): with NSW refusing, the Home commute card shows timetable trips with the note; Nearby lists
stops; Ask answers with the timetable note; flight mode shows "Offline" and "check your signal"; after NSW is back
(after 1 AM) cards show live times again with no note, and the trip screen's first open of a saved trip is instant.

## Live trip follows realtime and location (26 Oct, Bidur's Strathfield to Bondi Junction trip)

Automated: `app/test/livetrack.test.mjs` (21 tests: a T8 9 minutes late whose stop off has no live time, the planned change flagged as missed at once, "change here" only when the train is really due, a missed change after you get off, a late ferry into an L2 change, a 610X with no realtime that never ends or says "You've arrived" by the clock, no service answer at all, your tap, GPS arrival on the M1 and GPS before your stop holding the leg, stale or rough fixes ignored, the vehicle over the clock, a server saying its next stop is only the timetable, the delay on the notification and card, carried delays, rode only from live data, and the owner's case). `backend/test/service-progress.test.mjs` (3 tests: a delay carried to your stop off, the vehicle 2 stops behind the clock wins, no live data gives `progress: timetable` and the watch's one stop check says nothing). 18 of the 21 app tests and all 3 server tests fail on the code before this change.

On a phone (not done yet; needs the NSW key, after 1 AM, and the over the air update): start a trip on a train that is running late; the trip screen and the Live Activity should show "N min late" on the leg and an arrival that moves with it; the change alert should come only as the train nears the change station. With location allowed, walk off at the change: the trip moves on within 15 s of the screen being open. Turn on flight mode on a bus trip with no live data: the screen says "Not live, running to timetable" and shows I'm at; tap it and the trip moves on.

## Own trip planner (26 Oct, OWN_PLANNER off)

Automated: `backend/test/raptor.test.mjs` (direct trips, changes and change time, walks, boarding rules, arrive by, stations and points, the planner object's load and commit, no Trip Planner call with the flag on, RAPTOR against a brute force search on 300 random networks). On the full NSW timetable (26 Oct pack): RAPTOR and an independent Connection Scan search agree on the earliest arrival for 400 of 400 random station pairs.

Before switching it on:
1. After the daily pack load (3 to 6 AM), capped: `ENGINE_LOAD_KEY=... node backend/tools/planner_match.mjs 150 > match.json` asks the Trip Planner (through our server) and our planner the same searches, one pair every 3 s, and prints the match. Gate: our first trip leaves and arrives within 2 minutes of NSW's first, or uses the same lines, in at least 90%; write down every miss and why.
2. A delayed train: the trip's legs show the live time (the same feed step as NSW legs).
3. On a phone with `OWN_PLANNER` on in a test deploy: search Home to Work at 8 AM and at 11:30 PM (late night, next morning's first services), a trip from your position, and arrive by; compare with Trip Planner screenshots.
4. `/api/raptor/status`: every replica loaded the same pack day; after the daily load, replicas pulled the new one. Since 29 Oct (transport-api 2d6170e4) a sleeping replica reads `loaded: true, inMemory: false, from: "stored"` with its day; before it, `loaded: false, day: null` meant only "not in memory". `backend/test/raptor.test.mjs` has 2 tests for it (both fail without the fix).

## Trip lists a day at a time (27 Oct, OWN_PLANNER off)

1. `cd backend && TZ=Australia/Sydney node --test test/trip-days.test.mjs test/trips-compare.test.mjs`: whole day scan (every connection, not only where RAPTOR looked), trips nobody would pick dropped, days held from `tripDays` and `daysHeld`, the 3 AM edge, the build script's new arrays, the planner object's `/day` (templates once per pair, no storage rows read), `/api/trip` with `days=1` (a day only with the planner on or `own=1` with the key; Trip Planner pages otherwise and for cursor pages), added trains from the train feed; the compare sample (owner stops at most 5%), the match rule and the 40 call cap.
2. `cd app && node --test test/tripdays.test.mjs test/trippages.test.mjs`: the day page read, the next day about 50 rows from either end, earlier rows shown a block at a time with no request, Trip Planner pages past the planner's days.
3. Locally (`tools/local-dev.mjs`, fake NSW): build a pack (`python3 tools/build_planner.py <gtfs dir> pack.bin`), load it (`ADMIN_KEY=local-admin-key node tools/load_planner.mjs pack.bin http://127.0.0.1:<port>`), then `/api/trip?page=1&days=1&own=1&from=&to=` with `x-admin-key: local-admin-key` gives `page.mode` "day"; `node tools/trips-compare.mjs --dry --base http://127.0.0.1:<port> --gen 10` runs the compare against the fake planner.
4. Tonight (11 PM to 5 AM): `ENGINE_LOAD_KEY=... OWNER_NAMES=... node tools/trips-compare.mjs --gen 40 --live 40 --out compare.json`; record matched of counted. On a phone with a test deploy where `OWN_PLANNER` is on: open a trip at 8 AM and 11:30 PM, scroll a day both ways, check the list keeps up and the day after the planner's last day carries on.

## Budget mode checks (g20, 26 Oct)

1. `node --test test/budget.test.mjs` in `backend/`: billing cycle from `BILLING_DAY`, month end projection, no action
   under 50%, the hold past 80% (flags off, load key refused, one email), no second email, the hold lifting under 60%, a
   new cycle lifting it, load keys only with `LOAD_TESTS` on.
2. After a deploy: `GET /api/budget` with the admin key shows `token: true`, `email: true` and every flag's `var` and
   `on`; `POST /api/budget/check?dry=1` returns every meter with a projection; `POST /api/budget/mailcheck` says
   `binding: true, module: true`. Without the key all three answer 403.
3. An hour later: `last.at` is within the hour (the minute 17 run).
4. The night after: the timetable workflow log says either "no engine load tonight" (the engine holds today and
   tomorrow) or loads; `/api/engine/status` `days` always holds today and tomorrow.
5. Cloudflare dashboard, Billable usage: still US$0.00 projected at the end of the week.

## Store pack checks (g25, 26 Oct)

* `backend/test/search-points.test.mjs`: a watched trip from a point writes no trip history row; stop to stop still does.
* After a server deploy, the live script keeps `invocation_logs: false` (Cloudflare API, `workers/scripts/transport-api/script-settings`, `observability.logs`). Read back 26 Oct after `3e88773d`.
* Privacy policy live (30 Oct, 7:54 AM, Pages aa2b7ec2): /privacy/ is byte for byte `site/privacy/index.html`, says "Updated 30 October 2026", and names no Cloudflare, Expo, Sentry, Firebase or OpenFreeMap; Transport for NSW, Apple and Google appear only as data source and platforms; /terms/ unchanged (25 October 2026). `backend/test/security.test.mjs`: on a non API host /privacy, /privacy/ and /privacy/index.html answer 301 to https://transportsydney.app/privacy/.
* Privacy policy live: https://transportsydney.app/privacy/ says "Updated 27 October 2026", has the Crash reports section (`id="crash-h"`) and Sentry under Who else is involved, has no script and keeps `no-transform` (checked 27 Oct, 12:57 PM after Pages `202d89e9`; the live page is byte for byte `site/privacy/index.html`). Whenever the app starts sending something new (Sentry in build 209 is already covered), update the policy before the update or build ships.
* App Store Connect draft text read back through the API equals store/apple/listing.md (description) and docs/APP_REVIEW_NOTES.md (Notes, 3854 characters, read back 28 Oct, 3:53 PM; before that 3562 characters on 26 Oct). Age rating read back: every item None or No, 4+.
* Before submission: an Apple Watch screenshot set exists; the version has the newest build; the iPhone screenshots are a reshoot without the owner's stations or the owner kept the old set (store/README.md).
* Not verified: the store screenshot script's new defaults (Parramatta, Wynyard, Chatswood to Bondi Junction) have not been run; they need live data (after about 1 AM).

## Review notes checks (28 Oct)

* `node --test test/review-notes.test.mjs` in `backend/`: every server switch (`serverOn`) and every remote config flag the app reads (`useFlag`, `isOn`, `flags.`) is named in docs/APP_REVIEW_NOTES.md; the Notes text is at most 4000 characters with no long dashes. A new switch fails it until the notes list it.
* When the notes change: write the Notes section to App Store Connect (version 1.0.0, App Review Information) through the API and read it back equal to the file; never submit, never attach or change a build in the same step.
* Read back 28 Oct, 3:53 PM: 3854 characters, equal; version Prepare for Submission, build 208.

## Break it pass (g28, 26 Oct)

Local only, no production key, no cost: `node backend/tools/local-dev.mjs /tmp/tsl-local` (the API under wrangler dev against `backend/tools/fake-nsw.mjs`), then:
* `node backend/tools/local-burst.mjs`: 10 identical first opens of a board, a trip, nearby and alerts all answer 200 (before the fix 9 of 10 boards answered 500).
* `curl 127.0.0.1:8799/__mode?set=502html` (then `nulljson`, `malformed`, `429`, `500`): boards and trips answer 503 with `upstream: true` and Transport for NSW named, or the kept copy; never 500, never "our side".
* Hostile input: `/api/search?q=constructor` 200, `/api/service?mode=__proto__` not 5xx, `/api/predict?planned=garbage` 400.
* Tests: backend `cross-request.test.mjs`, `feed-lost.test.mjs`, `proto-keys.test.mjs`, `upstream-not-json.test.mjs`. Results 26 Oct: backend 430 pass, app 653 pass with 3 skipped (OFFLINE=1), tsc clean, battery test passes.
* After the next transport-api deploy: open one stop on two phones at once (both show the board), and `/api/health` with the admin key shows feed ages under a minute an hour later.

## Speed pass, every screen paints at once (27 Oct)

* `TZ=Australia/Sydney OFFLINE=1 node --test test/speed27.test.mjs` in `app/`: the shared service query, the service seed (fields, age, never kept), first frame order, a press in answer peeked on the next first frame, the kept copies cap, the press in gate, nearby lookups side by side and the 400 m rule, car park and route copies.
* On a phone after tonight's update: open a stop, tap a train you have not opened before; the line, destination, delay and your stop show at once with "Loading every stop", then the full list. Open Nearby twice in the same spot; the second shows its stops at once. More > Car parks opens on the last list with its age.
* Results 27 Oct: app 729 tests, 726 pass, 3 skipped (OFFLINE=1), battery 17 of 17, tsc clean.

## Speed pass part 2 (27 Oct)

* `TZ=Australia/Sydney OFFLINE=1 node --test test/speed27b.test.mjs` in `app/`: x-serves words per server and rollback, ids placed per server, the trip live legs on the wire and in requests of 12, live times laid over a held plan (timetable when the feed has no news), when it plans again, which answers are held, version tags (caps, 304 hands back the kept list), via trips with no forced refresh and the early second part, Home read ahead (plain trips, once per foreground, on screen and in front only).

## Plan tab trip rows (27 Oct)

* `TZ=Australia/Sydney OFFLINE=1 node --test test/planrows.test.mjs` in `app/`: 12 and 24 hour times ("12:56 pm", "09:05"), Sydney time over the daylight saving change, the time left buckets (Now, minutes, hours rounded down, days, Left), the status rule (the 1:29 pm row 3 hours out with an echoed estimate says Scheduled; a moved estimate, a vehicle or the last hour says live), boarding stop with platform, lines once each, when the columns stack, and the rows wired to these.
* On a phone: Settings, General, Date and Time, 24-Hour Time on and off, then reopen the Plan tab (the setting is read again within a minute). Largest Dynamic Type on an iPhone mini or SE: the get off column goes under the get on column and nothing is cut except long stop names. Light and dark.
* Follow ups (27 Oct): `TZ=Australia/Sydney OFFLINE=1 node --test test/planfollow.test.mjs` in `app/`: the chip clock ("12:56" and "pm", 24 hour digits alone), the Home chip past an hour, the tight change rule (same mode and stop 3 min, another mode, platform or stop 5 min, a walk plus 2 min, live times, cancelled legs, one service trips), screen reader words, no station names in the rule, and the screens' sources (trip detail has no old clock call, the row and detail show the label, the label is not a button).
* Screenshot of a tight change: run `node test/e2e/mockapi.mjs <repo> PORT`, POST `{"change": true}` to `/__clock`, serve the web export and open a trip (for example Burwood to Central); rows with a 2, 3 or 4 min change show Tight change, the 8 and 12 min ones do not; tap one for the detail line.
* On a phone: a trip with a short change shows Tight change under the row and in the detail; VoiceOver reads "tight change, N minutes to change"; the row's tap still opens the detail. Home with a saved trip more than an hour out: the chip shows "pm" or "am" under the time (24 hour digits with 24-Hour Time on).
* Server, tight change rule (27 Oct, deployed 1:45 PM as transport-api 3bf49b2f): `TZ=Australia/Sydney node --test test/tight-change.test.mjs` in `backend/`: the minimums equal the app's, the server rule and app/src/lib/tightChangeCore.ts agree on every change of 20,000 generated trips (generated stops, no real stations), the rule cases (same mode 3 min, another mode or platform 5 min, a walk plus 2 min, shorter than the walk is miss, cancelled is not tight), the journey risk, timetable trips keep the transfer keys, `/api/trip` with a 4 min train to bus change says tight, your own trips with a change (2 min on the same platform with 2 allowed is tight, 3 is fine, your own longer change time still counts) with the warning line, and the app hides its row label when the server has a warning line.
* Tight change fallback (27 Oct): `TZ=Australia/Sydney OFFLINE=1 node --test test/tightfallback.test.mjs` in `app/` (via trips joined on the phone: the rule with the person's own change time as a floor, a walk counts, cancelled is not tight, trips.ts uses `tightOrOwn`) and `TZ=Australia/Sydney node --test test/web-tight-change.test.mjs` in `backend/` (the web page's marked rule block equals app/src/lib/tightChangeCore.ts on 20,000 generated trips, the via floor, the web via join uses it). On a phone or the web page: a via trip whose change at the via stop is under the rule (for example train to bus under 5 min) shows Tight change in the detail.
* Server, trip legs live (27 Oct, deployed 1:10 PM, 807c3663): `TZ=Australia/Sydney node --test test/trip-realtime.test.mjs` in `backend/`: an echoed zero delay estimate 3 hours out is not live (estimate and delay kept), a moved estimate is live at any distance (late and early), within the hour is live and 61 min is not, a late first service counts from its live time, later legs of a trip leaving soon stay live, no estimate is never live, and the same through the whole `/api/trip` path.

## Crash safety net (27 Oct)

* `TZ=Australia/Sydney OFFLINE=1 node --test test/crash27.test.mjs` in `app/`: the report text (kind, screen, build, update, recent paths with query names only, the error once, under 4000 characters), the page tag, which phone keys Clear saved times drops and keeps, and source checks (the root layout exports ErrorBoundary and reports from it, the reporter is installed, no timers or native modules).
* Web export check: a forced throw on Home shows the recovery screen, posts one report to /api/feedback, and Try again, Go to Home and Clear saved times and reload work.
* Reading reports: `SELECT at, message, page, install FROM feedback WHERE page LIKE 'crash:%' ORDER BY at DESC` on the transport D1 database (read only).
* `TZ=Australia/Sydney OFFLINE=1 node --test test/crash28.test.mjs` in `app/` (28 Oct crash hunt): the train service shapes server D gave (a stop with no name, no planned time, skipped stops, no live times, no indexes, an empty list, ids only) through the trip in progress, its card and the stops after line at every minute of a two leg trip; a kept board copy with broken rows keeps its good rows; first frame reads of broken, unreadable or future dated kept copies give no copy; broken packs fail `packValid`; the two guards are in the source.
* On a phone (not yet done): the recovery screen in light and dark and at the largest Dynamic Type; a report arrives with the iOS build and update id.
* `OFFLINE=1 node --test test/hooksorder.test.mjs` in `app/` (29 Oct): no hook after an early return or inside a condition or loop in any component or hook under `src` (TypeScript parser walk), and OpalFareCard's state hook above its no fare return. From the 28 Oct crash reports ("Rendered more hooks than during the previous render" on the trip screen).
* On a phone after the update that carries it: open a trip whose fare shows only after a refresh (a long list, Earlier and Later pages); the Opal fare card appears with no error screen.

## Old apps and server steps C and D (27 Oct)

* `node --test test/trip-quick.test.mjs` in `backend/` (27 Oct, 1:20 PM commute card): an older app's plain trip (device and profile in the address, no x-device) with the planner answering at 3 s gets the live answer, not timetable trips; past 6.5 s it gets the planner-slow stand in at about 6.5 s; a newer app (x-device) still gets it at 1.5 s. Production check: the shipped app's request for a pair with no saved copy answers live (or a stand in only after 6.5 s), and with `x-device` a stand in at about 1.5 s when the planner is slow.
* `node --test test/old-client-compat.test.mjs` in `backend/`: an old app's asks (device and profile in the address, no x-device) for the service screen (a delay only train and one with clock times, slow planner), a kept and a fresh station list /api/timetable after a trip-live ask and Home's commute trip (with 6b461ff's realtime rule), compared with shapes, headers and stop lists recorded from server B (2aff7f9b, main 50dd351). A newer app (x-device) still gets the train quick answer from the engine and tags on kept copies.
* To record again from another server's source: `COMPAT_SRC=<dir with worker.js, engine.js, raptor.js> COMPAT_WRITE=1 node test/old-client-compat.test.mjs`.

## Speed pass 3, every other screen (27 Oct)
* `backend/test/trip-page-quick.test.mjs` (6): copy keys (first page `tripp:FROM>TO` with the plain key beside it; no key for after, before, day, n, time or page other than 1), a plain copy turned into a first page (gone trips out, sorted, cursors from timetable times; never a timetable, page or one trip copy), a slow planner gives a labelled first page at about 1.5 s and the live page is kept and saved, a saved plain copy answers a first page at once, a later page still waits for the planner, a fast planner is unchanged.
* `app/test/speed27c.test.mjs` (5): list keys, the watch detail seed from the Watching copy (never kept), kept lists shown and forgotten (`forgetOffline`), static lists shown at once only with a tag checked in the last 7 days, and the wiring of Watching, watch detail, More, morning checks, Opal machines and etag.ts.
* On a phone after tonight's update: open a trip never opened before on a slow afternoon; the list should show trips within about 2 s (timetable labelled, then live), not a spinner for 8 to 12 s. Open Watching, More, Check before I go and Opal machines twice; the second open should show the list on the first frame with an age line where the screen has one. In flight mode, New trip's station lists should still open.

## Speed pass 4, the last three slow screens (27 Oct)

* Backend: `TZ=Australia/Sydney node --test test/speed-pass4.test.mjs` (6): the engine's `/boardat` rows from the asked moment with no feed marked wanted; a slow planner gives the newer app labelled timetable rows after `DEP_AT_QUICK_MS` and the planner's board on the next ask (one planner call); a quick planner still wins; older apps, `format=text`, `DEP_AT_QUICK=off` and no engine wait for the planner; the board for now is unchanged; the car park list with a saved copy over 30 minutes old answers after `PARK_QUICK_MS` with every count stale and `counts-loading`, then live; with nothing saved, the list with no counts; older apps wait for the live read.
* App: `TZ=Australia/Sydney OFFLINE=1 node --test test/speed27d.test.mjs` (7): `packCovers` and `packBoardAt` (from the moment, departed marked, timetable only, not near the pack's end), `boardAtAgainMs` (6 s, 10 s, then null), `parkAgainMs` and `parkLoadingNote`, stand ins never kept (`worthKeeping`), `serviceSeed` with a kept route (stops after yours to the destination, alight tag, no made up times; trains, unknown stops and last stops unchanged), and the screen wiring.
* By hand on a phone (not done in this pass): pick a time on a starred stop's board in flight mode (pack rows from that time, "Timetable times"); pick a time on a stop with no pack (rows within about a second, then live); open Car parks on a fresh install in the afternoon (list at once, "Getting live counts", counts within about 15 s); tap a bus on a board twice, the second time the stops after yours show before the times.
* Measuring again: `node tasks/<id>/meas.mjs` style app shaped GETs with a made up device; a car park cold open needs the saved copy over 30 minutes old.

## Speed pass 5, app: the first frame and redraws (27 Oct)

* App: `TZ=Australia/Sydney OFFLINE=1 node --test test/speed27e.test.mjs` (7): the modules read before Home's first frame (an import graph walk from `_layout`, the tabs layout and Home) leave out localSearch, askPlaces, askBrain and localSearchCore; Plan's `useLocalIndex` and Ask's `askPlaces` start in `useFocusEffect`; `useNow` and `useCountdownNow` start off; the service screen, the live trip screen and the watch screens hold no screen clock; `ServiceRow` is memo with `sameServiceRow`, every clock input of the row is in `serviceRowClock`, and the trip list passes `pressKey`; Get me home and Last way home are memo; the watch leg and car park press ins.
* By hand on a phone (not done in this pass): cold start with Plan never opened, then scroll Home at once (no hitch about a second in); open Plan after 10 s and type a stop (results as you type at once); open Plan in the first 2 s and type (server results first, local ones a moment later, as on a fresh install); a train's service screen and the live trip map should not flicker or redraw every 5 s; a trip list paged a few days out should scroll smoothly across a minute change.
* Measuring again: `node tasks/<id>/evalcost.mjs app` and `node tasks/<id>/idxcost.mjs . bus-stops.raw.json` on the build box (Node timings, a floor for the phone); `expo export --platform ios` for the bundle size.

## Instant paint (30 Oct)

* App: `TZ=Australia/Sydney OFFLINE=1 node --test test/instantpaint.test.mjs` (9): R1 phone built trips carry timetable times only (no live fields, no delay warning, cancelled services left out, liveState says Timetable) and the label words; R1 exception and R2 (a kept live time under 5 min shows its true age, past 5 min never live); R3 gone services drop by the phone clock (seed and kept copy); R4 same row keys and order as the live answer; R5 never kept, never seeds again, and seeds only from a copy that covers the moment (asked before it, reaching past it; any mode answer, matching step free, no error, under 6 h), arrive by, and `firstFrame` prefers the search's own kept copy; R6 `armFresh` and `armSpec`, wired into Start trip; paint first source checks (trip screen placeholder rows and no spinner, the seed read from memory only, no paging while phone built, the stop screen placeholders, useLive repaints a seed on a change); the read ahead budget (at most 4, each pair once, plain trips only, 10 min freshness, same idle slot and limits, no timers or background work) and 64 kept copies; OTA safety (the new module imports only types and liveLabelCore, no native code).
* By hand on a phone after the update: open a saved trip, change the time to later today, then tap a mode chip: trips draw at once with "Timetable times. Getting live times." and no Live badge, then live times replace them in place without a jump. A brand new pair shows placeholder rows, not a spinner. Start trip from timetable rows: the live trip opens on timetable times and turns live within seconds. Airplane mode: phone built rows say "Live trips are unavailable right now."
* Not covered: the e2e layout shift check (`test/e2e/paintcache.mjs`) for the swap was not run (needs the web build and a browser).

## Before a release

1. `node --test test/*.test.mjs` in `backend/`: all 80 pass (a clean clone too, since the generated data is committed).
2. `npx tsc --noEmit` in `app/`.
3. `OFFLINE=1 node --test test/*.test.mjs` in `app/`: all pass. iPhone builds: the EAS simulator compile check is green before the production build ([Runbook](RUNBOOK.md), section 4).
4. After publishing the web: the live checks above.
5. grep every changed file for em dashes, en dashes and filler words.
