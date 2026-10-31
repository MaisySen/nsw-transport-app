# Trip state API (app/src/lib/tripState.ts)

One live trip state, drawn by every surface: the live trip screen, the Lock Screen card and Island, the "Your trip" widget data, the Watch data, speech and alerts on the phone, and the server's Live Activity pushes and trip alerts (the server runs a generated copy, `backend/tools/gen-livecard.mjs`, so the phone and the server can never disagree, I6). It is the real app version of the journey simulator's reference engine (`app/sim/journeySim.mjs`); `app/sim/realEngine.mjs` plays all the simulator's cases on it (`app/test/journeysim-real.test.mjs`).

Rules: pure (no runtime imports, `import type` only, no `Date.now()`, no timers); every time is an argument in ms since 1970; words follow `c24` (24 hour phone) and are Sydney time.

## Building the inputs from the app's real data

| Function | What it does |
|---|---|
| `tripPlanFrom(legs: WatchLeg[], svc?: ServiceResp[], alts?)` | The plan: one `PlanLeg` per trip leg (boarding stop first, stop off last, the service's own stops in between when an answer is loaded, else the two ends), then alternatives (`{ leg, svc, id, forLeg }`: the next service after a cancellation or a missed change). |
| `planLegFrom(w, d?, extra?)` | One plan leg. Stop names are short ("Croydon"). Platform is the number ("7"); buses keep the stand ("Stand G"). |
| `tripReadingFrom(plan, legs, svc, asOf, { boards?, plannerAt?, next? })` | One live reading for the whole trip from the `/api/service` answers per leg. `asOf`: when the live data was made or loaded (ms). `boards`: a departure board row per leg (board live time). `plannerAt`: when the planner estimate on `WatchLeg.estimated` was captured (Start trip); it then counts as a live reading with that age and ages out after 5 min (R2). `next`: the id of an alternative leg the trip can switch to when a leg is cancelled. |
| `legReadingFrom(planLeg, watchLeg, d, { asOf, board, plannerAt, next })` | The same for one leg. Handles the three feed shapes of spec section 0: (a) no live time in the answer but a late planner estimate, (b) only later stops live (delay carried back), (c) boarding stop not matched by index (matched by id, then by name; still not found = `unmatched`, timetable only). A stop time the server carried on (`stop.carried`) is a run time, not the stop's own. |
| `vehicleOnRun(d)` | The vehicle against the run's stops: at stop k (under 150 m) or heading to stop k; positions over 3 min old are not used. |

## The trip state

| Function | What it does |
|---|---|
| `newTripMemory(plan)` | The saved memory: per leg the phase the live train was last seen in, `phaseAt` / `phaseWhy`, calm steps rung (`rung`), alerts given, replacement leg. Save it with the trip. |
| `tripLegTimes(plan, M, reading, li, now)` | `{ dep, arr, before, platform, platformChanged, age, asOf, timetableOnly }`. Each time is a `TripTime` `{ at, planned, source: 'stop' or 'board' or 'run' or 'timetable', asOf }`: best evidence stop live, board live (departure), run live, timetable; live readings over 5 min old are not used. Departure, delay and arrival always come from the same reading. |
| `tripEvidence(plan, M, reading, li, now)` | Live evidence only: `leftBoard`, `leftBefore`, `arrived`, `passed`, `next` (vehicle position, or the stop's own live time passed, from a reading under 2 min old). Never a timetable time. |
| `staleStepOf(age, timetableOnly)` | `live` under 2 min, `about` to 5, `timetable` to 10, `no-data` after; `timetable-only` when unmatched. |
| `tripStep(plan, M, now, reading, { c24, lead, reread })` | One step: moves the phase only on live evidence (waiting, due, onTheWay, nextStop, getOff, arrived, ended) and returns `{ moments, log }`. A moment is `{ ring, age, byVehicle }`; `ring.kind` is cancelled, missed, delay, platform, headsup, getoff, atstop, arrived, passed or quiet, with title, body, level, Kylie `clip`, in-app words `say`, a once-only `moment` key, `expires`, and for Get off now `target` (live arrival minus 30 s) and `arrAt`. `lead`: how early this side sends Get off now (0 in the app, `TRIP_RULES.SERVER_DELIVERY` = 2 s on the server). `reread`: read once more at the Get off moment. `M` is updated in place. |
| `tripRender(plan, M, reading, now, { c24, size, forecast, forecastPhase })` | The render model every surface draws: `phase`, `step`, `status`, `warn`, `arrive`, `sub`, `timer` (countdown target, never in the past, null for Due), `staleDate`, `island { leading, trailing, minimal, timer }`, `widget`, `watch`, `inApp`, `voiceOver`, `delayShown`, `depAt`, `depPlanned`, `depSource`, `arrAt`, `arrSource`, `asOf`, `platform`, `platformWas`, `nextStop`, `offName`. Every line fits one line at normal and largest text (`LINE_BUDGET`), else `truncated`. |
| `renderSig(r)` | What a surface shows minus the ticking countdown: push and reload only when it changes (and at least every 60 s). |
| `forecastPhaseOf(plan, M, reading, now, reloadT)` | The widget's own timeline entries from the reading it loaded: Due, on the way, next stop at their live times; never Get off now or Arrived. |
| `voiceGate(state, now, say, readingAge, byVehicle)` | In-app speech V1 to V5: `{ words, why, start, until }`. Nothing in the first 10 s in front or the first two refreshes, nothing on Silent, nothing from a reading over 60 s old (a vehicle position is fine), one queue, a cue that waited over 30 s is dropped. |
| `ringRoute(state, ring, now)` | Who rings: the open app (banner, one light tap for the calm steps, server copy silent), the server (direct alert, or the Live Activity push carrying it), or nobody. |
| `backupGetOff(plan, M, reading, now, serverTakes)` | The phone's own backup Get off now (G39): only when the server has not taken it, from a reading under 20 s old, live arrival under 5 min away, at the live arrival minus 30 s. |
| `serverPollMs(plan, M, reading, now)` | 30 s, or 15 s once the live arrival is under 5 min away. |
| `tripClock(t, c24)` | "7:54pm" or "19:54". |

Constants: `TRIP_RULES` (ms), `TRIP_CLIPS` (getoff_soon, getoff_now, arrival), `TRIP_PHASES`, `PHASE_INDEX`, `LINE_BUDGET`, `BANNED_WORDS`.

## Registration contract with the server

The new app sends `tripFlow: 2` and `c24: <boolean>` in every trip, get off and Live Activity registration body. The server uses the new flow only for `tripFlow >= 2` and while its `tripflow2` switch is on; words follow `c24` (absent = 12 hour).

## How the old entry points sit on it

`computeLive` (liveCalc.ts) and `cardFor` / `staleAt` / `cardWarning` (platform/tripCard.ts) keep their shapes for every caller, and take their times and phase from the trip state (see CHANGELOG for the list of changes).


## Built on it (second push)

* `computeLive(legs, svc, t, memo?, pos?, o?)`: `o = { asOf, plannerAt, c24, size }`. Phase, times, track and stops left now come from the trip state. `LiveState` adds `view` (the `tripRender` model), `step` (stale step), `depSource` and `arrSource`; each leg adds `phaseEv` ('wait' | 'left' | 'at'). A leg the live train showed at your stop off is kept in `memo.here`.
* `stepLive(g, svc, now, f, pos?, shown?, flow?)`: with `flow = { asOf, c24, voice }` it runs the new flow (`tripStep` moments as alerts, `haptic: 'light'` on the calm steps, speech through `voiceGate`, returns `voiceUntil`). `g.flow` holds the `TripMemory`. Without `flow` it runs as before. `nextFlowMoment(g, s, now)` gives the exact Get off now moment within 20 s.
* `cardFor(g, s, now, { alt, asOf, updated, c24 })`: the words come from `s.view`; `legNoteFor(s, now, c24)` gives the leg note. `staleAt(card, updated, honestStale, keepMs)`: `updated + 2 min`, and while waiting no later than the live departure.
* Server copy: `backend/tools/gen-livecard.mjs` runs each file in its own scope and returns `{ computeLive, cardFor, staleAt, cardWarning, legNoteFor, ...every tripState export }` as `LIVECARD`.
* Tests that load one TS file at a time link its runtime imports with `app/test/tsLink.mjs`.
