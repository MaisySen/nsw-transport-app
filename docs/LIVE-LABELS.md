# Live labels and Recently departed

Every countdown in the app says where its time comes from. Written 25 Oct 2026 for the ghost bus complaint (about 105 store reviews of Sydney transport apps, keyword matches: "says it left" but it never came; research report files/research-25oct/report.md on the build box).

## The three labels

| Label | When | What the countdown shows |
| --- | --- | --- |
| Live, updated 20 s ago | The service has a live time, our copy is fresh and the vehicle's GPS position (when the feed sends one) is under 3 min old | Minutes to the live time, bold |
| Timetable | No live time for this service | Minutes to the timetable time, grey. Once that time has passed: the time itself (8:42am), never "Gone" or "Left" |
| Not tracking | It had a live time, but the GPS position is over 3 min old, or our copy is over 2 min old and the service is due within 10 min, or the live time passed over a minute ago and the service is still listed | The timetable time (8:42am) with "timetable" under it. No countdown to 0 |

The Home stop cards follow the same rule (31 Oct): their rows are compact, so a time that is not fresh live (Timetable or Not tracking) shows the timetable time in grey with the word "Timetable" under it.

Cancelled services say Cancelled. The age is our copy's age plus the GPS position's own age, in 15 s steps under a minute ("just now", "15 s ago", "30 s ago", "45 s ago"), then minutes, so rows redraw at most every 15 s.

Code: `app/src/lib/liveLabelCore.ts` (`liveState`, `liveKey`, `liveWords`, `stampSeen`, unit tests in `app/test/livelabel.test.mjs`) and `app/src/components/LiveLabel.tsx` (`LiveStatus`, `LiveCountdown`, `LivePill`). Every answer read through `app/src/lib/api.ts` is stamped with `seenAt` (the moment this phone received it) on each departure row and each trip leg, so a copy kept for offline use keeps its true age.

Where it shows: departure rows (stop screens, Home stop cards, the full screen board, where each row says Live with its age, Timetable, Not tracking with the timetable time instead of a countdown, or Cancelled; `boardCore.ts` `boardRows` uses `liveState`), Plan results and the trip screen (each leg), the service screen and the live trip.

## Recently departed

A departures board lists services from now on; a service drops off once it has gone. The app remembers what each board showed on its last read (memory only, this app session, nothing stored or sent) and, when a service drops off on the next read, lists it under Recently departed for 10 minutes. On a stop screen that is one row above the departures ("Recently departed: T8 left 4:21pm"); tap it to see up to 5, each opening its service:

* **Left 8:42am, Live, 2 min late**: only when a live time tracked it right up to its departure (read 2 min or less before it, GPS not stale).
* **Due 8:40am, Not tracked, no live time**: a timetable only service, or one whose live time had gone stale. The app does not say it left.

Two reads more than 3 min apart record nothing (the app was closed in between). A service that drops off more than 90 s before its time is not a departure (cancelled or the list changed). Code: `app/src/lib/recentCore.ts`, `app/src/lib/recent.ts`, same tests.

## Not stopping today

Written 28 Oct 2026. Trains say "Not stopping" when the realtime feed marks a stop skipped. Buses now get the same from the service's own alerts: a detour, a stop moved, no service, or changed or reduced service whose words say a stop is not served (a bus stop closure, missed stops, a diversion), naming the stop (docs/API.md `notStopping`). The row keeps its time and countdown and adds **Not stopping at <stop> today** in amber under it (another day: "on <day>"); with no stop name, "Not stopping here today". VoiceOver and TalkBack read the label and then the alert's own words. Trip legs show it with the warning icon where you get on, else where you get off. The bus route view asks `/api/detours` once per open: a line above the stops ("Not stopping at <stop> today", or "at N stops today") and "Not stopping today" under each stop skipped. A closure whose stop is on neither direction's list (the timetable has already dropped it, as with both live closures on 28 Oct) shows the alert's own words in that line instead. Code: `lib/notStoppingCore.ts`, the departure row in `Transit.tsx`, `LegView` in `app/trip.tsx`, `app/route.tsx`. Tests: `app/test/notstopping.test.mjs`.

## How fresh live is (28 Oct liveness pass)

Written 28 Oct 2026 for "We cant compromise liveness and speed here with accuracy". The full table of every layer and its worst case is in the liveness audit (files/liveness-audit-28oct.md on the build box).

* **A live time is as old as its feed copy.** The copy's own time is its GTFS realtime header timestamp (when Transport for NSW made it), never later than when the server fetched it; a header more than 2 minutes in the future is not trusted (`feedDataTs` in `backend/src/worker.js`). Feed rows carry it as `liveAt`; answers carry the oldest copy's time as `feedTs` (newer app only).
* **Server limit, every app version: 5 minutes.** No live time comes from a feed copy whose own time is over 5 minutes old (`FEED_LIVE_MAX_MS`); before 28 Oct the last good copy of a feed that stopped answering was used for as long as the server copy lived. Kept copies (edge copies, boards saved in D1, engine boards held while the planner fails) send a row whose live time is over 5 minutes old as a timetable row (`capLiveRows`: no estimate, no delay, no vehicle; `liveOld: true` for the newer app).
* **Phone limit: 5 minutes, on the phone's own clock** (`LIVE_MAX_MS` in `liveLabelCore.ts`), however far off the service is; within 10 minutes of the service the 2 minute limit stays, and a GPS position over 3 minutes old is Not tracking as before. Past the limit the row says Not tracking with its timetable clock time.
* **Row age from the feed** (`LIVE_DATA_AGE` on): each row's "updated" counts from its `liveAt` on the phone's clock, corrected with the answer's `now`, never younger than the answer. The GPS age in the answer was measured when the answer was made, so it is counted from there (`liveLead`), not twice.
* **Kept copies keep their age.** `copyTime` (api.ts `dataTime`) reads a copy's `dataAt` on the server's clock; a copy over 15 minutes old counts as 15 minutes old (before, as just read). The "Live, updated" line keeps an older answer's own time and, past 5 minutes, says "Updated N min ago, refreshing" instead of Live.
* **Live Activity.** The server tick's card is "updated" at the oldest live time on it (each service's `feedTs`), so its stale date (2 minutes after) never outlives its live times.
* **Switches** (server config, no deploy): `feedAgeCap` off removes the 5 minute drop; `feedHeaderTime` off ages copies by fetch time again.
* **Watching it.** `/api/engine/status` (`workerFeeds`) and `/api/health` (`feedFresh`) show per feed and per mode the copy's age, header lag, errors, copies served old and copies dropped as too old.
* Widgets are native and keep a timeline up to 15 minutes; the same limit for them is under Build 209 in IOS27.md.

## Often does not run

Written 28 Oct 2026. A bus with no live time ("Timetable only") or a stale one ("Not tracking") in an hour where many of its line's services never showed live says **Often does not run** instead, amber with the no live icon. VoiceOver: "Often does not run at this time, no live data" or "Not tracking, often does not run". The countdown is unchanged (minutes to the timetable time, or the clock time once passed or when stale). Live and Cancelled rows never change.

The server counts it (docs/API.md `noShow`): from the live times it already records, per line, day type and hour, only services that were being watched (a later bus at the stop was read live around their time); marked at 12 or more watched, counted on at least 4 distinct service days, and 30 percent or more never live (the bar was 8 watched with no day rule until the 28 Oct tightening: one hour qualified on 2 days of data, and a wrong label is worse than none). A day where over 35 percent of everything missed is still skipped as another timetable. The app checks the share and a lower count floor of its own (`liveLabelCore.ts` `oftenNoShow`, `NO_SHOW_SHARE`, `NO_SHOW_MIN_N` 8); the server's bar is the stricter one, and the app cannot see days. Servers without it send no `noShow`, so older servers and every other row show the labels above. Code: `liveState` (label, `noShow` on the state), `LiveStatus` in `LiveLabel.tsx`, `depState` and the row key in `Transit.tsx`, `boardRows` in `boardCore.ts`, the trip screen's legs. Tests: `app/test/noshow.test.mjs`.

## Bus stop boards (Opal style)

* **Route chips** on a bus stop: tap 410 to see only the 410 (tap again or All routes to see every route); with a route chosen, "Route 410: all stops and live buses" opens the route view. A route that leaves the board drops the filter. Code: `stopBoardCore.ts` (`byRoute`, `keepRoute`).
* **GET ON / GET OFF** in a service's stop list when it is opened from a trip or plan leg (the leg passes its get off stop as `to`; `/api/service` marks it `alight` on servers that know `to`, otherwise the app finds the stop id after the boarding stop). GET ON is filled in the line colour, GET OFF outlined; stops after GET OFF are dimmed. Opened from a departure board there is no get off stop, so the list shows YOUR STOP as before. Code: `stopBoardCore.ts` (`boardAlight`), `app/src/app/service.tsx`.
