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

Where it shows: departure rows (stop screens, Home stop cards, the board), Plan results and the trip screen (each leg), the service screen and the live trip.

## Recently departed

A departures board lists services from now on; a service drops off once it has gone. The app remembers what each board showed on its last read (memory only, this app session, nothing stored or sent) and, when a service drops off on the next read, lists it under Recently departed for 10 minutes:

* **Left 8:42am, Live, 2 min late**: only when a live time tracked it right up to its departure (read 2 min or less before it, GPS not stale).
* **Due 8:40am, Not tracked, no live time**: a timetable only service, or one whose live time had gone stale. The app does not say it left.

Two reads more than 3 min apart record nothing (the app was closed in between). A service that drops off more than 90 s before its time is not a departure (cancelled or the list changed). Code: `app/src/lib/recentCore.ts`, `app/src/lib/recent.ts`, same tests.
