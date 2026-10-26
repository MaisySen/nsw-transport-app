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
   are left off, except an Empty Train run the train feed gives a live time at the stop (since 27 Oct: some late
   night runs with that headsign carry passengers). Sydney Trains trips the timetable lacks (a trip id published after
   the load) are listed from the feed as added services.
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

## Night trains and trackwork trips (27 Oct, 2 to 4 AM, g14)

* **The train misses were Empty Train runs that carry passengers.** Every train the engine missed in the night match
  (12:37 to 12:54 AM: 2 at 12:37, 8 at 12:49, 4 at 12:54) was a late night run (T1 to Penrith, T4, CCN, BMT) that the
  timetable has with the headsign "Empty Train", which the engine left off every board. The Trip Planner listed 13 of
  the 14 such rows due at the matched stations, all with live times. Checked against the timetable the engine holds
  (`/api/timetable`), not a guess: their trip ids are in it, so they were never "trips the timetable lacks".
  * Now an Empty Train row stays on the board when the train feed gives that trip a live time at this stop (not
    cancelled, not skipped); with no live time it stays off as before. Its destination is the update's last stop, not
    "Empty Train". `ENGINE_EMPTY_LIVE` "off" (wrangler var, not set) leaves every Empty Train off again.
  * Not checked in the day: the 133 Empty Train runs a day at Strathfield that the planner does not list. If the train
    feed carries those with live times, they would now show. The match script counts engine rows the planner does not
    list, so a day match shows it; the var turns it off without a deploy of code.
* **Trips the timetable lacks, listed from the feed.** The 14th row was a new trip id for the same run (W795 under
  `.165.8.` where the timetable has `.165.4.`): a trackwork change published after the load. For the Sydney Trains feed
  (`ENGINE_ADD_UNKNOWN`), the core object looks up each trip id of a feed copy in the timetable's trips table (once per
  id per timetable version, kept in memory) and lists the trips it does not have as added services: the stop sequence
  is the order of the update's stops, the planned time is the update's time less its delay in whole minutes, the live
  time that minute plus the delay. Only the stops due from 10 minutes ago to the horizon are kept, so the copy sent to
  shards stays small. A copy where more than 40% of trips are unknown (another timetable version) lists none. A
  timetable row of the same run (trip id up to the first dot) within 10 minutes with no live data is dropped for the
  live one. Added rows now follow a board's mode filter too (a bus board had trains). `ENGINE_ADD_UNKNOWN` "off" stops
  it. `/api/engine/status` shows per feed `unknown`, `unknownListed` and `addMs`.
  No nightly load: the trips table already has every train trip of the loaded days.
* **Match after the change** (27 Oct, 4:08 AM, the first trains of the day; `match_x.mjs` in the task folder, now
  leaving out boards the engine did not make; 22 fresh stops NSW wide, no owner stop: 12 train stations, 2 metro, 3 light
  rail, 5 bus stops; boards warmed at 3:58 AM): **353 of 379, 93.1%**. Train 153 of 158, bus 155 of 176, metro 28 of 28,
  light rail 17 of 17. 3 engine rows inside the planner's span were not on the planner (a scheduled bus 17 at Gosford and
  one scheduled M1 run at Epping and Crows Nest); no Empty Train row among them. Below the 95% gate: `ENGINE_BOARDS` stays off.
  * 20 of the 26 misses: temporary stands not learnt yet (Stand X1 and X2 at Dulwich Grove 9, Dee Why 9, Rouse Hill 2).
    The engine shows no stand, the planner names one. The warm read 22 stops at once and learning takes at most 2 first
    reads a minute per shard, so these stops had not had their planner read.
  * 3: first trains of the morning with the Empty Train headsign (T9 at Epping, T4 at Hurstville, T3 at Lidcombe, 5:13 to
    5:35 AM) that the planner lists with timetable times, before the feed had them live. 2 more Empty Train runs (SCO at
    Sutherland and Hurstville) were live and matched. Over the night 18 of 18 Empty Train rows seen at matched stations
    were on the planner (13 live at 12:37 to 12:54 AM, 2 live and 3 scheduled at 4:08 AM). If a day check shows the same,
    the next step is to list Empty Train rows like any other row; not done tonight (no day evidence, and the 133 a day at
    Strathfield are said to be on no planner board).
  * 2: trains due 90.5 minutes out (Katoomba, Lidcombe, 5:38 AM), past the engine's 90 minute horizon when it built the
    board and inside the script's window a few seconds later. 1: a bus 61 s apart.
  * Planner calls for the night's work: at most 49 (warm and learn 22, match 22, 5 earlier checks).
* **Temporary stands (Stand X1 to X4): no code change.** The timetable's stops carry no stand for them: their names and
  their parents' are plain (for example 220314 "Old Canterbury Rd at Rosedale St", parent 220320 "Waratah Mills Light
  Rail"), so nothing can be read from them, and a guess would be wrong data. The engine learns them from the Trip
  Planner (`/learn`, the first read of a board with a service that has no stand, at most 2 stops a minute per shard):
  at 1:01 AM three engine reads of Waratah Mills, Marion and Dunmore St each started a learn, and at 1:03 AM all three
  showed Stand X1 to X4 like the planner. The night misses were stops read before their learn had run.
* **CPU, local only** (`tools/engine-cpu.mjs` against `tools/fake-nsw.mjs` mode `trains`: a synthetic Sydney Trains feed
  of 1,500 trips, 20 stops each, 966 KB; Node on the shared box, so an order of size):
  * Core object, per feed copy: 25 to 39 ms median CPU before and after (fetch, index, decode). The decode and unknown
    trip step was 10 to 12 ms with the feature off and on (the decode of every trip per copy was already there; the
    lookups are only for trip ids not seen before in this timetable version).
  * A board build: 3 to 6 ms median, p95 under 10 ms. A shard's tick: the same before and after (70 to 97 ms on this
    dense synthetic network). The core's answer to a shard grew from 900 KB to 923 KB with 30 unknown trips and 964 KB
    with 150.
  * Under wrangler dev (`tools/local-dev.mjs`, the same synthetic feed, 30 unknown trips): `addMs` 7 to 15 ms a copy,
    30 of 30 listed, shard ticks 2 to 4 ms; `tools/local-burst.mjs` 40 of 40 answers 200.
  * Cost: no new Worker requests, no new object requests, no rows written. Rows read: one per new trip id per timetable
    version (a few thousand a day against 25 billion included). Object duration: a few ms more per copy in an object
    that is awake anyway. Inside the US$5 plan, no overage; a request stays far under the plan's CPU limit.

## Status on 27 Oct, 1 AM (night match, g14)

* **Still behind the flag.** `ENGINE_BOARDS` off, budget guard untouched. Gate: 95% match, budget guard clear and the owner's go.
* **Night match** (`match_api.mjs` in the task folder: `/api/departures?engine=1` against `engine=0&refresh=1` for the same stop in the same seconds; services in the next 90 minutes, times within 60 s, platforms where given; boards warmed first, feeds 5 to 15 s old):
  * 12:37 AM, 30 stops NSW wide (1 owner stop): 95 of 126, 75.4%. Train 14 of 16, bus 59 of 88, light rail 18 of 18, metro 4 of 4. 20 of the 31 misses were buses on timetable times: fixed (33fb001, below).
  * 12:49 AM, a fresh 25 stops (no owner stop), after the fix: 62 of 74, 83.8%. Train 10 of 18, bus 32 of 36, light rail 16 of 16, metro 4 of 4.
  * 12:54 AM, 6 stops recheck: 47 of 51, 92.2%; 47 engine rows inside the planner's span and none of them missing from the planner.
* **Fixed tonight:** buses after midnight. The timetable keeps a run that starts after midnight on the day before (past 24:00); the Sydney buses feed gives the calendar date it starts on, so every bus update after midnight was dropped as another day's. The next day's date now counts when the row is on that date too (`engSameRun`).
* **Left:**
  * Trains the timetable does not have (every train miss after the fix: 8 at 12:49 AM, 4 at 12:54 AM). Their trip ids are in the Sydney Trains feed as scheduled trips but not in the engine's load from 26 Oct, 11:50 AM; budget mode loads every second day, so trackwork changes published later are missing until the next load. Options: load every night (about 1.3 million rows a load, about 39 million a month of the 50 million included), or list live trips the timetable does not know (train feed) as added services (a timetable lookup per new trip id in the core; measure on the local fake NSW first).
  * Temporary stands with no name in the timetable (`Stand X1` to `X4` for replacement buses: 8 misses at 12:37 AM, 3 at 12:49 AM): the engine shows no stand where the planner names one.
  * Ferries: no ferry feed copy when a ferry stop is first asked, so those boards go to the Trip Planner (not counted; no ferries were due).
* **Calls:** at most 129 Trip Planner calls for all of it (the cap was 150), plus about 700 feed calls by the engine and 3 feed reads to diagnose. No load test.
* Tests: `node --test test/*.test.mjs` in `backend/` needs `TZ=Australia/Sydney` (14 engine tests fail on a UTC machine, before and after this change).

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
