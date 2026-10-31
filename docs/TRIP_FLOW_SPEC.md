# Live trip flow: spec, gaps and plan

Transport: Sydney Live, after the build 211 test ride on Saturday 31 October 2026.
App code read: branch build-211-rc at d44d715 (runtime 1.2.0, TestFlight build 211). Server code read: branch server-211-rc (live as b1feea1d). Read only: no code was changed, built or published.

Revised 31 October, 8:30 PM, to carry Bidur's decisions of 8:02 to 8:07 PM (section 0.1): a started trip follows the live train even when he is not on it; next stop and arrival are spoken; Get off now rings 30 s before the live arrival; the alerts are calm; the widget works for the whole trip. Where an earlier draft said otherwise, this version replaces it.

## 0. What happened on the 7:48 to 7:55 PM trip

Bidur started a trip Strathfield to Croydon on the T1 (timetable 7:50pm, Platform 7) to test it from home, as he does: a started trip should run along with the train whether or not he is on it. Every surface told a different story, and most of it ran on the timetable clock instead of the live train, which was 4 min late.

| Time | What his phone showed | Why (code) |
|---|---|---|
| 7:48 | Lock Screen and Island: "Leaves 1 min", "4 min late", "Arrive Croydon 7:55pm". Status line wrapped onto 2 lines. | The countdown and the delay come from two different sources (G1). Departure is the boarding stop's own row, which had no live time, so 7:50. The delay came from elsewhere (the planner's estimate or a later stop), so "4 min late". Arrival stayed on the timetable 7:55 (G2). The status line is allowed 2 lines and the audit never checks it (G24). |
| 7:49 | Opening the app, it spoke "... from Platform 7" and cut off. | The first refresh after opening reads out every cue that is new: "running 4 minutes late, it now leaves at 7:50pm" and "leaves in 1 minute, from Platform 7". Only "arrived" and "next stop" cues are ever treated as too late (G12). |
| 7:50 | Island timer 0:00. Home widget: "Checking for the next one", "Trip started". | The Island timer counts to 7:50 and stops at 0:00 with no fallback (G3). The widget has one row, timed 7:50, and drops it when 7:50 passes (G4). "Trip started" is the widget's fixed footer for every waiting trip (G5). |
| 7:53 | Notification: "Wake up, Croydon is next. Next stop is Croydon at 7:55pm." | "Wake me before my stop" is an alarm set on the phone ahead of time from the stop before's time, timetable if that is all there is (G9). Moving on to "next stop" was right; the timetable time (the live train was still at Strathfield) and the sudden "Wake up" alarm were wrong. |
| 7:55 | Island: "Croydon:" and "7:54pm" (a past time). Lock Screen: "You've arrived at Croydon. Got in at 7:54pm. The trip has ended." Lock widget: "Checking for the next one, Updated 4 min ago". No get off alert, no voice. | The trip moved to "on board" and then "arrived" from clock times over the feed, not from the live train, which only left Strathfield at about 7:54 and was due at Croydon about 7:59 (G6, G7, G8). The server pushed the same wrong card while locked, because it runs a generated copy of the same code (G1, G7). The widget only learns from the open app, so it was still waiting at Strathfield (G11). No server alert can reach his phone today (G16), and nothing speaks the arrival with the phone locked (G37). |

Reproduced offline with the app's own code and, separately, with the server's own copy of it (scratch replays, nothing committed). Three feed shapes give the 7:48 picture: (a) the boarding stop's row has no live time and the leg carries the planner's estimate (gives Leaves 7:50, 4 min late, Arrive 7:55, exactly the screenshot); (b) only later stops have live times (gives Arrive 7:59); (c) the boarding stop is not matched in the service answer at all, which also flips the card to "on board" at 7:50:30. Which one it was is a two-minute check against production (section 5, step 0). The fix covers all three.

The one sentence: each value on each surface is worked out separately, often from the timetable, and the trip moves on by the clock instead of with the live train. The spec below replaces that with one trip state that follows the live train, that every surface draws, and that moves on, speaks and alerts when the live train does.

### 0.1 Bidur's decisions, 31 October, 8:02 to 8:07 PM

His words, then what they mean for this spec:

- "I was at home. We are testing trips." / "No. Thats good" / "Issue are: No. Working parts" / "If i start train trip. It should be working accordingly." A started trip follows the live train (live stop times, vehicle position) through waiting, due, left, next stop, approaching and arrived, whether or not he is on it. Phone location or a tap is never required to move on; at most it confirms. There is no missed-train check that stops or reroutes the trip. With no live data, the trip does not move on by the timetable clock; it says the data is old and waits (2.4).
- "Arrival on voice. It should work." Next stop and arrival are spoken in Kylie's voice when the live train reaches them: by a notification sound clip while the phone is locked (where iOS allows), by in-app speech while the app is open. Never on opening the app, the Silent switch is respected, never cut off (2.7).
- "Get off alert should be 30 sec before arrival. So user gets time to get off." Get off now fires at the live arrival estimate at the get off stop minus 30 s, and moves with every new estimate (2.6).
- "Not suddent buzz of scare." A calm sequence: a gentle heads-up first, then Get off now with Kylie's voice, a soft start and one light haptic. No "Wake up" wording, no repeated vibration. This replaces the timed "Wake me before my stop" alarm (2.6).
- "Working widget." The "Your trip" widget works for the whole started trip and never shows "Checking for the next one" mid-trip (2.5).

## 1. Today's flow, from the code

### 1.1 Who computes what

- The trip state is `computeLive` in app/src/lib/liveCalc.ts. The Lock Screen card is `cardFor` in app/platform/tripCard.ts. The server runs a generated copy of both (worker.js 6924 to 7559, made by tools/gen-livecard.mjs). Same code, same bugs, on both sides.
- While the app is open: the live engine (app/src/lib/liveEngine.ts) asks for each leg every 15 s, then runs `stepLive` (alerts, speech, ongoing note), `wakeStep` (app/src/lib/smart.ts), `getOffStep` (app/src/lib/getOffCore.ts) and the iPhone bridge (app/platform/iosBridge.ts) writes the card, the widget data and the Watch data.
- While the phone is locked: only the server updates the Live Activity, by push about every 30 s (worker.js 7828 to 7835, 9892 to 9898). The widgets and the Watch get nothing: they are written only by the open app (iosBridge.ts:152-163, 183-198).
- Alerts from the server: written to notes, then sent by Web Push, Expo, then direct APNs (worker.js 4035-4064). His Expo tokens fail and direct APNs is off (apnsAlerts), so none reach his phone. They only appear as catch-up rows when he opens the app within 90 s.
- Speech: only the open app can speak (no background audio). Spoken trip alerts use the ambient audio session from build 211, which the Silent switch mutes.

### 1.2 Where each value comes from

| Value | Source today | File:line |
|---|---|---|
| Countdown while waiting (`departs`) | Boarding stop row: live time, else its timetable time. Leg's registered time if the stop is not matched. | liveCalc.ts:175; worker.js:7070 |
| Delay ("4 min late") | Boarding stop's live delay, else any other stop's delay, else the planner's estimate captured at Start trip (never refreshed, no age) | liveCalc.ts:171-174 |
| Arrival | Stop off row: live time, else timetable plus the carried delay (ignores the planner's estimate) | liveCalc.ts:179-183 |
| Platform | The platform registered at Start trip, never the live one (card) | tripCard.ts:120; worker.js:7530 |
| Stops left, next stop | Where the run is: vehicle position, else the first stop whose live or projected time is still ahead of the clock, else timetable | liveCalc.ts:101-114 (trackOf) |
| Phase wait to ride | Vehicle or "live" track past the boarding stop; timetable track or unmatched stop: the clock passing `departs` | liveCalc.ts:227-230; worker.js:7139-7142 |
| Arrived | Track past the stop off, or live arrival plus 45 s, or a kept arrival plus 45 s; none need a train position or the rider | liveCalc.ts:162-166, 188, 201-202 |
| Card goes stale | min(updated + 2 min, arrival + 2 min, get off time) | tripCard.ts:151-158; worker.js:7549-7555 |
| Server card "updated" | The feed's time, or now when there is no feed time (so a no-data card never looks stale) | worker.js:7473-7477 |
| Clock words in card warnings | 12 hour, hard coded | tripCard.ts:48-51; worker.js:3969-3972, 7466-7469 |

### 1.3 Every place a timetable time is used while a live time could exist

1. Departure countdown when the boarding stop row has no live time of its own (liveCalc.ts:175, worker.js:7070).
2. Arrival when only the planner's estimate is late (liveCalc.ts:180).
3. Phase flips to "on board" at the timetable departure on a timetable track or an unmatched stop (liveCalc.ts:230, worker.js:7142).
4. The server card ignores the departure board's live estimate that the server's own alert code already reads (worker.js:7716-7727 vs 5242-5256).
5. Speech "leaves in N minutes" and "running late, it now leaves at" use the same departure (liveCalc.ts:439-450).
6. Haptic "leave now" tap at that departure (liveCalc.ts:458-464).
7. Wake alarm time: stop before's time or arrival minus 2 min, timetable if that is all there is, set on the phone ahead (smart.ts:140-152, 205).
8. Watch tap 60 s before the get off time it was sent (targets/watch/WatchCore.swift:197-205).
9. Widget and Watch keep the trip until arrival + 2 min, whatever arrival was (widgetShare.ts:32, WatchCore.swift:48-50).
10. Server watch: boarding assumed at the timetable departure; "Get off soon, by the timetable" after 5 min without live data, and with no data at all over the daily budget (worker.js:5501, 5552, 5609-5637, 5668, 5781).
11. Server watch marks a computed arrival (timetable plus shift) as live (worker.js:5234, 5251).

### 1.4 What each surface shows, state by state (today)

Waiting for departure:
- In-app trip screen (app/src/app/go.tsx:215-238): "Leaves in N min, 7:50pm" and a "4 min late" badge from different sources; at 0 min "Due now" with no end.
- Live Activity Lock Screen (LiveTripActivityWidget.swift:449-555): "To Hornsby", "Leaves 7:50pm, Platform 7 · 4 min late" (may wrap), stop track, "Arrive Croydon 7:55pm".
- Island compact and minimal: a system timer to `departs` (LiveTripActivityWidget.swift:179-201), which freezes at 0:00.
- Home and Lock widget "Your trip" (TransportWidgets.swift:245-262): one row timed `departs`, footer "Trip started", no delay.
- Watch app and complications: counts to `departs`; "Leaving now" then a count up (WatchCore.swift:454-459, Complications.swift:56, 117-121).
- Notifications: phone "leave" reminder taken back at Start trip (live.ts:84); server "Leave now" no longer sent for Start trip watches (server-211).
- Speech: "leaves in N minutes, from Platform 7" from 3.5 min out, "running N minutes late" (liveCalc.ts:439-450), also on the first refresh after opening.

On board:
- Card: "Get off at Croydon", stops left, countdown to `legArrives`; Island "Croydon:" plus countdown; stale at the get off time, then a past clock time.
- Next stop: phone alert and speech when the track's next stop is the stop off (liveCalc.ts:365-370, 418-424); server "Next stop" push (worker.js:5803-5815), undelivered to him.
- Get off now: server push if it accepted the job (worker.js:5594-5603; it cannot reach him), else a location alert (When In Use location trigger) if location is allowed and precise, else the quiet note within 5 min of a live read (getOffCore.ts:302-359).
- Wake alarm: set on the phone ahead from times (smart.ts:177-209).

Interchange: change warnings "Tight change at Redfern" or "Change at risk. Next T4 8:31am" (tripCard.ts:135-142, 12 hour words); missed change moves the countdown to the next found service.

Arrived or ended: card "You've arrived at Croydon. Got in at 7:54pm. The trip has ended." for 2 min (LiveTripActivity.swift:129, 144); also shown when a card with no `updated` goes stale (LiveTripActivity.swift:97). Phone alert "You've arrived" when no server watch (liveCalc.ts:360-361). Server end push (worker.js:7554, 7781).

Testing from home (not on the train): the trip runs on, which is wanted, but by the clock rather than the live train, so it said "arrived" about 4 min before the train got there. With the phone locked, nothing speaks the next stop or the arrival.

Stale or no data: card one step only, at updated + 2 min: "Leaves about 7:50pm", "Updated 7:49pm", the delay still shown as if current. Widget "Updated N min ago" (WidgetLive.swift:16-46). Server card with no feed time stamps itself fresh.

## 2. The correct flow (spec)

### 2.1 One trip state, drawn by every surface

One pure function builds one trip state from the legs, the live answers, the evidence and the time. It replaces `computeLive` plus the separate decisions in `cardFor`, `speechCues`, `tripAlerts`, `wakeStep` and `getOffStep`. The server runs a generated copy, as today, so the phone and the server can never disagree.

Each time in it carries where it came from and how old it is:

- `at`: the time to show and count to.
- `planned`: the timetable time.
- `source`: stop live (the stop's own live time), run live (the run's live delay carried to this stop), board live (the departure board's live time), position (from the vehicle or the rider), or timetable.
- `asOf`: when that live reading was taken.

Derived values are never worked out separately:

- delay minutes = round((at − planned) / 1 min), shown only when `source` is live and fresh. So the delay text and the countdown always agree. Invariant I1: if a delay is shown, countdown target − timetable time = that delay (±30 s).
- The planner's estimate captured at Start trip counts as a live reading with its own `asOf`, and ages out under R2 like any other.

Best evidence order for a departure or an arrival: stop live, then board live (departure only), then run live, then timetable. All live readings must be under 5 min old (R2). A run whose boarding stop is not matched in the service answer is matched by stop name and position as well; if still unmatched, the leg is timetable only and says so.

Every surface gets a render model from the trip state: the exact words, the countdown target (or none), the line, the platform, the stale words, and the voice cue (if any). Swift, the Watch, the widget, the in-app screen and the server push all draw that model. No surface works out a time, a phase or a word on its own.

### 2.2 Trip phases and what moves them

A started trip follows the live train. These are facts about the service, and the trip moves through them whether or not the person is on the train (Bidur, 8:02 PM: "If i start train trip. It should be working accordingly."). Testing a trip from home is normal use and works the same way.

1. Waiting: before the live departure.
2. Due: the live departure time has come, and nothing yet shows the train has left. Shows "Due" or "Arriving", never 0:00, never "left", for as long as live data says it has not left (a late train stays Due and its time moves).
3. Left: the train has left the boarding stop. Evidence: a fresh vehicle position past the stop, or the feed's own live time for the stop (under 2 min old) passed by 60 s.
4. On the way: between stops; the card shows the next stop and the live arrival at the stop off.
5. Next stop: the train has left the stop before the stop off, by the same evidence. The heads-up rings (2.6).
6. Get off now: the live arrival at the stop off is 30 s away (2.6).
7. Arrived: the train is at the stop off: a vehicle position at the stop, or the stop's live arrival time (under 2 min old) has passed. The arrival is announced and spoken (2.6, 2.7). "Got in at" uses that live time.
8. Ended: 2 min after Arrived the card goes. The widget and Watch clear at the same moment.

What moves the trip: only the live train. The feed's live stop times and vehicle positions under 2 min old are the evidence; a timetable time passing is never evidence. Phone location (when allowed and fresh) may confirm a phase or sharpen the arrival estimate, and a tap ("I'm off", "End trip") may end the trip early, but neither is ever required, and no location reading ever stops or reroutes a started trip. There is no "you missed it" detection by default (Bidur, 8:02 PM).

When live data is missing: the trip holds at the last phase the live train was seen in and the surfaces say the data is old (2.4). It never moves on by the timetable clock. When live data comes back, the trip jumps to where the train really is; only the moment that is true now is announced, the ones it skipped are marked done silently.

Rules that hold in every phase:

- R-A. No phase moves on a timetable time alone; every phase change comes from the live train.
- R-B. Countdowns always count to the live `at`. A target in the past while the train has not left shows words ("Due", "Arriving"), never a timer at 0:00 and never a count up.
- R-C. "Departed", "Trip started", "Checking for the next one" and "Next one" never appear while a trip is in progress and the train has not left by evidence; "Checking for the next one" never appears at all during a started trip.
- R-D. Arrival time shown is the live arrival; with only timetable data it says "timetable".
- R-E. Every surface (in-app, Lock Screen card, Island, widget, Watch, notifications, voice) shows the same phase at the same moment, drawn from the same trip state.

### 2.3 Delays, early running, cancellations, platform changes, missed changes

- Delay found before departure: countdown to the live time ("Leaves 7:54pm"), delay text beside it, both from the same reading. One voice cue and one alert when the delay first reaches 3 min and each time it changes by 3 min or more (including a train already late at Start trip).
- Delay grows after the phone locks: the server pushes the new time within 30 s; the phone shows it.
- Early running: count to the earlier live time; "2 min early" in the same place as a delay. Never hide an early departure.
- Cancelled: the card says "Cancelled" and shows the next service on the same line if found ("Next T1 8:05pm, Platform 7"); no countdown to the cancelled train. One alert. Timetable rows of a cancelled run are never shown as running.
- Platform change: only a platform the live data reported. The card shows the new one with "was 6"; one alert, one voice cue if open.
- Missed change: live times say you will miss it: the card counts to the next found service, not the missed one; one alert with the next option.

### 2.4 Live data getting old (every surface)

| Live data age | What every surface shows |
|---|---|
| Under 2 min | Live: countdown, delay, "On time". |
| 2 to 5 min | Countdown replaced by the clock time with "about" ("Leaves about 7:54pm", "Croydon about 7:59pm"), plus "Updated 7:48pm". Delay shown as "4 min late at 7:48". The trip holds its phase. No Get off now with sound; a quiet note instead (2.6). |
| 5 to 10 min | Past the live cap (R2): timetable time labelled "Timetable 7:50pm", plus "No live data since 7:48pm". No delay text. The trip holds its phase; no next stop, get off or arrival. |
| Over 10 min | "No live data. Open the app to refresh." Timetable times only. No phase moves, no next stop, no get off, no arrival from the clock. |

While the phone is locked the server pushes these words at 2, 5 and 10 min when its own feed is old, so this works on build 211 as long as the server is reachable. Build 212 makes the card change at those ages on its own as well (for when no push arrives).

### 2.5 Phone locked, app in background, app killed

- The server owns the Live Activity while the phone is locked: one push on every change of target, delay, platform, phase or stale step, and at least every 60 s while the trip is live. Each push sets the stale date to updated + 2 min (and to the live departure while waiting, so a missed push shows "about 7:54pm", never 0:00).
- The phone writes the card only from live readings under 20 s old (today's rule), so it never pushes the card back to older times.
- App killed mid-trip: the server keeps the card and the alerts going; on next open the trip resumes from the saved trip and the server's state, silently (no speech, no late banners).
- The Watch gets the same trip state while locked (build 212: it reads the trip from the server itself, as the widget below).

The widget for the whole trip (Bidur, 8:03 PM: "Working widget"):

- From Start trip to Ended, the "Your trip" widget (Home Screen and Lock Screen) shows the same phase as the card: countdown to the live departure, Due, "Next: Burwood", "Croydon next", "Get off now", "Arrived Croydon 7:59pm". It never shows "Checking for the next one" or "Trip started" during a started trip, and it never drops its row because a time passed.
- Its timeline is built from the latest trip state: one entry per coming phase at its live time, each marked "about" once the reading behind it is over 2 min old (2.4). When the entries run out before the next reading, it keeps the last phase with "Updated N min ago" instead of an empty row.
- Build 212: the widget asks the server for the trip state itself when it reloads (one small read), asks to reload about every 5 min during a trip (within the system's widget budget), and the app reloads it on every change while open. It clears 2 min after Arrived, with the card.
- Build 211 (interim, app only): the app writes the live departure and live arrival into the widget data, so the row is no longer dropped at the timetable time; the rest needs build 212.

### 2.6 Alerts

- Leave now: server only, from live board times; never after Start trip.
- Delay, platform change, cancellation, missed change: server push from live data, once per change.
- Catch-up on open: only alerts whose moment is still true now and under 90 s old; never a sound, never speech.
- Every alert expires when its moment has passed (heads-up at the live arrival, Get off now at the live arrival + 30 s, arrival 2 min after).
- Nothing in a trip comes from a timetable guess or from data over 5 min old.

The calm sequence near the stop off (Bidur, 8:06 PM: "Get off alert should be 30 sec before arrival. So user gets time to get off." and "Not sudden buzz of scare."). It replaces the "Wake me before my stop" alarm, the "Wake up" wording and the old quiet note at arrival minus 2 min. Each step rings once per trip, never repeats, and never vibrates more than once.

| Step | When (live train) | Words | Sound, feel |
|---|---|---|---|
| 1. Heads-up | The train leaves the stop before the stop off, or the live arrival is 2 min away, whichever comes first (never before the train has left the boarding stop) | "Croydon is next. Arriving about 7:59pm. Get ready to get off." | Kylie getoff_soon clip ("Your stop is coming up. Please get ready to get off at the next stop.", 5.2 s). Normal alert level, not time sensitive. One light tap in the app; one system buzz when locked. |
| 2. Get off now | Live arrival at the stop off minus 30 s | "Get off now. Croydon, arriving 7:59pm." | Kylie getoff_now clip ("Please get off at the next stop.", 2.8 s). Time sensitive (comes through a Focus only if allowed). One light tap in the app; one system buzz when locked. Card and Island show "Get off now · Croydon". |
| 3. Arrived | The train is at the stop off (vehicle at the stop, or the stop's live arrival time under 2 min old has passed) | "You've arrived at Croydon. 7:59pm." | Kylie arrival clip ("You've arrived at your stop.", new). Normal level. No tap. The card shows "Arrived" for 2 min, then ends. |

Never: "Wake up", an alarm set ahead from times, a repeated or long vibration, a Critical Alert, a sound on app open, a second ring of the same step. The clips are checked on his phone for a soft start; if one starts loud, the same file gets a short fade-in.

How Get off now lands 30 s before the live arrival:

- Phone locked or app in the background: the server sends it. Once the live arrival at the stop off is under 5 min away, the server reads that trip's live data every 15 s (instead of the shared 1 min tick) and keeps one timer per trip at the live arrival minus 30 s, minus 2 s for delivery. Every new reading moves the timer. When it fires, the reading behind it must be under 2 min old. It goes as a direct alert (sound getoff_now, time sensitive, expires at the live arrival + 30 s, one collapse id per stop so it can never stack), and at the same moment the Live Activity is pushed to the "Get off now" phase. The Live Activity push carries the alert and sound itself only when the direct alert route is not working, so the phone rings once.
- App open: the phone runs the same timer from the same trip state (it reads every 15 s), plays the Kylie clip in the app and shows the banner. The server's push for the same moment is shown in the app without sound, so it never rings twice.
- Backup on the phone, only when the server has not taken Get off now (no working route): the location alert at the stop off (needs location, rings where the person is), and a local Get off now at the live arrival minus 30 s, set only from a reading under 20 s old when the app goes to the background and only when the arrival is under 5 min away. Neither is set when the server has taken it.

If the live arrival estimate jumps:

| Jump | What happens |
|---|---|
| Later, before Get off now has fired (e.g. held 2 min at Burwood) | The timer moves later. The card and widget show the new time. The heads-up is not repeated. |
| Earlier, the new fire time still ahead | The timer moves earlier. |
| Earlier, the new fire time already passed, train not yet at the stop | Get off now fires at once (less than 30 s warning beats none). |
| Train already at the stop by evidence before Get off now fired | One alert, "Croydon now. Get off here.", with the getoff_now clip; no separate arrival sound after it. |
| Train already past the stop | No loud alert. A quiet note "Your train passed Croydon at 7:59pm" and the trip ends. |
| Any jump after Get off now fired | Nothing rings again; the card shows the new time. |
| Reading 2 to 5 min old at fire time | No Get off now with sound. A quiet note with no sound at the last live arrival minus 30 s: "Croydon about 7:59pm. No live update since 7:56pm." Never the words "get off". |
| Reading over 5 min old | Nothing; the card shows the stale words (2.4). |
| Live data says the train will not stop at Croydon | No Get off now; one alert with the next option, as a cancellation. |

### 2.7 Voice

Bidur's rules (31 Oct, 11:37 AM and 8:03 PM): speak only when it is known to be real (the live train, a live server push or a real position) and only at that moment; never on app open, foreground or resume; respect the Silent switch; never cut off. Next stop and arrival must be spoken ("Arrival on voice. It should work.").

- V1. In the app, a cue is spoken only if the app has been in front for at least 10 s and was in front when the event became true.
- V2. The event must come from the live train: a live reading under 60 s old or a vehicle position. Timetable never speaks.
- V3. The cue's moment must be now (within 30 s). A cue that became true while the app was away is marked said, silently.
- V4. The first two refreshes after opening or resuming mark every cue as said, silently.
- V5. One speech queue. Nothing interrupts a spoken alert; a newer cue waits, a cue older than 30 s in the queue is dropped. The audio session is made active before the first word, so the start is never lost.
- V6. Spoken alerts in the app use the ambient session (muted by the Silent switch). Buttons the person presses ("Speak departures") may use the speaking session, as now.
- V7. The words never contradict the screen: "Your T1 leaves at 7:54pm, from Platform 7", from the same trip state.
- V8. Phone locked: the voice is the alert's own sound, a Kylie clip in the app bundle (no background audio). Clips play whole, follow the Silent switch and the ringer volume, and cannot be cut off by the app. Heads-up and Get off now use getoff_soon and getoff_now, already in build 211. The arrival clip is new: build 212, or earlier if copying it into the phone's sound folder from an app update works on his phone.
- V9. What is spoken, once each per trip: heads-up (next stop), Get off now, arrival. With the app open the in-app voice names the station ("Croydon is next", "Get off now for Croydon", "You've arrived at Croydon"); the locked clips use their general words ("Your stop is coming up...", "Please get off at the next stop.", "You've arrived at your stop.") and the station is in the alert text.

### 2.8 Settings and system states

- Location off or approximate: no difference to the trip. It follows the live train; heads-up, Get off now and arrival come from the server push (locked) or the app (open). Location, when allowed, only confirms and enables the backup location alert (2.6).
- Silent switch on: no app speech (ambient session); alert sounds follow the system.
- Notifications off or a Focus: the card still works; time sensitive alerts break through a Focus only if the person allowed it. The trip screen says alerts are off.
- 12 or 24 hour: every time on every surface follows the phone. Times travel as numbers; words are made on the phone (build 212). Until then the app tells the server its setting and the server builds its words to match.
- Largest text: every status line stays on one line; it shortens ("Plat 7", the delay beside the countdown) and truncates with "..." last. VoiceOver reads the full text.
- Reduce Motion: no moving countdown animations; the stop track does not animate.
- VoiceOver: one label per card, "T1 to Hornsby, leaves 7:54pm in 6 minutes, Platform 7, 4 minutes late"; the timer has a spoken label; a Due state reads "due now", never "zero".

### 2.9 App Store limits kept

No background audio, no Always location, no Critical Alerts, no new background modes. Live Activity updates by push (allowed), location alerts with When In Use (allowed), time sensitive alerts (entitlement present), custom alert sounds as bundled clips under 30 s (allowed), widget reloads within the system budget.

## 3. Gap list

Fix route: JS = app JavaScript, OTA to runtime 1.2.0 (build 211). SRV = server deploy. BOTH = the shared trip code (change liveCalc.ts and tripCard.ts, regenerate worker.js, deploy and OTA together). NAT = native Swift, needs build 212. Severity: wrong info, scary, cosmetic.

### 3.1 From the 31 October trip (top of the list)

G1. Countdown counts to the timetable time while a delay is known.
- Where: liveCalc.ts:175 (dep) vs 171-174 (delay); worker.js:7070, 7531.
- Severity: wrong info. Surfaces: card, Island, widget, Watch, in-app, speech, haptic. Fix: BOTH.

G2. Arrival ignores the planner's estimate; can stay timetable while late.
- Where: liveCalc.ts:179-183; tripCard.ts:119. Severity: wrong info. Fix: BOTH.

G3. Island and minimal timer freeze at 0:00 when the target passes.
- Where: LiveTripActivityWidget.swift:179-201 (Text(timerInterval:)). Severity: scary. Fix: NAT for the real fix; JS and SRV interim: stale date at the live departure, so the card shows "about 7:54pm" instead of 0:00.

G4. Widget drops its only row at the target and says "Checking for the next one".
- Where: TransportWidgets.swift:128-143, 251-253; WidgetText.swift:82-84; WidgetRefresh.swift:68-71. Severity: scary. Fix: NAT.

G5. Widget footer "Trip started" while still waiting.
- Where: TransportWidgets.swift:256. Severity: scary. Fix: NAT.

G6. Phase moves to "on board" by the clock (timetable track, unmatched stop, or projected "live" track).
- Where: liveCalc.ts:109-111, 227-230; worker.js:7139-7142. Severity: scary. Fix: BOTH.

G7. "Arrived" before the live train got there: from clock times over the feed, with no train position; "Got in at" a projected time.
- Where: liveCalc.ts:162-166, 188, 201-202; worker.js:7095-7116, 7781; LiveTripActivity.swift:97 (stale card with no updated reads as arrived). Severity: wrong info, scary. Fix: BOTH; NAT for the stale branch (JS can always send `updated` meanwhile).

G8. A started trip does not follow the live train end to end: phases move on clock times, and with thin or no live data it advances by the timetable instead of holding with a stale label. (Moving on while he is not on the train is wanted; Bidur, 8:02 PM.)
- Where: liveCalc.ts:101-114 (trackOf), 162-166, 227-230; worker.js:2354-2357, 7139-7142. Severity: wrong info. Fix: BOTH.

G9. "Wake up, Croydon is next" alarm set on the phone ahead from times: sudden, alarming wording, timetable timing.
- Where: smart.ts:140-152, 162-169, 205. Severity: scary. Fix: JS (remove; the calm sequence in 2.6 replaces it).

G10. Island "Croydon:" plus a past clock time while riding; stale at the get off time.
- Where: LiveTripActivity.swift:167; LiveTripActivityWidget.swift:147-152, 186-191; tripCard.ts:153-156. Severity: wrong info, cosmetic. Fix: JS (live arrival, stale rule), NAT (wording).

G11. Three surfaces showed three different trips at 7:55; the widget stops following the trip once the phone locks.
- Where: widget and Watch only written by the open app (iosBridge.ts:152-163, 183-198); widget shows only a waiting row (TransportWidgets.swift:245-262). Severity: wrong info. Fix: NAT (widget timeline for every phase, widget and Watch read the live trip themselves, 2.5); JS interim (write live times).

G12. App speaks on open; voice cut off.
- Where: liveCalc.ts:439-450 (soon and late cues), 474-481 (cueStale ages only arrived and next stop), 592-603; liveEngine.ts:169, 184, 201, 205; nativeExtras.ts:159-185 (two audio sessions share one AVAudioSession; activation and deactivation can clip a cue). Severity: scary. Fix: JS (V1 to V5); check on the phone that the start is no longer clipped.

G13. Spoken "running 4 minutes late, it now leaves at 7:50pm": contradicts itself.
- Where: liveCalc.ts:439-442. Severity: wrong info. Fix: JS (same trip state).

G14. Get off now did not come: server path cannot reach the phone; server accepts the job on a dead token after any re-registration.
- Where: worker.js:5594-5603, 9074, 4059, 4110. Severity: scary. Fix: SRV (accept only with a working route) plus Bidur's OK for direct alerts.

G15. Get off now timing is wrong: it fires when the arrival is 90 s or less away, on the shared 1 min tick, using the projected arrival. Bidur's rule is the live arrival minus 30 s.
- Where: worker.js:5516-5536, 5781; one cron tick per minute for all watches (evidence-server.md section 4). Severity: scary. Fix: SRV (15 s reads near the stop, one timer per trip, 2.6).

G16. No server alert reaches his phone (Expo tokens dead, direct APNs off).
- Where: worker.js:4056-4062, 4110. Severity: wrong info. Fix: SRV flag (apnsAlerts), with his OK and one test push.

### 3.2 Data and timing

G17. Planner's estimate captured at Start trip used for the delay forever, no age.
- Where: live.ts:76-80; trip.tsx:317 (armSpec); liveCalc.ts:173. Severity: wrong info. Fix: BOTH.

G18. Boarding stop lost: stops with no coordinates dropped before matching; id only match on platform stop ids.
- Where: worker.js:2337, 2370-2377. Severity: wrong info. Fix: SRV.

G19. Server card ignores the departure board's live time that its own alert code uses.
- Where: worker.js:7716-7727 vs 5242-5256. Severity: wrong info. Fix: SRV.

G20. Delay not carried back to stops before the first live update.
- Where: worker.js:5320-5331, 2327. Severity: wrong info. Fix: SRV.

G21. Card platform is the registered one, never the live one.
- Where: tripCard.ts:120; worker.js:7530. Severity: wrong info. Fix: BOTH.

G22. Card ignores cancellation.
- Where: tripCard.ts cardFor; worker.js 6925-7557. Severity: scary. Fix: BOTH.

G23. Server watch marks a computed arrival as live; assumes boarding at the timetable time; "Get off soon, by the timetable" with old or no data.
- Where: worker.js:5234, 5251, 5501, 5552, 5609-5637, 5668, 5781. Severity: scary. Fix: SRV.

### 3.3 Display

G24. Lock Screen status line allowed 2 lines; the audit never checks it; no fixture has a waiting card with a delay.
- Where: LiveTripActivityWidget.swift:465, 479-491, 510-520; native-tests/native-audit/Tests/iOS/LiveActivityAudit.swift:49, 72-74. Severity: cosmetic. Fix: NAT.

G25. Stale ladder: one step only; old delay still reads as current; server stamps a no-data card as fresh.
- Where: LiveTripActivity.swift:100-110; WidgetLive.swift:16-46; worker.js:7473-7477, 7703-7707. Severity: wrong info. Fix: SRV (words at 2, 5, 10 min), NAT (on its own).

G26. In-app screen: "Leaves in 1 min, 7:50pm" beside "4 min late"; "Due now" with no end.
- Where: go.tsx:215-238. Severity: wrong info. Fix: JS (draw the render model).

G27. Watch "Leaving now" early and counts up past the target.
- Where: WatchCore.swift:197-205, 454-459; Complications.swift:56, 117-121, 199, 217. Severity: scary. Fix: NAT.

G28. Widget never shows the delay; green "Leaves" reads on time.
- Where: TransportWidgets.swift:245-256. Severity: wrong info. Fix: NAT.

G29. 12 hour words in card warnings and server alerts.
- Where: tripCard.ts:48-51, 137-141; worker.js:3969-3972, 7466-7469. Severity: cosmetic. Fix: JS and SRV now, NAT for times as numbers.

G30. VoiceOver: the timer has no label, a frozen 0:00 reads "zero", no combined card label.
- Where: LiveTripActivityWidget.swift:179-245. Severity: cosmetic, accessibility. Fix: NAT.

G31. Card data has no live flag per time, no delay number, no timetable time; the Island reads the delay by matching the warning text.
- Where: LiveTripActivity.swift:17-34, 116-122; modules/transport-ios/ios/LiveTripAttributes.swift:7-55. Severity: enabler. Fix: NAT (new optional fields; old payloads still decode).

### 3.4 Alerts

G32. Catch-up on open returns alerts for 90 s whether or not still true.
- Where: worker.js:5569-5585. Severity: wrong info. Fix: SRV.

G33. Expo alerts live 15 min with no expiry tied to the moment.
- Where: worker.js:4141 vs 4091-4100. Severity: scary. Fix: SRV.

G34. No delay alert when the train is already late at Start trip.
- Where: worker.js:5678, 5703-5712. Severity: cosmetic. Fix: SRV.

G35. "Watching the ..." note sent on Start trip; shows as a stale banner on next open.
- Where: worker.js:5692. Severity: cosmetic. Fix: SRV.

G36. The followed-service Live Activity is bundled and audited but never started.
- Where: TransportWidgets.swift:11; TripActivity.swift; TripLiveActivity.swift. Severity: none today. Fix: NAT cleanup, out of scope.

### 3.5 Added from Bidur's decisions (8:02 to 8:07 PM)

G37. Arrival is not spoken. With the phone locked nothing speaks it (no arrival clip, and the server sends no arrival alert); in the app the "arrived" cue is dropped as stale, and the phone's own "You've arrived" alert only runs when there is no server watch.
- Where: liveCalc.ts:360-361, 474-481; server arrival is the card ending only (worker.js:7554, 7781). Severity: wrong info. Fix: SRV (arrival alert from the live train), JS (in-app cue), NAT for the new Kylie clip (or JS if the sound folder copy works).

G38. Next stop push decided from clock progress when there is no vehicle position, and its words say "Get ready to get off" with the arrival from the estimate or, failing that, the timetable.
- Where: worker.js:5803-5815, 8058-8064, 2354-2357. Severity: wrong info. Fix: SRV (heads-up from the live train, 2.6).

G39. The phone's own Get off now is set ahead at the best known arrival and does not move with the train once the phone locks.
- Where: getOffCore.ts:296, 302-359. Severity: scary. Fix: JS (backup only, set only from a fresh reading within 5 min of the stop, 2.6).

G40. No single calm sequence: heads-up, Get off now and arrival come from different places (phone alarm, server Next stop, server or phone Get off now, card ending) with different words and sounds, and nothing stops two of them ringing for the same moment.
- Where: smart.ts:177-209; worker.js:5781-5815; getOffCore.ts:302-359. Severity: scary. Fix: BOTH (one moment key per step, 2.6).

G41. Nothing moves Get off now when the live arrival jumps inside the last minute, and nothing turns it into "Croydon now" when the train is already at the stop.
- Where: worker.js:5516-5536 (decided once per tick). Severity: scary. Fix: SRV, JS for the app-open path.

## 4. Test plan

### 4.1 The trip simulator

A replay harness (app/test/tripsim/, Node, OFFLINE=1, TZ=Australia/Sydney, no NSW calls) that:

- runs a fake clock in 15 s steps from 10 min before departure to 10 min after arrival;
- feeds scripted live answers per minute: stop live times, carried delays, board times, vehicle positions, platform, cancellation, feed age; and scripted phone states: app in front, in the background, killed, locked, Silent switch, location (on, off, approximate, a track; it may confirm but never decides), taps;
- drives the phone (the live engine's step functions, speech, alerts, the Get off timer, location alerts, quiet note), the server (the generated card code and the alert engine from worker.js, as backend/tools/sim210.mjs does today) and the surface render models;
- asserts at named minutes the exact words, the countdown target, the stale date and the voice cue for: in-app screen, Lock Screen card, Island compact, minimal and expanded, widget, Watch, notifications, server pushes, speech, haptics;
- checks the invariants on every step: I1 delay shown equals target minus timetable; I2 no 0:00, "Trip started", "Checking for the next one" or "left" before evidence; I3 no "next stop", "Get off now" or "arrived" before the live train reaches that point, and no phase move from the timetable clock; I4 no speech within 10 s of opening and none on the first two refreshes; I5 no next stop or get off from timetable or data over 5 min old; I6 the phone's card equals the server's push at the same minute; I7 every status line fits one line; I8 Get off now fires at the live arrival minus 30 s (within 5 s), or at once if a jump made that moment pass; I9 each of heads-up, Get off now and arrival rings at most once per trip, never "Wake up", at most one vibration each; I10 the widget never shows "Checking for the next one" or "Trip started" during a started trip.
- writes each scenario's card states as JSON fixtures that the native audit renders (Lock Screen, Island compact, minimal, expanded, widget, Watch) at the named minutes, at normal and largest text, 12 and 24 hour, so the screenshots match the replay exactly.

### 4.2 Bidur's trip, replayed (S2)

Timetable Strathfield 7:50pm Platform 7, Croydon 7:55pm. Live: 4 min late from 7:44, departs 7:54, leaves Burwood (the stop before) about 7:57, Croydon 7:59. He is at home testing, location off, phone locked from 7:47, opens the app at 7:49 for 20 s. Being at home changes nothing: the trip follows the live train.

| Minute | Expected (every surface) |
|---|---|
| 7:48 | Card "Leaves 7:54pm, Plat 7" on one line, "4 min late", countdown 6 min to 7:54, "Arrive Croydon 7:59pm". Island 6 min and "4 min late". Widget row 7:54 with "4 min late", no "Trip started". |
| 7:49 open | Trip screen "Leaves in 5 min, 7:54pm", "4 min late". No speech, no banner. |
| 7:50 | Countdown 4 min to 7:54. No 0:00 anywhere. Widget still shows the 7:54 row. |
| 7:54 | Due ("Due" or "Arriving") until the live train is shown leaving; never 0:00. |
| 7:55 | Live train left Strathfield 7:54. Card, Island, widget: "Next: Burwood", "Croydon 7:59pm". No alert, no voice. |
| about 7:57 | Live train leaves Burwood. Heads-up: "Croydon is next. Arriving about 7:59pm. Get ready to get off." with the Kylie getoff_soon clip, one buzz. Card and widget "Croydon next". |
| 7:58:30 | Get off now (live arrival 7:59:00 minus 30 s): "Get off now. Croydon, arriving 7:59pm.", Kylie getoff_now clip, one buzz. Card, Island, widget "Get off now". |
| 7:59 | Live train at Croydon. "You've arrived at Croydon. 7:59pm." with the Kylie arrival clip. Card "Arrived" for 2 min. |
| 8:01 | Card, widget and Watch clear together. Nothing more rings. |

Same trip with the app open from 7:56: the same three moments, spoken in the app with the station name, the server's matching pushes shown without sound. Same trip with location on: identical.

### 4.3 Scenario matrix

Each row has its own timeline file with the expected output on every surface at named minutes; below is the essence.

| # | Scenario | Must hold |
|---|---|---|
| S1 | On time | Countdown to the live time; "On time"; heads-up, Get off now at live arrival minus 30 s, arrival; one voice cue per moment. |
| S2 | 4 min late found before departure (Bidur's trip) | Section 4.2. |
| S3 | Delay grows after lock (on time at 7:47, 6 min late at 7:52) | Server push within 30 s moves the countdown to 7:56; no 0:00; heads-up and Get off now move with it, never early. |
| S4 | Early (2 min) | Counts to the earlier time; "2 min early"; Due when it comes. |
| S5 | Cancelled at 7:46 | "Cancelled", next T1 shown; no countdown to the cancelled run; one alert. |
| S6 | Platform 7 to 6 at 7:47 | "Plat 6, was 7" on card and screen; one alert; one voice cue if open. |
| S7 | Interchange missed | Card counts to the next found service; one alert with it. |
| S8 | Feed stops at 7:47 | 7:49 "about 7:54pm, Updated 7:47pm"; 7:52 "Timetable 7:50pm, no live data since 7:47pm"; 7:57 "No live data, open the app"; nothing moves on by the clock. |
| S9 | Location off | Identical to location on: the trip follows the live train; alerts from the server (locked) or the app (open). |
| S10 | Silent switch on | No app speech and no clip sound (the phone mutes alert sounds); one buzz per step; card and alerts as normal. |
| S11 | App killed at 7:51 | Server keeps the card and alerts; reopen at 7:58 is silent and resumes. |
| S12 | 12 hour and 24 hour phones | Every time on every surface follows the phone ("19:54"). |
| S13 | Largest text, SE and Pro Max | Every status line one line; VoiceOver reads the whole. |
| S14 | Testing from home with a live train | Trip runs through every phase with the live train; heads-up, Get off now and arrival ring and speak at the live moments; nothing from the timetable clock; no "missed it". |
| S15 | Boarding stop not matched | Matched by name and position; if not, labelled timetable only, no phase moves. |
| S16 | Get off at minus 30 s, phone locked | Live arrival read every 15 s from 5 min out; Get off now pushed at arrival minus 32 s, lands about 30 s before; expires at arrival + 30 s; one ring. |
| S17 | Arrival estimate jumps in the last minute | (a) later by 2 min at 7:58:20: timer moves to 8:00:30, no second heads-up; (b) earlier by 40 s at 7:58:20: fires at once; (c) train shown at the platform first: one "Croydon now. Get off here."; (d) reading 3 min old at fire time: quiet note, no sound. |
| S18 | Calm sequence | Order heads-up, Get off now, arrival; each once; Kylie clips whole; one light tap or buzz each; no "Wake up"; locked, background and app-open variants ring once each, never twice. |
| S19 | Widget for the whole trip | Widget matches the card at every named minute from Start trip to 2 min after arrival; never "Checking for the next one" or "Trip started". |
| S20 | Live data lost 3 min before Croydon | Card holds "Croydon about 7:59pm, Updated 7:56pm"; no Get off now with sound, no arrival claim; quiet note only if the reading is under 5 min old. |

### 4.4 Native audit additions

- Probe the Lock Screen status line, the warning and the arrive line as one-line items.
- Fixtures: waiting with "4 min late" and "Platform 7"; "12 min late" and "Platform 10"; target in the past (Island compact, minimal, Lock Screen) asserting "0:00" never appears; stale at 2, 5 and 10 min; Due; Cancelled; "Next: Burwood"; "Croydon next"; "Get off now"; Arrived; 24 hour locale. The same phases for the widget (Home Screen and Lock Screen sizes) and the Watch.
- A logic test for the widget timeline: with a live trip whose times pass, the widget moves through every phase, the row stays, and "Checking for the next one" or "Trip started" never appears.

### 4.5 What only his phone can show

- The server's pushes reaching the locked card on time (and Apple's push budget not throttling them).
- The audio: no speech on open; the first word of a cue not clipped; Silent switch muting.
- Get off now landing about 30 s before the live train reaches the stop, with the phone locked, and moving when the train is held.
- The Kylie clips playing whole as alert sounds, starting soft, muted by the Silent switch, one buzz each.
- A trip tested from home following the live train to "arrived", with the widget in step the whole way.
- Direct alerts arriving once apnsAlerts is on.

## 5. Implementation plan

Step 0 (read only, about 5 min, with Bidur's OK to make two live reads): read his card row on the server (pushes, last push, status) and replay the service answer for his leg to see which of the three feed shapes it was.

Phase 1: the simulator and failing tests (no behaviour change).
- The tripsim harness, S1 to S20 as failing tests where today's code is wrong, and the native audit fixtures.
- Effort: about half a day of work. Ships: nothing.

Phase 2: the shared trip state, phone JavaScript and server (OTA plus deploy).
- One trip state with sources and ages (G1, G2, G6, G7, G8, G13, G17, G21, G22); phases follow the live train and hold with stale labels when live data is missing (2.2, 2.4).
- The calm sequence (2.6): heads-up from the live train, Get off now at the live arrival minus 30 s, arrival alert; the server's 15 s reads and per-trip timer near the stop, the jump rules, one moment key per step so nothing rings twice (G15, G37 to G41). Uses the Kylie getoff_soon and getoff_now clips already in build 211.
- Voice rules V1 to V9 (G12); the "Wake up" alarm removed (G9); in-app screen from the render model (G26).
- Card payload for build 211: stale date at the live departure (no 0:00 freeze), always send `updated`, live arrival for the get off stale rule, stale ladder words (G3 interim, G10, G25). Widget data written with live times (G11 interim).
- Server: matching, board time on the card, carried delay, alert fixes, catch-up, expiry, start note (G14, G18 to G20, G23, G32 to G35); regenerate the card code; 12 or 24 hour words from the app's setting (G29).
- Effort: about one day. Ships: one server deploy and one OTA to runtime 1.2.0 (build 211), both from the same commit so phone and server agree; the OTA for older runtimes follows only if their tests pass.
- Fixes on build 211: countdown, delay, arrival time, speech on open, "arrived" before the train, the "Wake up" alarm, 0:00 becomes "about 7:54pm", the trip follows the live train when testing from home, heads-up and Get off now at minus 30 s spoken by Kylie while locked (once direct alerts are on, decision 2), arrival spoken in the app.
- Does not fix on build 211: the widget for the whole trip (only the early drop at the timetable time is fixed), "Trip started", the Watch, the one-line status line, the Island wording, the arrival spoken while locked (new clip, unless the sound folder copy works on his phone).

Phase 3: build 212 (native).
- Past target shows Due, never 0:00 (G3); the widget for the whole trip: a timeline entry per phase, reads the trip from the server itself, shows the delay, no "Trip started" (G4, G5, G11, G28); Watch the same (G27); the Kylie arrival clip bundled (G37); one-line status plus audit probes (G24); stale ladder on its own (G25); new card fields with live flags, delay, timetable and times as numbers (G31); VoiceOver (G30); Island wording (G10); an "End trip" button on the card.
- Effort: about one to one and a half days, plus the build and TestFlight (about 1.5 hours). Ships: build 212.

Phase 4: on his phone.
- Trips tested from home with a live train are now a full test (decision 5); one real ride at a quiet time for the Get off timing on a moving train. On build 211 after Phase 2, and again on 212, with the checklist in 4.5.

Order and risk:
- Phase 2 must ship server and phone together: a phone on the new rules with the old server (or the reverse) draws two different cards.
- Get off now at minus 30 s depends on the push arriving in time. Delivery is usually a second or two but not guaranteed; the server aims 2 s early and the alert expires 30 s after the live arrival, so a very late one never rings after the stop.
- Reading the live data every 15 s near the stop costs more calls per trip for the last 5 min only; this stays inside the daily data budget for one rider, and is checked against it in Phase 1.
- Apple limits how often a Live Activity can be pushed at high priority; the server should send high priority only for changes the person must see (heads-up, Get off now, arrival, delay, platform), and normal priority for the 60 s refresh. Watch the push results on his card row.
- When the feed is thin, the trip holds its phase with "Updated" words instead of moving on. That is honest, and the words must make it read as intended.
- Main has no server-211 code; any server deploy from main would undo the server fixes. Phase 2 deploys from the trip branch, and main gets the merge after his test.

Decisions for Bidur:
1. Approve the rule: "arrived", "next stop" and "get off" only from the live train (never the timetable clock). When live data is missing, the trip says so and waits.
2. Turn on direct alerts to his phone (apnsAlerts), with one test push. Today no server alert can reach his phone; this is now required for the heads-up, Get off now at minus 30 s and the arrival alert while the phone is locked.
3. Confirm the calm sequence and its words: heads-up when the train leaves the stop before (or 2 min out), Get off now 30 s before arrival, then arrival, each once with Kylie's voice and one light buzz. It replaces "Wake me before my stop".
4. Ship order: Phase 2 as an update plus server first, then build 212.
5. Testing from home: a started trip follows the live train, so testing on his phone from home with any live train is a real test of every phase; the simulator and screenshots cover the rest. Test switches stay in developer builds only.
