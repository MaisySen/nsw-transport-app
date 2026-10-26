# Button and screen check

Roadmap item 5 (briefs g23 and g23b, 26 Oct 2026). Every screen, button, sheet, switch and link the app shows, checked on the web export of the app against a local copy of our server with a fake Transport for NSW, at set times of day. No call reached Transport for NSW or our live server.

## How it was run

* `app/test/e2e/mockapi.mjs <repo> <port> [stops.json]`: the real `backend/src/worker.js` from this clone in Node, an in memory database, and a fake Transport for NSW answering from the GTFS stop list (or the station lists in `backend/src/public/stations/`). `POST /__clock {t, mode, headway, latency}` moves its clock, sets NSW to ok, down or over quota, the minutes between services and a delay on every answer.
* `app/test/e2e/buttons.mjs <out.json> <webPort>` with `MOCK_API`, `AT` (an ISO time), `HEADWAY`, `LATENCY`, `NSW_MODE`: taps the 54 buttons on the main path once each and checks each did its job on the first tap.
* `app/test/e2e/sweep.mjs <outDir> <webPort> <tag> [taps]` with `MOCK_API`, `AT`, `W`, `H`, `SCHEME`: opens 27 screens, saves a screenshot, lists page errors and words that must never show (raw status codes, undefined, NaN, null, "No more services" with no data), and with `taps` taps every visible control once and records what happened.
* Exports: `npx expo export --platform web` with `EXPO_PUBLIC_LOOK=android` (Android look) and without (iPhone look). Screenshots at 390 x 844 and 430 x 932, light and dark, are in the g23 and g23b task folders (not in the repo).

## Why the time of day buttons failed (baseline 49 of 54, 5 to 7 failures by time of day)

| Cause | Checks | Kind | Fix |
| --- | --- | --- | --- |
| In the busy hour the commute card's leave line looked only at the 6 services already loaded. With trains 2 to 3 minutes apart all 6 left before you could walk to the station, so "Leave in N min", Remind me and Cancel disappeared. | Leave in N min, Remind me, Cancel the reminder | App bug. Reproduced at 8:10 AM with services 2 minutes apart on the export before the fix: 51 of 54, these 3 failing | `1c9f0f9`: `reachFrom()` in `src/lib/smart.ts` gives the moment you could board and the card asks once for services from then (no history or install id, asked again only when that moment moves to the next 5 minutes, no polling). Test in `test/smart.test.mjs` |
| The check compared chip colours with the Android light accent, so an export with the iPhone look or dark mode failed. | Saturday on and off, lead 10 min | The check | `f558382`: a chip is on when it is filled with its own border colour |
| After 12pm the card's check is for the way home, but the check looked for the morning direction. | Check my trip before I go opens, Turn on check, Edit, Delete asks, Delete removes | The check | `f558382`: the expected name follows the card's direction |

## Main path, 54 buttons

Results in this order: 1:00 AM / 8:10 AM busy (services 2 minutes apart, every answer 0.8 s late) / 12:48 PM / 5:30 PM busy / iPhone look 12:48 PM / before the fix at 8:10 AM busy. The 1:00 AM and 12:48 PM runs are from g23 on main `25f5d14` plus the fix; the busy hour and iPhone look runs are from g23b on main `f558382` (after g22 and g25). With NSW down (every NSW call failing) 28 of 54 pass: the local server has no timetable to fall back on, so this is a limit of the check, not a finding about the app.

| Screen | Control | Expected | Result | Fix |
| --- | --- | --- | --- | --- |
| Setup | Setup opens on first launch | does what it says | pass / pass / pass / pass / pass / pass |  |
| Setup | Setup | pick home Burwood | pass / pass / pass / pass / pass / pass |  |
| Setup | Setup | pick work Strathfield | pass / pass / pass / pass / pass / pass |  |
| Home | Home | commute card on top, direction by time of day | pass / pass / pass / pass / pass / pass |  |
| Home | Home | swap flips the commute | pass / pass / pass / pass / pass / pass |  |
| Home | Home | Leave in N min from your location | pass / pass / pass / pass / pass / **FAIL** | `1c9f0f9` (app) |
| Home | Home | Remind me sets a leave alert | pass / pass / pass / pass / pass / **FAIL** | `1c9f0f9` (app) |
| Home | Home | Cancel the reminder | pass / pass / pass / pass / pass / **FAIL** | `1c9f0f9` (app) |
| Home | Home | swap back | pass / pass / pass / pass / pass / pass |  |
| Home | Home | Check my trip before I go opens the checks | pass / pass / pass / pass / pass / pass | `f558382` (check, after 12pm) |
| Check my trip before I go | Morning | 5 minutes later moves the time | pass / pass / pass / pass / pass / pass |  |
| Check my trip before I go | Morning | Saturday on, then off again | pass / pass / pass / pass / pass / pass | `f558382` (check) |
| Check my trip before I go | Morning | lead 10 min | pass / pass / pass / pass / pass / pass | `f558382` (check) |
| Check my trip before I go | Morning | Turn on check saves it | pass / pass / pass / pass / pass / pass | `f558382` (check, after 12pm) |
| Check my trip before I go | Morning | Check now shows what it would say | pass / pass / pass / pass / pass / pass |  |
| Check my trip before I go | Morning | Edit opens the check | pass / pass / pass / pass / pass / pass | `f558382` (check, after 12pm) |
| Check my trip before I go | Morning | Cancel closes the edit | pass / pass / pass / pass / pass / pass |  |
| Check my trip before I go | Morning | Delete asks | pass / pass / pass / pass / pass / pass | `f558382` (check, after 12pm) |
| Check my trip before I go | Morning | Delete removes it | pass / pass / pass / pass / pass / pass | `f558382` (check, after 12pm) |
| Tab bar | Plan | opens Plan | pass / pass / pass / pass / pass / pass |  |
| Tab bar | Ask | opens Ask | pass / pass / pass / pass / pass / pass |  |
| Tab bar | More | opens More | pass / pass / pass / pass / pass / pass |  |
| Tab bar | Home | opens Home | pass / pass / pass / pass / pass / pass |  |
| Plan | Plan | Step free switch on | pass / pass / pass / pass / pass / pass |  |
| Trip results | Trip | Step free carried from Plan, results say so | pass / pass / pass / pass / pass / pass |  |
| Trip results | Trip | Step free off asks again | pass / pass / pass / pass / pass / pass |  |
| Trip results | Opal fare row opens | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip results | Later services | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip results | Include trips with a change | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip results | Tap a service closes its details | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip results | Tap a service opens its details | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | Start trip | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | Wake me before my stop | on | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | Wake me before my stop | off | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | Share trip | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | Share dialog Cancel | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip in progress | End trip asks | does what it says | pass / pass / pass / pass / pass / pass |  |
| Trip results | End trip ends | does what it says | pass / pass / pass / pass / pass / pass |  |
| New trip | Save trip star | does what it says | pass / pass / pass / pass / pass / pass |  |
| Stop | Departures | occupancy chips only where sent (0 in the feed) | pass / pass / pass / pass / pass / pass |  |
| Stop | Star a stop | does what it says | pass / pass / pass / pass / pass / pass |  |
| More | More | Home and work shows both | pass / pass / pass / pass / pass / pass |  |
| More | More | Home and work opens setup to edit | pass / pass / pass / pass / pass / pass |  |
| More | More | Check my trip before I go opens the checks | pass / pass / pass / pass / pass / pass |  |
| More | More | Watching | pass / pass / pass / pass / pass / pass |  |
| More | More | Opal fare type | pass / pass / pass / pass / pass / pass |  |
| More | Fare type sheet | choose Concession | pass / pass / pass / pass / pass / pass |  |
| More | Fare type sheet | back to Adult | pass / pass / pass / pass / pass / pass |  |
| More | About | Made by Fintex Australia Pty Ltd | pass / pass / pass / pass / pass / pass |  |
| More | About | Contact us opens email to support@transportsydney.app | pass / pass / pass / pass / pass / pass |  |
| More | About | Fintex website opens fintex.au | pass / pass / pass / pass / pass / pass |  |
| Opal machines | Opal machines | list from the server | pass / pass / pass / pass / pass / pass |  |
| Opal machines | Opal machines | Takes cash filter | pass / pass / pass / pass / pass / pass |  |
| Opal machines | Opal machines | a row opens the stop | pass / pass / pass / pass / pass / pass |  |

## Every screen and every control (tap sweep)

27 screens, Android look, 390 x 844, light, 12:48 PM, main `f558382`. Each visible control is tapped once from a fresh load of its screen. "opens" went to another screen, "dialog" showed a dialog, "link" opened an outside link, "changes" changed the page, "gone" means the control was not on the screen again after reloading (lists that change, rows that move), "none" means nothing visible happened; each "none" is explained. No screen showed a raw status code, undefined, NaN or null, and no tap failed. The same 27 screens without taps were also run at 430 x 932 dark and 390 x 844 dark (Android look) and at 390 x 844 light and 430 x 932 dark (iPhone look): no page errors and no bad words on any of them.

| Screen | Controls | What the taps did | Bad words | Taps with no visible change |
| --- | --- | --- | --- | --- |
| Home | 22 | 4 changes, 2 dialog, 5 gone, 2 none, 9 opens | none | Speak departures: speech, no visible change on the web; Show stops near me: asks for nearby stops; the local fake NSW has no nearby search, so it waits then shows its error words (not verified with real data) |
| Plan | 7 | 1 changes, 5 gone, 1 none | none | Trip: already the selected tab |
| Ask | 5 | 4 changes, 1 none | none | Send: nothing typed yet |
| More | 17 | 3 changes, 2 dialog, 4 link, 1 none, 7 opens | none | Notifications Blocked : opens phone Settings; the web has no Settings app (web only page error, see below) |
| Stop (train, Parramatta) | 29 | 3 changes, 11 gone, 1 none, 14 opens | none | Speak departures: speech |
| Stop (ferry, Manly Wharf) | 34 | 8 changes, 12 gone, 1 none, 13 opens | none | Speak departures: speech |
| Stop (bus stand) | 34 | 8 changes, 11 gone, 1 none, 14 opens | none | Speak departures: speech |
| Full screen board | 3 | 1 changes, 1 none, 1 opens | none | Speak departures: speech |
| Trip results (Parramatta to Wynyard) | 23 | 20 changes, 1 none, 2 opens | none | Any, selected: already selected |
| Trip results (Newcastle to Wollongong) | 24 | 20 changes, 1 dialog, 1 none, 2 opens | none | Any, selected: already selected |
| Route (link to a train line) | 1 | 1 opens | none | |
| Check my trip before I go | 23 | 21 changes, 2 none | none | Parramatta to Wynyard: direction chip already selected; Any: mode chip already selected |
| Parking | 0 | no controls besides the tab bar | none | |
| Opal machines | 27 | 1 changes, 1 none, 25 opens | none | All machines: filter already selected |
| Watching | 0 | no controls besides the tab bar | none | |
| Simple mode | 11 | 3 changes, 1 dialog, 7 gone | none | |
| Voice | 3 | 2 changes, 1 none | none | Play sample: speech |
| New trip | 7 | 1 changes, 5 gone, 1 opens | none | |
| Add trip | 7 | 2 changes, 3 gone, 2 none | none | Save trip: disabled (greyed) until From and To are picked; Swap from and to: both fields empty, nothing to swap |
| Plan link | 23 | 7 changes, 1 dialog, 14 gone, 1 none | none | Any, selected: already selected |
| Setup (edit home and work) | 6 | 4 changes, 2 opens | none | |
| Trip in progress, none started | 7 | 2 changes, 3 dialog, 1 none, 1 opens | none | Settings: opens phone Settings; none on the web (web only page error) |
| Shared trip, bad link | 1 | 1 opens | none | |
| Saved trips link, bad | 1 | 1 opens | none | |
| Watch, unknown id | 0 | no controls besides the tab bar | none | |
| Car park | 0 | no controls besides the tab bar | none | |
| Old Platform view link | 1 | 1 opens | none | |

Notes:
* Parking showed the loading rows at the moment of the screenshot in this run; a separate 12 second check of the same screen listed the car parks closest first. Found while checking: an empty list would have shown a blank screen. Now it says "No car parks to show" (`app/parking.tsx`).
* Route: the route screen is for buses and coaches; every way into it is from a bus or coach. A hand made link to a train line says "No stops found for route T1."
* Watch, unknown id (`/watch/<id>` for a watch the server no longer has): showed "Live times unavailable right now, trying again" over an empty screen and asked again every 15 seconds. Fixed in `fb4b1cd`: "This watch has ended", Show Watching, and no more requests (checked: 1 request in 41 seconds, Show Watching opens Watching, 390 light and 430 dark). The tap sweep above ran on the export before this fix.
* Old Platform view link (`/platform`): Platform view was removed on 26 Oct (owner). The link now shows "This link isn't in the app" with Go to Home, which opens Home (checked at 390 light and 430 dark); before, the router's own Unmatched Route page with a Sitemap link.
* Web only: the Settings buttons on More (Notifications Blocked) and on a trip in progress call the phone's Settings app, which the web does not have, so on the web the tap does nothing and logs an error. On a phone they open Settings.
* Not checked here: anything that needs a phone (haptics, speech, notifications arriving, Live Activities, widgets, Siri, Control Center, the Watch app, the share sheet, location prompts) and screens that need live NSW data to have something to show (nearby stops, live car park counts).

## Platform view while hidden

Asked by the owner at 5:36 PM. While hidden (8:30 AM to its removal) it made no requests: the `/platform` route redirected before the screen mounted and `openPlatform()` returned at once, so its board and stop list calls never ran. It had no server endpoint of its own: `platformDepartures` and `platformService` read `/api/departures` and `/api/service`, the same endpoints as every stop and service screen. The only server output it alone read is the `cars` count on train departure rows (the `quiet` hint next to it is still used by the quiet carriage tag); it is a few bytes per row and was left in place (no server deploy for this).

## Files

* App: `src/components/Smart.tsx`, `src/lib/smart.ts` (leave line), `src/app/watch/[id].tsx` (ended watch), `src/app/parking.tsx` (empty list), `src/app/+not-found.tsx` (new), Platform view removal (see CHANGELOG).
* Tests: `test/smart.test.mjs`, `test/features.test.mjs`, `test/buttoncheck.test.mjs` (new), `test/e2e/buttons.mjs`, `test/e2e/mockapi.mjs` (new), `test/e2e/sweep.mjs` (new).
* Results: app tests 655 pass, 3 skipped offline (`OFFLINE=1`, includes battery), `npx tsc --noEmit` clean, backend 430 pass (after rebasing on main `2b61fd5`).
