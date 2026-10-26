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
   and keeps one copy of each. Each feed aims for an age (the busiest 10 s, other Sydney feeds 20 s, regional bus
   feeds 45 s, vehicle positions 30 s) and the most overdue goes first; at most 45 calls a minute (`ENGINE_PER_MIN`).
   After a refused call (429 or 403) no feed calls for 30 s, doubling to 10 minutes while refusals go on.
   A Durable Object alarm is the only Workers timer that fires every 10 s (cron triggers are once a minute), and one
   object means one copy of each feed for all of Australia, so calls stay flat. The alarm stops after 15 minutes with
   no reads and starts again on the next read.
4. **Shards (since 26 Oct, g14).** Boards are built by 16 shard objects (`BoardShard`, binding `SHARDS`, stop id
   hash, `ENGINE_SHARDS`), not by the core. A shard reads a stop's timetable window from the core (`/window`, kept 20
   minutes), the live trips of its boards (`/live`, trimmed to those trips), and every 5 s rebuilds a board whose live
   data changed (at least every 15 s), writing it to `caches.default` for 15 s. Design and reasons in SCALING.md.
5. **Joining.** For each timetabled departure in the next 90 minutes (and up to 2 hours back, for late services) the
   trip's update gives the live time: the update at the stop (the delay first, added to the planned time; the
   update's own time only when it has no delay), else the last
   update before the stop carries on down the line (the GTFS realtime rule). A cancelled trip, a skipped stop, a
   platform change (the update names another platform of the station), a replacement timetable that no longer calls
   at the stop, and services added on the day (not in the timetable) are all handled. An update for another service
   day is ignored. Planned times are whole minutes, as the Trip Planner gives them (02:16:35 is 02:16), and the live
   time is that minute plus the delay. Light rail and metro clock times in the feeds run 30 to 75 s after
   planned plus delay, which is why the delay comes first (26 Oct: on 319 services live in both, the delay agreed with
   the planner within 60 s on 298, the update's time on 237). Non revenue runs ("Empty Train", "Not In Service")
   are left off.
6. **Platform names and missing services.** Where the Trip Planner's platform names differ from the timetable's (bus
   stands such as "Stand X1", some light rail platforms), the engine uses the planner's, learnt from planner boards
   (`/learn`). A shard asks the worker for one planner board of a stop on its first read (once in 6 hours when rows
   have no platform name, else once a day, at most 2 stops a minute per shard). The same board's lines tell the core
   when the planner lists a line our bundles do not have at that stop (the private Watsons Bay ferry, coach 855 and
   SH100 at Goulburn, 700-1): the stop is marked for 6 hours (`engine.gap`) and its boards come from the Trip Planner.
7. **Serving.** `/api/departures` asks the engine when `ENGINE_BOARDS` is `on` (or `engine=1` on the request). Boards
   are read from Cloudflare's cache (written by the shards, 15 s) and a 2 s copy in each worker instance; a shard is
   asked only on a miss. A stop with no timetable falls back to the Trip Planner, and so does a board over 60 s old
   (built or feed copy) unless the planner refuses, fails or is busy, when the engine's board is served as it is.
   `dataAt` is the time the feed copy was fetched, so the app's "Updated" line stays honest. Boards carry a weak ETag
   (304 on If-None-Match).
   **Outage fallback** (root's decision, 26 Oct 1:58 PM): whatever `ENGINE_BOARDS` says, when the Trip Planner fails
   and no copy is kept or saved, `/api/departures` answers with the engine's board as timetable times (rows realtime
   false, `source: "timetable"`, a first alert "Live times unavailable, showing timetable times"), never stored as a
   copy. Not the switch on.
8. **Push (off).** `/api/live` (ENGINE_PUSH on): a WebSocket to the board's shard, which sends the whole board and
   then a diff each time it rebuilds the board; open sockets keep the board hot. Format in API.md.
9. **Feed timing (off).** With `ENGINE_FEED_TIMING` on, the core reads each feed's publish period from the header
   times of its last 8 copies, asks for the next copy 2 s after it is expected (not on a fixed beat), names the copy it
   holds (If-None-Match / If-Modified-Since) so an unchanged feed can answer 304, and shards ask the core just after a
   copy lands. `/api/engine/status` shows each feed's `periodS`, `same` (calls that brought nothing new), `madeAgoS`
   and `nextInS`.
10. **Budget.** The engine counts its feed calls per day. If the day's count runs ahead of `ENGINE_BUDGET` (default
   40,000), intervals stretch, up to 6 times.

## Endpoints

* `GET /api/departures?stop=ID[&mode=][&engine=1]` same answer shape as before, plus `engine.builtAt`.
* `GET /api/engine/status` timetable version, days loaded, feed ages, calls today, hot boards, refusals and pause,
  stops marked with missing lines (`gaps`), and every shard's starts (`boots`, `bootAt`), boards, cache writes.
* `POST /api/engine/load/restart` and `/api/engine/load/restart-shards` (engine load key) restart the objects so they
  run newly deployed code.
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
