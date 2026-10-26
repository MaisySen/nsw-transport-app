# Cloudflare costs: budget mode

Owner's rule, Mon 26 Oct 2026, 3:47 PM: "Can't pay 90. We stay at 5 right now. Max users we may get currently is 1k."
So the server runs on the Workers Paid base fee (US$5 a month) with no overage, for up to 1,000 people, aiming under
half of every included amount. The million user design in [SCALE_1M.md](SCALE_1M.md) stays a documented path only.

Read 26 Oct 2026, about 4 PM Sydney (g20). "Read" numbers come from Cloudflare's GraphQL analytics and the dashboard;
"estimate" numbers are worked out from published prices and are not bills.

## The account

* Workers Paid, US$5 a month, since 25 Oct 22:06 UTC (26 Oct 9:06 AM Sydney). Before that, the free plan.
* Usage cycle: 25 Oct 00:00 UTC to 25 Nov 00:00 UTC (dashboard, Billable usage: "Oct 25 to Nov 24"). `BILLING_DAY = 25`.
* One invoice: IN-85622635, 25 Oct, US$5.00, paid. Nothing else open. The Billable usage page shows total cost US$0.00
  and projected cycle cost US$0.00.
* Cloudflare's own spend alert: US$10 total, emails contact@fintex.au (made by Cloudflare with the plan).
* Zone transportsydney.app is on the free plan. "Images Stream Basic" is listed at US$0.

**Did today's load tests cost anything? No.** They ran after the move to Paid (01:00 to 03:00 UTC), and every meter is
far inside the included amounts (table below). The dashboard says "All usage is within included tier limits".

## Included amounts (Workers Paid)

Read on developers.cloudflare.com on 26 Oct 2026:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing).

| Meter | Included a month | Over that |
|---|---|---|
| Worker requests (cron runs count, static assets do not) | 10 million | US$0.30 a million |
| Worker CPU | 30 million ms | US$0.02 a million ms |
| Durable Object requests (HTTP, RPC, alarms, sockets opened; incoming socket messages 1 in 20) | 1 million | US$0.15 a million |
| Durable Object duration (128 MB x wall time while running or unable to hibernate) | 400,000 GB-s | US$12.50 a million GB-s |
| Durable Object SQLite rows read | 25 billion | US$0.001 a million |
| Durable Object SQLite rows written (each setAlarm is a row, deletes count) | 50 million | US$1.00 a million |
| Durable Object SQLite stored data | 5 GB-month | US$0.20 a GB-month |
| D1 rows read | 25 billion | US$0.001 a million |
| D1 rows written | 50 million | US$1.00 a million |
| D1 storage | 5 GB | US$0.75 a GB-month |
| Workers Logs events | 20 million | US$0.60 a million |

Billable usage is rounded up to the next billing unit (for example 1 million Durable Object requests). From 1 Dec 2026
Workers Logs moves to Cloudflare Observability pricing (50 GB ingestion and 10 GB-month storage a cycle included).

## This cycle so far (25 Oct 00:00 UTC to 26 Oct about 05:00 UTC, read)

| Meter | Used | Share of included | Of which load tests (01 to 03 UTC, 23 UTC) |
|---|---|---|---|
| Worker requests | 253,780 | 2.5% | 245,609 |
| Worker CPU | 910,480 ms | 3.0% | 733,212 ms |
| Durable Object requests | 119,614 | 12.0% | 115,716 |
| Durable Object duration | about 2,870 GB-s | 0.7% | about 2,590 |
| Durable Object rows written | 2,579,706 | 5.2% | none: two engine timetable loads (00:45 and 01:15 UTC), 1.29 million each |
| Durable Object stored data | 725.8 MB | 14.5% if kept all month | |
| D1 rows read | 15.0 million | 0.06% | 14.0 million |
| D1 rows written | 380,058 | 0.8% | 298,223 |
| D1 storage | 8.4 MB | 0.2% | |
| Workers Logs events | 258 (dashboard) | 0.001% | |

**Month end at today's rate, before the changes below (estimate):**
* With a test day like today every day: Durable Object requests about 3.7 million (370%, about US$0.45 over).
* With no tests: Durable Object rows written about 40 million (80%) from one engine timetable load a day, plus 1.3
  million for every extra load by hand (two today). Durable Object requests about 0.7 million (70%), almost all from
  engine wake ups while Transport for NSW refuses us (each refused board falls back to the engine's timetable board,
  which wakes the core object and up to 16 shards for 15 minutes). Everything else under 10%.

## What runs with nobody using the app

| Always on | Cost a month (estimate) | Now |
|---|---|---|
| Minute cron (watches, morning checks, alerts digest, sampling, clean up) | 43,200 Worker requests (0.4%); 45 to 70 ms CPU each, 2 to 3 million ms (7 to 10%); about 0.3 to 1.9 million D1 rows written (under 4%) | kept |
| Engine timetable load, daily workflow | 1.29 million Durable Object rows written a load: 40 million a cycle (80%) | every second day: about 20 million (40%) |
| Engine core and shard alarms | 0 when nobody reads a board; a woken core ticks every 10 s and each woken shard about 24 object requests a minute, for 15 minutes after the last read; 16 shards | 4 shards, stop after 5 minutes |
| Engine "learn" calls from Trip Planner boards (platform names, missing lines) | one object request per stop per Worker copy every 10 minutes, with the engine off: up to about 150,000 at 1,000 people (15%) | only while the engine serves boards (`ENGINE_LEARN`, off) |
| Live push hubs (LiveHub) | 0: alarms only while a phone's socket is open; `LIVE_PUSH` off | kept |
| Own trip planner (TripPlanner) | 0 requests and 0 duration when idle (no alarms, can hibernate); pack about 45 MB per copy of stored data (under 2%) | kept, `OWN_PLANNER` off |
| Load generator script (transport-loadgen) | 0: no cron, its object idle | load keys refused on production (`LOAD_TESTS` off) |
| Request log lines (`REQ_LOG`) and Workers Logs at 10% sampling | about 2 events per sampled request: 0.3 million at 1,000 people (1.5%) | kept |
| D1 `searches` rows (one per trip search, commute memory) | about 0.1 million at 1,000 people (0.2%) | kept: dropping them would break commute memory for no saving |

The "planner kept warm" worry: Cloudflare bills duration only while an object runs or cannot hibernate. The planner has
no alarms and no sockets, so while it sits in memory between searches it costs no duration. Its 80 MB in memory is
not billed separately (duration is always 128 MB).

## What changed (g20, 26 Oct)

* `ENGINE_SHARDS` 16 to 4 (a wrangler var; raise it again for more people). `ENGINE_IDLE_MIN` 5: an idle engine object
  stops its alarm after 5 minutes with no reads (15 before).
* `ENGINE_LEARN` off: Trip Planner boards no longer send platform names and line lists to the engine unless the engine
  serves that board.
* `LOAD_TESTS` off: the load test key is refused on production. Load tests run on `wrangler dev` with a fake
  Transport for NSW.
* Timetable workflow: builds 4 days (yesterday to 2 days ahead) and loads the engine only when it does not already hold
  today and tomorrow, so every second night. A failed load is tried again the next night while the old one still
  covers today. The planner pack is still loaded every night (a few dozen rows).
* Budget guard (below).

## Budget guard

Every hour (minute 17) the cron reads this cycle's usage with a read only Account Analytics token (Worker secret
`CF_ANALYTICS_TOKEN`) and works out the month end: used so far plus the last 48 hours' rate (counted over at least a
day) times the days left. 48 hours smooths the daily rhythm and the timetable load every second night; a load test
(about 100,000 object requests in two hours) still projects far past the line at once.
* Over 50% projected on any meter: one email a cycle to contact@fintex.au (Email Routing, `ALERT_EMAIL`).
* Over 80% projected, or 80% already used: the hold. `ENGINE_BOARDS`, `ENGINE_PUSH`, `LIVE_PUSH`, `OWN_PLANNER`,
  `ENGINE_LEARN` and `LOAD_TESTS` act as off whatever their vars say, and an email says why. The app keeps working on
  the Trip Planner path.
* The hold lifts by itself when the month end is back under 60% and nothing is used past 60%, at the next cycle, or
  with `POST /api/budget/clear` (admin key; holds off for 6 hours unless a meter is already at 95%).
* `GET /api/budget` (admin key) shows the last reading, the hold and each switch; `POST /api/budget/check` runs it now
  (`?dry=1` reads without changing anything or emailing).
* Log events are not in the analytics API: the guard estimates them as 2 per sampled invocation.
* First run in production, 26 Oct 05:17 UTC: it read every meter and held (Durable Object requests projected 1,363% at
  the 6 hour rate it used then, all from the morning's load tests). Nothing changed for phones: every held switch was
  already off. The email failed on a header bug (fixed, 48 hour rate since). The hold lifts by itself once the load
  test days pass out of the 48 hour window and the month end is under 60%, expected on 28 Oct.
* What it cannot stop: the timetable load itself (stopping it would leave the engine without today). Its rows are
  counted, and the email says so.

## At 1,000 people (estimate, engine off as now)

Assumed: 400 open the app on a day, 3 times for about 3 minutes, a refresh every 15 s; 300 widgets refreshing about 70
times a day. About 43,000 Worker requests a day.

| Meter | A cycle | Share |
|---|---|---|
| Worker requests | about 1.3 million | 13% |
| Worker CPU (3 ms a request, 55 ms a cron run) | about 7.6 million ms | 25% |
| Durable Object requests (outage fallbacks; own planner if on: 1 per search) | under 0.1 million | under 10% |
| Durable Object rows written (engine load every second day) | about 20 million | 40% |
| Durable Object stored data | about 0.8 to 1 GB-month | under 20% |
| D1 rows written (about 0.8 a request plus the cron) | about 2 million | 4% |
| D1 rows read | about 0.1 billion | 0.4% |
| Workers Logs events | about 0.3 million | 1.5% |

Every meter under 50%: US$5.00 a month.

**What still risks overage:**
* Turning the board engine on for phones (`ENGINE_BOARDS` on) at 1,000 people: about 13 million Durable Object
  requests a cycle with 16 shards, about 3.3 million with 4 (alarms and shard to core calls while boards are read, 19
  hours a day), about US$1.80 or US$0.45 over. The guard would hold it off at 80%. To fit, the engine needs 1 shard with 15 s ticks or a
  longer edge copy; that is a design change for the engine owner, not done here.
* Extra engine timetable loads by hand: 1.3 million rows each (2.6% of the month).
* A load test on production (about 70,000 object requests an hour).
* Live push (`LIVE_PUSH` or `ENGINE_PUSH` on): one object request per socket opened and 1 in 20 per incoming message,
  plus hub alarms every 15 s while a socket is open on a stop.
* Unverified: the guard's email (built and the binding present; no real email sent), and Workers Logs counts (the
  dashboard shows 258 events, far below the guard's estimate method).
