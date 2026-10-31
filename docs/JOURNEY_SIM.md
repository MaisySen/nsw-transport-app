# Journey simulator

Phase 1 of the live trip plan (docs/TRIP_FLOW_SPEC.md, section 5). Asked for by the owner on 31 Oct 2026, 8:31 PM: "Create a full journey simulation and cases to plan what and when".

The simulator plays a started trip second by second and says, for every moment, what each surface shows, says and buzzes, and what the server pushes, under the NEW rules in docs/TRIP_FLOW_SPEC.md (sections 2.1 to 2.9). It is the target behaviour, written as code, before any app or server code changes. It does not run or change app code; nothing in the app imports it.

## Files

| File | What it is |
|---|---|
| `app/sim/journeySim.mjs` | The reference implementation: live feed model, one trip state, phases, alerts, voice, render model for every surface, the second-by-second loop, the invariant checks I1 to I10. Pure, no dependencies, no network, no clock. |
| `app/sim/cases.mjs` | The cases: S1 to S20 from the spec (some with a, b, c variants), the owner's 31 Oct trip (S2, S2-open), a 415 bus leg (BUS) and a T1 to T4 change at Redfern (X). |
| `app/sim/report.mjs` | Turns runs into one timeline table per case (time, train, Lock Screen, Island, widget, alert and voice). |
| `app/test/journeysim.test.mjs` | The tests (node test runner). |

## Run it

```
cd app
OFFLINE=1 TZ=Australia/Sydney node --test test/journeysim.test.mjs
node sim/report.mjs /tmp/sim-out        # writes JOURNEY_SIMULATION.md and timelines.json
```

Times inside the simulator are seconds since local midnight (Sydney), so the output is the same on any machine and in any time zone.

## What one run gives

`simulate(caseDef)` returns:

- `frames`: one per second: the Lock Screen card (status, warning, arrive line, sub line, countdown target, stale date), Island (leading, trailing, minimal), widget row, Watch line, in-app line (when open), the trip phase, and how old each reading is.
- `rings`: every alert: kind, title, body, route (in-app banner, server alert, Live Activity push carrying the alert, local backup, quiet note), sound (Kylie clip or default, muted by Silent), haptic (one light tap, one buzz, none), level, expiry, the reading age behind it.
- `voice`: every spoken cue with its words, or none with the reason (V1 to V8).
- `pushes`: every Live Activity push the server sends (status, timer, stale date, phase).
- `log`: phase changes with the evidence that moved them.

`checkInvariants(run)` returns every broken rule; the tests fail on any.

## The model in short

- The feed publishes every 15 s (and on each event): carried delay, stop estimates, vehicle position, platform, cancellation. Gaps stop publishing. A reading's age is now minus its publish time.
- The open app reads every 15 s. The server reads a live trip every 30 s, every 15 s once the live arrival is under 5 min away, and once more at the Get off moment. Build 212's widget reads the server on each reload (about every 5 min while locked); the open app reloads it on every change.
- Times: best evidence stop live, board live, run live, timetable; live readings over 5 min old are not used for times.
- Phases move only on live evidence: Due when the live departure has come (not stored: a train that gets later goes back to counting down); left and next stop from a vehicle position or the stop's own live time passed by 60 s; arrived from a vehicle at the stop or the stop's live arrival passed (reading under 2 min old); ended 2 min after arrived.
- Calm sequence: heads-up (stop before left, or live arrival 2 min away; on a non-stop leg only the 2 min rule), Get off now at the live arrival minus 30 s (server sends 2 s early), arrival. Each once per stop; jumps per the table in spec 2.6.
- Who rings: app open, the app (banner, in-app voice, one light tap; the server copy shown without sound). Otherwise the server (direct alert, or the Live Activity push carries it when direct alerts are not working). Server unreachable: only the phone's backup Get off now, set from a reading under 20 s old within 5 min of the stop.

## Invariants (spec 4.1), checked on every second

I1 delay shown equals countdown target minus timetable (within 30 s). I2 no 0:00, no timer in the past, no "Trip started", "Checking for the next one", "Next one", "departed" or "Wake up". I3 no phase from the timetable clock: checked against the raw feed, and again by moving every timetable time 7 min either way with the live train unchanged (phases and calm alerts must not move). I4 no speech within 10 s of opening or on the first two refreshes. I5 no next stop or get off from the timetable or data over 5 min old (with sound: under 2 min). I6 the phone's card equals the server's push from the same reading. I7 every line fits one line (a character budget per surface and text size; the native audit is the real measure). I8 Get off now lands at the live arrival minus 30 s (within 5 s), or at once after a jump. I9 each calm step at most once per stop, in order, never "Wake up", at most one vibration. I10 the widget keeps its row and never shows "Checking for the next one" or "Trip started"; a different phase from the card only with "about" on it.

Six tests feed the build 211 behaviour (countdown to the timetable, 0:00, "Checking for the next one", arriving by the clock, speaking on open, a doubled or early get off, a wrapped line, phone and server disagreeing) into the checks and assert they fail.

## Add a case

1. Add an object to `CASES` in `app/sim/cases.mjs`: `id`, `title`, `story` (plain words), `legs` (mode, line, platform or stand, stops with timetable `tt`), `start`, `end`, `feed.events` (`{ at, leg, delay }` minutes, `{ at, leg, est: { stopName: time } }`, `vehicle(leg, [[stop, at, left]])`, `{ at, leg, platform }`, `{ at, leg, cancelled: true, next: altId }`, `{ at, leg, unmatched: true }`), optional `feed.gaps`, `alts` (services the feed can find instead), `phone` (`{ at, app: open|locked|background|killed, silent, location, c24, size: normal|largest }`), `server` (`{ reachable, direct }`).
2. Add expectations: `checks` (named-second card, widget or phase values), `order` (alert kinds in order), `ring` (exact landing, send, expiry or route), `spoken`, `pushWithin`, `same` (identical to another case).
3. Run the tests. Every case is checked against I1 to I10 automatically.
4. Use sample stations. The owner's own stations may appear in at most 5% of tests (`backend/tools/owner-stations.mjs`); S2, S2-open, BUS and X are the only cases that use them.

## Choices made where the spec was open

These are the simulator's choices; each is one line to change if the owner decides otherwise.

1. Server read cadence: the spec says the shared 1 min tick but also that a delay reaches the locked card within 30 s; the simulator reads every 30 s (15 s near the stop).
2. An earlier arrival inside the last minute is caught at the server's next 15 s read (S17b rings at 7:58:15, 5 s before arrival). Reading every 5 s in the last minute would close that.
3. Heads-up on a non-stop leg (T1 Strathfield to Redfern): "the stop before" is the boarding stop, which would ring right after leaving; the simulator uses only the 2 min rule there.
4. The widget on a locked phone learns nothing between reloads (about every 5 min). It runs timeline entries for coming phases from the live estimates (Due, Next: stop, "Croydon next"), marked "about" / "Updated N min ago" once the reading is 2 min old, and holds a phase whose time had already passed when it loaded. It never forecasts "Get off now" or "Arrived": every server alert also refreshes the widget (build 212: the notification extension writes the trip state and reloads the widget; to be confirmed on a phone), so those appear when they happen. It can still be a step behind the card when a train is held between alerts.
5. Due is not sticky: a train that is suddenly later goes back to a countdown to its new time (S3), instead of staying Due.
6. Cancelled with a next service found: the trip follows that service (S5).
7. A missed change that comes from a delay is one alert carrying both, not two.
8. Arriving at a change stop: alert "change here" with the default sound, not the arrival clip ("You've arrived at your stop" would mislead mid-trip).
9. Cancellation and missed change are spoken in the app when it is open (the spec names voice only for delay and platform change).
10. Running 3 min or more early alerts like a 3 min delay.
11. The delay already known at Start trip is shown, not spoken (the app had just opened: V1 wins over "one voice cue").
12. "Next: Burwood" stays while the train stands at Burwood, until it leaves.
13. The Lock Screen card shows "Get off now" when the server sends (2 s before the alert lands).
