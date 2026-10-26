# Scale: 1,000,000 people using the app at the same moment

## Budget mode: US$5 a month, up to 1,000 people (in force from 26 Oct 2026)

Bidur, 26 Oct, 3:47 PM: "Can't pay 90. We stay at 5 right now. Max users we may get currently is 1k." The server is
run for that, and the rest of this page is a documented path for later, not the plan now. Numbers, sources and the
guard are in [COSTS.md](COSTS.md).

* Plan: Workers Paid base fee, US$5 a month, nothing over the included amounts. Target: under 50% of every one at
  1,000 people (estimate: Worker requests 13%, CPU 25%, Durable Object rows written 40%, everything else under 20%).
* Phones stay on the Trip Planner path with the edge copies: `ENGINE_BOARDS`, `ENGINE_PUSH`, `LIVE_PUSH` and
  `OWN_PLANNER` off. The engine serves only outage fallbacks, timetable trips, Nearby and timetable packs.
* Idle costs nothing but the minute cron: engine objects stop ticking 5 minutes after the last read, 4 shards instead of
  16, no learn calls from Trip Planner boards, push hubs and the planner have no alarms when nobody is on them.
* The engine timetable loads every second night (4 days built), not every night: it was 80% of the month's included
  Durable Object rows written on its own.
* No load tests on production (`LOAD_TESTS` off). Load tests use `wrangler dev` with a fake Transport for NSW.
* Budget guard: every hour it reads this cycle's usage, projects the month end and, past 80% of any included amount,
  switches the costly features off for the rest of the cycle and emails contact@fintex.au.
* Going past 1,000 people, the order to spend money in: own planner on (cheap, cuts NSW calls), then push, then the
  engine for phones with fewer, slower shards. Each step needs a fresh COSTS.md estimate first.

Written 26 Oct 2026 after Bidur's 3:09 PM message: "Plan entire infra in scale properly ... as if we have million users.
Multiple users. Using app in same time. Multiple times in many devices. Live works."

Measured numbers say so and give their date. Everything else is an estimate from Cloudflare's published prices and
limits (read 26 Oct 2026 on developers.cloudflare.com), not a bill. SCALING.md (10,000 and 100,000) and ENGINE.md
(board engine) are the earlier steps; this page builds on them.

## The rule

**Transport for NSW calls must not grow with users.** Before today two things called NSW once per person:

* stop boards on the Trip Planner path (until the board engine is switched on), and
* every trip search (A to B), always.

So users x devices = NSW calls, and the 60,000 a day key ran out on 26 Oct at 1:24 PM with a handful of real phones
plus our tests. No quota, even the 1,000,000 a day we asked for, reaches a million users that way. The design below
makes NSW calls a fixed number a day, the same for 10 people or 1,000,000.

## The design in one picture

```
 phone, Watch, widgets, Live Activity (one fetch per person, shared on the device: build 209)
        |  HTTP (boards, trips, alerts)            |  WebSocket (open board, later live trip)
        v                                          v
 Cloudflare Worker in every Australian location (api.transportsydney.app)
   1. copy in this Worker instance (2 s)   2. Cloudflare cache in this location (boards 15 s, trips 60 s)
   3. only on a miss: the object that owns the answer
        |                       |                              |
 board shards (64 at 1M)   push hubs (128 at 1M)         trip planner replicas (RAPTOR, 120 to 380 at 1M)
 build every hot board     hold the sockets, send a      our own timetable search, no NSW call
 every 5 to 15 s           diff when a board changes     (src/raptor.js, this page, built today)
        \_______________________|______________________________/
                                |
                core object: the GTFS timetable and ONE copy of each NSW realtime feed
                                |
               Transport for NSW: about 25 network feeds, pulled once per publish period
               (+ the daily GTFS download, + a small capped Trip Planner cross check)
```

## Layer by layer, with the numbers

### What "1,000,000 at the same moment" means here

Assumptions, stated so they can be argued with:

* 1,000,000 people with the app open in the same minute (a weekday peak), for about 2 hours a day (morning and evening),
  and 15% of that for 14 more hours. That is about **4 peak hours a day**, so a month is the peak rate x 432,000 s.
* On screen: 50% a stop board, 30% a trip (results or a live trip), 20% Home and the rest.
* A new trip search once every 5 minutes per person: **3,333 searches a second** at the peak.
* Extra devices: today the Watch, widgets and Live Activities fetch on their own, about one request every 2 minutes per
  person on top of the phone. After build 209 they read the phone's copy.

### 1. Ingest once (NSW calls a day, flat)

| | 10,000 | 100,000 | 1,000,000 |
|---|---|---|---|
| Realtime feeds (trip updates, vehicles, alerts; engine core, capped at 45 a minute, 40,000 a day budget) | 15,000 to 35,000 | same | same |
| GTFS timetable download (daily workflow) | about 27 | 27 | 27 |
| Trip searches with our own planner | 0 | 0 | 0 |
| Trip Planner cross check (sampled, capped) | up to 2,000 | up to 2,000 | up to 2,000 |
| **Total** | **under 40,000** | **under 40,000** | **under 40,000** |
| For comparison, trip searches on the NSW planner (today's path) | about 30,000 | about 300,000 | about 4,000,000 at the peak hours alone |

Measured on 26 Oct: the engine made 10 to 24 feed calls a minute during the 1,000 and 10,000 phone tests (SCALING.md),
against 381 to 533 a minute on the Trip Planner path at 1,000 phones. With feed timing on (ENGINE_FEED_TIMING, built
today, off), each feed is asked just after NSW publishes a new copy and an unchanged copy can answer 304; the real
publish periods can only be measured after the key resets at 1 AM. A 20,000 a day target is likely with feed timing on.

### 2. Edge: the Worker (requests a second at the peak)

| Per person | Today (polling) | Target (push + shared device fetch) |
|---|---|---|
| Stop board open | 1 request every 15 s | a socket + 1 request a minute |
| Trip screen | 1 every 30 s + searches | same (push for live trips is a later step) |
| Home and the rest | 1 a minute | 1 a minute |
| Watch, widgets, Live Activity | 1 every 2 minutes | 0 (the phone's copy, build 209) |

| Requests a second | 10,000 | 100,000 | 1,000,000 |
|---|---|---|---|
| Today's design | 583 | 5,833 | 58,333 |
| Target design | 250 | 2,500 | 25,000 |

Measured 26 Oct: about 1 ms of Worker CPU per request (p50) at 1,000 simulated phones, p95 678 ms with every request
crossing the Pacific from the test machine. The Worker is not the limit: Cloudflare runs as many copies as needed in
every location; there is no per Worker request ceiling on the paid plan.

**Shared answers.** A board, a trip answer (same from, to and minute) and the alerts are the same for everyone, so the
Cloudflare cache in each location holds one copy: at most one request per stop per 15 s per location reaches the
object behind it, however many phones ask. The 2 s copy inside each Worker instance absorbs bursts. Per device state
(saved trips, settings) stays on the device.

### 3. Board shards (Durable Objects)

* A shard can write at most 400 boards to the cache per 5 s tick (the engine's own batch cap, under Cloudflare's 1,000
  subrequests per invocation). At 1,000,000 people about 40,000 stops are watched at once (estimate: NSW has about
  90,000 stops with services; 30,000 hot boards were measured as the busy set for Sydney in SCALING.md). Rebuilt every
  10 s, that is 4,000 boards a second, so **64 shards** (`ENGINE_SHARDS=64`) keep each under 400 a tick. 16 is enough
  to about 150,000 people.
* Requests to shards are cache misses only: about one per hot stop per location per 15 s. With 20,000 hot stop and
  location pairs, about 1,300 a second at the peak.

### 4. Push: WebSocket fan out

* Target: 500,000 open sockets at the peak (everyone on a board).
* Built today, both off: engine boards push from their board shard (ENGINE_PUSH, a81237c8), and Trip Planner path
  boards push from a LiveHub object per stop and mode (LIVE_PUSH, d01f9276), at most 2,000 sockets on one stop (the
  next phone gets 503 and polls). One object runs on one thread; Cloudflare's guidance is up to about 32,000 sockets
  on one object. A busy stop (Central, Town Hall) at 1,000,000 people can have tens of thousands of phones on one
  board, so for 1,000,000 a hub is keyed by **stop and bucket** (a stop with more than 2,000 phones spreads over
  `ceil(n / 2,000)` buckets) and the shard sends one diff to each bucket, not each phone. Sockets should not stay on the
  board shards at that size: a shard holding a hot stop's sockets is also the one building 600 boards a tick.
* Count: 500,000 sockets at 2,000 a hub is about 250 hub objects at the peak, most of them small; about 128 when the
  limit is raised to 4,000 after a load test shows one hub sending to 4,000 within a second.
* Sockets are renewed every 10 minutes (built): 500,000 / 600 s is about 850 new sockets a second, each a request.
* Outgoing WebSocket messages are free; incoming pings handled by auto response are free; hibernation means a hub is
  billed only while it is sending. One diff per board change per socket: about 50,000 messages a second at the peak.

### 5. Our own trip planner (built today, OWN_PLANNER off)

* **What:** RAPTOR (Delling, Pajor, Werneck 2012) over the NSW GTFS timetable, in `backend/src/raptor.js`. Round k
  finds the earliest arrival at every stop with k services, so one search gives the fastest trip for each number of
  changes. Footpaths from GTFS stations (all platforms and stands of a station) and between stops up to 400 m apart;
  walks to and from a point (the phone's position) to stops up to 1 km away. Stops where nobody may board or get off
  are respected. The answer has exactly the leg shape of today's trip answers, so the app needs no change, and the legs
  go through the same live time step as Trip Planner legs (feed trip updates by trip id).
* **Data:** `tools/build_planner.py` turns the complete NSW GTFS bundle into one pack for a service day (plus the
  night before past midnight and the next morning): 167,294 stops (89,567 with services), 18,376 patterns, 73,738
  trips, 2,448,070 stop events, 566,728 footpaths, 45 MB (26 Oct pack, from the 23 Oct bundle).
  Since g22 the pack also has `tripLim` (one byte per trip, 1 when its pattern skips stations its line normally
  serves, `tools/limited_stops.py`) and `counts.limited`; the planner object answers `/limited` with those trip ids for
  the Limited stops tag (docs/API.md). `LIMITED_REPORT=<file>` writes per line counts while building.
* **Speed (measured 26 Oct on our build machine, Node 22):** 34 ms per search over the whole NSW network, 114 ms for a
  list of 5 trips (several searches). Opening the pack: 0.14 s.
* **Correct (measured 26 Oct):** on 400 random NSW station pairs at random times, RAPTOR's earliest arrival equals an
  independent Connection Scan search on the same timetable in 400 of 400. Unit tests check direct trips, changes,
  change time, walks, boarding rules, arrive by, stations and points, and RAPTOR against a brute force search on 300
  random networks.
* **Not yet checked: the match with NSW's own planner.** No recorded NSW trip answers exist in the repo, and no NSW
  calls are allowed before 1 AM. Plan: record 300 answers off peak after 1 AM (capped), compare first trip within 2
  minutes and same lines; gate 90% before the switch is turned on.
* **Capacity:** 3,333 searches a second at the peak, about 40% answered from the cache (same pair and minute), leaves
  2,000 a second. At 114 ms each that is 228 objects busy all the time: **about 380 replicas** at 60% use
  (`OWN_PLANNER_REPLICAS`). A range search (one rRAPTOR pass instead of several searches) and a slimmer pack are
  expected to make it about 3 times faster: **about 120 replicas**. Each replica holds the pack in memory (about 80 MB
  of the 128 MB an object may use), loaded once from its own storage.
* **Memory is the tight limit.** The 128 MB per object is why the pack keeps names and ids as single strings and the
  search reuses its buffers. Next: drop the 77,727 parent only stop records the search never visits, shorter trip ids.

### 6. Protection

* **Rate limits:** per IP (exists, in D1 for writes) and a global cap on searches per second per location (to add).
* **Circuit breaker on NSW:** exists for the Trip Planner (budget, refusal back off) and the engine feeds (30 s doubling
  to 10 minutes).
* **Stale while revalidate:** boards up to 60 s old are served while a new one is built; up to 10 minutes when NSW is
  failing, with the real age shown (liveAt, built today).
* **Timetable fallback:** exists (outage mode, 7f000674): timetable boards and trips, labelled.
* **No retry storms:** at most 1 retry, jittered (app side, 7f000674's fetch work). Push sockets reconnect with
  jittered back off, then fall back to polling once a minute (built, a81237c8).
* **Load shedding order** (first to go first): Ask and smart suggestions; then fresh trip searches (cached answers,
  then timetable); then push (polling once a minute); then board freshness (serve up to 60 s old). Never shed:
  disruption alerts.

### 7. Observability

* Per endpoint p50, p95 and error rate. Since today one JSON line per request goes to the Worker log (REQ_LOG, d01f9276).
  For dashboards and alerts at 1,000,000 that should become a 1% sample in Workers Analytics Engine (one data point per request at 1,000,000 people is 10.8 billion a month, about 2,700 US dollars;
  1% is plenty for percentiles).
* Alert thresholds: p95 over 1.5 s for 5 minutes; 5xx over 1%; any feed copy over 60 s old; NSW refusals over 5 a
  minute; planner p95 over 500 ms; board shard or hub restarts over 2 an hour.

### 8. Load test plan to 1,000,000

* A staging Worker with a **mock NSW upstream** (recorded feeds replayed), never the production key.
* Generators on Cloudflare Workers and Durable Objects in Australian locations (one machine cannot do it: the 26 Oct
  10,000 phone run was limited by the test machine's own connections).
* Steps: 10,000, then 100,000 real; 1,000,000 as "equivalent": every shard, hub and planner replica driven at its
  1,000,000 share (a hub at 10,000 sockets, a planner replica at its 1,000,000 search rate) and the edge numbers
  extrapolated, since a real million sockets needs about a million client connections.
* Recorded per step: p50 and p95 per endpoint, errors, NSW calls a minute (must stay flat), data age, object restarts.

## What breaks first, in order

1. **NSW quota** (today): trip searches. Fixed by our own planner (OWN_PLANNER on after the NSW match check).
2. **D1 writes**: every trip search writes a row to `searches`, and boards write kept copies. At 3,333 searches a
   second a single D1 database cannot keep up (one writer), and rows written would cost about 1,440 US dollars a month.
   Move per request logs to Analytics Engine (sampled) or batch them in an object **before 100,000 people**.
3. **One board shard object busy**: fixed by sharding (16 now, 64 at 1,000,000).
4. **Hot stop sockets on one object**: fixed by push hubs.
5. **Planner object memory** (128 MB): pack slimming before more data (realtime in the search).
6. **Deploys**: a deploy restarts objects and drops sockets. Restart endpoints exist; reconnects must be jittered
   (built in the app's push client).

## Cost a month (estimates, Workers Paid published prices)

Prices used: Workers 5 US dollars a month, 10 million requests and 30 million CPU ms included, then 0.30 a million
requests and 0.02 a million CPU ms; Durable Objects 1 million requests and 400,000 GB-s included, then 0.15 a million
requests and 12.50 a million GB-s (an object is billed 128 MB while awake, not while hibernating); WebSocket incoming
messages count 20 to 1, outgoing free; Analytics Engine 10 million data points included, then 0.25 a million.

| US dollars a month | 10,000 | 100,000 | 1,000,000 |
|---|---|---|---|
| Workers requests (target design) | 30 | 320 | 3,240 |
| Workers CPU (2 ms a request) | 4 | 45 | 430 |
| Board shards (16 / 32 / 64 awake 18 h a day) | 50 | 100 | 290 |
| Push hubs (16 / 32 / 128 to 250) and socket opens | 0 | 40 | 380 |
| Trip planner replicas (2 / 40 / 380) | 0 | 40 | 400 |
| Analytics Engine (1% sample) | 0 | 0 | 25 |
| Plan | 5 | 5 | 5 |
| **Total** | **about 90** | **about 550** | **about 4,770** |
| Today's design instead (polling, separate device fetches, NSW planner) | about 140 | about 950 | about 8,600, and NSW would refuse it |

The largest line is Worker requests. The levers, biggest first: push instead of polling (built, off), one fetch per
person across devices (build 209), the phone's own timetable for planned times (built by a507eb24), longer cache
lifetimes on things that change slowly (lines, trackwork).

## Build order and what is done

| # | Piece | State on 26 Oct, 3:40 PM | Owner | Estimate to done |
|---|---|---|---|---|
| 1 | Ingest once (engine core, feed budget, feed timing) | built, feed timing off until NSW periods are measured after 1 AM | a81237c8 | measuring: 1 hour after 1 AM |
| 2 | Board shards, edge cache, ETag | built, ENGINE_BOARDS off until the 95% match gate | a81237c8 | gate in progress |
| 3 | Own trip planner v1 (RAPTOR, timetable, live times on legs) | **built today, OWN_PLANNER off** | g18 | done |
| 3a | Daily planner pack in the timetable workflow | next | g18 | 1 hour |
| 3b | Match with NSW's planner (300 recorded answers, after 1 AM, capped) | next | g18 | 3 to 4 hours |
| 3c | Delays in the search (a late train can make a change impossible) | next | g18 | 1 day |
| 3d | Step free trips, via, leaving out a mode, walking paths | next | g18 | 1 to 2 days |
| 3e | One range search per list, slimmer pack | next | g18 | half a day |
| 4 | Trip answers cached per from, to and minute | partly (trip copies per pair) | 7f000674 | 2 hours |
| 5 | Push hubs by stop and bucket, engine boards through hubs too | per stop hubs built (LIVE_PUSH off) | a81237c8 / d01f9276 | 1 day |
| 6 | Per request logs to sampled Analytics Engine, D1 off the request path | logging in progress | d01f9276 | half a day |
| 7 | Global search cap, load shedding switch | next | open | half a day |
| 8 | Load test with a mock NSW, 10,000 then 100,000, 1,000,000 equivalent | plan here | open | 1 to 2 days |

## What needs build 209 (1 Nov)

Written into docs/IOS27.md "Build 209" too. All native, so not in an OTA:

* One fetch per person: the phone writes boards and trips to the App Group; widgets, the Watch (WatchConnectivity) and
  Live Activities read that copy instead of asking the server.
* Widget and Live Activity updates by push (APNs) instead of their own timeline fetches.
