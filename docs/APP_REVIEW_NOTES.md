# App Review notes (App Store Connect > version 1.0.0 > App Review Information > Notes)

The source for the Notes field. It lists every feature that appears, changes or switches off from the server, as App Review guidelines 2.5.2 (the app is self contained and downloads no code) and 2.5.19 (no hidden, dormant or undocumented features, added 16 Oct 2026) expect, and 2.3.1(a) (new features described in the notes).

## Status

* Written to App Store Connect through the API on Wed 28 Oct 2026, 3:53 PM Sydney, and read back: 3854 characters (limit 4000), identical to the text below.
* Saved as a draft only. Nothing was submitted, no build was attached or changed (the version still has build 208), and the contact fields are unchanged (Bidur Khatri, contact@fintex.au, his mobile on file in App Store Connect, not written here because the repo is public). Sign in required: No. The version is still Prepare for Submission.
* Replaces the 26 Oct text (3562 characters, kept in git history in store/apple/review-notes.md).

## What changed from the 26 Oct text

* Added the 28 Oct server features: Often does not run, Not stopping at (stop) today, the off peak hint, the walking limit sent to the trip planner, and the 5 minute freshness rule for Live.
* Added features the 26 Oct text left out: Plan B on the trip and Home (not only in the morning alert), Step free routing, platform change alerts, Alerts for my trips.
* Remote configuration now names everything it can do (switch features off or back on, timings, server address, WebSocket boards) and that the server can build boards and trip plans itself from the same data (board engine and own planner, both off today).
* Test steps shortened to make room; the get off alert choice (1, 2 or 3 stops early, spoken Get off now) and the Max walk chips are in the steps.

## Before submitting (root or owner)

* Attach build 209 (from 1 Nov) to version 1.0.0 and reread this text against it: if 209 adds Sentry crash reports, the App Privacy Crash Data answer must be in first (store/apple/app-privacy.md).
* Apple Watch screenshots must be uploaded first (store/screenshots/README.md).
* If a feature switches on or changes from the server after 28 Oct, add one line under SERVER DATA here and in App Store Connect, and read it back.
* Submit only with the owner's written OK.

## Where each server feature comes from

| Feature in the notes | App switch (remote config) | Server switch or field |
| --- | --- | --- |
| Plan B | none (works from the trip's own services) | `planB` in the morning check evaluation |
| Weekend trackwork card | `weekendTrackwork` | `/api/trackwork` |
| Status of my lines | `lineStatus` | `/api/lines` |
| Last way home reminder | `lastWayHome` | `lastWayHome` |
| Usually late | `usualLate` | `usualLate`, `/api/usual` |
| Reliability | `reliabilityPick` | `reliabilityPick` |
| Park and Ride fills | none (`parkRide` is in the defaults but no screen reads it) | `/api/parking`, `/api/station` |
| Quieter carriages | `occupancy` | `occupancy` |
| Often does not run | none (shows only with the `noShow` field) | `noShow` |
| Not stopping at (stop) today | none (shows only with the `notStopping` field) | `notStopping`, `/api/detours` |
| Off peak hint | none (shows only with `fare.offPeak.save`) | fare tables on the server |
| Walking limit to the planner | none (chips filter on the phone anyway) | `WALK_PLANNER` |
| Step free routing | `liftAwareRouting` | `liftAwareRouting` |
| Platform change alerts | | `platformAlerts` |
| Morning check | `morningCheck` | `morningCheck` |
| Alerts for my trips | `tripAlerts` (shown only when `true`) | `tripAlerts` |
| Calendar leave by | `calendarLeaveBy` | |
| Live board push (WebSocket) | `livePush` (off unless `true`) | `LIVE_PUSH` (off) |
| Freshness rule | none (the phone also caps Live at 5 min) | `feedAgeCap`, `feedHeaderTime` |
| Server built boards and trips | none | `ENGINE_BOARDS`, `OWN_PLANNER` (both off), `ENGINE_FEED_ONLY` |
| New trip first look (timetable times shown while the live search runs, labelled Timetable) | `tripTt` (kill) | `TRIP_TT`, `TRIP_TT_OWN`, `/api/trip?tt=1` |
| Past and upcoming apart on trip lists and stop boards (gone services under Earlier, a Now divider, the list opens at Now; layout only, 30 Oct) | `pastNow`, `pastNowScroll` (on unless `false`; the server can only switch them off) | none |

App switches are `flags` and `kill` in `/api/app/config` (an unknown flag counts as on). Server switches are the same sections under `platform=server`, read once a minute; the budget guard holds `ENGINE_BOARDS`, `ENGINE_PUSH`, `LIVE_PUSH`, `OWN_PLANNER`, `ENGINE_LEARN`, `LOAD_TESTS` and `TRIP_TT` off when the month is projected over its line (docs/COSTS.md). The server address is `copy.api_base` (docs/API.md).

## Notes

Transport: Sydney Live shows live Sydney and NSW public transport times. It is free, with no accounts, sign in, ads or in-app purchases, so no demo account is needed. Every screen works from any location.

DATA SOURCE
Transport information comes from Transport for NSW Open Data, licensed under CC BY 4.0, credited in More and in the description. The app is independent, by Fintex Australia Pty Ltd, not made or endorsed by Transport for NSW, and uses no Transport for NSW logos.

HOW TO TEST
1. First launch: pick Parramatta as Home and Wynyard as Work. Home shows the next trip as a big card. Every time says Live (with its age), Timetable or Not tracking.
2. Plan: search Central for a departure board. Plan Chatswood to Bondi Junction with Leave now, Leave at or Arrive by. Chips set the mode and a walking limit (Max walk 5, 10 or 15 min, Prefer bus).
3. Buses: search route 333, or a stop number from a stop sign.
4. Ask: type "next train Parramatta to Central". Ask answers from live data by fixed rules, with no generative AI.
5. Start trip: open a trip, tap Start trip for a live map, next stop, arrival time and a Live Activity. Get off alerts come 1, 2 or 3 stops early (your choice) and a Get off now alert before your stop, optionally spoken.
6. Reminders: saved trip, Reminders, Add a reminder. More > Check my trip before I go alerts only if something is wrong.
7. More > Delete all my data removes what the server keeps for this install.

PERMISSIONS
Location: optional, only on a location button tap, foreground only.
Notifications: never at launch; asked when you first turn on an alert.
Calendar: only for Calendar leave by in More (off by default), read only.

SYSTEM FEATURES
Live Activities (step 5); Home Screen, Lock Screen and StandBy widgets; Siri ("Next train home in Transport"); Control Center (search Transport); Apple Watch app and complications.

SERVER DATA AND REMOTE CONFIGURATION (guidelines 2.5.2 and 2.5.19)
All of these are in this build, documented here, and none is behind a hidden setting or code. Each appears only when our server (api.transportsydney.app) has data for it, and otherwise the screen looks as it would without it:
- Plan B: another way when a service is cancelled, a line is suspended, a change will be missed or trackwork applies (trip, Home card, morning check alert)
- Weekend trackwork card on Home; status of my lines
- Last way home reminder before the last service
- How late a route usually runs; reliability of a service
- When a Park and Ride usually fills; traffic incidents on bus legs; quieter carriages where occupancy is sent
- Live times for regional trains and coaches
- "Often does not run" on bus times that often never show live
- "Not stopping at (stop) today" for bus detours and closed stops, from service alerts
- Off peak hint on peak hour trips: leave after the peak and pay about a stated amount less (an Opal fare estimate)
- Walking limit and Prefer bus passed to the trip planner
- Step free routing around lifts out of service; platform change alerts
- Alerts for my trips (More, off until switched on; the switch shows only when the server supports it)

Freshness rule: a time is shown as Live only if the feed's own timestamp is under 5 minutes old; older data is shown as Timetable with "Updated N min ago".

Remote configuration (read at launch and when the app returns to the front) can only: switch features listed above off or back on, adjust refresh and alert timings, change the server address, or send live boards over a WebSocket instead of polling (same data, off today). The server can also switch its own features off for every app at once, and may build boards and trip plans from the same open data itself (off today); the screens and fields stay the same. It cannot add features, screens or code.

From about 1am to 4am many lines have no services.
