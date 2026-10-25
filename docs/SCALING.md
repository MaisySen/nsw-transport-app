# Scaling: from a few phones to 10,000 and 100,000

Written 26 Oct 2026, 10:55 AM, after Bidur's 9:19 AM message: "Two three users and this loads slower. Imagine 10000. So plan properly." Every number here was measured today unless it says otherwise.

## Short version

* Our server is not the limit. At 1,000 simulated phones it answered 63 requests a second with p95 678 ms and used about 1 ms of CPU per request (p50).
* The limit is Transport for NSW. Our API key may make 5 calls a second and 60,000 a day, shared by everyone. A 1,000 phone surge onto an empty cache made 18 of 11,375 requests (0.16%) fail in the first 15 s, all because the hub refused us. After the surge: 0 errors.
* Today's design costs Transport for NSW calls per stop being watched. That cannot reach 10,000 phones on this key. Two things fix it: a bigger quota (only the key's owner can ask) and boards built from the network wide realtime feeds, which cost the same number of calls for 10 phones or 100,000.

## How a request is served today

The app talks to `api.transportsydney.app` (Cloudflare Worker `transport-api`). Since 9:58 AM phones read from it, with a read fallback to the first server.

1. **Shared copies, never per user.** Live answers (`/api/departures`, `trip`, `plan`, `service`, `status`, `alerts`, `stations`, `search`, `nearby`, `station`, `parking`, `topup`, `lifts`) are stored in Cloudflare's cache under the query without `profile`, `device`, `refresh` and `_` (`edgeKey`). Everyone at Central gets the same copy. A plain open takes a copy up to 15 s old, a refresh (the app's polls) up to 5 s old. Copies are kept 120 s, and the older ones are used only when the hub is busy, slow or refusing.
2. **One upstream answer per key at a time.** If 50 phones ask for the same stop while it is being fetched, they all wait for that one answer (`inFlight`, answer tagged `x-edge-cache: shared`). The stop board also has its own in memory copy (`depMem`) and the realtime feeds are fetched once per location every 15 s (`feedMem` and Cloudflare's fetch cache).
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
