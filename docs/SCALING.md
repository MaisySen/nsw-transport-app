# Scaling: from a few phones to 10,000 and 100,000

Written 26 Oct 2026, 10:55 AM, after Bidur's 9:19 AM message: "Two three users and this loads slower. Imagine 10000. So plan properly." Every number here was measured today unless it says otherwise.

## Short version

* Our server is not the limit. At 1,000 simulated phones it answered 63 requests a second with p95 678 ms and used about 1 ms of CPU per request (p50).
* The limit is Transport for NSW. Our API key may make 5 calls a second and 60,000 a day, shared by everyone. A 1,000 phone surge onto an empty cache made 18 of 11,375 requests (0.16%) fail in the first 15 s, all because the hub refused us. After the surge: 0 errors.
* Today's design costs Transport for NSW calls per stop being watched. That cannot reach 10,000 phones on this key. Two things fix it: a bigger quota (only the key's owner can ask) and boards built from the network wide realtime feeds, which cost the same number of calls for 10 phones or 100,000.

## How a request is served today

The app talks to `api.transportsydney.app` (Cloudflare Worker `transport-api`). Since 9:58 AM phones read from it, with a read fallback to the first server.

1. **Shared copies, never per user.** Live answers (`/api/departures`, `trip`, `plan`, `service`, `status`, `alerts`, `stations`, `search`, `nearby`, `station`, `parking`, `topup`, `lifts`) are stored in Cloudflare's cache under the query without `profile`, `device`, `refresh` and `_` (`edgeKey`). Everyone at Central gets the same copy. A plain open takes a copy up to 15 s old, a refresh (the app's polls) up to 5 s old. Copies are kept 120 s, and the older ones are used only when the hub is busy, slow or refusing.
2. **One upstream answer per key at a time.** If 50 phones ask for the same stop while it is being fetched, they all wait for that one answer (`inFlight`, answer tagged `x-edge-cache: shared`). The stop board also has its own in memory copy (`depMem`) and the realtime feeds are fetched once per location every 15 s (`feedMem` and Cloudflare's fetch cache). The waiting requests do not await the first request's promise (Workers cancels or fails a request that does): the answer is kept as plain data and each waiting request checks it on its own timers, up to 25 s (`sharedJob`, `joinJob` in worker.js; before 26 Oct, g28, 9 of 10 identical first opens answered 500 on wrangler dev, docs/REVERSE_ENGINEERING.md).
3. **A copy instead of a long wait.** With a copy in hand, a phone waits at most 700 ms for a new answer (`COPY_WAIT_MS`). A slower Trip Planner answer finishes in the background and is stored for the next poll. The phone gets the copy, and `dataAt` says how old its times are, so the app's "Updated" line stays honest.
4. **A budget per server copy.** Each copy of the worker counts its Trip Planner calls over 10 s. At 3 a second or more (`UPSTREAM_PER_S`), or for a while after the hub refuses us, it is busy: a refresh is answered from a copy up to 60 s old instead of asking again. At most 4 calls start in any second in one copy (`upstreamSlot`).
5. **Refusals become waits or copies, not errors.** The hub answers 429 "Your API quota or rate limit has been exceeded" (its docs say 403; both count). The call is asked again up to 4 times over about 5 s while good answers came in the last minute. With a copy, the phone gets the copy. With no good answer for a minute it is taken as the day's quota: a minute's back off, no retries.
6. **Per address limits** (120 upstream reads and 60 writes a minute, counted in D1, plus per copy limits in memory) stop one script from spending the shared quota. Load tests use the `LOAD_TEST_KEY` Worker secret in `x-load-key`, which lifts only these limits and is counted like any other request. It is set only during a test and deleted after.

## Transport for NSW quota

* **Documented** (opendata.transport.nsw.gov.au, API basics, read 26 Oct 2026): the default Bronze plan allows 60,000 calls a day and 5 a second for the whole key. The docs say you can ask for more.
* **Our key:** I made a direct call with it and the hub sends no rate limit headers, so the plan cannot be read from responses. Our docs have always said Bronze and nothing says it was raised, so treat it as 5 a second and 60,000 a day. **Unverified:** the plan page in the bidurtab account was not checked.
* **Seen today:** a burst of 46 first opens at once got 27 answers of 429 with "Your API quota or rate limit has been exceeded", while the day's count was about 17,000. So the per second limit is real and applies to us.
* **Usage today:** 10,515 calls by 10 AM with two or three people plus background sampling (about 17 a minute). 17,430 by 10:48 AM, including about 6,000 from the load tests. 24 Oct: 28,976 calls in the day.

### Calls a minute at 10,000 phones with today's design

A phone with a board open refreshes every 15 s. A refresh takes a copy up to 5 s old, so a watched key costs about 4 calls a minute with one phone on it, and at most 12 with 3 or more (per Cloudflare location). Sydney phones mostly reach the Sydney location, sometimes Melbourne or Brisbane, each with its own cache.

| Phones with the app open at once | Keys being watched (stops, trips, services), estimated | Calls a minute needed for 5 s freshness | Key allows |
| --- | --- | --- | --- |
| 3 (today) | 3 | 12 to 36 | 300 a minute, 60,000 a day |
| 100 | about 60 | 300 to 700 | same |
| 1,000 | about 200 to 300 | 1,200 to 3,600 | same |
| 10,000 | about 3,000 | 12,000 to 36,000 | same |

The keys column is an estimate (many people share busy stations, buses spread out). The rest follows from the cache windows.

So 5 s freshness runs out at about 25 to 75 watched keys. Past that the budget rule keeps us under 5 a second by serving copies up to 60 s old, which holds to about 300 watched keys (roughly 1,000 phones). Past that copies get older than a minute and phones start to see errors. The day's 60,000 runs out after about 3 hours at 5 a second, so even 1,000 phones through a full morning peak would empty it.

## Load test, 26 Oct 2026

**Method.** `load.mjs` (in the task folder, not shipped) simulates phones as the app behaves: each phone has one screen open and refreshes it every 15 s (refresh=1): a stop board (70%), a trip list (20%) or a service stop list from a board (10%). Each poll has a 5% chance of a new screen and 2% of a search. Stops are Zipf weighted over 125 real stops (Central, Town Hall, Wynyard, Parramatta, Strathfield, then 120 more across Sydney, Wollongong, Gosford, Newcastle, Katoomba, plus bus and light rail stops). Trips cover 20 common pairs. The phones ran from a machine in the US west, so Cloudflare served them from Seattle. Every miss there also pays about 150 ms each way to Sydney (the hub and D1), so Sydney phones see less than this. Load requests count as busy from 1 call a second per copy (3 for phones) to leave the key's room to real users, so data ages under load are older than real phones would see. CPU is from Cloudflare's analytics for the run.

| Run (server version) | Phones, time | Requests | p50 | p95 | p99 | Errors | Data age p50 / p95 | Calls a minute (D1 count) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A (a4e14076, first version) | 100, 2 min | 768 (6 a second) | 38 ms | 1,447 ms | 5,850 ms | 1 (a service list timed out at 15 s) | 9 s / 48 s | 182 |
| B (e0412e56, 700 ms copy wait) | 100, 2 min | 769 (6 a second) | 44 ms | 783 ms | 1,450 ms | 0 | 8 s / 52 s | 173 |
| C (e0412e56) | 1,000, 3 min, 30 s ramp | 11,439 (64 a second) | 27 ms | 698 ms | 925 ms | 50 (502, first 11 s) | 11 s / 54 s | 533 |
| D (fa25bfbe, pacing, retry on 403) | 1,000, 3 min | 11,452 | 27 ms | 631 ms | 974 ms | 76 (502, first 9 s) | 22 s / 57 s | 381 |
| E (2592d738, retry on the hub's real 429) | 1,000, 3 min | 11,375 (63 a second) | 26 ms | 678 ms | 2,642 ms | 18 (502, first 15 s) | 15 s / 54 s | 487 |

Run E in parts: polls 9,641, p95 606 ms, p99 743 ms, 0 errors. Opens 1,734, p95 3.5 s, 18 errors (first opens of a stop nobody had looked at in 2 minutes, during the surge). After the 30 s ramp: 9,918 requests, p95 615 ms, p99 786 ms, 0 errors. Server CPU per request in run E: p50 0.9 ms, p90 4.4 ms, p99 32 ms (11,347 requests, 2,414 subrequests). Calls a minute include real phones, the minute tick and retries. About 17 a minute is the normal baseline.

What changed between runs: the first errors (C, D) were the hub's 429, which our code did not yet recognise (the docs said 403), so nothing was retried. Since E it is retried for about 5 s. A cold surge from many server copies at once still asks faster than 5 a second, and some first opens ran out of retries.

**Gate** (switch phones only if 1,000 phones get p95 under 1 s with no errors): p95 passed in every 1,000 phone run. "No errors" did not: 18 of 11,375 (0.16%), all from the hub's limit in the first 15 s of a surge onto an empty cache. The switch (update group e86d515f, 9:58 AM) was already in production before the test. It was published by the earlier worker. It stayed, because the old server uses the same key with no shared copies, so it would hit the same wall sooner and is slower for today's phones.

## Next steps for 10,000 phones

In order:

1. **Ask Transport for NSW for a bigger quota** (owner action, from the bidurtab Open Data account; free, and their docs invite it). Today's design at 10,000 phones (about 3,000 keys, copies up to 15 s, 4 calls a minute each) needs about 200 calls a second and about 3 million a day over a 4 hour peak. That is unlikely to be granted, so ask for an interim 20 a second and 500,000 a day, which covers about 1,000 to 2,000 phones at 15 s freshness while step 2 is built.
2. **Boards from the network feeds, not one Trip Planner call per stop.** Keep the GTFS timetable (the static bundle, once a day) in R2, one small file per stop per day. Read live times from the GTFS realtime trip update feeds we already fetch every 15 s, about 10 feeds. Upstream then costs about 40 calls a minute (57,600 a day at 15 s, 28,800 at 30 s) whatever the number of phones. The Trip Planner stays for trip lists and stop lists, with copies per pair kept 30 to 60 s.
3. **One copy for all of Australia.** The cache is per Cloudflare location today. Put hot keys behind one Durable Object per key, or turn on tiered caching, so Sydney, Melbourne and Brisbane locations share a copy.
4. **Per address limits without a D1 write per miss.** Move them to the Workers Rate Limiting binding (Workers Paid is on since 9:12 AM), so D1 only holds real data.
5. **Alarms.** A daily count alarm at 40,000 and 50,000 calls, and the per copy budget (`upstream` in `/api/health`) watched in the peak.
6. **Measure from Sydney.** Repeat this test from an Australian machine so the numbers include no trans Pacific trip.

## Next steps for 100,000 phones

* Step 2 is required: no quota covers 100,000 phones asking per stop.
* **Precomputed boards.** One worker (a cron or Durable Object alarm) decodes the feeds every 15 s and writes a board snapshot per active stop to the cache or KV. Phone requests become pure reads of about 1 ms CPU and never touch the hub.
* **Fewer polls.** Polls at 15 s only while a service is due within 10 minutes (already so), 60 s otherwise. Use push for watched trips and the iPhone trip card (already pushed by the server) instead of polling.
* **Cost** (Workers Paid, 10 million requests a month included, then 0.30 US dollars a million). At 15 minutes of use a day per person and a request every 15 s: 10,000 people make about 18 million requests a month (about 2.40 US dollars over the included amount). 100,000 make about 180 million (about 51 US dollars). These are estimates from the polling rate, not bills.
* **D1** holds saved trips, push tokens and observations. At 100,000 people, writes per request (commute memory, observations) need batching or sampling.


## Board engine on Cloudflare: design, limits and cost (26 Oct, g11)

Owner's steer (12:11 PM): decide the Cloudflare design from Cloudflare's own documentation and from measuring on our
account, and write it here. Limits below are Cloudflare's published Workers Paid limits as I read them on 26 Oct; the
measured lines say what our account showed.

**Chosen:** one Durable Object (`BoardEngine`, SQLite storage, near Sydney) holds the timetable and the live feed
copies, and an alarm rebuilds every board read in the last 5 minutes every 10 s. The Worker answers `/api/departures`
from the object, with a 4 s Cloudflare cache copy per location and a 2 s copy per Worker instance in front of it.
Details in ENGINE.md.

| Option | What the docs say | Verdict |
|---|---|---|
| Cron Triggers | Shortest schedule is once a minute. | Too slow for 10 s. Kept as the existing per minute job. |
| Durable Object alarm | One alarm per object, can be set to any time, retried on failure. | **Used.** A 10 s beat, and one object means one copy of each feed for all of Australia, so NSW calls do not grow with phones. |
| Queues | A delivery pipe with batching, not a timer. | Not needed: nothing to fan out. |
| KV for boards | At most 1 write a second per key; reads can be up to about 60 s stale at other locations; writes billed per million. | **No.** 30,000 boards every 10 s is 3,000 writes a second (about 260 million a day, roughly 1,300 US dollars a day at 5 dollars a million), and 60 s stale reads would undo the 10 s refresh. |
| Cache API | Per location, not shared; no write cost. | **Used** as the 4 s copy in front of the object. |
| D1 for the timetable | A separate service: every query is a network hop; 10 GB per database. | **No.** A tick reads thousands of rows; inside the object SQLite is in process with no hop. |
| R2 for the timetable | Object storage; needs R2 switched on (a card on the account). | **Not needed.** The timetable (383,369 stop day rows for 5 days, 165,825 stops) fits the object's SQLite. R2 stays optional. |
| Durable Object limits | 128 MB memory per object; 30 s CPU per request or alarm by default; SQLite storage up to 10 GB per object. | Memory is the one that bit: see below. |

**Measured on our account (26 Oct):**
* Timetable load into the object: 119 to 122 s for 5 days.
* Alarm tick: 0.35 to 2.3 s for up to 990 hot boards (0.9 s typical).
* NSW calls: capped at 24 a minute by the engine's own bucket (34,560 a day if never idle), measured 10 to 24 a minute during the 1,000 and 10,000 phone tests. The Trip Planner path made 381 to 533 a minute at 1,000 phones (g9 test).
* The object restarted twice under load (at about 500 hot boards in the 1,000 phone test and about 990 in the 10,000 phone test). No deploy happened at those moments, so the likely cause is the 128 MB memory limit. Caches were cut (200 whole stop days, 2,000 stop windows, 1,500 hot boards; transport-api fefbc66f), and the object still restarted once in the follow up 1,000 phone test (at about 985 hot boards). So the cause is not settled: memory or CPU in one object. Phones did not see errors from it, only older times for up to a minute. Next step before switching on: split the work over several objects (one per group of feeds) so no single object holds every hot board.
* A restart cost the feed budget: every waiting first read was charged a call, so the bucket went 90 calls into debt and boards went stale for minutes (data age p50 151 s in the first 10,000 phone run). Fixed in 9e9220dc: only fetches actually started are charged, and the bucket floor is 10 s of calls.

**Cost math (Workers Paid; estimates from the published rates, not bills):**
* Object duration: one object awake around the clock is 128 MB x 86,400 s = about 11,000 GB-s a day, about 330,000 a month, inside the 400,000 GB-s included.
* Requests to the object: at most one per board per location per 4 s, and never more than the phones' own requests. 10,000 phones polling every 15 s for a 1 hour peak is about 2.4 million requests, about 0.36 US dollars at 0.15 a million beyond the included million.
* SQLite rows: a board's window is read once per 5 minutes per stop, then kept in memory; rows read are in the millions a day, cents at 0.001 US dollars a million.
* NSW: flat at 24 calls a minute or less, so the 60,000 a day default quota is never the limit for boards.

**Nothing to switch on in the dashboard.** Durable Objects with SQLite are on, Smart Placement is in the code. R2 is not needed for the engine.

**Load tests against the engine (26 Oct, `engine=1`, simulated phones from this US west coast machine; each phone opens
a board and refreshes it every 15 s, with a 5% chance of another stop per refresh, Zipf over 1,000 NSW stops):**

| Run | Requests | p50 | p95 | p99 | Errors | NSW calls a minute | Data age p50 / p95 |
|---|---|---|---|---|---|---|---|
| 1,000 phones, 3 min, 30 s ramp (transport-api 49480881) | 10,539 (62 a second) | 378 ms | 667 ms | 1.10 s | 0 | 24 (the cap) | 7 s / 24 s |
| 1,000 phones, 3 min, after the fixes (fefbc66f) | 8,960 (62 a second) | 236 ms | 586 ms | 1.03 s | 0 | 24 or less | 6 s / 16 s |
| 10,000 phones, 3 min, 60 s ramp (9e9220dc) | 95,130 (about 500 a second) | 886 ms | 5.1 s | 6.7 s | 20,751 on the test machine (20,618 connection resets, 133 time outs) | 10 | 8 s / 19 s |

* The engine answered 100% of the 1,000 phone requests (none fell back to the Trip Planner).
* The 10,000 phone run is limited by the test machine, so it does not prove the server either way: 10,000 open
  connections from one address were reset before reaching our Worker (the Worker's own log showed no errors, only a
  few requests the client gave up on), and the machine's own name lookups failed during the run. The server side
  numbers from that run (NSW calls 10 a minute, data 8 s old at the median) are real; its latency and error numbers
  are the test machine's. A clean 10,000 phone number needs several source machines, ideally in Australia.
* NSW calls stayed flat: 24 a minute or less in every run, against 381 to 533 a minute for 1,000 phones on the Trip
  Planner path.
* CPU per request was not read from Cloudflare's analytics for these runs.
* All from the US: every request crossed the Pacific to the object near Sydney (about 150 ms each way). Sydney phones skip that.

## Board engine part 2: builders apart from servers (26 Oct, g14)

Root's steer (26 Oct, 12:48 PM): use Cloudflare's own design for this kind of service where it fits. Builders write
boards to the Cache API, the Worker reads the cache first and calls an object only on a miss, 10 to 20 builder
shards with a router, batches of about 100 cache writes per alarm (the limit is 1,000 per invocation), R2 only for
static slices if needed, at most 6 outgoing connections per invocation, ETag and 304 on boards, Smart Placement.
Not done on purpose: D1 read replication, a live board TTL over 15 s, phones polling every 30 s.

**Chosen (transport-api 8dc80fab onward, code in backend/src/engine.js):**

```
phone -> Worker (/api/departures)
           1. a copy in this Worker instance, up to 2 s old
           2. caches.default (this location), up to 15 s old      <- builders write here
           3. the board's shard object (miss only)
                 |
   16 builder shards (BoardShard, "nsw-2-b0".."b15", stop id hash, near Sydney)
       5 s alarm: rebuild a board when its live data changed, at least every 15 s;
       write up to 400 boards a tick to caches.default in batches of 50
                 |  timetable windows (/window), live data trimmed to their trips (/live), names learnt (/learn)
   1 core object (BoardEngine, "nsw-2"): the timetable (SQLite) and one copy of each NSW feed,
       feed calls capped by a token bucket (45 a minute, 40,000 a day budget), 5 connections at most
```

* **Router:** `engShardOf(stop)` is an FNV hash of the stop id over `ENGINE_SHARDS` (16). A stop's board always comes
  from the same shard, so one shard holds a board's timetable window and live trips, and no object holds every
  board (the single object of part 1 restarted once in every load test).
* **Builder and server apart:** a shard writes each board it rebuilds to `caches.default` under
  `https://engine-cache.transportsydney.app/board?stop=&mode=` with a 15 s lifetime. The Worker reads that first; a
  shard is called only on a miss, and a Worker that answers from the cache tells the shard once a minute that the
  board is still being read (`/touch`), so it keeps building it. A shard stops after 15 minutes with no reads.
* **Batches:** at most 400 cache writes a tick in batches of 50 (Cloudflare allows 1,000 subrequests per
  invocation).
* **Connections:** the core opens at most 5 connections to Transport for NSW at a time (Workers allow 6 per
  invocation).
* **ETag:** an engine board carries `W/"e<builtAt>-<length>"`; a phone sending it in If-None-Match gets 304 with no
  body.
* **Smart Placement:** already in `wrangler.toml.template` (`[placement] mode = "smart"`).
* **R2:** not needed. Timetable windows come from the core's SQLite (a window is read once per 20 minutes per
  stop); nothing to switch on in the dashboard.
* **Fresh code after a deploy:** a busy object keeps the code it started with across a deploy (seen 26 Oct: a shard
  kept its 2:06 PM code after the 2:20 PM deploy). After each deploy: `POST /api/engine/load/restart` (core) and
  `POST /api/engine/load/restart-shards`, both with the engine load key. `/api/engine/status` shows every shard's
  start time and code generation.

**Feed calls (the scarce thing).** Each feed copy now aims for an age: the busiest feeds 10 s, other Sydney feeds 20 s,
regional bus feeds 45 s, the most overdue first. Part 1 ranked feeds by use, and with 1,000 stops NSW wide watched
the four busiest took every call while light rail and ferry copies went 3 minutes old. A board whose feed copy is over
60 s old goes to the Trip Planner; if the planner refuses, fails or is busy, the engine's board is served as it is
(up to 10 minutes old, with its real `dataAt`). After a refused feed call the core makes no feed calls for 30 s,
doubling to 10 minutes while refusals go on.

**What went wrong on 26 Oct, 1:24 PM:** the NSW key ran out of its daily quota (60,000; D1 counted 51,444 Trip Planner
calls that day plus about 3,000 engine calls). During my 1,000 phone soak test the engine's light rail and regional
feed copies went over 60 s old (the feed scheduling above was not yet deployed), every stale board fell back to the
Trip Planner at once, and the planner calls of the day ran out. Since then: the stale rule only uses the planner when
it answers, feed copies are scheduled by age, the core backs off on refusals, and when the planner fails with no copy
kept, phones get the engine's timetable board labelled "Live times unavailable, showing timetable times" (outage
fallback, root's decision 1:58 PM; not the switch on).

**Cost of 16 shards (Workers Paid published rates, estimates, not bills):** an object awake is billed 128 MB for its
wall time. A shard is awake while its boards are read; 17 objects awake 18 hours a day is about 150,000 GB-s a day,
4.5 million a month, about 51 US dollars a month over the 400,000 included (12.50 dollars a million). Alarms and calls
between objects add about 8 million requests a month, about 1 dollar. `ENGINE_SHARDS` (a wrangler var) sets the count:
10 shards cuts the duration cost by about a third.
