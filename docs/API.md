# API

Base URL: https://api.transportsydney.app (Cloudflare, see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md)). Until the switch, installed apps still use the first address, which answers the same API.

On the API address only `/api/*`, the shared live trip page `/live/` and `/download/transport.apk` are served. `/`, `/privacy/`, `/support/`, `/terms/` and `/download/` redirect (301) to https://transportsydney.app, and any other path answers `404 {"error": "...", "site": "https://transportsydney.app"}`. Shared live trip links (`POST /api/share`) are `https://api.transportsydney.app/live/?t=...`.

All endpoints return JSON unless noted. Most read endpoints also take `format=text` for a short plain text answer (used for messaging). CORS is open (`access-control-allow-origin: *`). Updated 25 Oct 2026. Shared live answers (`departures`, `trip`, `plan`, `service`, `status`, `alerts`, `stations`, `search`, `nearby`, `station`, `parking`, `topup`, `lifts`) are shared copies keyed without `profile`, `device`, `refresh` and `_`: a plain request takes a copy up to 15 seconds old, a request with `refresh=1` (the app's polls and pull to refresh) only up to 5 seconds old, and `/api/departures` keeps its own copy 5 seconds for a refresh (12 otherwise), so a live time reaches a polling phone within seconds. Copies are kept 120 seconds for a busy, slow or refusing Transport for NSW: with a copy in hand a request waits at most 700 ms for a new answer and otherwise gets the copy (the new answer is stored for the next request); while a server copy has made 3 Trip Planner calls a second or more over the last 10 s, or the hub has just refused us, a refresh gets a copy up to 60 seconds old; a 5xx with a copy kept gets the copy. Concurrent requests for the same key share one upstream answer. `x-edge-cache` says `hit` (a fresh copy), `stale` (an older copy, as above), `shared` (waited for another request's answer) or `miss` (asked upstream); a copy carries `dataAt` (milliseconds, when its times were read). The hub's limit answer (429 "Your API quota or rate limit has been exceeded"; the docs say 403) is asked again up to 4 times over about 5 s; see [Scaling](SCALING.md) (26 Oct 2026). The live trip page is served by the worker with HSTS, a Content Security Policy with `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and COOP. Admin endpoints and `/api/tick` read their key only from the `x-admin-key` header; a `?key=` in the address is ignored. Load tests: a request whose `x-load-key` header matches the `LOAD_TEST_KEY` Worker secret is not turned away by the per address limits and is counted and handled like any other; the secret is set only during a test and deleted after, and with no secret nothing matches.

## Common parameters

| Parameter | Meaning |
| --- | --- |
| `profile` | The install's profile id: 6 to 40 of `a` to `z`, `0` to `9`, `_`, `.`, `:` or `-`. Each app install makes a random one. Saved trips, commutes and searches belong to a profile. Send it in the `x-profile` header (preferred, kept out of access logs) or as `profile` in the query or body. With no valid profile nothing is logged, saved trips and commutes read as empty, and writes answer `400 profile needed`. There is no shared default profile |
| `device` | The device id used for watches and push |
| `lat`, `lon` | Location, when the client shares it |
| `format=text` | Plain text answer instead of JSON |
| `fare` | Fare type for Opal fare estimates on `/api/trip`, `/api/plan`, `/api/next` and `/api/ask`: `adult` (default), `child`, `concession` or `gold` |

Errors: `400` for bad input with an `error` message (checked before any upstream call: place and stop ids up to 200 characters with no markup, `q` up to 300 characters, `count` 1 to 8, `time` as HHMM, `lat` and `lon` as numbers), `429` over a rate limit (per address: 120 upstream reads and 60 writes a minute across all copies of the worker, plus per copy limits), `403` for a wrong key, `404` for unknown routes or items, `405` for a wrong method, `502` with `kind: "error"` when Transport for NSW does not answer.

## Ask and search

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/ask` | GET | `q` (the question), `home`, `work` (optional saved places), `profile`, `device`, `lat`, `lon`, `format` | `reply`, `cards`, `links`, `suggestions`; for trips also `understood {from, via, to}`. Trip answers carry their journeys inside the `trip` card only, trimmed to the fields the Ask screens read (5 to 21 KB a reply). Alert `url` values are `https://` or null. When a place is unclear it returns `options` (Did you mean choices, each a full question). Rule based, no AI model |
| `/api/search` | GET | `q` (2 or more characters) | `items`: up to 8 stops with `id`, `name`, `modes`. Answered from the server's own stop index (every train, metro, light rail, ferry, bus and coach stop) with `source: "index"` when the index has a clear answer; otherwise the Trip Planner's stops are added after the index's (26 Oct 2026, see Speed below) |
| `/api/places` | GET | `q` (2 to 80 characters) | api.transportsydney.app only. `items`: up to 10 places in the Trip Planner's match order, each with `id`, `name`, `kind` (`stop`, `address`, `street`, `place` for a landmark, `suburb`), `modes` for stops, `area` (suburb) when the name has none, `lat`, `lon`. Every `id` works as `from` or `to` of `/api/trip`. The app uses it for the Plan search box and falls back to `/api/search` (stops only) when this answers 404 or fails |
| `/api/nearby` | GET | `lat`, `lon` | `stops` near the point |
| `/api/stations` | GET | `mode` = `train`, `metro`, `ferry`, `lightrail` or `bus`; for bus, optional `route` (for example `461X`) | Station list A to Z; for bus, the route list or one route's directions and stops. Cached for a day |

Example: `/api/ask?q=campsie%20to%20newcastle%20via%20chatswood&format=text`

## Boards, trips and services

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/departures` | GET | `stop` (stop id), `mode` (optional: `train`, `metro`, `bus`, `lightrail`, `ferry`, `coach`; only that mode is asked for, so its 40 services reach further ahead, see "One mode"), `time` (optional, `HHMM` Sydney), `date` (optional, `YYYYMMDD`) | `kind: "departures"` with live and scheduled rows, platforms, alerts. With `time`: the board from that moment, services that already left included (`departed: true`), and `at` echoed. See "Departures from another time" |
| `/api/trip` | GET | `from`, `to` (stop ids), `fromName`, `toName`, `time`, `arriveBy=1`, `count` (default 5), `refresh=1` to skip logging, `long=1` for long distance trips (api.transportsydney.app: planner wait 35 s instead of 12 s, answer kept 120 s); api.transportsydney.app only: `modes` (comma list of `train`, `metro`, `bus`, `lightrail`, `ferry`, `coach`; `bus` includes coach and school bus) asks the planner for those modes only (`excludedMeans=checkbox` with `exclMOT_n`) and drops any journey with another mode, and `date=YYYYMMDD` (today to 14 days ahead, Sydney) plans that day at `time` (from midnight without one) | `kind: "trip"` with journeys, legs, change times, live delays; bus and coach legs may carry `traffic` (see Live traffic on bus legs); with `modes` the answer echoes `modes` (sorted) and with a valid `date` it echoes `date`, which tells the app this server honoured them (the first server ignores both and echoes neither) |
| `/api/plan` | GET | `legs` (JSON list of 1 to 6 legs), `time`, `count` (1 to 8, default 5), `all=1` for all services | `kind: "trip"` with each first leg service paired with the first catchable connection on every next leg, total time, arrival and warnings (tight or missed changes) |
| `/api/service` | GET | `trip`, `mode`, `line`, `stop`, `destId`, `planned`, `to`, `stopName`, `dest`, `color` | One service: live vehicle position, stop list with live times, crowding |
| `/api/status` | GET | Same as `/api/service` | The service without the stop list and path, plus a `text` summary. Also used as a health check |
| `/api/alerts` | GET | `q` (for example `T1`, `buses`) | `kind: "alerts"` |
| `/api/app/config` | GET | `platform` (`ios`, default) | Remote config for the phone apps, see below |
| `/api/predict` | GET | `line`, `stop`, `planned` | `prediction`: usual delay from recorded history, or null when there are fewer than 5 trips |
| `/api/usual` | GET | `s=LINE~STOP` repeated, up to 12 (or `line`, `stop`), optional `at` (ISO time, default now) | `{items, enabled}` (or `{usual, enabled}`): Usually N min late per line and stop. api.transportsydney.app only. See Usual lateness below |
| `/api/reliability` | GET | `line`, `stop`, `planned`; or `s=LINE~STOP~PLANNED` repeated, up to 8 | `{reliability, enabled}`, or `{items, enabled}` in the same order. See Reliability pick below |
| `/api/lines` | GET | `l=T1,T4,M1` (up to 16 lines) | `{enabled, at, items}`, one per line in the order asked. See Status of my lines below. api.transportsydney.app only |
| `/api/traffic` | GET | none | `{items, count, at}`: open Live Traffic NSW incidents as `{id, lat, lon, kind, text, major, updated}`, read at most every 2 min. api.transportsydney.app only |
| `/api/trackwork` | GET | `t=FROM~TO~LINES~HOUR` repeated, up to 6 (`LINES` dot separated, e.g. `T1.T4`) | `{enabled, weekend, at, trips}`. See Weekend trackwork below. api.transportsydney.app only |
| `/api/pack` | GET | `stop` (stop id) | One stop's timetable for today and tomorrow, for the phone to keep: compact rows, no live data, no trip ids. See "Timetable packs on the phone" below. api.transportsydney.app only |

`/api/plan` leg fields: `f` from stop id, `fn` from name, `t` to stop id, `tn` to name, `m` mode (`train`, `metro`, `bus`, `ferry`, `lightrail`, `walk`), `c` connection minutes before this leg (0 to 60, default 5), `a` all services for this leg (1 or 0), `w` walk minutes (1 to 90). The first leg cannot be a walk.

Example (Central to Chatswood by metro): `/api/plan?legs=[{"f":"200060","fn":"Central Station","t":"206710","tn":"Chatswood Station","m":"metro"}]` (URL encode the JSON)

## Saved trips and commutes (per profile)

| Endpoint | Method | Body or parameters | Returns |
| --- | --- | --- | --- |
| `/api/saved` | GET | `profile` | `items`: saved trips |
| `/api/saved` | POST | `{profile, name, from, to}` or `{profile, name, legs}` for a multi leg trip | `saved` |
| `/api/saved` | DELETE | `profile`, `name` | `ok` |
| `/api/next` | GET | `profile`, `name` (for example `home`), `count` (up to 5) | Next live services for that saved trip, multi leg aware |
| `/api/commutes` | GET | `profile` | `items` and a `suggestion` when a trip repeats |
| `/api/commutes` | POST | `{from, to, tod, days, name}` to create, or `{id, name, tod, days, active}` to edit | `item` |
| `/api/commutes` | DELETE | `profile`, `id` | `ok` |
| `/api/commutes/dismiss` | POST | `{key}` | `ok` |
| `/api/history/delete` | POST | `{profile, device, scope}`. `scope` is `history` (trip searches and dismissed commute suggestions; suggestions are worked out from searches, so they go too) or `all` (also saved trips, commutes, watches, alerts, and for this `device` its push sign ups, Expo tokens, live trip shares, morning checks and last way home reminder). A valid `profile` is required; searches this `device` made under any older profile id are deleted too. Rate limited to 10 a client address per 10 minutes | `{ok, scope, deleted: {searches, dismissed, saved, commutes, watches, alerts, push, shares, morningChecks, morningCheckLog, lastHome}}` (row counts) |

`tod` is minutes after midnight (0 to 1439). `days` is a string of weekday numbers, 1 is Monday (default `12345`).

## Watches and notifications

| Endpoint | Method | Body or parameters | Returns |
| --- | --- | --- | --- |
| `/api/watch` | POST | `{device, profile, legs, lead, getOff}` | `watch` |
| `/api/watch` | GET | `id` | `watch` with recent `notes` |
| `/api/watch` | DELETE | `id`, `device` | `ok` |
| `/api/watches` | GET | `device`, `since` | Active watches with live snapshots, recent alerts, push counts. Runs a tick for the device if the scheduler is quiet |
| `/api/push/key` | GET | none | `publicKey` (VAPID public key) |
| `/api/push/subscribe` | POST | `{device, profile, subscription, welcome}` | `ok`, optional test result |
| `/api/push/unsubscribe` | POST | `{device, endpoint}` | `ok` |
| `/api/push/expo` | POST | `{device, profile, token, platform, welcome}` | `ok` |
| `/api/push/expo/unregister` | POST | `{device, token}` | `ok` |
| `/api/push/test` | POST or GET | `device` | Sends a test alert |

## Live trips (shared)

A shared live trip is a link someone else can open to follow a trip. No account. Rows are deleted when the owner ends the trip or stops sharing, otherwise 30 minutes after the live arrival, and never kept longer than 6 hours.

| Endpoint | What it does |
| --- | --- |
| `POST /api/share` | Body `{device, title, from:{id,name}, to:{id,name}, legs:[watch legs], pos?:{lat,lon,acc}, prog?}`. Returns `{id, key, url, expires}`. `key` is the owner's secret; keep it on the device. Rate limit 20 per 10 min per address. |
| `POST /api/share/update` | Body `{id, key, pos?: {lat,lon,acc} or null, prog?: {leg, phase, next, stopsLeft, eta}, legs?, end?}`. `pos: null` removes the position. `end: true` deletes the share. Rate limit 240 per 10 min. |
| `GET /api/share?id=` | For viewers: `{title, from, to, legs, pos (only if under 5 min old), prog, started, updated, expires, now}`. Never returns the key or the device id. 404 `{ended: true}` once the trip has ended. |
| `DELETE /api/share?id=` | Header `x-share-key` (or `key=`). Deletes the share and every position in it. |

Positions are rounded to 5 decimal places. Viewers get the vehicle from `/api/service` for the current leg.

Watches: `POST /api/watch` takes `track: true` (sent by Start trip). A tracked watch also sends "Next stop: X" one stop before you get off or change, from where the vehicle really is, instead of the 2 minute arrival alert.

## App and site

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/app` | GET | none | Latest Android APK (url, size, version, uploaded), the Expo Go link and the download page |
| `/download/transport.apk` | GET | none | The APK file from R2, with range support |
| `/api/hit` | POST | `{p, r}` (page and referrer) | `204`. Counts one view per day, page and referring site. Skipped for Do Not Track and Global Privacy Control |
| `/api/feedback` | POST | form or JSON: `message` (10 or more characters), `email` (optional), `topic` (`question`, `problem`, `idea`, `data`) | Form posts redirect to `/support/thanks/`; JSON returns `ok` or field `errors` |

## Operations

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/health` | GET | `x-admin-key` header | Feed fetch stats, cached realtime feeds and their age, storage status, and `upstream` for this server copy (`perS` budget, `last10s` Trip Planner calls, `busy`, `refused`, `staleServed`, `shared`, any rate or quota `headers` the hub sent). `403` without the key |
| `/api/usage` | GET | `x-admin-key` header for the full answer | With the key: today's upstream calls against the 60,000 budget, observation count, last tick time. Without it: only `observations.n` (shown in Settings) |
| `/api/obs` | GET | `route`, `stop`, `day`, `limit` (up to 1000) | Recorded live observations |

## Keyed endpoints

These need `TICK_KEY` or `ADMIN_KEY` in an `x-admin-key` header. The keys are secrets (see [Security](SECURITY.md)).

| Endpoint | Key | What it does |
| --- | --- | --- |
| `/api/tick` | TICK_KEY or ADMIN_KEY (in the `x-admin-key` header, or `?key=`) | Runs the minute scheduler. `force=1` (admin only) and `nosample=1` |
| `/api/stats` | ADMIN_KEY | Page counter by day, page and referrer. `days` (1 to 90). DELETE with `day` clears a day |
| `/api/feedback` | ADMIN_KEY | GET lists contact form messages; DELETE with `id` removes one |
| `/api/admin/file` | ADMIN_KEY | PUT uploads an APK into R2 (`name=transport.apk`, `version=N`); GET shows the stored file |
| `/api/admin/sim` | ADMIN_KEY | Simulates a delay or platform change on a watch (`id`, `leg`, `delay`, `platform`) |
| `/api/admin/commute` | ADMIN_KEY | Runs one commute now (`id`, `reset=1`, `leave=1`) |
| `/api/admin/searches` | ADMIN_KEY | Adds or clears test searches for commute memory |
| `/api/admin/profile-copy` | ADMIN_KEY | POST `{from, to}`: copies saved trips, trip legs, commutes, searches and dismissed suggestions from one profile to a new id of 20 to 40 characters. Device bound rows (push, watches, notes) stay with their device |

### Database export (admin)

`GET /api/admin/export` with `x-admin-key`: `{tables: [{name, sql, rows}], indexes: [{name, table, sql}]}`. With `table=NAME&after=ROWID&limit=500` (1 to 1000): `{table, rows: [{__rowid, ...columns}], next}`; `next` is the rowid to pass as `after`, or null on the last page. Read only. Used by `backend/tools/export-d1.mjs`.

## Opal fare estimates

Every journey from `/api/trip`, `/api/plan` and `/api/next`, and every journey in an Ask trip card, carries `fare` for the requested `fare` type. Ask trip replies also end with a sentence like "Opal fare estimate $5.38 (Adult, peak). Off peak from 7pm, save $1.62." and the top level `fare` of the next journey.

| Field | Meaning |
| --- | --- |
| `type`, `typeName` | `adult`, `child`, `concession` or `gold`, and its name |
| `total` | The estimate in dollars, after transfer discounts and the daily cap, including any airport station access fee |
| `peak` | True when any part is charged at the peak fare (Monday to Thursday 6:30am to 10am and 3pm to 7pm, not public holidays; ferries have no off peak) |
| `offPeak` | `{from, save}` when the trip is in peak: when off peak starts (`10am` or `7pm`) and how much less it would be |
| `transfer` | Total transfer discount ($2 Adult, $1 other types per change of mode within 60 minutes) |
| `airportFee` | Airport station access fee included in `total` ($18.61 Adult, $16.64 other types; $5.20 between the two airport stations, $10.34 to Mascot, $12.74 to Green Square) |
| `capped` | True when the daily cap was reached ($19.30 Adult Monday to Thursday, $9.65 Friday to Sunday; half for Child and Concession; $2.50 Gold) |
| `unknown` | True when a leg is not an Opal fare (for example a coach); that leg has `amount: null` |
| `legs` | One per transit leg, in order: `line`, `mode`, `km`, `peak`, `fare` (table fare), `transferOff`, `airportFee`, `amount` (what this leg adds), `joined` (true when it continues the previous journey: trains and metro, or the same mode within 60 minutes, are one fare on the total distance) |
| `estimate` | Always true |

Distances: train, metro and ferry along the route; bus and light rail in a straight line between where you board and get off. Child or Youth and Gold pay the concession per trip fares. Fares come from transportnsw.info and the Opal Fares open data (fare values from 29 June 2026), read 24 Oct 2026.


## Station access, Park and Ride and Opal machines

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/station` | GET | `id` (station number, for example `200060`), `live=0` to skip live parts | `name`, `access` (`level`: `independent`, `assisted`, `none` or `unknown`; `label`; `lift`, `escalator`, `stairs`, `ramp`, `hearingLoop`, `tactile`), `ticket` (`kind`: `cash`, `card`, `topup`, `none` or `unknown`; `label`; `extraTopUp`), `facilities` (names), `parkRide`, `peak` (`morning`, `afternoon`), `shortPlatform`, `address`, `phone`, `outages` (live lift or escalator outages: `id`, `kind`, `title`, `detail`, `url`, `updated`), `parking` (car parks at this station, see below), `sources`, `read` (date the facility data was read). 404 when there is no facility data |
| `/api/parking` | GET | `id` (car park), or `stop` (station number), or nothing for every car park; `live=0` for the list without live counts | `carpark` or `carparks`: `id`, `name`, `station`, `spots`, `free`, `occupied`, `status` (`ok`, `nearly`, `full`, `unknown`), `label`, `updated` (ISO time of the reading), `stale` (older than 30 minutes, shown as no live count), `lat`, `lon`, `address`; plus `source` |
| `/api/topup` | GET | `lat`, `lon` (optional), `limit` (1 to 40, default 12) | `items`: stations with an Opal machine (`id`, `name`, `lat`, `lon`, `kind`, `label`, `cash`, `distance` in metres when `lat` and `lon` are given, closest first). Without a position, every such station (about 250) |
| `/api/lifts` | GET | none | `items`: every current lift and escalator outage with `stops` (station numbers) |
| `/api/lifts/alerts` | POST | `{device, profile, stations: [station numbers, up to 40], on}`; `on: false` turns it off and deletes the list | `on`, `stations` (count), `now` (outages already showing at those stations; listed, not pushed) |
| `/api/lifts/alerts` | GET | `device` | `on`, `stations` |
| `/api/parking/watch` | POST | `{device, profile, facility}` | `watch` (`id`, `name`, `expires`, 3 hours) and `now` (the live reading). Up to 5 open per device |
| `/api/parking/watch` | GET, DELETE | `device` (GET), `id` and `device` (DELETE) | Open watches, or stop one |

Nearly full means 10 percent or fewer spaces left, or 10 or fewer on a small car park. Car park readings are cached for 90 seconds, the full list for 10 minutes, lift outages for 5 minutes.

App use (over the air, 25 Oct, about 10:00 PM): a station's car park row reads `parking` from `/api/station`; the car park detail reads `/api/parking?id=<facility>` (or `?stop=<station>` for a station with several); More > Car parks reads `/api/parking`. Each car park already carries the facility id, name, `lat` and `lon`, `spots`, `free`, `updated` and `stale`, so no separate `/api/carparks` route was added and the server was not redeployed. The server's own Transport for NSW key covers the Car Park API (`/v1/carpark?facility=`), checked live on 25 Oct: 41 car parks answered with readings minutes old.

Trip results: `/api/trip`, `/api/plan`, `/api/next` and `/api/ask` take `acc=1` for step free trips only (the Trip Planner `wheelchair=on` option; the answer then has `accessible: true`). Every transit leg gets `access: {from, to}`, each `{id, level, lift, outage, outages}` for the station where you board and get off. When the first leg starts at a Park and Ride station the answer has `parking: {station, carparks, source}`. Ask trip replies add lines for step free only, a lift outage on the trip, and the Park and Ride spaces.

Ask: parking, lift and top up questions answer with `kind: "facility"`, a `reply`, and cards of type `parking` (`title`, `items` as above, `source`) or `station` (`station`: `id`, `name`, `access`, `ticket`, `outages`, `parking`, `source`). Clients that do not know these card types can show the reply text alone.


**Usually full by** (api.transportsydney.app only). Each car park in every `/api/parking` answer gets `usual`: `{state, n, text}` (plus `tod`, minutes after midnight, for `full` and `some`; `need` for `learning`). Weekday mornings from 5am to 11am the minute tick reads a quarter of the car parks each minute (each one every 4 minutes) and keeps one row per car park per day in `park_full` (`first_tod`, the first reading that morning, and `full_tod`, the first reading that showed it full): at most two row writes per car park per day, and a car park already full that day is not read again. Rows older than 70 days are deleted. From the last 8 weeks of weekdays (today only once it has filled or after 11am):
* under 5 mornings: `learning`, "Learning when it fills: 2 of 5 weekday mornings recorded"
* full on at least 70 percent of mornings: `full`, "Usually full by 7:40am on weekdays" (the time it was full by on 70 percent of mornings, rounded up to 5 minutes)
* full on some: `some`, "Full by 8:00am on 2 of the last 6 weekdays" (the middle full time)
* never full: `space`, "Had spaces every weekday morning lately (6 days)"
The readings are every 4 minutes, so a full time can be up to 4 minutes late. A morning when the tick stopped early counts as not full. App: the line under each car park (`usualLine` in app/src/lib/access.ts), hidden when the answer has no `usual`; over the air update group 9e15f138-cee2-4fc5-b804-7512ff516bc5 (25 Oct, 10:11 AM).
## Morning check (per device)

A device registers a usual trip. About 15 minutes before the usual departure (Sydney time) the minute tick looks at live data once and sends ONE alert to that device, only if something is wrong. When all is fine it stays silent. Alerts go to the same push targets as trip alerts: the device's Expo push tokens (`/api/push/expo`) and Web Push sign ups (`/api/push/subscribe`). No login: everything is keyed by `device`, and `/api/history/delete` with `scope: "all"` and the `device` removes it too.

What counts as wrong, all from live or published data, never guessed:
* a delay over 5 minutes on any leg (live times only; a service with no live data is never called late)
* a cancellation (the leg is cancelled, or a cancellation alert on its line)
* trackwork or a changed service on the line (Transport for NSW alerts such as "Buses replace trains", "changed timetable", "not running", "suspended")
* a platform change for a leg's departure
* a change that is now too tight to make
* a lift out of service at the start or end station, when that end of the trip is by train or metro (escalator only outages are not counted; a bus stop outside a station is reached from the street)

The service checked is the one whose first train, bus or ferry is planned closest to the usual time (within 45 minutes; see `mode` below). If none is found, nothing is sent. The check is claimed in D1 (`morning_sent`, one row per check per departure day) before it runs, so two ticks never send it twice; if live data does not answer, the claim is given back and the next minute tries again, until 3 minutes before the usual time.

| Endpoint | Method | Body or parameters | Returns |
| --- | --- | --- | --- |
| `/api/morning-check` | POST | Create: `{device, from: {id, name}, to: {id, name}, time, days, lead, mode, name}`. Edit: the same with `id` (only this device's) | `{ok, item, push, enabled}` |
| `/api/morning-check` | GET | `device` | `{items, push, enabled, max}` |
| `/api/morning-check` | DELETE | `device`, and `id` for one (without `id`: all of this device's) | `{ok, deleted}` |
| `/api/morning-check/preview` | GET | `device`, `id` | What the check would say right now, without sending or claiming: `{item, found, issues, service, alert, sent: false}` |

Fields:
* `device`: the same device id used for trip alerts (6 to 64 of `A` to `Z`, `a` to `z`, `0` to `9`, `_ . : -`).
* `from`, `to`: stop or station ids from `/api/search` or `/api/stations`, place ids from `/api/places`, or a point as `longitude:latitude:EPSG:4326` (api.transportsydney.app), with the names to show.
* `time`: usual departure, `"HH:MM"` 24 hour Sydney time (`"7:45"` and `"0745"` also work).
* `days`: weekday numbers, 1 is Monday to 7 is Sunday. Default `[1, 2, 3, 4, 5]`.
* `lead`: minutes before `time` that the check runs, 5 to 45. Default 15.
* `mode`: optional, the kind of service usually taken: `train`, `metro`, `bus`, `coach`, `ferry` or `lightrail`. Journeys starting with it are checked first. Without it, any mode near the usual time, with services of an unknown kind (on demand, school runs) last.
* `name`: optional label, up to 40 characters. `active: false` pauses a check without deleting it.
* Up to 6 checks per device (`409` past that). Bad input answers `400` with `error` saying which field.

```json
POST /api/morning-check
{ "device": "a1b2c3d4e5", "from": { "id": "213410", "name": "Burwood Station" }, "to": { "id": "213510", "name": "Strathfield Station" }, "time": "08:00", "days": [1, 2, 3, 4, 5] }

200
{
  "ok": true,
  "item": {
    "id": "Zk3mPq8rTw1y", "name": null,
    "from": { "id": "213410", "name": "Burwood Station" }, "to": { "id": "213510", "name": "Strathfield Station" },
    "time": "08:00", "timeText": "8:00am", "days": [1, 2, 3, 4, 5], "mode": null, "lead": 15, "active": true, "created": 1793080800000,
    "last": null
  },
  "push": { "web": 0, "expo": 1 },
  "enabled": true
}
```

* `push`: how many push targets this device has. `{web: 0, expo: 0}` means an alert would reach nobody, so the app should ask for notifications first.
* `enabled`: `false` when the server flag `morningCheck` is off (checks are kept but nothing runs).
* `last` after the first run: `{day: "20261026", at, result, issues, alert}`. `result` is `ok` (all fine, nothing sent), `alert` (sent), or `no service found`. `issues` lists the kinds found: `delay`, `cancelled`, `trackwork`, `platform`, `connection`, `lift`. `alert` is `{title, body}` as sent, or null.

The alert as sent (push `data.tag` is `m<id>`, `data.url` is `/`). Up to 3 problems, one sentence each; the body is at most 300 characters and a long Transport for NSW alert is cut at a word with `...`:

```json
{ "title": "Check before you go: Burwood to Strathfield", "body": "The 8:00am T1 is 7 min late. The 8:00am T1 now leaves from Platform 4, not Platform 3. Lift out of service at Strathfield." }
```

Preview answer:

```json
{
  "item": { "id": "Zk3mPq8rTw1y", "time": "08:00", "...": "as above" },
  "found": true,
  "issues": [ { "kind": "delay", "minutes": 7, "text": "The 8:00am T1 is 7 min late." } ],
  "service": { "line": "T1", "mode": "train", "planned": "2026-10-25T21:00:00.000Z", "estimated": "2026-10-25T21:07:00.000Z", "platform": "Platform 3", "realtime": true,
    "leave": "2026-10-25T21:02:00.000Z", "arrive": "2026-10-25T21:13:00.000Z", "changes": 0 },
  "alert": { "title": "Check before you go: Burwood to Strathfield", "body": "The 8:00am T1 is 7 min late." },
  "sent": false
}
```

Preview is rate limited to 20 a client address per 10 minutes; writes share the 60 per 10 minutes write limit.

## Platform change while waiting

A followed trip (`/api/watch`, and Start trip in the apps) gets one alert when the platform of the leg you are about to board changes before it leaves. Only a platform the departure board actually reports counts, so a board that does not answer for a minute never reads as a change back. Each new platform of each leg is claimed in D1 before it is sent (`watch_sent`, key `plat:<leg>:<platform>`), so the minute tick and an open app never both send it. A second real change (for example 3 to 4, then 4 to 1) is a second alert. Nothing is sent after the service has left. Server flag: `platformAlerts`.

```json
{ "title": "Platform changed to 4", "body": "The 8:00am T1 to Hornsby now leaves from Platform 4, not Platform 3." }
```

Push `data.tag` is `w<watch id>` and `data.watch` the watch id, like the other trip alerts.

## Occupancy

Departures (`items[].occupancy`), trip and plan legs (`journeys[].legs[].occupancy`) and live vehicles (`vehicle.occupancy`) carry occupancy only when Transport for NSW sends it for that service: the Trip Planner's occupancy on the stop event, or the realtime vehicle feed's occupancy status. Shape: `{level, text}`, for example `{"level": 2, "text": "Few seats"}`.

| `level` | `text` |
| --- | --- |
| 1 | `Empty` or `Many seats` |
| 2 | `Few seats` |
| 3 | `Standing room` |
| 4 | `Very full`, `Full` or `Not taking passengers` |

When it is not sent, or the value is one we do not know, `occupancy` is `null`: show nothing. Never fill it in. Server flag `occupancy` off removes the field from every answer.

## Lift aware trips

`/api/trip`, `/api/plan` and `/api/next` with `acc=1`: on top of the Trip Planner's step free option, a trip that boards, changes or gets off at a station with a lift out of service right now is left out when another trip avoids it, and trips that are step free at every station come first (otherwise the Trip Planner's order is kept). `/api/trip` and `/api/plan` ask for 3 more trips than `count` so there is something to choose from, then return `count`. Lift data is the same as `/api/lifts` (escalator only outages do not count). Only train and metro legs count: a bus or coach stop outside a station is reached from the street. Server flag: `liftAwareRouting` (off: `acc=1` is only the Trip Planner's step free option, as before).

Added to the answer with `acc=1`:

```json
{
  "accessible": true,
  "liftAware": { "avoided": 1, "allAffected": false, "stations": ["Central"] },
  "journeys": [
    { "stepFree": true, "liftOutages": [], "legs": [ { "access": { "from": { "id": "213410", "level": "independent", "lift": true }, "to": { "id": "200070", "level": "independent", "lift": true } } } ] }
  ]
}
```

* `liftAware.avoided`: trips left out because of a lift outage. `stations`: where the outages were.
* `liftAware.allAffected: true`: every trip found meets a lift outage, so all are kept; show each trip's `liftOutages`.
* `journeys[].stepFree`: every station on the trip is listed as step free (stations with no access data count as not step free).
* `journeys[].liftOutages`: `[{id, name, title}]` for stations on that trip with a lift out.
* Each station in `legs[].access` gets `liftOut: true` when the outage is a lift.

## Usual lateness

`GET /api/usual?s=410~2046100&s=T1~2135223&at=2026-10-26T07:52:00%2B11:00` (api.transportsydney.app only; the old host answers 404 and the app hides the line) says how late a line usually is at a stop, for the day type (weekday or weekend) and part of the day of `at`: mornings 6am to 10am, middle of the day 10am to 3pm, afternoons 3pm to 7pm, evenings 7pm to 6am.

```json
{ "items": [ { "lateMin": 3, "plus": false, "n": 24, "lateShare": 58, "dayType": "weekday", "band": "mornings",
    "text": "Usually 3 min late on weekday mornings", "short": "usually 3 min late",
    "basis": "median lateness of recorded live departures, recent weeks weighted most", "kind": "usual" }, null ], "enabled": true }
```

`lateMin` is the median minute of lateness (0 for on time or early, 10 with `plus` for 10 or more), `lateShare` the percent of services 3 or more minutes late, `n` the services counted after fading. When the part of the day has fewer than 8 services the whole day type is used (`band` null, "on weekdays"); under 8 there too the item is null. Cached 10 minutes. Server flag `usualLate` off: every item is null and `enabled` is false.

Where it comes from: the live times already recorded in `obs` (the same rows `/api/predict` and `/api/reliability` read, from Transport for NSW realtime departures). Once a day the minute tick folds one day into `late_agg`: one row per line, stop, day type and part of the day with a count per minute of lateness (early, 0 to 9, 10 or more), only rows whose live time was read within 10 minutes of departure. Each folded day first multiplies every count by 0.95 (recent weeks count most) and rows below half a service are deleted. The first run folds the last 28 days, one day per tick; after that yesterday is folded from 1am. The claim is in `meta` (`late_day`), so two ticks never fold one day twice. No trip, time, device or profile is kept in `late_agg`.

## Reliability pick

`GET /api/reliability?line=T1&stop=2134101&planned=2026-10-26T07:52:00%2B11:00` says how often that timetabled service left that stop on time lately, from the live times the server recorded (the `obs` table, the same data `/api/predict` reads). Nothing else goes in: no timetable guess, no average for the line.

* A sample is one day on which the same line left the same stop within 2 minutes of the same timetable time, on the same kind of day (weekday or weekend), seen by the server close to departure (within 10 minutes of it). One sample per day, the most recent 10 days over the last 42.
* On time: no more than 1 minute early and less than 3 minutes late.
* Fewer than 5 samples: `null`. The app then shows nothing.

```json
{ "reliability": { "onTime": 9, "n": 10, "dayType": "weekday", "lateMin": 3, "usualLateMin": 6,
    "text": "Left on time 9 of the last 10 weekdays", "short": "9 of 10 on time",
    "basis": "on time means under 3 min late, from recorded live times", "kind": "reliability" }, "enabled": true }
```

`usualLateMin` is the median lateness of the late days, or null when none was late. Batch: `?s=T1~2134101~2026-10-26T07:52:00%2B11:00&s=...` (up to 8) answers `{items: [...], enabled}` in the same order, `null` where there is not enough history. Server flag `reliabilityPick` off: every answer is null and `enabled` is false.

## Weekend trackwork

Without this route (the first address, 404) the apps work the card out from `/api/alerts?q=<line>` (no added time; docs/TRACKWORK.md).

`GET /api/trackwork?t=213510~201110~T1.T4~8` says which planned work this coming weekend (Friday 8pm to Monday 3am, Sydney time; on Saturday and Sunday the weekend under way) touches each trip. Only on api.transportsydney.app; the app hides the card when the server answers 404.

* Source: Transport for NSW's GTFS realtime service alerts v2 (`/v2/gtfs/alerts/all`, every mode). The minute tick reads it every 10 minutes, keeps alerts with lines or stops whose effect is no service, reduced service, delays, detour, modified service or stop moved, and stores the cut down list (about 30 KB) as one row in `meta` (`alert_digest`). Requests read that row; no request decodes the feed.
* Line names: alerts name GTFS route ids (`NSN_1a`). `src/public/data/routes.json` maps them to lines (`T1`), built from the per network timetables by `tools/build_routes.py`. Bus route ids carry the line after the `_`. NSW TrainLink trains and coaches named by number are left out of the table (the numbers clash with bus routes); their alerts match by stop only.
* Planned: cause maintenance or construction, or a header saying buses replace trains, trackwork or a changed timetable.
* A trip matches when the alert names one of its lines or its start or end stop. For matched trips the planner is asked twice at `HOUR`:00 (the weekend day and the same day a week later). Alerts not on the trip's path are dropped (alert stops not on it, or the places a header names, "between X and Y", not on it). `buses` is the first temporary bus leg on the weekend plan; `addedMin` is the weekend trip minus the week later trip, given when 5 min or more and the week later trip has no temporary buses. The answer per trip is cached for 3 hours.
* Server flag `weekendTrackwork` off: `enabled: false` and no trips.

```json
{ "enabled": true, "weekend": { "sat": "20261031", "sun": "20261101", "from": 1793444400000, "to": 1793635200000 }, "at": 1793400000000,
  "trips": [{ "f": "213510", "t": "201110", "affected": true, "day": "20261031", "addedMin": 25, "buses": { "from": "Central", "to": "Kings Cross" },
    "items": [{ "id": "...", "title": "Buses replace trains between Central and Bondi Junction", "url": "https://transportnsw.info/alerts/details#/ems-80076", "lines": ["T4"], "sat": true, "sun": true, "days": "Sat and Sun" }] }] }
```

## Status of my lines

`GET /api/lines?l=T1,T4,M1` gives one status per line now, from the same service alerts digest as Weekend trackwork (alerts active now: no active period, or one that covers now). Only on api.transportsydney.app; the app hides the section when the server answers 404.

* `suspended` ("Suspended"): an alert with effect no service, or a header saying suspended or not running, that is not planned work.
* `delays` ("Delays"): effect significant delays, or reduced, modified or detoured service that is not planned work.
* `trackwork` ("Trackwork" for trains, metro and light rail; "Changes" for buses and ferries): planned work under way, or a detour or moved stop.
* `good` ("Good service"): none of these.
* The worst one wins; `title` and `url` are its header and Transport for NSW link, `more` counts the other alerts.
* A digest older than 2 hours (the tick stopped) answers `stale: true` and no items, so the app shows nothing rather than a wrong "Good service". Server flag `lineStatus` off: `enabled: false`.

```json
{ "enabled": true, "at": 1792881795600, "items": [
  { "line": "T4", "status": "trackwork", "label": "Trackwork", "title": "Trains run to a changed timetable and stopping pattern. City Circle trackwork may also affect how you travel", "url": "https://transportnsw.info/alerts/details#/ems-79751", "more": 0 },
  { "line": "M1", "status": "good", "label": "Good service", "title": null, "url": null, "more": 0 }] }
```

## Last way home reminder

From the Ask "Last train home" answer, or a trip that is the last one tonight, the app asks for ONE push 15 minutes before the last service home. The server finds that service itself (the same search as Ask), looks at live data again from 20 minutes before (every 5 minutes, and once more at the moment if the last look is over a minute old), follows it if it runs late or is replaced, then claims the send in D1 and notifies once. No login: keyed by `device`, one reminder per device (a new one replaces the old one). Push targets are the device's Expo tokens and Web Push sign ups, like the other alerts. Android builds without push (before versionCode 6) show it in the app instead.

| Path | Method | Input | Output |
| --- | --- | --- | --- |
| `/api/last-home` | POST | `{device, from: {id, name}, to: {id, name}, mode, acc}`. `mode` optional (train, metro, bus, coach, ferry, lightrail; empty is any service) | `{ok, item, push, enabled}`. 409 with `reason`: `none` (no service home for the rest of tonight), `soon` (it leaves in 16 minutes or less), `far` (more than 8 hours away). 503 when the server flag is off |
| `/api/last-home` | GET | `device` | `{item, push, enabled, lead}`. `item` is null when there is none, or once the service left over 30 minutes ago |
| `/api/last-home` | DELETE | `device`, `id` optional | `{ok, deleted}` |

Without this route (the first address, 404) the apps set the reminder on the phone from the Ask answer and look at live times again with `/api/trip` or `/api/ask` while open (docs/LAST-WAY-HOME.md). Android uses the phone's reminder on both addresses.

`item`: `{id, from, to, mode, serviceMode, lead, leave, board, remindAt, line, stop, platform, changedFrom, status, checked, sent, text, leaveText, remindText}`. `leave` is when to set off (the first service, or earlier when the trip starts with a walk), `board` the first service's time, `remindAt` = `leave` minus `lead`. `status`: `waiting`, `sent`, `none` (no service showed any more; that was said once instead), `gone` (it left before a push could go). `changedFrom` is the first time found when the service has since moved by 2 minutes or more. `text` is the push body as sent.

The push: title "Last train to Burwood", body like "Leaves in 15 min: the 12:04am T1 from Central, Platform 16." or "Leave by 11:52pm: the 12:04am T1 from Central, Platform 16." plus "It changed from 11:58pm." when it moved. Push `data.tag` is `h<id>`, `data.url` is `/`.

`/api/ask` adds `lastHome: {from, to, mode, leave, lead}` to a `lastService` answer when the service is between 16 minutes and 8 hours away and the flag is on; the app shows "Remind me 15 min before" only then. Delete all data (`/api/history/delete`, `scope: "all"` with the `device`) removes the reminder. Server flag: `lastWayHome`.

## iPhone trip card by push (build 205 and later)

The trip card on the Lock Screen and in the Dynamic Island (Live Activity) is updated by Apple push while the phone is locked. The app sends the card's push token here, whichever address the rest of the app uses; the server holds the push key (Worker secret `APNS_KEY`, vars `APNS_BUNDLE`, `APNS_KEY_ID`, `APNS_TEAM_ID`).

* `POST /api/live-activity` body `{ token, activity, device, trip: { id, title, origin, to, legs, rode, arrivedAt } }`: stores the card (table `live_activities`). Sent again when the token changes, a leg is ridden or the trip arrives. Answers `{ ok, push }` (`push` false when the key is not set). 400 for a token that is not hex or a trip with no usable legs (at most 8).
* `POST /api/live-activity/end` body `{ token }`: the trip ended on the phone; no more pushes, and the card's row is deleted.
* `POST /api/apns/device` body `{ token, device, env }`: the phone's own push token, saved for alerts later (table `apns_devices`). Nothing is sent to it yet. Not sent after Delete all my data until alerts are turned on again.
* `POST /api/live-activity/forget` body `{ device }`: Delete all my data for these two tables. Deletes every `live_activities` and `apns_devices` row of that install and answers `{ ok, deleted: { liveActivities, apnsDevices } }`; 400 without a device. Rate limited like `/api/history/delete` (10 per 10 min per address). The app calls it on this address from the 25 Oct 5:28 PM update, because these tokens live here whichever address the app uses. `/api/history/delete` with `scope: "all"` deletes the same rows (`deleted.liveActivities`, and the phone token counted in `deleted.push`).
* Clean up (hourly housekeeping): cards ended, expired (10 min after `expires`) or created over 24 h ago are deleted; phone push tokens not sent for 30 days are deleted.
* Minute tick: each active card not pushed in the last 50 s (10 per tick) gets the card worked out from live times with the app's own code (`LIVECARD` in `src/worker.js`, written by `tools/gen-livecard.mjs` from `app/src/lib/liveCalc.ts` and `app/platform/tripCard.ts`; `app/test/livecard-sync.test.mjs` fails when they drift). Push: topic `<APNS_BUNDLE>.push-type.liveactivity`, `apns-push-type: liveactivity`, `event: update` with `content-state` matching `LiveTripAttributes.ContentState` (dates as seconds since 1 Jan 2001), `stale-date` 2 minutes after the live times, priority 10 when the card looks different and 5 otherwise. On arrival (or 7 hours at most) `event: end` with the arrived card and `dismissal-date` 2 minutes later. A token Apple refuses (410, BadDeviceToken, Unregistered) stops the card.
* `GET /api/admin/live-activity` (admin key): the last 10 cards (token cut to 8 characters, trip title, pushes, Apple's last status and reason) and the count of saved phone tokens.
* `POST /api/admin/live-activity` (admin key) body `{ token?, warning?, end? }`: sends the newest active card (or the one whose token starts with `token`) its live state now, with the warning line "Server test 9:41am" unless `warning` is given (`false` for none); `end: true` ends it. Answers Apple's status and reason, the event, phase and the content state sent.

## Remote config for the phone apps

`GET /api/app/config?platform=ios` returns the settings the iPhone app reads at launch and each time it comes to the front (cached for 5 minutes at the edge; the app keeps its last good copy and has the same defaults built in, so it works offline). Native code cannot be changed over the air, so this only switches what the app already has.

```json
{
  "version": 1,
  "flags": { "ask": true, "parkRide": true, "opalMachines": true, "liveTrip": true, "shareTrip": true, "weekdayReminder": true, "nearby": true,
    "morningCheck": true, "platformAlerts": true, "occupancy": true, "liftAwareRouting": true },
  "kill": {},
  "copy": {},
  "tabs": ["home", "plan", "watching", "more"],
  "timing": { "liveRefreshSec": 15, "alertRepeatWindowMin": 15, "arriveLeadSec": 150, "sameRunToleranceSec": 120, "configRefreshMin": 30 },
  "platform": "ios"
}
```

* `flags`: `false` hides a feature (Ask, Park and Ride, Opal machines on More; Start trip; Share trip on the live trip; Remind me every weekday; Nearby on Home; `morningCheck` the Morning check screen; `platformAlerts` the platform change alert option; `occupancy` crowding labels; `liftAwareRouting` the lift aware note on Accessible trips; `reliabilityPick` the on time line on service rows; `lastWayHome` Remind me on the last service home).
* `kill`: feature name to the words shown in its place, for example `{"liveTrip": "Live trips are paused for a moment."}`. A killed feature is hidden even if its flag is true.
* `copy`: `welcomeTitle` (Home welcome) and `startTripFooter` (under Start trip). Empty or missing uses the text in the app.
* `tabs`: tab order. Unknown keys are ignored and a missing tab is added at the end, so no tab can disappear.
* `timing`: `liveRefreshSec` (5 to 120), `alertRepeatWindowMin` (how long the same alert is held back, 1 to 120), `sameRunToleranceSec` (how far a service's boarding time may be from the planned one and still count as the same run, 30 to 600), `configRefreshMin`. Values outside the range are clamped in the app.

* `api_base` (iPhone): moves the app, its widgets and the Live Activity to another server address without a build. Send it inside `copy` (`{"copy": {"api_base": "https://api.transportsydney.app"}}`), which the server passes through today; a top level `api_base` is read too. The app takes it only when it is https, has no user name, port or query, and its host is the host in use now or on `APIBase.allowedDomains` (today `api.transportsydney.app`; `ios-native/Sources/TransportKit/APIBase.swift` is the one place the address and the list are written). Example: `{"copy": {"api_base": "https://api.transportsydney.app"}}`. A bad value is ignored and the last good one stays; removing it goes back to the address built into the app.
* Setting `copy.api_base` (admin POST to `/api/app/config?platform=ios` and `platform=android`): the server accepts only an https origin with no path, like `https://api.transportsydney.app`, or `""` to clear it; anything else answers 400. A POST replaces that platform's stored overrides, so send the other overrides with it. Nothing sets it by default. The switch steps are in [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md).
* `api_base` (Android): the same key, read the same way: `copy.api_base` first, then a top level `api_base`. The Android app reads `GET /api/app/config?platform=android` at launch and each time it comes to the front (at most every `configRefreshMin`), keeps the last good copy, and takes the address only when it is https, a bare host (no user name, port, path or query) and the host in use now or `api.transportsydney.app` (or a subdomain of it); the list and the default address are in `app/src/lib/server.ts`. A bad value is ignored and the last good one stays; a config without `api_base` goes back to the default. The Android flags it reads: `morningCheck` (Check my trip before I go in More and on the commute card), `occupancy` (crowding chips) and `liftAwareRouting` (the lift notes on Step free results); `kill` hides a feature the same way.

Change it without a build or a deploy: `POST /api/app/config?platform=ios` with the `x-admin-key` header and a JSON object holding only the parts to change. It is stored in D1 (`app_config`) and merged over the defaults. Send `{}` to go back to the defaults.

Server side switches: the same POST with `platform=server` turns the server's part of a feature off for every app at once, within a minute and with no deploy. The server reads `flags` (or a `kill` entry) for `morningCheck` (no morning checks run), `platformAlerts` (no platform change alerts), `occupancy` (no occupancy in any answer), `liftAwareRouting` (`acc=1` is only step free, no lift outage ranking), `reliabilityPick` (every `/api/reliability` answer is null), `weekendTrackwork` (`/api/trackwork` answers `enabled: false`), `lineStatus` (`/api/lines` answers `enabled: false`) and `lastWayHome` (no reminders sent, new ones refused with 503, Ask leaves out `lastHome`). For example `{"flags": {"morningCheck": false}}`. The stored body replaces the previous one for that platform, so send every switch you want off.

## Realtime for regional and private operators

Trip legs and departures for services outside the Sydney feeds carry `feed`, and their live times, cancellations and vehicle positions come from that operator's feed: `ferry_mff` (Manly Fast Ferry, `/v1/gtfs/realtime/ferries/MFF`), `nswtrains` (NSW TrainLink trains and coaches, `/v1/gtfs/realtime/nswtrains`) and `rb_<network>` (regional buses, every `/v1/gtfs/realtime/regionbuses/<network>` feed of that network: North Coast, Central West and Orana, Riverina Murray, South East and Tablelands, New England North West, Newcastle and Hunter, Far West, Sydney and Surrounds; Hunter Buses Network services stay on the Sydney buses feed, where their trips are). The feed is chosen from the planner's operator and network names, never from the line name, because regional route numbers repeat Sydney ones. Legs without `feed` use the mode's feed as before. `/api/service` takes the same `feed` parameter; the app passes it from the leg or departure (over the air update group 9e15f138-cee2-4fc5-b804-7512ff516bc5, 25 Oct, 10:11 AM). The trip screen's "Bus running 6 min late" line on bus and coach legs reads `realtime` and `delayMin`, already on every leg. Feeds are read only when a trip or board includes such a service.

Checked 25 Oct 2026: TrainLink and North Coast bus trip ids in the planner match their feeds. The Manly Fast Ferry feed still carries trips from 1 July (start date 20260701) whose ids do not match the current timetable, so those legs stay scheduled until TfNSW fixes the feed; the wiring needs no change when it does.

## Long distance trips

Past times on `/api/trip` (checked on both servers 25 Oct, 7:10 PM): with `time` the answer is the planner's list from that time, services that have already left included, on both servers; neither filters out departures before now (only an answer for Now drops services that boarded over a minute ago). A `time` more than 30 min before now with no `date` means tomorrow on both servers (`tomorrow: true`). For an earlier time today the app sends `date` set to today, which only api.transportsydney.app honours (it echoes `date`); the first server ignores `date` and plans tomorrow, so the app never sends those requests there (it asks the new server directly and says "Earlier trips need a newer server" if that fails). No server change was needed.

The Trip Planner takes up to about 30 s for regional trips (Central to Albury or Dubbo). The first server gives up at 12 s (502 "Live data didn't answer"). The app treats a trip as long when a stop id's postcode (its first four digits) is outside Sydney, the Central Coast, Newcastle and the Hunter, the Illawarra, Macarthur and the Blue Mountains, or when the server in use answered 502 or not at all; it then asks `/api/trip?...&long=1` on api.transportsydney.app (45 s timeout, stops only when it answers 404). The server waits up to 35 s for the planner and keeps the answer in the Cache API for 120 s, keyed on from, to, time, arriveBy, count, acc and fare. The app keeps it 120 s too and refreshes the trip screen every 2 minutes for these trips.

## Feed on watched legs

Watch legs (`POST /api/watch`), share legs and trip card legs (`/api/live-activity`) carry `feed`: a key from the operator feeds (`nswtrains`, `ferry_mff`, `rb_<network>`), or `""` for the mode's usual feed. Anything else is dropped. Watches saved without it get it from the stop's departure board on the minute tick (legs leaving within the next hour or in the last two hours; after 3 looks without a match, `""`).

## Plan B in the morning check alert

When the morning check finds a cancellation, a delay over 5 min, a change that will be missed, or trackwork on the line, the alert ends with `Plan B: the 8:44am M1 from Epping, arrives 9:11am.` It is the earliest arriving journey from the ones already planned for the check that is not the same service, has no issue of its own and avoids a line under trackwork. When trackwork leaves none, one more planner call leaves out that mode (`excludedMeans=checkbox`, `exclMOT_n`). `planB` is also on the check's evaluation (`{text, leave, arrive, line, mode, from, planned, changes}`). Not for a platform change or a lift.

## Live traffic on bus legs

**Delays ahead (`ahead`, 25 Oct 2026).** Live bus, coach and school bus rows of `/api/departures` and bus legs of `/api/trip` and `/api/plan` carry `ahead`: the live predicted delays in minutes (one decimal) at each stop from the bus's next stop to this stop, in stop order, from the GTFS realtime trip update (null where a stop has no live time). Only when the vehicle has a position and the stop is ahead of it (the same rows that carry `stopsAway`), at least 3 stops have a live delay, and at most 24 values (the first two and last two always kept, the stops between sampled evenly). The app reads it for "Running slow in traffic" (`app/src/lib/busLiveCore.ts`, `slowInTraffic`: the smaller of the last two values minus the smaller of the first two is 3 or more, and the smaller of the last two is 3 or more). `/api/service` needs nothing new: its `stops` already carry `planned` and `estimated` from the bus's next stop on.


Bus and coach legs of `/api/trip` and `/api/plan` answers carry `traffic: {id, kind, text, major}` when an open Live Traffic NSW incident (`/v1/live/hazards/incident/open`) sits within 120 m of the leg's path. 4WD only tracks and notices not updated for 12 hours are left out unless marked major. The app shows "Crash on Victoria Road at Gladesville. Your 501 may run late."

## Quieter carriage

Vehicles carry `cars` (carriages reporting) and `quiet: {where, text}` (`where` is `front`, `middle`, `back` or `ends`) from per carriage occupancy: the GTFS realtime `multi_carriage_details` when sent, else the Transport for NSW consist extension (field 1007 on VehiclePosition: position, occupancy, quiet carriage). Sydney Trains, intercity and Metro send it; Metro sends position 0, so the order sent is used. A hint only when part of the train has few seats or less and another third is at least one level emptier. Removed with occupancy when the occupancy switch is off.

## Weekend trackwork push

On the minute tick, Thursday 6pm to 9pm Sydney time, with the `weekendTrackwork` and `morningCheck` switches on: each phone with an active morning check gets at most one push per weekend when a planned alert in the digest is active this weekend (Friday 8pm to Monday 3am) and lists a stop the check's trip passes (planned with `planShape` for Saturday at the check's time), or names a station on it. Up to 4 trips are looked at per minute; what was looked at and sent is kept in `meta` under `twk:<device>:<saturday>`.

## NSW TrainLink fares

Legs with `feed: "nswtrains"` (NSW TrainLink regional trains and coaches) are not priced as Opal: their `amount` is null and the fare is `unknown`. The app shows a booking link instead of an Opal estimate when every priced part is TrainLink.

## Departures from another time

`/api/departures` takes an optional `time` (`HHMM`, 24 hour Sydney time) and `date` (`YYYYMMDD`). Only api.transportsydney.app has it (25 Oct 2026); the first address ignores both and answers for now.

* No `time`: the board for now, exactly as before (services gone over 45 s ago are dropped, no `at`).
* `time` with no `date`: that time in the current service day, which runs 4am to 4am (at 1:30am, `2300` is the evening before and `0200` is tonight).
* `time` with `date`: that day at that time.
* Never before the start of the current service day (4am today, or yesterday's 4am when it is now before 4am): an earlier moment is answered from 4am with `at.clamped: true`. Never more than 14 days ahead.
* The Trip Planner's departure monitor is asked for that moment (`itdDate`, `itdTime`, departures). Every service it returns is kept, gone or not. Each row carries `departed`: `true` when it left over a minute ago (its live time when there is one, else its timetable time). A gone service keeps the live time and `delayMin` it left with when Transport for NSW still reports them, else `realtime: false` (timetable only).
* The answer carries `at: {date, time, clamped}`, the moment used. The app checks it: an answer without `at` is from a server without this parameter.
* A board for another moment records no delay samples (`obs`), since those are live times read close to departure.
* Edge cache as for every departures answer (15 s), keyed with `time` and `date`.

Example: `GET /api/departures?stop=213510&time=1815` (Strathfield from 6:15pm today).

**Stop list status (`stopsStatus`, 25 Oct 2026).** `/api/service` and `/api/status` now say how their stop list was found. `ok`: the list is current. `stale`: the trip planner could not answer just now, so this is the last list seen for that service in the past 20 minutes, with planned times only (live times still come from the realtime feed where it has them). `busy`: the planner could not answer and no recent list was kept, so `stops` is empty; ask again in a minute. `notFound`: the planner answered but had no such run (a timetable row the planner no longer lists). `none`: no stop list for another reason. `cancelled`: the trip update says the whole service is cancelled. The field is new; older clients ignore it, and an empty `stops` means what it always did.

**Train destinations (`destId`, 26 Oct 2026).** The departure board names a through train's destination right ("Hornsby via Gordon") but can carry the stop id of a station on the way: on 26 Oct T1 trains to Hornsby, Berowra and North Sydney came with Central's id. `/api/service` asked the trip planner for the stop list to that id, so the list ended at Central, or the planner offered a faster train or a change to reach Central and this run was not in its answer (`notFound`, shown as "Full stop list not available yet"). Now, for trains and metro, `destId` in `/api/departures` rows and in `/api/trip` legs is the id of the station named by `dest` or `towards` (the text before " via ", matched against the server's `/stations/train.json` and `/stations/metro.json`); a name that is not a station ("City Circle via Museum") keeps the id as sent. `/api/service` does the same when the request carries `dest`, and asks the trip planner for direct services only (no changes), so the run asked for is the one returned. Older apps send the corrected `destId` from the rows they already read, so they need no update.

**Train stop lists from the planner (26 Oct 2026).** Three more changes to `/api/service` for trains, measured the same morning. (1) Sydney Trains' realtime feed lists only the stops it has news for (an all stops South Coast train had 9 of its 41), so a train's stops from the requested stop onwards now always come from the trip planner when `stop`, `destId` and `planned` are sent; the feed's live clock times are put on those stops, its skipped stops are marked `skipped`, and the feed's stops before yours stay in the list (so `nextIndex`, `where` and `stopsAway` read as before). When the planner has no answer the feed's list is kept with `stopsStatus` `ok` and `source` `feed`. A metro list from the feed is replaced only when it ends before the destination station. (2) When the live planner answer does not include the run (a run that is late behind others, a faster service of another mode, two trains in the same minute), the timetable is asked once more for this mode only, six runs, no changes. (3) With a `trip` id the stop list is only ever that run's: the guess by line and departure time (within 90 s) is used only when the planner gives no run ids, because two T1 trains to Hornsby leave Blacktown in the same minute from platforms 1 and 5. The planner's run starts at the requested stop, so `mineIndex` is that stop even when the planner names another platform of the station. Still not found on 26 Oct: City Circle runs asked from Central (their destination is Central too), shown as `notFound`.

Why it was added: on 25 Oct 2026 around 11:20 PM most trains at Central, T1 at Chatswood, T2 and T5 at Liverpool and T4 at Town Hall and Redfern came back with empty stop lists. Train stop lists come from the trip planner (Sydney Trains trip updates carry delays, not clock times), and the Open Data service answers 429 ("quota or rate limit exceeded") when several planner questions arrive in the same second; the worker caught the error and sent an empty list. Reproduced at 11:37 PM: 20 parallel service requests gave 22 empty lists out of 40, and 12 parallel planner calls gave three 429 answers. Now the worker retries a 429 or 5xx answer up to three times (about 0.45 s, 0.9 s and 1.35 s apart, with jitter), shares one planner call between identical requests in the same isolate, keeps each list for a minute in memory and in the data centre's edge cache (Cache API, so other isolates reuse it), and falls back to the last list seen in the past 20 minutes. No D1 change. The key's per second limit is shared by every board and trip request, so a burst of many different trains in the same second can still see `busy` for a few of them (measured at 11:49 PM after the change, 20 parallel requests for 40 trains at 8 stations: 37 with stops, 1 `busy`, 2 `notFound`; before the change, 22 of 40 came back empty); the app asks again each minute. A higher rate limit is the data provider's to grant on request; none was requested.

What is upstream and not ours: during trackwork or a line closure (on 25 Oct trains did not run between Strathfield and Central from 9 PM), the realtime feed sends trips that start or end short of their timetable. A train still labelled Central can list stops only to Strathfield with Central skipped, and a train still on the Central board can list stops from Strathfield (so the station is not in its list). Cancelled trips have no stop list. The app shows the destination with "Full stop list not available yet" when the list does not include the station or is empty, "Not stopping at ..." for skipped stops, and "This service is cancelled" for a cancelled one; nothing is guessed.

## One mode on `/api/departures` (26 Oct 2026, transport-api 89566d44)

A departures answer is the 40 services the Trip Planner returns. At a station with trains and many bus stands a mixed list of 40 covers only about 15 minutes, and its buses fewer still: Strathfield Station (213510) at 7:51am on Monday 26 Oct listed 7:51 to 8:07, 11 buses, and the 8:10 415 to Chiswick from Stand G (213516) was past the end, although it ran (8:12, 2 min late).

* With `mode`, api.transportsydney.app asks the planner for that mode only (`excludedMeans=checkbox` and `exclMOT_n=1` for every other class: 1 train, 2 metro, 4 light rail, 5 bus, 7 coach, 9 ferry, 11 school bus). `bus` keeps coach and school bus, as the filter on the answer always did. The answer is 40 services of that mode: buses at Strathfield then reach about 50 minutes ahead (40 over 53 min, checked 8:04am), at Chatswood 45 min (18 before), at Hornsby 2 hours (39 min before).
* No `mode`, or an unknown one: unchanged. The edge cache already keys on `mode`.
* The first address (nsw-transport-bot.sites.tab.bot) only filters its mixed list of 40. The stop screen asks api.transportsydney.app directly for a one mode board and falls back to the server in use (`departuresFor` in app/src/lib/api.ts).
* Tests: backend/test/departures-mode.test.mjs. Rollback: transport-api 98fd6119.

**Speed (26 Oct 2026, g10).**
* Search copies. `/api/search`, `/api/places` and `/api/stations` copies are kept and served for 6 hours (`max-age=21600`), keyed on `q` in lower case with single spaces, so "Kings  Cross" and "kings cross" share one copy. A request with `refresh=1` still takes a copy only up to 5 seconds old.
* Stop index. `/stations/bus-stops.json` lists every bus and coach stop once as `[id, name]` (about 34,600 stops, 1.5 MB, 370 KB compressed), built by `backend/build.mjs` from `stations/bus/*.json`. `/api/search` answers from it and the station lists without a Trip Planner call when the answer is clear: a stop number, a station named or started by the query, or 3 or more matching stops. The app keeps the same lists and searches them on the phone as you type.
* Saved boards. Every live board for now (`/api/departures` without `time` or `date`) that is fetched is also saved in D1 (table `board_copies`, gzip, one row per stop and `mode`, at most one write per board per server copy every 20 s, rows older than a day deleted hourly). A plain open with no edge copy gets the saved board at once (up to 15 minutes old) with `x-edge-cache: saved`, its real `dataAt`, `now` set to the current time and services that left more than a minute ago taken out; the fresh board keeps going in the background and is stored. A request with `refresh=1` takes the saved board only when the fresh one fails (5xx). The app asks again about 2 s after any answer whose `dataAt` is more than 20 s old. Live copies are still 15 s.
* Warming. The minute tick keeps saved boards for 50 busy interchanges (train, metro, light rail and ferry, named in `WARM_HUBS`) and every stop a phone opened in the last 30 minutes, each refreshed when its saved board is 6 minutes old: at most 8 Trip Planner calls a minute (`WARM_PER_TICK`, 0.13 a second, under 10,000 a day), none from 1:00 to 4:30 AM, none while a server copy is busy (3 calls a second) and none once the day's count passes 40,000 (`WARM_DAY_CAP`). The tick's answer carries `warm` (`due`, `warmed`, `hubs`, `recent`, or `skipped`).
* Smart Placement is on (`[placement] mode = "smart"` in `wrangler.toml.template`): Cloudflare may run the worker next to the Transport for NSW hub and D1 in Sydney when that is faster.

## Timetable packs on the phone (26 Oct 2026)

`GET /api/pack?stop=ID` returns one stop's timetable (a station includes its platforms and stands) from the board
engine's timetable (docs/ENGINE.md), today's departures and tomorrow's, so the app can show a saved stop's departures
the moment it opens, with no signal too, and lay the live board on top when it arrives. Code: `backend/src/pack.js`.

```
{ "v": 1, "stop": { "id": "213510", "name": "Strathfield Station" }, "ver": 3, "builtAt": "...", "generatedAt": 1792977142932,
  "base": 1792933260, "until": 1793120400, "days": ["20261025", "20261026", "20261027"],
  "lines": [["T9", "train", "#D11F2F", "Train", "Hornsby to Gordon via City"]], "heads": ["Hornsby"],
  "plats": [["2135223", "Platform 3", "Strathfield Station Platform 3"]],
  "rows": [0, 0, 0, 0, 180, 0, 0, 0] }
```

* `rows` is flat, four numbers per departure in time order: seconds after the previous departure (the first after
  `base`, epoch seconds), then an index into `lines`, `heads` and `plats`. `until` (epoch seconds) is the end of the last
  service day covered; the app asks again before then.
* Lines, headsigns and platforms are the ones the engine's boards show for the same timetable row (tested in
  `backend/test/pack.test.mjs`).
* 200 with `cache-control: public, max-age=3600`; shared through Cloudflare's cache per stop and Sydney day for 6 hours.
  404 when the timetable has no such stop (some private ferries and coaches): the app keeps no pack and uses the live
  board as before. 503 when the timetable is not loaded. 400 without a valid `stop`.

## Board engine answers on `/api/departures` (26 Oct 2026, g14)

* `engine=1` asks the board engine (docs/ENGINE.md); `ENGINE_BOARDS=on` would do it for every request (off).
  An engine board carries `engine: { builtAt, feeds, shard }`, `live: { feedAt, liveCount, total }` and a weak
  `ETag`; sending it back in `If-None-Match` answers 304 with no body.
* A stop where the Trip Planner lists lines our timetable lacks (`engine.gap` inside the engine) is answered by the
  Trip Planner.
* **Outage fallback:** when the Trip Planner refuses or fails and no copy is kept or saved, the answer is the engine's
  board as timetable times: `source: "timetable"`, `fallback: "planner-unavailable"`, every row `realtime: false`,
  `estimated: null`, `status.key: "scheduled"` (a row may stay live only from a feed copy under 60 s old, marked
  `liveSource: "feed"`), and the first alert is "Live times unavailable, showing timetable times". `cache-control:
  no-store`; never kept as a copy, so the next planner answer replaces it. Not for `time`/`date` boards or
  `format=text` (which still says the live data didn't answer).
* Every live row (engine and Trip Planner boards) carries `liveAt`: the time in ms its live time was read (the feed
  copy, or the planner answer). Timetable rows have `liveAt: null`.

## Live board push `/api/live` (26 Oct 2026, g14, off)

`GET /api/live?stop=ID[&mode=]` with `Upgrade: websocket`, answered by the board's shard when `ENGINE_PUSH` is `on`
(404 otherwise; 426 without the upgrade; 400 for a bad stop id). Messages from the server: first
`{"type":"board","board":{...}}` (the engine board), then on each rebuild of that board
`{"type":"diff","base":<builtAt the phone holds>,"builtAt":...,"head":{board without items},"rows":{key: row},"gone":[keys],"order":[keys]?}`
with key `tripId|stopId|planned` (`order` only when the order changed). A phone whose board is not at `base` sends
`full` and gets the whole board; `ping` answers `pong`. The HTTP board stays the fallback. App: `useBoardPush`
(`app/src/lib/boardPush.ts`), off unless remote config sets `flags.livePush` to true.

Boards on the Trip Planner path (26 Oct, g17, off): with `LIVE_PUSH` `on` the same address is answered by a `LiveHub`
object for that stop and mode (`backend/src/livehub.js`), unless `ENGINE_PUSH` is on and the engine serves that
stop's boards (then the shard, as above). The hub asks for the board the way a polling phone does (`refresh=1`: the
edge copy when it is at most 5 s old, else one shared Trip Planner call that is stored for everyone; when that fails, a
kept copy or the labelled engine timetable board), sends `{"type":"board","board":{...}}` on connect with `dataAt`
(when the copy was made) and `now` (server clock), and sends it again only when the rows, alerts or stop changed. It
asks again just after the copy it got is 15 s old (`LIVE_TICK_MS`), and stops asking when no phone is on the stop.
No socket (503) when no board could be had; the phone keeps polling. `full` is answered at most once in 10 s per
socket; `ping` answers `pong` without waking the object.

Limits for both kinds of socket: 30 opens a minute per address (`/api/live` rate rule), 4 sockets per address on one
object (429), 2,000 sockets per object (503), and every socket is closed with code 4000 (`renew`) after 10 minutes so a
phone that went away without closing stops costing anything (a phone still on the screen opens a new one).

## Request numbers (26 Oct 2026, g17)

Every `/api` request writes one JSON line to the Worker's logs (`reqLog` in `src/worker.js`):
`{"t":"req","p":"/api/departures","m":"GET","s":200,"ms":84,"up":0,"un":0,"c":"hit","k":"app","colo":"SYD"}` with
`ms` the time to the answer, `up` and `un` the time spent on and the number of NSW calls (Trip Planner and realtime
feeds) made for that request, `c` the copy tag (`hit`, `stale`, `miss`, `shared`, `saved`, or `-`), `k` `app` when the
request carries a profile (the phone app) and `ext` otherwise (Watch, widgets, web), and `test: 1` for load test
traffic. The path only, never the query or an address. Workers Logs keeps one request in 10 for 3 days
(`[observability]` in `wrangler.toml.template`); `wrangler tail transport-api --format json` sees every line. `REQ_LOG`
`off` stops the lines.

Watch and widget asks (no profile, not a refresh) for `/api/departures` and `/api/trip` take a kept copy (up to 2 min
old) at once instead of waiting up to 700 ms for the fresh answer, which is stored behind it for the next ask
(DIAGNOSIS_LAG.md item 4, server part). The Watch's trip reuses the phone's recent answer for the same from and to
through the trip copies (g16, `trip:FROM>TO`).

## When Transport for NSW refuses: timetable trips, nearby and honest errors (26 Oct 2026, g16)

Written after Bidur's screenshots at 2:52 PM, with the NSW key over its daily limit: Home's commute card said "No more
services today", Nearby said "Something went wrong (502)" and Ask said "Check your signal" on 5G. Code:
`backend/src/ttplan.js` (appended to worker.js after pack.js), tests `backend/test/outage-trips.test.mjs`.

* `GET /api/trip` when the Trip Planner refuses (403, 429), fails (5xx) or times out: trips from the board engine's
  timetable, direct on one service or with one change at a station both services call at (trains use the timetable's
  stop order; other modes try the big interchanges nearest the straight line). 200 with the usual trip shape plus
  `source: "timetable"`, `fallback: "planner-unavailable"` and `alerts: [{ title: "Live trips unavailable, showing
  timetable times", priority: "high" }]`; every leg `realtime: false`, `estimated: null`, `status.key: "scheduled"`,
  `source: "timetable"`, and the first leg of each trip carries the same alert (so phones that show only leg alerts
  label it). No `fare`: Opal fares need the distance along the route. Never kept as a copy (`x-stand-in: timetable`).
  Not for timed trips with step free on (`acc=1`), the last service or the server's own checks (morning check, push
  alerts), which keep the error.
* No timetable trip found: `503 { kind: "error", unavailable: true, upstream: true, error, text }` with
  "Live trips are unavailable right now because Transport for NSW isn't answering. Try again soon." Never an empty
  list. A Trip Planner time out with nothing found is `504` (the app's long trip path).
* Known gaps: the timetable keeps no row for a trip's last stop (nobody boards there), so a trip that ends at the
  destination (Manly Wharf on the F1, a bus terminus) is found only with a change before it; walks between two
  different stops are not planned.
* Every error: `{ kind: "error", text, error, upstream, unavailable }`, `error` and `text` the same words. An upstream
  failure (status 503) says Transport for NSW's live data is not available; our own failure (502) says so. No bare
  status codes.
* `GET /api/nearby?lat&lon`: from the timetable's stop list in the engine (no Trip Planner call), stops within 800 m,
  platforms and stands as their station, stop pairs ("G" parents) as their own stops, nearest first, 8 at most:
  `{ kind: "nearby", stops: [{ id, name, distance }] }`. The Trip Planner only when the engine is not there.
* `GET /api/departures?format=text` when the Trip Planner fails: the same labelled timetable board as the JSON answer.
* `GET /api/ask`: trips and boards as above when the Trip Planner is down, stop names from our own index; the reply
  starts "Live times are unavailable right now because Transport for NSW isn't answering, so these are timetable
  times." An answer that cannot be given says "Transport for NSW's live data isn't answering right now ... It's not your
  connection."
* Trip copies (DIAGNOSIS_LAG.md item 3): the last live answer of a plain trip (no time, day, arrive by, step free,
  modes or long) is saved per from and to pair in `board_copies` (key `trip:FROM>TO`, gzip, up to 15 minutes, only
  while 2 of its trips are still to leave, never a timetable answer, never warmed by the minute tick). A first open
  gets it at once with its age (`dataAt`, `x-edge-cache: saved`) while the fresh answer loads behind it.
* Engine object paths (worker only): `GET /ttplan?from&to&count[&at | &day&time][&arriveBy=1]` and
  `GET /nearby?lat&lon[&radius]`. After a deploy, `POST /api/engine/load/restart` so the object runs the new code.

## Our own trip planner `/api/raptor` (26 Oct 2026, g18, OWN_PLANNER off)

All with `x-admin-key` set to the engine load key (or the admin key); 403 otherwise, 503 when the PLANNER object is not
bound.

* `GET /api/raptor/plan?from=ID&to=ID[&day=YYYYMMDD&time=HHMM][&arriveBy=1][&count=1..8]` our planner's answer:
  `{ day, ver, searches, ms, error, journeys: [{ leave, board, arrive, durationMin, changes, risk, legs, source: "own" }] }`.
  `from` and `to` are stop ids (a station means all its platforms and stands) or points `lon:lat:EPSG:4326`. Legs are
  in the `/api/trip` leg shape with `source: "own"`, `realtime: false` (live times are added by `/api/trip`). Without
  day and time: now in Sydney. A day the loaded pack does not hold answers `journeys: []` and `error: "day"`.
* `GET /api/raptor/status[?open=1]` the flag and each replica's pack (`ver`, `day`, `builtAt`, `counts`, searches and
  their total ms).
* `POST /api/raptor/load/begin?ver=N`, `POST /api/raptor/load/part?ver=N&part=NAME&i=K` (body: up to 1 MB of the part),
  `POST /api/raptor/load/commit?ver=N` load a pack into the first object; commit checks every part and switches in one
  step (a broken pack is refused and the old one stays). `tools/load_planner.mjs` does all of it.
* `POST /api/raptor/replicas` makes replicas 1..`OWN_PLANNER_REPLICAS`-1 copy the pack from the first object.

`/api/trip` with `OWN_PLANNER` = `on` asks our planner first (not for step free trips, via, leaving out modes or long
trips) and, when it has trips, answers from them with no Trip Planner call; legs get live times from the feeds as
before. No answer (another day, an unknown stop, over 4 s) asks the Trip Planner as before.
