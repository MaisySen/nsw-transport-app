# Trip flow 2 on the server

Phase 2 of [TRIP_FLOW_SPEC.md](TRIP_FLOW_SPEC.md) (branch tripflow-sim), server side. Branch server-tripflow from server-211-rc 1d3fa14, 31 Oct 2026. Not deployed.

## When it runs

Only for a registration that carries `tripFlow: 2` (the new app sends it, with `c24`, in every trip, get off and Live Activity registration body) AND while the server switch `tripflow2` is on (`platform=server` flags, off unless `true`). Every other phone, and every phone while the switch is off, keeps the old watch and alert path: the new code is one block in `backend/src/worker.js` between `// ---- trip flow 2 start` and `// ---- trip flow 2 end`, plus small hooks that only act for those watches.

One thing is NOT behind the switch: the generated LIVECARD block is one copy of the app's card code, and it now comes from tripflow-p2 4162ece (liveCalc.ts and tripCard.ts rebuilt on tripState, plus the app changes since server-211-rc's copy). The old Live Activity card pass (`laCardFor`, every phone with a card today) calls the same `computeLive` and `cardFor`, so after a deploy those cards follow the phase 2 rules too: times from the one live time, a leg on board only on live evidence or when seen riding before (never by the clock), the honest stale date. The backend suite passes (one live-stops expectation changed for it), but this changes what build 210 and 211 cards show. If that must wait for the switch, the old card pass needs its own copy of the 211-rc card code (not done: a choice for Bidur).

## One trip state (I6)

Every decision is the app's own trip state, `app/src/lib/tripState.ts`, inlined into `LIVECARD` by `backend/tools/gen-livecard.mjs` (tripState in its own scope, then liveCalc.ts and tripCard.ts on it): the phase from the live train (`tripStep`), the calm alerts and their words, sounds, moment keys and expiry, the Get off now target, when to read (`serverPollMs`), and the card's times and words (`tripRender`, `tripLegTimes`). The server's part (`tfRead`, `tfState`) only turns the live data into that state's plan and reading:

* the trip update feed per leg: the boarding stop, the stop before yours and your stop, matched by stop id or by station name (a different platform id and stops with no coordinates still match, G18); a stop event with only a delay carries the run's delay (also behind the first stop the feed has news for, G20); the vehicle against those stops;
* the departure board for the leg about to be boarded and the next leg of a change: live time, platform, cancellation and the next services (G19, G21, G22);
* the services the trip switched to after a cancellation or a missed change keep a fixed place in the plan (`st.tfAlts`).

`tfCard` maps the render model into the build 211 card content state (no new build), with the phone card's own words (`cardFor`, `legNoteFor`): the countdown always to the live time, "Due now", the live platform ("Plat 7, was 4"), "Cancelled. No next service found yet" with no countdown, the stale ladder words, and "updated" from the reading's own time (G25). The stale date is the reading plus 2 min and no later than the live departure while waiting or the live arrival while riding, so a card that misses a push shows its time and never 0:00 (G3).

## Reads and the timer

* Read every 30 s, and every 15 s once the live arrival is under 5 min away (`serverPollMs`), on the clock's 15 s or 30 s grid.
* One Get off now timer per trip at the live arrival less 30 s, sent 2 s early for delivery (`TRIP_RULES.SERVER_DELIVERY`), moved on every reading. At that moment the feed is read fresh (a copy under 5 s old, past the shared 15 s copy), so a jump in the last seconds moves it (S17a to S17d).
* A named moment between reads (a live time coming or passing: Due, left, the heads-up window, the live arrival) steps the trip on the reading it already has, the way the phone does between its reads.
* The cron (every minute) runs `tfPass` beside the minute tick and the card passes. One run holds reads and timers for up to 62 s and then the next run takes over; the moment keys (`watch_sent`, `tf:<moment>`) stop anything ringing twice where two runs overlap. The waits cost no CPU and no request. No Durable Object.
* Why 15 s and 5 s: 15 s is the shared feed copy's age (`FEED_TTL_MS`), so reading more often near the stop only rereads the same copy; the 5 s fresh read happens once per trip, at the Get off now moment, which is the only moment a few seconds change what rings. The simulator plays the same numbers (S17a to S17d jump inside the last minute and pass).

## Alerts

* G38 heads-up and G37 arrival from the live train; G40 once per moment key; G33 expiry: heads-up at the live arrival, Get off now at the arrival plus 30 s, arrival at plus 2 min (Apple `apns-expiration`, Expo `ttl`).
* Sounds: Kylie `getoff_soon` for the heads-up and `getoff_now` for Get off now (both in build 211). The Kylie arrival clip is not in build 211: the arrival rings with the default sound until build 212 or the sound folder copy.
* G34: a train already late at Start trip gets its delay alert at once; G35: no "Watching the ..." note at Start trip.
* G32 catch-up on open (`/api/watches?since=`): only alerts under 90 s old that have not expired, marked `silent: true` (never a sound or speech), and none the card push already carried.
* Passive ("quiet") alerts go with no sound at the passive interruption level.

## Routes (G14, G16)

* Get off is accepted only with a working route: an Expo token not marked dead, the phone's own Apple token (only with `apnsAlerts` on) or an open Live Activity. With `tripflow2` on, a register again no longer revives a token marked dead.
* `apnsAlerts` stays OFF. With it off or failing, an alert that reached no phone rides the Live Activity push (an `aps.alert` with its sound on the card update, S16b), and the catch-up does not show it again.

## Live Activity pushes

One push on every change (target, delay, platform, phase, stale step, words) and at least every 60 s while live; priority 10 for must-see changes (heads-up, Get off now, at stop, arrival, delay, platform, cancellation, missed change, the end) and when carrying an alert, priority 5 for the refresh. A card with no watch behind it (the app registered only the card) is drawn by `tfCardAlone` from one reading, with no alerts.

## Tests

* `backend/test/tripflow-sim.test.mjs` (35 tests): every simulator case with a server (30, by id) through the real routes (`/api/push/expo`, `/api/live-activity`, `/api/watch`, `/api/watches`) and `tfPass`, against `tools/fake-nsw.mjs` mode `case` (the case's feed as GTFS realtime and boards built by `tools/case-feed.mjs`; no NSW call). Each alert: same title, body and sound within 5 s, nothing extra. Each card push: no 0:00, no stale date past its own target, no banned words, the countdown equal to the simulator's live departure, no gap over 61 s. Plus G29 (24 hour words), the switch off and an old app keeping the old path, and G18 matching by name.
* `node backend/tools/simtrip.mjs [ids] [-v]` prints the same per case.
* Failing first on server-211-rc (the test file and tools copied on): 32 of 35 fail (the 3 that pass are the old path guards); the old server matches 0 of the simulator's 109 alerts across the 30 cases (in S2 it sends "Watching the ..." and no delay alert at Start trip, no heads-up, Get off now 28 s early from its 90 s rule, and its own arrival words). The old path runs its minute tick there with the card passes left out, so its card pushes are not compared.

## Cost

Measured in the server path runs (fake NSW, one phone, `caught.nsw` in simtrip): S2, one leg, 17 min from Start trip: 44 trip update reads, 44 vehicle position reads, 18 departure board reads; X, two legs: 83, 83 and 66. In production the two feeds are one shared copy per 15 s for every trip (`FEED_TTL_MS`), so the extra cost per trip is the board reads (the leg about to be boarded until it leaves, and the next leg of a change for the whole first leg: one per read, so 2 a minute, 4 a minute near the stop) plus one fresh feed read at each Get off now moment. Apple pushes: 23 to 63 per trip in the cases (one a minute at least, more on changes). D1: one watch row write per step (every 30 s, 15 s near the stop). Worker CPU: small; the cron run waits up to 62 s of wall time per minute. A stop's board read serves every trip read at that stop in the next 14 s (`TF.BOARD_REUSE`; one cron run steps every trip in one isolate), so 100 trips from 30 stops cost about 30 board reads a read cycle, not 100. If board reads still matter for the NSW quota, the next leg's board could drop to once a minute (not done and not tried against the cases: a choice for Bidur).

For 100 trips at once (estimate, not measured): 200 to 400 steps a minute in the one cron run; subrequests per run about 120 board reads (30 stops, 4 read cycles), up to 16 feed reads (two feeds, the shared 15 s copy), up to 100 fresh reads at Get off now moments in the worst minute, 100 to 200 Apple pushes: well under the 1,000 subrequests of one invocation. No Durable Object, so no alarm invocations; requests: the cron's 1,440 runs a day that already exist. CPU per step not measured offline (feed decode is shared per copy; the rest is a few small JSON reads and writes). 5 s reads in the final minute: not added. The feed copy changes about every 15 s, so 5 s reads would mostly reread the same copy and add 12 fresh reads per trip in its last minute; the one fresh read at the Get off now moment covers the jump table (S17a to S17d pass).
