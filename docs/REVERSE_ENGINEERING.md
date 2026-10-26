# Reverse engineering and break it pass (26 Oct 2026, g28)

The app and its server treated as a stranger's code: run locally against a fake Transport for NSW, hit with hostile
input and broken upstream answers, the shipped bundle read the way an attacker would. Every defect found has a failing
test, a minimal fix and a commit. Nothing here was deployed or published: the server fixes go out with the next
transport-api deploy (see "Needs a deploy" below), and there is no app change.

## How to run it again

* `node backend/tools/local-dev.mjs /tmp/tsl-local` builds the worker into a work dir outside the repo with the Transport
  for NSW address swapped for `http://127.0.0.1:8799`, writes a local `wrangler.toml` (no routes, no account, local D1,
  no email) and placeholder secrets, applies the D1 migrations and starts `wrangler dev` on 8787 plus the fake on 8799.
  Needs wrangler 4 (`npm i wrangler@4` in the work dir). No production key, no network, no cost.
* `backend/tools/fake-nsw.mjs`: stop finder, departure monitor, trip, coord, add info and empty GTFS realtime feeds.
  `GET /__mode?set=NAME` switches it to `429`, `403quota`, `500`, `502html` (a 200 HTML page), `empty`, `nulljson`,
  `malformed` (cut off JSON), `weird` (null entries), `huge` (5,000 departures, 300 journeys), `slow` (20 s),
  `slowfeed` (8 s realtime feeds); `GET /__mode` also lists the last 20 calls the worker made.
* `node backend/tools/local-burst.mjs http://127.0.0.1:8787 10`: 10 identical first opens of a board, a trip, nearby and
  alerts at once; exits 1 on anything but 200. Refuses any host but 127.0.0.1 or localhost.

## What was run

* The API under `wrangler dev` (the same workerd runtime as production) against the fake.
* A hostile input sweep of all 68 `/api` routes: 20,984 requests with injection strings, 5,000 character values,
  markup, NaN and 1e309, `__proto__` and `constructor`, unicode controls, empty and missing params, across 32 param
  names. Before the fixes: 200 11,445, 400 6,427, 404 2,298, 503 577 (no timetable loaded locally), 500 109,
  414 68, 403 26, 502 18, 405 16. Every 500 and 502 is a finding below.
* Bursts of identical requests (local only, 10 at once).
* Every upstream mode above on boards, trips, search, nearby, alerts, trackwork and lifts.
* A log check: requests carrying an install ID, a position and an Ask question; none of the three appeared in the
  local request log (`reqLog` keeps the path only).
* The shipped bundle: `expo export --platform ios --no-bytecode` from main (3.9 MB of JS), searched for keys, tokens,
  hosts, phone numbers, emails, admin routes and debug hooks.
* Not repeated here: app journeys in the web build at 390x844 and 430x932. Worker g23 drove every screen and button
  with its own mock API (moving clock, NSW down and slow) at the same time; see docs/BUTTON_CHECK.md.

## Architecture as found

Server (`backend/`): one Worker, `transport-api`, built by `backend/build.mjs` as one script: `src/worker.js` (8,720
lines, every route) plus `engine.js`, `pack.js`, `ttplan.js`, `raptor.js`, `tripalerts.js` and `livehub.js` appended in
that order (build.mjs:47 to 60). Functions from later files are reached with `typeof x === "function"` guards, so a test
that loads `worker.js` alone runs without them (the outage path is then off). Bindings: D1 `DB`, static `ASSETS`
(stations, stop shards, the live trip page), Durable Objects `ENGINE`, `SHARDS`, `LIVE`, `PLANNER`; a cron every minute.
Every request goes `fetch` > `reqLogged` (worker.js:8580, one JSON line, path only) > `edgeFetch` (worker.js:8480, edge
cache, one upstream answer per key per copy, kept copies, budget) > `handleRequest` (the routes). Input is checked once
in `badInput` (worker.js:8430) before any upstream call. Trip Planner calls go through `tp` (worker.js:127: pacing,
retries over the limit), realtime feeds through `loadFeed` (worker.js:580, 15 s per copy plus Cloudflare's fetch cache).
Upstream failures that `ttUpstreamDown` (ttplan.js:212) recognises get the timetable board or trips; anything else is
"Something went wrong on our side" (worker.js:8172).

App (`app/`): Expo Router screens in `src/app`, logic in `src/lib` (`*Core.ts` files are pure and tested by node).
Every read goes through `req` in `src/lib/api.ts` (one request in flight per address, 4 s reuse) to
`https://api.transportsydney.app`. Device state is AsyncStorage only (saved trips under `store`, the install ID under
`profile`, the push token, Ask history, notice and alert markers); the install ID is 12 random bytes from a secure source
with no weak fallback (src/lib/device.ts:21). Requests carry the install ID as `profile` or `device` in the query or body,
no other header.

## Findings, by user impact

| # | Finding | Where | Status |
|---|---|---|---|
| 1 | A request awaited a promise another request had started (the shared board answer, realtime feeds, hazards, stop shards, planner legs, lift outages). Workers does not allow that: the second request is cancelled as hung, or its answer is built in the first request's context and fails with "Cannot perform I/O on behalf of a different request". On wrangler dev 9 of 10 identical first opens of a board answered 500, and the sweep's 109 500s were all this (`/api/plan`, `/api/parking`, `/api/nearby`, `/api/alerts`). In production this is a burst of phones opening the same stop in one server copy, the case the shared answer was built for. | worker.js:556 to 577 (`sharedJob`, `waitJob`, `joinJob`), `edgeFetch` worker.js:8480, `loadFeed` 580, `loadShard` 659, `trafficHazards` 1112, `plannerLeg` 1716, `liftOutages` 6994, livehub.js:97 | Fixed `491d19c`: a shared answer is kept as plain data and other requests poll it on their own timers (5 ms doubling to 100 ms, up to 25 s). After: 10 of 10 at 200 on every route. Test `cross-request.test.mjs` |
| 2 | A realtime feed fetch slower than the 2.5 s a board waits outlived the request that started it, the runtime dropped it, and its never settled promise stayed in `feedMem` for the life of the server copy: no fresh realtime for that feed again and 2.5 s added to every later board in that copy (measured on wrangler dev: one 8 s feed, then 0 feed fetches and 2.55 s per board minutes later). | worker.js:580 (`loadFeed`), 13 (`FEED_JOB_MAX_MS`) | Fixed `491d19c`: the fetch is kept with the request's `waitUntil` (`reqKeep`, worker.js:8577), has its own 18 s timeout, and a fetch still running after 20 s is asked again. Test `feed-lost.test.mjs` |
| 3 | Transport for NSW answering 200 with something that is not JSON (an HTML maintenance or gateway page, `null`, a cut off body) was parsed as an answer. The error did not look like an outage, so boards and trips said "Something went wrong on our side" (502) and the timetable board did not stand in. | worker.js:145 (`tp`) | Fixed `93548fc`: such an answer counts as the hub answering 502. After: 503 with `upstream: true`, "Live data from Transport for NSW isn't available right now", and the timetable board when one is loaded; a kept copy is still served first. Test `upstream-not-json.test.mjs` |
| 4 | Words from a request used as keys in plain tables read `Object.prototype`: `/api/search?q=constructor` and `/api/service?mode=__proto__` (also `/api/status`) answered 502, and `modes=constructor,train` kept a function as a mode. | worker.js:72 (`own`), `feedKey` 82, `feedKeys` 92, `tripModesParse` 1189, `idxKey` 8211 | Fixed `5641ad8`. Test `proto-keys.test.mjs` |
| 5 | `/api/predict` with a `planned` that is not a time threw "Invalid time value" (502). | worker.js:8075 | Fixed `5641ad8`: 400 "planned must be a date and time" |
| 6 | Upstream answers with null entries (`stopEvents: [null, ...]`, a journey with `legs: null`) fail the whole board or trip with 502 instead of skipping the bad row. Transport for NSW has not been seen sending this. | `departures` worker.js:983, trip parsing | Open, low |
| 7 | Over the hub's limit with no kept copy, a board or trip waits about 6 s (4 retries) before its 503. By design (docs/SCALING.md), noted because the phone shows a spinner for those 6 s. | worker.js:161 | By design |
| 8 | The bundle carries no keys, tokens or secrets, no admin routes (`/api/admin`, `x-admin-key`, load test key), no owner phone number and no install ID. Hosts in it: our API and site, transportnsw.info, maps.apple.com, google.com, exp.host (push tokens), fintex.au, library doc links. `localhost:8081` and `localhost:3000` are inside Expo and React Native dev code. The only test style call is `/api/push/test`, the user facing "Send a test notification" in Settings, which sends only to the caller's own device. 10 digit numbers that look like phones are Reanimated and colour constants. | `expo export` of main | Clean |
| 9 | Request log and errors: no install ID, position or Ask text in the request lines; `console.error("api error", ...)` (worker.js:8161) keeps the error message only. | worker.js:8580 | Clean |
| 10 | Huge upstream answers (5,000 departures, 300 journeys, 5,000 stop finder hits) answered in 0.13 s or less; 429, 403 quota and 5xx all answer 503 with `upstream: true` and the right words, or the kept copy (a board opened 20 s earlier stayed 200 while the fake answered 500). | | Clean |

## Where the docs disagree with the code

* The g28 brief and the worker guides spoke of a fake Transport for NSW harness in the repo; there was none (each
  worker built its own in its task folder). It is now `backend/tools/fake-nsw.mjs` with `local-dev.mjs`.
* docs/SCALING.md item 2 and docs/FEATURES.md ("a burst for one stop waits for that one answer") describe the shared
  answer as phones waiting on one promise; that was finding 1. The behaviour they describe is now true; SCALING.md says how.
* docs/API.md errors listed `502` for "Transport for NSW does not answer"; the code answers `503` with `upstream: true`
  for an outage and `502` only for our own faults. Fixed in API.md.

## Needs a deploy

Findings 1 to 5 are server fixes on main, not deployed. They go out with the next transport-api deploy per
docs/RUNBOOK.md (no D1 migration, no new binding, no new secret, no flag). After the deploy: `/api/departures` for one
stop opened by several phones at once answers 200 for all, and `/api/health` keeps showing fresh feed ages.

## Not verified

* Finding 1 and 2 were reproduced on wrangler dev, not seen in production logs: how often production requests share
  one server copy at the same moment is not measured. Production logs keep one request in ten.
* Nothing here has been seen on a phone; there is no app change.
