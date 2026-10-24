# API

Base URL: https://nsw-transport-bot.sites.tab.bot

All endpoints return JSON unless noted. Most read endpoints also take `format=text` for a short plain text answer (used for messaging). CORS is open (`access-control-allow-origin: *`). Updated 24 Oct 2026.

## Common parameters

| Parameter | Meaning |
| --- | --- |
| `profile` | The install's profile id. Each app install makes a random one. Saved trips, commutes and searches belong to a profile. Defaults to the legacy owner profile when missing |
| `device` | The device id used for watches and push |
| `lat`, `lon` | Location, when the client shares it |
| `format=text` | Plain text answer instead of JSON |

Errors: `400` for bad input with an `error` message, `403` for a wrong key, `404` for unknown routes or items, `405` for a wrong method, `502` with `kind: "error"` when Transport for NSW does not answer.

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
| `/api/health` | GET | none | Feed fetch stats, cached realtime feeds and their age, storage status |
| `/api/usage` | GET | none | Today's upstream calls against the 60,000 budget, observation count, last tick time |
| `/api/obs` | GET | `route`, `stop`, `day`, `limit` (up to 1000) | Recorded live observations |

## Keyed endpoints

These need `key=TICK_KEY` or `key=ADMIN_KEY`. The keys are secrets (see [Security](SECURITY.md)).

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
