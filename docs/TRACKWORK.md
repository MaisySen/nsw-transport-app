# Weekend trackwork

From Thursday 6pm to Sunday, Home shows a Trackwork this weekend card, only when planned work this weekend touches a Home trip (Home and Work, commutes, saved trips). Optional: one notification on Thursday 6pm.

## Where the answer comes from

| Server | Source | Added time |
| --- | --- | --- |
| New (`/api/trackwork` answers) | GTFS realtime service alerts v2 with their active periods, matched to the trip's path (docs/API.md, Weekend trackwork) | Yes: the planner for the weekend day against a week later ("Your trip takes about 25 min longer") |
| Current (404 on `/api/trackwork`) | Worked out on the phone from `/api/alerts?q=<line>` for each line the Home trips use (at most 6 lines, kept 30 min) | No: the current server plans only today and tomorrow |

The phone's version (`weekendFromAlerts` in `app/src/lib/trackworkCore.ts`, 25 Oct, 5 PM):

* Planned work: rail words ("Buses replace", "trackwork", "Trains run to a changed timetable", "Trains run between X and Y only", "not running") or bus words ("diversion", "detour", "will not stop"). Station updates, lifts, escalators and permanent changes are left out.
* This weekend: the dates the alert names ("Saturday 24 and Sunday 25 October", "Friday 30 October to Monday 2 November") cover this Saturday or Sunday. Ranges over 4 days are ongoing changes and are left out. The coming weekend from Monday to Friday, the one under way on Saturday and Sunday.
* On the trip: the alert lists one of the trip's lines and, when it names places ("between Hornsby and Gordon"), one of them is where the trip boards, changes or gets off. A trip wholly inside a named section (Gordon to Pymble for work between Hornsby and Wynyard) is missed on this server; the new server matches by the trip's full path.
* The row: "Sat and Sun: T1 North Shore Line: Trains run between Hornsby and Wynyard only" (the alert's words up to its first date), tap for Transport for NSW's page.

Checked on 25 Oct with live alerts: Strathfield to Kings Cross (T9 or T1 then T4) gets the T4 City Circle work and not the T1 North Shore or T1 Western work (their places are not on the trip).

## Thursday heads up

More > Settings > Weekend trackwork heads up (off by default; turning it on asks for notifications). While Home is open, Monday to Thursday before 6pm, at most every 6 hours for the same trips, the app works out this weekend (from either server) and sets one local notification for Thursday 6pm (DATE trigger, identifier `trackwork-weekend`): "Trackwork this weekend" / "Strathfield to Kings Cross. Sat and Sun: ... Also on 1 more of your trips." With nothing touching a trip it cancels any it set. No answer (offline) leaves it as it was. Nothing runs in the background; if Home is not opened before Thursday 6pm, there is no heads up, and the card is there from Thursday 6pm.

On the new server a trip with an active morning check is left out, because the server sends its own Thursday push for it (docs/API.md, Weekend trackwork push). A tap opens Home. Delete all my data turns it off.

## Tests

`app/test/trackwork.test.mjs` (the card), `app/test/trackwork-alerts.test.mjs` (Sydney weekend dates and daylight saving, dates in alert words, real alerts from the current server, places, the Thursday plan).
