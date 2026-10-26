# Timetable packs on the phone

Written 26 Oct 2026 after Bidur's 12:11 PM message: "Do everything to make it fastest". Server: transport-api
2ef1ad9f (26 Oct, 12:20 PM). App: over the air 26 Oct, 12:54 PM, production group 54aa4d52, roll back to f9c48f4c (RELEASES.md).

## What it does

A stop you use (starred, on a saved trip, home or work, or opened lately) keeps its whole timetable for today and
tomorrow on the phone. When you open it, its departures are on screen in the first frame, with no signal too, marked
"Timetable times, getting live times". The live board replaces them when it lands (about 0.2 to 2 s on a good
connection), with live times, delays, platform changes and cancellations as before. A copy of the live board kept in
the last 10 minutes still wins over the pack, because its live times are closer to right.

## Server

`GET /api/pack?stop=ID` (docs/API.md, "Timetable packs on the phone"), code `backend/src/pack.js`, tests
`backend/test/pack.test.mjs`. The pack is built in the board engine's Durable Object from the timetable it already
holds (docs/ENGINE.md), so it shows the same lines, headsigns and platforms as the engine's boards for the same row.
`pack.js` is appended after `engine.js` by `build.mjs` and adds the object's `/pack` path without changing `engine.js`.
Trip ids are left out (they were 60% of the size). Cloudflare keeps each stop's pack for the Sydney day (6 hours).

Sizes on 26 Oct 2026 (two service days, gzip as sent): Katoomba 0.7 KB, Tallawong 1.3 KB, Strathfield 4.6 KB,
Central 14.3 KB (the biggest stop in NSW, 38 platforms and stands, 8,000 departures). Unzipped JSON as kept on the
phone: Katoomba about 2 KB, Strathfield 53 KB, Central 91 KB.

## App

* `app/src/lib/timetablePackCore.ts` (rules, tested in `app/test/timetablepack.test.mjs`): reading a pack into board
  rows (realtime false, status Scheduled, no trip id), one mode, which stops keep a pack (24 at most), when a pack is
  fetched again (once a day, or when it covers less than 20 more hours), which first paint wins, the labels.
* `app/src/lib/timetablePack.ts`: one AsyncStorage key per stop (`tt:pack:<id>`, index `tt:index`). Kept packs are read
  into memory at start, so screens read them with no wait. Due packs are fetched one at a time 4.5 s after start and
  when the app comes back to the front; the first network failure stops the round. A stop opened is fetched 4 s after
  its screen opens if it keeps a pack. No timers repeat. Packs come from api.transportsydney.app only.
* `useLive` (`app/src/lib/hooks.ts`) takes `pack: { stop, mode }`: first frame from a live copy younger than 10 minutes,
  else the pack, else an older live copy. `packAt` says pack times are on screen; a live answer clears it.
* Used by the stop screen (Now only, and the mode chip's board), Home's starred stop cards and the full screen board.
* Labels: the stamp says "Timetable times, getting live times", or "Live times unavailable, showing timetable times"
  when the live board could not be had (offline or a server error). Each row says Timetable, in grey, as rows with no
  live data always have. Nothing from a pack is ever called live.

## Checked against the live board (26 Oct 2026, 12:23 PM)

20 stops NSW wide, one Sydney commute name (Strathfield): Katoomba, Wollongong (station and the Station St bus stop),
Newcastle Interchange, Gosford, Albury, Wagga Wagga, Orange, Tamworth, Coffs Harbour, Goulburn, Kiama, Bomaderry,
Queanbeyan, Honeysuckle light rail, Stockton ferry wharf, Maitland, Port Macquarie Base Hospital and Nowra Mall buses.
Every pack row from 2 minutes ahead to the end of what the Trip Planner board returned (at most 3 hours; one board per
mode at stops with several) was looked for in the planner's board at the same minute:

* 370 pack rows, 370 found at the same minute and mode, 0 missing.
* 362 of 370 with the same line name. The other 8 are NSW TrainLink regional trains the timetable names by route
  (`STH`, `NRC`, `NRW`) and the planner by train number (623, 634, 22). The board engine's boards have the same names.
  When the live board lands the row takes the planner's name.
* Coffs Harbour had no departure in the window.

## Measured (web build 390x844, 26 Oct 12:31 to 12:38 PM, before: main 639608f, the app of the 11:58 AM update; after: this change)

Strathfield starred, its pack kept, no live copy kept, a cold start, 5 runs each. The time is from navigation to the
first departure row on screen, so it includes the web build loading its JavaScript (about 0.85 s on this box).

| | Before | After |
| --- | --- | --- |
| Stop screen, signal | 1.22 s (1.18 to 1.72, 3 of 5; 2 never loaded while a load test ran from the same box) | 0.88 s (0.87 to 0.90, 5 of 5) |
| Stop screen, no signal | "Can't load this stop", 0 of 5 | 0.90 s, timetable rows, 5 of 5 |
| Home starred card, signal | 1.61 s (0.98 to 1.63, 4 of 5) | 0.90 s, 5 of 5 |
| Home starred card, no signal | never, 0 of 5 | 0.91 s, 5 of 5 |

Screens (light and dark, 390x844 and 430x932, with and without signal): `stop-strathfield-*.png` in the task's files.

## Not done here

* Wi-Fi only refresh: the app has no network type API in builds 201 to 208 (no NetInfo, no expo-network), so packs
  refresh once a day on any connection. They are small (0.7 to 14 KB each). Noted under Build 209 in IOS27.md.
* Widgets and the Watch do not read packs yet (native code, build 209).
