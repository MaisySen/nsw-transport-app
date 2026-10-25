# Why it's late

One short line under a late or changed service that says why, in Transport for NSW's own words. Added 25 Oct 2026 (over the air, builds 201 to 206 and Android). Code: `app/src/lib/whyLateCore.ts` (rules, unit tested in `app/test/whylate.test.mjs`), `app/src/lib/whyLate.ts` (fetching), `app/src/components/WhyLate.tsx` (the line).

## What it shows

* `Delayed: incident requiring emergency services at Allawah` on a service running 2 min or more late on a live time.
* `Cancelled: police operation at Central` on a cancelled service.
* `Changed: urgent track repairs` on a service with its own trip alert (Not stopping at, Now ending at, Starting from) and no delay.
* One line, cut at a word with an ellipsis at 80 characters and again by the screen at its width. Tap it to open the full alert on transportnsw.info. VoiceOver and TalkBack read it with the row and offer "Why it's late" as an action on the row.

On a trip card or service row with more than one ride, the line is named: `T4 delayed: incident requiring emergency services at Allawah`, so it does not seem to contradict an On time first train.

Where: departure rows (stop screens, starred stops on Home), the board (third line of the row), each service row and each leg on a trip screen (saved trips included), the Home trip cards (Next trip card and rows) and the live trip card.

## Where the reason comes from (no guessing)

1. Only alerts linked to that service: a departure's alert ids (resolved against the board's `alerts` list) or a leg's own `alerts` from `/api/trip` and `/api/service`. An alert on the same line but not linked to the service is never used.
2. Low and very low priority alerts, lifts, escalators, accessibility, Opal, car parks and "platforms may change" notes are never a reason.
3. The cause has to be written in the alert: after "due to", "because of", "caused by" or "following", or an alert that starts with the cause ("Police operation at Central", "Signal repairs at Redfern", "Urgent track repairs", "Severe weather"). A trackwork note such as "Trains run to a changed timetable and stopping pattern" names no cause and shows nothing.
4. The departures and trip answers carry only an alert's title. For services that could show a reason, the app asks `/api/alerts?q=<line>` (the current server already answers it, the old address is not changed) and matches the full text by the alert id in its link. Lines without a number (CCN, Blue Mountains) are not asked, because the server filters by line only for names with a number; their own titles still count.
5. Trip alerts first (Running late and the like), then by priority, then in the order the server gave.

Nothing found: no line. The existing alert note on a row (an alert the top of the stop screen does not already show) stays as before when there is no reason line.

## Battery

No polling of its own. A screen's own live data (already polled by `useLive` only while on view) decides when to look; `/api/alerts` is asked once per line and kept 3 minutes; a failed ask hides the line and is tried again after 30 s at the earliest. No new native calls.

## Seen on 25 Oct with live data

A T4 leg on Strathfield to Kings Cross ran 13 min late with the linked alert "Eastern Suburbs & Illawarra Line, South Coast Line" whose full text says "Allow plenty of extra travel time in both directions due to an incident requiring emergency services at Allawah earlier": the leg shows `Delayed: incident requiring emergency services at Allawah`.
