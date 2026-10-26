# Board engine

Written 26 Oct 2026 after Bidur's 11:24 AM message: "How can we make it faster like really crazy faster. Everywhere."

## What it does

Every departure board in NSW is built ahead of time on our server from Transport for NSW's network wide GTFS realtime
feeds and the GTFS timetable. A phone asking for a board gets one that is already made. The number of calls we make to
Transport for NSW depends on the number of feeds (about 25), not on the number of phones or stops.

Code: `backend/src/engine.js` (appended to `worker.js` by `build.mjs`, same module), timetable builder
`backend/tools/build_timetable.py`, loader `backend/tools/load_timetable.mjs`, tests `backend/test/engine.test.mjs`.

## How

1. **Timetable.** `build_timetable.py` reads the GTFS schedule bundles per realtime feed (buses, sydneytrains, metro,
   ferries, MFF, 4 light rail networks, nswtrains, 13 regional bus feeds) plus `stops.txt` of the complete bundle (its
   parent stations put a station's bus stands on the station's board, as the Trip Planner does). It writes one row per
   stop and service day: departure seconds, trip id, route, headsign, stop sequence. Rows where nobody can board (pick
   up type 1, a trip's last stop) are left out. Sydney Trains updates carry no stop sequence, so the stop order of each
   train trip is kept too.
2. **Storage.** One Durable Object (`BoardEngine`, binding `ENGINE`, SQLite storage, created near Sydney with location
   hint `oc`) holds the timetable. A load writes a new version next to the old one and `commit` switches to it, so
   boards never mix two timetables. R2 is not available on the account, and KV would bill a write per board every
   10 s, so SQLite in the object it is.
3. **Live data.** An alarm every 10 s fetches the trip update feeds that boards have needed in the last 5 minutes
   (regional bus feeds every 30 s, vehicle positions every 30 s) and rebuilds every board read in the last 5 minutes.
   A Durable Object alarm is the only Workers timer that fires every 10 s (cron triggers are once a minute), and one
   object means one copy of each feed for all of Australia, so calls stay flat. The alarm stops after 15 minutes with
   no reads and starts again on the next read.
4. **Joining.** For each timetabled departure in the next 90 minutes (and up to 2 hours back, for late services) the
   trip's update gives the live time: the update at the stop (a live time first, then the delay), else the last
   update before the stop carries on down the line (the GTFS realtime rule). A cancelled trip, a skipped stop, a
   platform change (the update names another platform of the station), a replacement timetable that no longer calls
   at the stop, and services added on the day (not in the timetable) are all handled. An update for another service
   day is ignored.
5. **Platform names.** Where the Trip Planner's platform names differ from the timetable's (bus stands such as
   "Stand X1", some light rail platforms), the engine uses the planner's, learnt from the planner boards the worker
   still asks for (`/learn`).
6. **Serving.** `/api/departures` asks the engine when `ENGINE_BOARDS` is `on` (or `engine=1` on the request). Boards
   are shared through Cloudflare's cache for 4 s per location and 2 s in each worker copy, so 10,000 phones at one
   stop make one request to the engine every few seconds per location. A stop with no timetable falls back to the
   Trip Planner. `dataAt` is the time the feed copy was fetched, so the app's "Updated" line stays honest.
7. **Budget.** The engine counts its feed calls per day. If the day's count runs ahead of `ENGINE_BUDGET` (default
   30,000), intervals stretch, up to 6 times.

## Endpoints

* `GET /api/departures?stop=ID[&mode=][&engine=1]` same answer shape as before, plus `engine.builtAt`.
* `GET /api/engine/status` timetable version, days loaded, feed ages, calls today, hot boards.
* `GET /api/timetable?stops=ID,ID[&days=2]` the on phone timetable pack (up to 40 stops, today and the next days).
* `POST /api/engine/load/{begin,stops,days,trips,commit}` loading, `x-admin-key` with `ENGINE_LOAD_KEY` or the
  admin key.

## Refreshing the timetable

```
python3 tools/build_timetable.py <dir of GTFS zips plus stops_complete.txt> <out> [first day] [days]
ENGINE_LOAD_KEY=... node tools/load_timetable.mjs <out>
```

The GTFS zips come from `/v1/gtfs/schedule/<feed>` (one call each, about 26) and `stops_complete.txt` from the complete
bundle. A stop with no rows for today falls back to the Trip Planner, so a missed refresh degrades to today's speed,
it does not show wrong boards. The daily refresh is the GitHub workflow `.github/workflows/timetable.yml`.

## Status on 26 Oct, 12:45 PM

* **Behind the flag.** `ENGINE_BOARDS` is off; phones get the Trip Planner path. `engine=1` on a request asks the engine.
* **Match with the Trip Planner** (30 stops NSW wide, 1 Sydney commute name; same services, times within 60 s,
  platforms where given; `match_api.mjs` in the task folder): 92.9% at 12:06 PM (328 of 353), 91.1% at 12:27 PM
  (328 of 360). The gate is 95%, so it stays off. Where they differ:
  * Live times 61 to 120 s apart on services both show live (light rail and buses mostly, engine later). Polling both
    every 30 s for 6 minutes, the planner later reached the engine's time in 34 of 143 such cases, so "the planner
    lags the feed" explains only some of it.
  * Replacement trains (REPLACEMENT trips in the feed) where the feed says 10 to 22 minutes late and the planner says
    on time, or where the replacement starts after this stop.
  * Services with no GTFS data in the bundles we load: the private Watsons Bay ferry, Goulburn coach 855, SH100,
    Bomaderry 700-1.
  * A bus whose feed has already dropped this stop (it has left) while the planner still lists it.
* **Fixed today:** loop services (a stop called at the start and the end: the stop sequence now decides which call an
  update is for), duplicate rows for NSW TrainLink services that are in two bundles, and the feed bucket going into
  debt after a restart.
* **Open:** the object restarted under load (SCALING.md); alerts, wheelchair access and destination ids are not on
  engine boards yet.
