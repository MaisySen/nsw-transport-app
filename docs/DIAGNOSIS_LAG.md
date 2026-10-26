# Lag, slow Watch and failed loads: diagnosis and fix plan

Written 26 Oct 2026, 3:15 PM, for Bidur's 2:52 PM message: "Our own app lags, connected apple watches slow and loads. Sometime it just fail to load." Diagnosis only: nothing below has shipped. Each fix says whether it is server only, an over the air update (OTA), or needs build 209 (native, 1 Nov).

## Data and its limits

* Cloudflare GraphQL analytics for the Worker `transport-api` (invocations: wall time, request duration, status, colo; subrequests: host, status, time to response). Retained from 24 Oct, 1 AM Sydney only, so "7 days" is 2.6 days.
* No per endpoint numbers exist. The API token has no zone analytics permission and no Workers Logs read, and the Worker logs nothing per request. Endpoint level findings below come from the code plus a live tail (3:05 to 3:35 PM, outage, only test traffic seen).
* The Worker's analytics status "success" means no exception, not HTTP 200. A 502 counts as success, so a server error rate cannot be read from analytics.
* Phones moved to this server with the 9:58 AM OTA today (`api_base` switch). Before that, phones read `nsw-transport-bot.sites.tab.bot`, which is not in this account's analytics. So the only window of real phone traffic on this server is Mon 26 Oct, 10 AM to 12 PM.
* Our own tests are most of the traffic: 205,475 Worker requests on 26 Oct (UTC day) against about 1,000 a day from Australian colos before the tests. Real users are picked out below as requests through the SYD, MEL and BNE colos outside the load test windows (12:00 to 13:27 today, and the box's US address).
* Outage from about 1:25 PM (NSW daily quota used up, see SCALING.md) is reported on its own and kept out of the "normal" numbers.

## 1. Server numbers

### Whole request time (Worker wall time, Australian colos, ms)

| Window | Requests | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| Sat 1 AM to Sun 11 PM (weekend, mostly not phones) | 615 | 25 | 66 | 1,011 | 1,606 | 3,361 |
| Mon 6 AM to 11 AM (morning peak) | 186 | 117 | 2,854 | 7,421 | 8,067 | 13,166 |
| Mon 10 AM to 12 PM (phones on this server) | 129 | 82 | 408 | 6,110 | 7,764 | 12,037 |
| Mon 1:25 PM on (outage, mostly the soak test) | 26,582 | 40 | 67 | 893 | 2,095 | 13,094 |

* About 1 phone request in 8 took more than 5 s on Monday morning, and 1 in 100 took 12 s.
* The p99 of 12,037 ms is exactly the server's Trip Planner timeout (`tp()`, 12 s). Those requests waited the full 12 s for NSW and then failed or fell back.
* Request bodies: p50 0.5 KB, p95 66 KB (trip answers); a saved stop board is 24 KB of JSON (40 services, median of 60 boards in D1), about 3 KB gzipped.

### NSW upstream (subrequests to api.transport.nsw.gov.au)

| Window | OK calls | Refused (429) | Refused share | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|---|
| Weekend | 13,290 | 191 | 1.4% | 872 ms | 1,737 ms | 1,887 ms | 2,490 ms |
| Mon 6 AM to 11 AM | 18,422 | 1,257 | 6.4% | 228 ms | 1,000 ms | 1,427 ms | 4,805 ms |
| Mon 10 AM to 12 PM | 11,503 | 1,074 | 8.5% | 220 ms | 844 ms | 1,251 ms | 4,148 ms |
| Mon 1 PM hour | 3,226 | 31,001 | 91% | | | | |

* NSW calls per hour, Monday: 1,392 (7 AM), 2,693 (8 AM), 3,272 (9 AM), 10,133 (10 AM), 5,774 (12 PM). The baseline with no users is 400 to 500 an hour (minute tick, board warming, engine feeds). At 10 AM only 124 phone requests came in, so about 9,000 of those 10,133 calls were our own load and match tests (LOAD_TEST_KEY was live 10:11 to 10:48 AM, RELEASES.md).
* D1 `usage`: 51,460 Trip Planner calls on 26 Oct by 3 PM, 11,962 on 25 Oct, 28,976 on 24 Oct.

### Top causes of slow (over 1 s) and failed requests

1. **Waiting on the Trip Planner.** Any request with no copy to hand waits for NSW: 0.9 s median on the weekend, 1.9 s p95, and up to the 12 s timeout. Trip searches (`/api/trip`) always wait; boards wait on a first open with no copy and on a refresh whose copy is over 120 s old.
2. **Our tests starving the shared key.** The per second limit (5 a second for the whole key) refused 8.5% of NSW calls in the only real phone window. Each refusal is retried inside `tp()` (up to 4 more tries over about 5 s), and the service view's `plannerLeg` retries each ask up to 4 times on top (up to 16 NSW attempts for one ask). That is the 6 to 12 s tail above. Then the soak test used up the daily quota at 1:25 PM.
3. **Retry chains, not single slow calls.** NSW p99 per call is 2.5 to 4.8 s, but request p99 is 12 s: the extra comes from retries and serial calls in one request (169 subrequests for 26 requests at 7 AM Monday, 6.5 per request).
4. **No fallback for trip answers.** During the outage `/api/trip` returns 502 (tail 3:05 PM: 487 to 1,306 ms then 502). Boards have the labelled timetable fallback; trips have nothing.

### Plan limits (needs a check in the dashboard)

The docs say the account is on the free Workers plan. If so, today's tests went past every daily free allowance: Worker requests 205,475 (free: 100,000 a day), D1 rows read 13.4 million (free: 5 million), D1 rows written 221,446 (free: 100,000; 25 Oct was 158,095 too). Cloudflare's documented behaviour on Free is errors (Worker error 1027, D1 errors) until 00:00 UTC, which is 11 AM Sydney. The server was still answering at 3:05 PM, so either the account is on Workers Paid or the limit is not enforced yet. Real phones alone use about 1% of these allowances; only our tests reach them. If the account is Free, a test day can make every phone fail to load until 11 AM the next day.

### Outage (1:25 PM on), separate

* 31,001 refused NSW calls in the 1 PM hour, 48 since (the engine backs off now).
* 1,447 requests ended with the client hanging up at 15 s (the soak test's own timeout), 15 Worker exceptions (37 to 88 ms, all in the soak).
* `/api/departures` serves the labelled timetable board when no copy exists (transport-api e940f714). `/api/trip`, `/api/morning-check/preview` and `/api/nearby` (owner's screenshot, "Something went wrong (502)") still return 502.

## 2. App first load paths

What every screen waits for, and what it does on a timeout. Reads go through `api.ts` `req()`: one 20 s timeout, one quiet retry for a dropped connection (not after a timeout), then the same read is asked of the old server (`nsw-transport-bot.sites.tab.bot`) with a 12 s timeout on any timeout, no answer or 5xx (`server.ts fallbackWorthy`), and after that fallback works, all reads go to the old server for 60 s.

| Screen | Shows first | Waits for | Worst wait before an error | On failure |
|---|---|---|---|---|
| Home stop cards | kept copy (10 min) or timetable pack, first frame | `/api/departures` per starred stop, in parallel | 32 s (20 + 12 old server) | kept copy or pack stays, marked offline, only on a network error |
| Home commute card | kept copy | `/api/trip` | 32 s, then the long trip path, up to 89 s | "Live times unavailable, trying again"; "No more services today" when the answer is empty (g16 is fixing the outage case) |
| Stop screen | kept copy or pack, first frame | `/api/departures`, `/api/station` | 32 s | same as Home cards; an HTTP error with nothing kept shows the error |
| Trip list (`trip.tsx`) | spinner, "still searching" at 6 s | `/api/trip` | 20 s + 12 s, then `tripLong` 45 s + 12 s: 89 s | error; a 502 is read as "planner too slow" (`plannerTooSlow`) and asked again the long way, so a refused key costs 4 server requests |
| Service view | spinner | `/api/service` (server `plannerLeg`, up to 3 asks x 4 tries, 8 s each) | 32 s app side | error |
| Search, Plan, New trip lists | lists on the phone | `/api/stations` (25 s) for bus routes | 37 s | "Could not load the list. Check your connection." |
| Nearby | spinner | `/api/nearby` | 32 s | "Something went wrong (502)" (owner's screenshot) |
| Ask | spinner | `/api/trip` and Ask | 32 s or more | "No connection right now. Check your signal" for any non HTTP failure, including a slow server (g16 is fixing) |
| Shared trip | spinner | share fetch | 32 s | "Check your connection and try again." |
| Morning check | spinner | `/api/morning-check/preview` | 32 s | error (502 in the outage) |

### Can fail to load (each one is a path seen in the code)

1. Any read with nothing kept or packed and NSW slow: up to 32 s of spinner, then "No answer from the server. Check your connection." (`api.ts` line 98). The message blames the phone's signal when the phone was fine and the server was waiting on NSW.
2. `useLive` (`hooks.ts`) falls back to the kept copy or pack only when the error is a network error (`e.offline`). A server 5xx, 429 or 502 with nothing yet on screen shows the error text instead of the copy the phone holds.
3. Trip searches during an NSW refusal: 502 counts as "too slow", so the app asks again with a 45 s timeout, and each of those also tries the old server. Up to 89 s, 4 requests, then an error.
4. The old server fallback: it uses the Open Data key the old host was set up with (not checked from here; if it is the same key, every failed read is a second refused call). After one fallback works, every read for 60 s goes to the old server, which has no saved boards, no timetable fallback and no engine.
5. Stop board widget (native): a failed fetch replaces the last rows with an empty widget, "Live times will be back shortly." (`TransportWidgets.swift`). The trip widget keeps its last times; the stop board widget keeps nothing.
6. Watch: any request over 8 s marks the whole screen "Offline" and keeps the old times, even when the phone and watch are connected and the server was only slow.

### Not the cause, already measured (PERFORMANCE.md, g13)

Startup requests already go out together (7 at about 930 ms on web); Home's first frame has its kept copies; lists keep their rows between refreshes. All of that was measured on the web export with the CPU slowed 4x. Nothing has been measured on a real phone.

### On the phone itself

* **52 production OTAs in 2 days** (42 on 25 Oct, 10 on 26 Oct, RELEASES.md). expo-updates checks on every cold start and every return to the front (15 min gap, `platform/updates.ts`) and downloads the new bundle (6.2 MB Hermes bytecode before compression, PERFORMANCE.md) right away, on the same connection as the first live requests. The new bundle then runs on the next cold start with nothing in the disk cache, which is the slowest start a phone has. "Close and reopen twice" every hour is felt as lag.
* Startup reads storage for up to 400 ms before the first frame (g13, `boot.ts`), on purpose, so the kept copies are on it.
* No JS thread profile on a device exists. Unknown, not assumed.

## 3. Apple Watch and widgets

### Watch (`targets/watch`, builds 206 to 208)

* **Data path:** the phone sends only context (server address, Home, Work, starred stops, trip card) through WatchConnectivity (`sendWatchContext`). The watch then loads all times itself over its own network: `/api/trip` for the commute, then `/api/departures` for each starred stop (up to 8). With the phone nearby that traffic is relayed over Bluetooth through the phone; away from it, LTE or Wi-Fi. Times are not shared from the phone even though the phone already holds them.
* **Serial:** the commute trip is awaited first; the starred stops start only after it (`refresh()` in `TransportWatchApp.swift`). Nothing on screen changes until every request has finished, because the snapshot is applied once at the end.
* **Timeouts:** 8 s per request (`WatchCore.swift`), no retry. Worst case 16 s before anything updates. With the server's Monday p90 of 6.1 s and p95 of 7.8 s, plus the relay through the phone (estimated 1 to 3 s in WIDGET_WATCH_SPEED.md, not measured), a peak time open often hits 8 s and shows "Offline".
* **No shared copy on the server for the watch's trip:** the watch asks `/api/trip?from&to&count=7` with no profile, so it never gets the server's cached usual trip path (that needs a profile) and its edge key differs from the phone's commute card (names, fare, count), so it cannot reuse the answer the phone got seconds earlier. Every watch open is a fresh Trip Planner call.
* **Whole boards for 3 rows:** each starred stop downloads the full board (about 40 services, 24 KB JSON, 3 KB gzipped) to show 3.
* **Complications never load:** they show what the watch app last loaded. When the app has not been opened for a while they show old times or "Open Transport for times". That is felt as "the Watch is slow".
* **Cold start:** WCSession activates, asks the phone for context, then loads. With context already stored it loads at once.

### Widgets (`targets/widget`)

* Each timeline reload asks the server itself (`APIClient.swift`, 12 s timeout, one retry on timeout: up to 24 s). The first paint after a reload waits for the network; iOS decides when reloads happen.
* Built in address in builds up to 208 is the old server (`APIBase.builtIn`); a widget follows the new one only after the app has written `apiBase.v1` to the App Group.
* Stop board widget keeps nothing on failure (see "Can fail to load", 5).

## 4. How fast transit apps work, and the gap

| | Fast apps | This app today |
|---|---|---|
| Timetable | on the phone, always shows times | on the phone for 24 stops since 12:54 PM today (packs) |
| Live data | live delays laid over the phone's timetable | boards from the Trip Planner per stop; the engine (feeds, delays) is built but off for phones |
| Screen waits on network | never; a slow or failed network keeps the timetable | Home and stop screens no; trip list, service view, Nearby, Ask, morning check yes |
| Watch | reads the phone's or an app group copy first, network second | network first, serial, 8 s timeouts |
| Widgets | app group copy, timetable entries ahead | network per reload |
| Server | network feeds pulled centrally, phones never cause upstream calls | every cache miss and every trip search is a Trip Planner call |
| Releases | a few a month | 52 OTAs in 2 days |

## 5. Ranked fix list

| # | Cause | Evidence | Fix | Where | Expected gain | Effort |
|---|---|---|---|---|---|---|
| 1 | Our tests share the production key and server | 8.5% of NSW calls refused in the only real phone window; 9,000 of 10,133 NSW calls at 10 AM were tests; quota gone at 1:25 PM; 205,475 requests in a day | Tests never touch the production NSW key: a second free Open Data key for tests (its own 60k a day), the load key forced onto the engine (done in 3c3bdcc), and no load or match test against production during 6 to 10 AM or 4 to 7 PM | server config and process | removes the retry tail: Monday p95 7.8 s toward the 1.9 s NSW p95; no more quota outages from us | small |
| 2 | Screens wait for the Trip Planner | p99 = 12.0 s = the `tp()` timeout; NSW p50 0.2 to 0.9 s, p95 1.3 to 1.9 s per call | Switch ENGINE_BOARDS on once its gates pass (g14): boards built from the feeds every 10 s, no NSW call per board | server | `/api/departures` p95 from 7.8 s to under 0.3 s; board load independent of NSW speed and quota | in progress (g14) |
| 3 | Trip searches always wait and have no fallback | 89 s worst chain; 502 read as slow; 502 in the outage | Server: keep each trip answer per from and to pair (like `board_copies`) and serve it at once with its age, refreshing behind it; on a refusal, a timetable trip from the engine, labelled. App (OTA): one 10 s deadline, a 502 or 429 is not "too slow", no old server fallback for trips | server, then OTA | commute and saved trips instant after the first search; worst wait 89 s to 10 s; an outage shows timetable trips instead of an error | medium |
| 4 | Watch loads serially and over the relay, with no shared trip copy | serial trip then stops; 8 s timeout; Monday p95 7.8 s; fresh planner call per open | Server: the watch's `/api/trip` and `/api/departures` served from the newest copy at once (trip copies from item 3; watch requests named by their User-Agent, to be confirmed in a tail while a watch opens), and the trip edge key made the same for the phone and the watch (from, to, time; names and count left out). Build 209: phone sends its boards and commute to the watch (WIDGET_WATCH_SPEED.md step 3), watch loads trip and stops in parallel, applies each as it lands, asks for 3 rows | server now, then build 209 | server part: a watch open from about 1 to 9 s down to the relay time (estimated 1 to 3 s); 209: times on the wrist at once, no network | small (server), medium (209) |
| 5 | Old server fallback | every timeout or 5xx is asked again of the old host (12 s more); 60 s hold sends all reads there | OTA: fall back only when the new host cannot be reached at all (DNS, TLS, no route), never after a timeout or 5xx; drop the 60 s hold | OTA | worst read wait 32 s to 20 s (and to 8 to 10 s with item 6); one NSW call per failed read, not two | small |
| 6 | Long timeouts and errors that blame the signal | 20 s default read timeout; "Check your connection" after a server timeout | OTA: 8 s for a board or trip when a kept copy or pack is on screen, 15 s with nothing; say "Live times are slow right now" when the phone is online (another request answered recently) and keep the copy or pack on screen | OTA | a slow server reads as slow live data, not as no signal; spinners end in 8 s | small |
| 7 | `useLive` drops the phone's copy on a server error | fallback only when `e.offline` | OTA: a 5xx or 429 shows the kept copy or the pack the same way a network error does (g16 covers the outage specific screens; this is the shared hook) | OTA | no error screen while the phone holds times | small |
| 8 | OTA churn | 52 production OTAs in 2 days; 6 MB each, fetched on start and every foreground | One release train: at most one OTA a day, batched, published off peak (after 8 PM) | process | fewer cold first starts and background downloads during the morning | none |
| 9 | Stop board widget keeps nothing | empty on any failure | Build 209: App Group board file and timetable entries (WIDGET_WATCH_SPEED.md steps 1 and 2); keep the last rows on failure | build 209 | widget never empty while times exist | medium |
| 10 | No per endpoint numbers | no logs, token lacks zone analytics | Turn on Workers Logs (`[observability]` in wrangler.toml) and give the token zone analytics and Workers Observability read; or write one Analytics Engine data point per request (path, status, ms, copy tag, upstream ms); tag test traffic so it is left out | server | the next diagnosis per endpoint, with 5xx rates | small |
| 11 | Free plan limits, if the account is Free | 205k requests, 13.4M D1 reads, 221k D1 writes on 26 Oct | Check the plan in the dashboard; if Free, item 1 keeps us under; if load tests must run at scale, Workers Paid | dashboard | removes a hidden "everything fails until 11 AM" risk | small |
| 12 | Unknown on device cost | every number above for the app is from the web build | Measure 208 with the production bundle on an iPhone: cold start, first times on Home, frame drops while a stop screen refreshes; then decide on `inlineRequires` (Metro, JS only, but untested on device) | device check | tells us whether JS work is part of "lags" at all | small |

Safe now, server only: items 1 (process and test key) and 10 (logging). Nothing else here should ship without the gates in each item.

## What a person feels, mapped to the causes

* "Lags": items 2, 3, 6 (spinners and late times while the server waits on NSW), 8 (update downloads and cold first starts), 12 (not yet known).
* "Watch slow": item 4 (serial network loads over the relay, 8 s timeouts) and complications that only update when the watch app is open.
* "Sometimes fails to load": items 1 and 11 (our tests refused or quota'd the key; today's outage), 3 (trip 502s), 5 to 7 (errors shown while the phone holds times).
