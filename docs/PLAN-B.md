# Plan B

When a trip has a problem, the app names it and offers the best other way, so nobody replans on a crowded platform.

## What counts as a problem (`app/src/lib/planBCore.ts`, `problemOf`)

1. A cancelled service on the trip ("The 8:04am T1 is cancelled").
2. A line Transport for NSW says is suspended (alert words such as "suspended", "not running", "no trains between").
3. A change the live times say you will miss.
4. Trackwork: a leg is a rail replacement bus (route number then the line it replaces: 45T1, 2AT9, 1L1, 10HU, 3SH, 2CN), "Buses replace T1 trains from Pymble to Gordon". Added 25 Oct, 5 PM.

## Which other way (`planB`)

Among services leaving at least 1 minute from now that avoid the problem, the earliest arrival, then the earliest departure. Avoiding means: not the cancelled service, no leg on the suspended line, its own changes work, and for trackwork no replacement bus. For trackwork the other way must arrive at most 10 min after the replacement bus trip (`TRACKWORK_SLACK_MIN`), since the buses still run. Replacement buses count as a fine way round a cancelled or suspended service.

## Where it shows

| Place | Works on the current server | Notes |
| --- | --- | --- |
| Trip screen card | Yes | Since 25 Oct, 9:12 AM. When nothing on screen avoids it, one more planner call for the services from now. For trackwork with no faster way it says the replacement buses are still the quickest way. |
| Home trip cards (Next trip card and rows) | Yes | Since 25 Oct, 5 PM. One line under the card: "Plan B: T1 suspended. Try the 8:04am M1 from Epping, arrives 8:41am." Worked out from the services the card already fetched (6), so no extra request. Without a Plan B in those: "Open the trip for Plan B." Trackwork with no faster way shows as "Trackwork: Buses replace T1 trains from Pymble to Gordon." Tap opens the trip. |
| Morning check alert (push) | Tap: yes. Words: after the server move | The alert's words carry Plan B only from the new server (`planB` in the check's evaluation, docs/API.md). A tap on the alert now opens that check's trip (live times and the Plan B card) when the phone knows the check; otherwise the list of checks. |
| Trip reminders (local) | Yes | A reminder tap opens the trip, which shows the Plan B card when something is wrong. |
| Platform change alert | Not applicable | Same service, new platform: there is nothing to route around. |
| Weekend trackwork card | No | That card is about the coming weekend; Plan B is about the next service. |

## Battery

No new requests on Home: Plan B reads the journeys the card already has. The trip screen asks the planner at most once per problem.

## Tests

`app/test/planb.test.mjs` (cancelled, suspended, missed change, trackwork and its 10 min slack, replacement buses round a cancellation, the Home sentence, the morning alert tap).
