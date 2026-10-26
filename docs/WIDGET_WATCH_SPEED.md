# Widget and Watch speed (plan for build 209, 1 Nov)

Written 26 Oct 2026 for Bidur's 11:24 AM ask ("Widget. Watch. App everywhere"). Nothing here ships before build 209:
every step below needs native code. The JavaScript parts that feed it (the board engine, the on phone timetable
packs) are already live or ship over the air.

## How they get data today

* **iPhone widgets** (`app/targets/widget`): each timeline asks the server itself (`APIClient.swift`, `URLSession`)
  for a board or a trip, then asks iOS for its next reload with `WidgetText.reloadDate` (5 to 15 minutes, 1 to 5 with
  a trip under way). iOS decides when that really happens, and a widget that has used its daily refresh budget waits.
  The first paint after a reload waits for the network.
* **Watch app and complications** (`app/targets/watch`, `app/targets/watch-widget`, both `WatchCore.swift`): ask
  `api/trip` and `api/departures` over the watch's own network on every open and timeline reload. On a watch away
  from the phone that is LTE or a Bluetooth relay, often 1 to 3 s.
* **Shared data** (`app/platform/widgetShare.ts`): the app writes Home, Work, saved trips, starred stops and the live
  trip card into the App Group `group.com.maisysen.nswtransport`. Times are not shared; every surface fetches its own.

## The plan: read first, network second

1. **One shared board cache in the App Group.** The app already holds the last board for every stop it shows. In 209
   it also writes them, with `dataAt`, to a file in the App Group container (`boards.v1.json`, one entry per starred
   stop and per Home or Work stop, at most 20, about 3 KB each). Widgets and the watch read this file first and paint
   at once, then fetch.
   * New: `app/targets/widget/SharedBoards.swift` (read, age check, decode the server's `/api/departures` shape).
   * Changed: `TransportWidgets.swift` (timeline provider reads `SharedBoards` before `APIClient`),
     `app/modules/transport-ios` (one `writeSharedBoards(json)` call, feature detected from JavaScript),
     `app/platform/widgetShare.ts` (builds the file contents, unit tested like `starredFor`).
2. **Timetable fallback on the widget.** The on phone timetable packs (`/api/timetable`, see ENGINE.md) are also
   written to the App Group for starred, Home and Work stops. A widget with no fresh board shows scheduled times
   from the pack, marked as scheduled, instead of an empty state or a spinner. The timeline then carries entries for
   the next hour from the pack, so the widget keeps counting down with no reload at all.
   * New: `app/targets/widget/TimetablePack.swift` (the pack's rows to `[Date]`, same rules as the app's
     `timetableCore`).
3. **Pushed updates instead of polling.**
   * **Live Activity**: already pushed by the server (`/api/live-activity`, APNs). The board engine makes those
     pushes cheaper: the push job reads the engine's prebuilt board for the trip's stop instead of asking the Trip
     Planner. Server only, no build needed; listed here because 209 is when the widget side is checked on devices.
   * **Widgets**: iOS 26 widget push (`WidgetCenter` push token through `WidgetPushHandler`, APNs topic
     `com.maisysen.nswtransport.push-type.widgets`). The server sends a widget push when a starred stop's next
     departure changes by a minute or more, or is cancelled, at most every 2 minutes per device (Apple budgets
     these). New: `app/targets/widget/WidgetPush.swift`; server: a `widget_tokens` table (D1 migration, ask first)
     and a sender in the engine's tick for boards that have tokens.
   * **Watch**: the phone forwards the shared board file through `WCSession.transferCurrentComplicationUserInfo`
     when it changes (budgeted by watchOS, about 50 a day), and the watch app reads it before it asks the network.
     Changed: `app/targets/watch/WatchCore.swift`, `app/targets/watch-widget/WatchCore.swift`,
     `app/modules/transport-ios` (the `WCSession` sender).
4. **Built in server address.** Covered in IOS27.md "Build 209": `APIBase.swift` and `CommuteIntents.swift` move
   their built in address to api.transportsydney.app, so a widget whose App Group has not been written yet still
   asks the fast server.

## Targets to check on devices after 209

| Surface | Today | Target |
|---|---|---|
| Widget first paint after a reload | waits for the network | from the App Group file, no network |
| Widget with no network | last entry or empty | scheduled times from the pack, marked scheduled |
| Watch app open | 1 to 3 s on LTE or relay | board from the phone's copy at once, live times after |
| Live Activity update | Trip Planner per push | engine board per push |

Not checked on any device yet: widget push budgets on iOS 26 and 27, and `transferCurrentComplicationUserInfo`
budgets on watchOS 12. Both are Apple's numbers and are read in the 209 build checks, not assumed here.
