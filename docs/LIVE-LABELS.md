# Live labels and Recently departed

Every countdown in the app says where its time comes from. Written 25 Oct 2026 for the ghost bus complaint (about 105 store reviews of Sydney transport apps, keyword matches: "says it left" but it never came; research report files/research-25oct/report.md on the build box).

## The three labels

| Label | When | What the countdown shows |
| --- | --- | --- |
| Live, updated 20 s ago | The service has a live time, our copy is fresh and the vehicle's GPS position (when the feed sends one) is under 3 min old | Minutes to the live time, bold |
| Timetable | No live time for this service | Minutes to the timetable time, grey. Once that time has passed: the time itself (8:42am), never "Gone" or "Left" |
| Not tracking | It had a live time, but the GPS position is over 3 min old, or our copy is over 2 min old and the service is due within 10 min, or the live time passed over a minute ago and the service is still listed | The timetable time (8:42am) with "timetable" under it. No countdown to 0 |

Cancelled services say Cancelled. The age is our copy's age plus the GPS position's own age, in 15 s steps under a minute ("just now", "15 s ago", "30 s ago", "45 s ago"), then minutes, so rows redraw at most every 15 s.

Code: `app/src/lib/liveLabelCore.ts` (`liveState`, `liveKey`, `liveWords`, `stampSeen`, unit tests in `app/test/livelabel.test.mjs`) and `app/src/components/LiveLabel.tsx` (`LiveStatus`, `LiveCountdown`, `LivePill`). Every answer read through `app/src/lib/api.ts` is stamped with `seenAt` (the moment this phone received it) on each departure row and each trip leg, so a copy kept for offline use keeps its true age.

Where it shows: departure rows (stop screens, Home stop cards, the full screen board, where each row says Live with its age, Timetable, Not tracking with the timetable time instead of a countdown, or Cancelled; `boardCore.ts` `boardRows` uses `liveState`), Plan results and the trip screen (each leg), the service screen and the live trip.

## Recently departed

A departures board lists services from now on; a service drops off once it has gone. The app remembers what each board showed on its last read (memory only, this app session, nothing stored or sent) and, when a service drops off on the next read, lists it under Recently departed for 10 minutes. On a stop screen that is one row above the departures ("Recently departed: T8 left 4:21pm"); tap it to see up to 5, each opening its service:

* **Left 8:42am, Live, 2 min late**: only when a live time tracked it right up to its departure (read 2 min or less before it, GPS not stale).
* **Due 8:40am, Not tracked, no live time**: a timetable only service, or one whose live time had gone stale. The app does not say it left.

Two reads more than 3 min apart record nothing (the app was closed in between). A service that drops off more than 90 s before its time is not a departure (cancelled or the list changed). Code: `app/src/lib/recentCore.ts`, `app/src/lib/recent.ts`, same tests.

## Not stopping today

Written 28 Oct 2026. Trains say "Not stopping" when the realtime feed marks a stop skipped. Buses now get the same from the service's own alerts: a detour, a stop moved, no service, or changed or reduced service whose words say a stop is not served (a bus stop closure, missed stops, a diversion), naming the stop (docs/API.md `notStopping`). The row keeps its time and countdown and adds **Not stopping at <stop> today** in amber under it (another day: "on <day>"); with no stop name, "Not stopping here today". VoiceOver and TalkBack read the label and then the alert's own words. Trip legs show it with the warning icon where you get on, else where you get off. The bus route view asks `/api/detours` once per open: a line above the stops ("Not stopping at <stop> today", or "at N stops today") and "Not stopping today" under each stop skipped. Code: `lib/notStoppingCore.ts`, the departure row in `Transit.tsx`, `LegView` in `app/trip.tsx`, `app/route.tsx`. Tests: `app/test/notstopping.test.mjs`.

## Often does not run

Written 28 Oct 2026. A bus with no live time ("Timetable only") or a stale one ("Not tracking") in an hour where many of its line's services never showed live says **Often does not run** instead, amber with the no live icon. VoiceOver: "Often does not run at this time, no live data" or "Not tracking, often does not run". The countdown is unchanged (minutes to the timetable time, or the clock time once passed or when stale). Live and Cancelled rows never change.

The server counts it (docs/API.md `noShow`): from the live times it already records, per line, day type and hour, only services that were being watched (a later bus at the stop was read live around their time); marked at 12 or more watched, counted on at least 4 distinct service days, and 30 percent or more never live (the bar was 8 watched with no day rule until the 28 Oct tightening: one hour qualified on 2 days of data, and a wrong label is worse than none). A day where over 35 percent of everything missed is still skipped as another timetable. The app checks the share and a lower count floor of its own (`liveLabelCore.ts` `oftenNoShow`, `NO_SHOW_SHARE`, `NO_SHOW_MIN_N` 8); the server's bar is the stricter one, and the app cannot see days. Servers without it send no `noShow`, so older servers and every other row show the labels above. Code: `liveState` (label, `noShow` on the state), `LiveStatus` in `LiveLabel.tsx`, `depState` and the row key in `Transit.tsx`, `boardRows` in `boardCore.ts`, the trip screen's legs. Tests: `app/test/noshow.test.mjs`.

## Bus stop boards (Opal style)

* **Route chips** on a bus stop: tap 410 to see only the 410 (tap again or All routes to see every route); with a route chosen, "Route 410: all stops and live buses" opens the route view. A route that leaves the board drops the filter. Code: `stopBoardCore.ts` (`byRoute`, `keepRoute`).
* **GET ON / GET OFF** in a service's stop list when it is opened from a trip or plan leg (the leg passes its get off stop as `to`; `/api/service` marks it `alight` on servers that know `to`, otherwise the app finds the stop id after the boarding stop). GET ON is filled in the line colour, GET OFF outlined; stops after GET OFF are dimmed. Opened from a departure board there is no get off stop, so the list shows YOUR STOP as before. Code: `stopBoardCore.ts` (`boardAlight`), `app/src/app/service.tsx`.
