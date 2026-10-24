# API

Base URL: https://nsw-transport-bot.sites.tab.bot

All endpoints return JSON unless noted. Most read endpoints also take `format=text` for a short plain text answer (used for messaging). CORS is open (`access-control-allow-origin: *`). Updated 24 Oct 2026. Shared live answers (`departures`, `trip`, `plan`, `service`, `status`, `alerts`, `stations`, `search`, `nearby`, `station`, `parking`, `topup`, `lifts`) are cached at the edge for 15 seconds, keyed without `profile` and `device`; a cached answer carries `x-edge-cache: hit`. Every HTML page is served by the worker with HSTS, a Content Security Policy with `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and COOP. Admin endpoints and `/api/tick` read their key only from the `x-admin-key` header; a `?key=` in the address is ignored.

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
| `/api/search` | GET | `q` (2 or more characters) | `items`: up to 8 stops with `id`, `name`, `modes` |
| `/api/nearby` | GET | `lat`, `lon` | `stops` near the point |
| `/api/stations` | GET | `mode` = `train`, `metro`, `ferry`, `lightrail` or `bus`; for bus, optional `route` (for example `461X`) | Station list A to Z; for bus, the route list or one route's directions and stops. Cached for a day |

Example: `/api/ask?q=campsie%20to%20newcastle%20via%20chatswood&format=text`

## Boards, trips and services

| Endpoint | Method | Parameters | Returns |
| --- | --- | --- | --- |
| `/api/departures` | GET | `stop` (stop id), `mode` (optional filter) | `kind: "departures"` with live and scheduled rows, platforms, alerts |
| `/api/trip` | GET | `from`, `to` (stop ids), `fromName`, `toName`, `time`, `arriveBy=1`, `count` (default 5), `refresh=1` to skip logging | `kind: "trip"` with journeys, legs, change times, live delays |
| `/api/plan` | GET | `legs` (JSON list of 1 to 6 legs), `time`, `count` (1 to 8, default 5), `all=1` for all services | `kind: "trip"` with each first leg service paired with the first catchable connection on every next leg, total time, arrival and warnings (tight or missed changes) |
| `/api/service` | GET | `trip`, `mode`, `line`, `stop`, `destId`, `planned`, `to`, `stopName`, `dest`, `color` | One service: live vehicle position, stop list with live times, crowding |
| `/api/status` | GET | Same as `/api/service` | The service without the stop list and path, plus a `text` summary. Also used as a health check |
| `/api/alerts` | GET | `q` (for example `T1`, `buses`) | `kind: "alerts"` |
| `/api/app/config` | GET | `platform` (`ios`, default) | Remote config for the phone apps, see below |
| `/api/predict` | GET | `line`, `stop`, `planned` | `prediction`: usual delay from recorded history, or null when there are fewer than 5 trips |

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
| `/api/history/delete` | POST | `{profile, device, scope}`. `scope` is `history` (trip searches and dismissed commute suggestions; suggestions are worked out from searches, so they go too) or `all` (also saved trips, commutes, watches, alerts, and for this `device` its push sign ups, Expo tokens, live trip shares and morning checks). A valid `profile` is required; searches this `device` made under any older profile id are deleted too. Rate limited to 10 a client address per 10 minutes | `{ok, scope, deleted: {searches, dismissed, saved, commutes, watches, alerts, push, shares, morningChecks, morningCheckLog}}` (row counts) |

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
| `/api/health` | GET | `x-admin-key` header | Feed fetch stats, cached realtime feeds and their age, storage status. `403` without the key |
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

Trip results: `/api/trip`, `/api/plan`, `/api/next` and `/api/ask` take `acc=1` for step free trips only (the Trip Planner `wheelchair=on` option; the answer then has `accessible: true`). Every transit leg gets `access: {from, to}`, each `{id, level, lift, outage, outages}` for the station where you board and get off. When the first leg starts at a Park and Ride station the answer has `parking: {station, carparks, source}`. Ask trip replies add lines for step free only, a lift outage on the trip, and the Park and Ride spaces.

Ask: parking, lift and top up questions answer with `kind: "facility"`, a `reply`, and cards of type `parking` (`title`, `items` as above, `source`) or `station` (`station`: `id`, `name`, `access`, `ticket`, `outages`, `parking`, `source`). Clients that do not know these card types can show the reply text alone.

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
* `from`, `to`: stop or station ids from `/api/search` or `/api/stations`, with the names to show.
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

* `flags`: `false` hides a feature (Ask, Park and Ride, Opal machines on More; Start trip; Share trip on the live trip; Remind me every weekday; Nearby on Home; `morningCheck` the Morning check screen; `platformAlerts` the platform change alert option; `occupancy` crowding labels; `liftAwareRouting` the lift aware note on Accessible trips).
* `kill`: feature name to the words shown in its place, for example `{"liveTrip": "Live trips are paused for a moment."}`. A killed feature is hidden even if its flag is true.
* `copy`: `welcomeTitle` (Home welcome) and `startTripFooter` (under Start trip). Empty or missing uses the text in the app.
* `tabs`: tab order. Unknown keys are ignored and a missing tab is added at the end, so no tab can disappear.
* `timing`: `liveRefreshSec` (5 to 120), `alertRepeatWindowMin` (how long the same alert is held back, 1 to 120), `sameRunToleranceSec` (how far a service's boarding time may be from the planned one and still count as the same run, 30 to 600), `configRefreshMin`. Values outside the range are clamped in the app.

* `api_base` (iPhone): moves the app, its widgets and the Live Activity to another server address without a build. Send it inside `copy` (`{"copy": {"api_base": "https://api.fintex.au"}}`), which the server passes through today; a top level `api_base` is read too. The app takes it only when it is https, has no user name, port or query, and its host is the host in use now or on a domain in `APIBase.allowedDomains` (`ios-native/Sources/TransportKit/APIBase.swift`, the one place the address and the list are written; the list holds a placeholder until the new domain is chosen, then it is a one line change and a build). A bad value is ignored and the last good one stays; removing it goes back to the address built into the app.

Change it without a build or a deploy: `POST /api/app/config?platform=ios` with the `x-admin-key` header and a JSON object holding only the parts to change. It is stored in D1 (`app_config`) and merged over the defaults. Send `{}` to go back to the defaults.

Server side switches: the same POST with `platform=server` turns the server's part of a feature off for every app at once, within a minute and with no deploy. The server reads `flags` (or a `kill` entry) for `morningCheck` (no morning checks run), `platformAlerts` (no platform change alerts), `occupancy` (no occupancy in any answer) and `liftAwareRouting` (`acc=1` is only step free, no lift outage ranking). For example `{"flags": {"morningCheck": false}}`. The stored body replaces the previous one for that platform, so send every switch you want off.
