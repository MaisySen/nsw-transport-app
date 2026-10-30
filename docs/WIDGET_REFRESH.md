# Widget and Watch refresh

Why the widgets and the Apple Watch changed only after the app was opened (owner, testing build 209 on 30 Oct 2026), what
build 210 changes, and the push design that comes after it. Branch `build-209` only; nothing here is built yet.

## What was wrong (build 209 and every build before it)

The iPhone widget extension does fetch live times itself (`TransportAPI` with `URLSession` in
`targets/widget/TransportWidgets.swift`, `NextTripProvider.entry` and `StopBoardProvider.entry`), and the 209 IPA had the
app group, the server address and the profile right (checked in the build log of run 41000215686: the widget appex carries
`group.com.maisysen.nswtransport`). So the fetch was fine. What failed was when it ran and what was on screen in between:

1. Too many asks. `WidgetText.reloadDate` asked iOS for a new timeline every 15 minutes, and every 5 when the list was short,
   day and night: 96 to 288 asks a day for each widget. WidgetKit gives a widget about 40 to 70 a day. iOS serves asks past the
   budget later and later, and once the day's budget is gone, not at all, until the app comes to the front (a reload from
   the app in front is free, and `platform/iosBridge.ts` reloads every widget on each open). That is exactly "it refreshes
   when I open the app".
2. A short timeline. The trip widget had an entry a minute for 20 minutes, the stop board for 15. When iOS served the next ask
   late, the widget sat on its last entry: the minutes stopped counting and services that had left stayed on screen.
3. Since build 209 a live time older than 2 to 5 minutes shows as its timetable time with "Updated N min ago" (the app's own
   rule, `WidgetLive.swift`). That is right, but with throttled reloads it made the old data plain to see.
4. A slow fetch could be cut off: 12 s with one retry (up to 24 s) per call, and Home and Work (auto) can make three calls in
   a row.
5. Offline, the stop board was empty ("Live times will be back shortly").
6. Apple Watch: the complications never loaded anything (`targets/watch-widget/Complications.swift` said so in its header).
   They drew the times the watch app last loaded, and the watch app loaded only while on screen. No background refresh
   existed. So the watch face changed only after the watch app (or the phone app, which sends Home, Work and the trip card)
   was opened.

Nothing else refreshes in the background on build 209: the app has no `UIBackgroundModes`, the widget extension has no push
entitlement (`aps-environment` empty on the appex), and the server's pushes go to the trip Live Activity only.

## What build 210 changes (branch build-209)

* `targets/widget/WidgetRefresh.swift` (new, pure Foundation, compiled on its own by `app/test/widgetrefresh.test.mjs`):
  * Entries: one a minute for an hour, plus one the moment each service leaves (`WidgetText.entryDates`, both widgets, Lock
    Screen and StandBy, which share the providers). Minutes count down and services drop off by the clock however late iOS
    reloads.
  * Reloads spent by the time of day on the Sydney clock: every 15 minutes in the weekday peaks (6:30 to 9:30am, 3:30 to
    7pm), 20 in the rest of the day, 30 from 9pm to 12:30am, hourly from 12:30 to 5am. Sooner (not before 5 minutes, 10 in
    quiet hours) only when the list is down to its last service. About 65 asks a weekday and 59 on a weekend per widget,
    inside the budget, so iOS keeps serving them on time.
  * A trip in progress keeps its 5 minutes (it reads the app's card, no network).
  * A fetch that failed tries again in 15 minutes (hourly overnight).
* The widget waits 8 s for the server, once (no retry in the extension), then shows what it saved.
* Offline stop board: the last rows for that stop and line filter are kept in the app group (`BoardCache`); offline they show
  at their timetable times, never as live, services that left dropped, with "Offline, times from 5:12pm".
* Apple Watch (`WatchRefresh` in `WatchCore.swift`, both copies identical):
  * Complications load the commute themselves on each reload when the kept times are over 4 minutes old (or fewer than two
    services are left), 8 s at most, and save them for the watch app. Reloads every 20 minutes in the weekday peaks, 30 in
    the day, 45 in the evening, hourly overnight: about 47 a weekday, inside watchOS's budget. A trip in progress (the
    phone's card) every 5 minutes. Countdowns stay system timers, one entry per service.
  * The watch app asks watchOS for a background refresh on the same clock (`WatchAppDelegate`,
    `WKApplication.scheduleBackgroundRefresh`), loads the commute and starred stops then, saves them and reloads the
    complications only when what they show changed. It still loads on open and every minute while on screen.
  * The trip card and Home and Work still come from the phone (WatchConnectivity); the trip itself is on the watch as the
    iPhone's Live Activity, which the server already pushes.
* App (JavaScript, works on every build): leaving the app reloads the widgets once more when their last reload from the app is
  over 2 minutes old, so the hour of entries starts from fresh times as the phone is locked.

Checks: `app/test/widgetrefresh.test.mjs` (compiles both rules with swiftc when present), and logic tests run by the native
audit on the simulator: `native-tests/native-audit/Tests/iOS/WidgetRefreshLogicTests.swift`,
`Tests/Watch/WatchRefreshLogicTests.swift`.

## What can ship over the air

Only the JavaScript part (reload on leaving the app). The reload rule, the hour of entries, the offline board and the whole
Watch fix are native code in the widget and watch extensions and need build 210. Builds 201 to 209 keep their own widget code.

## Next: widget push updates (iOS 26 and later), designed, not built

WidgetKit can reload a widget from a push (iOS 26). It would let the server say "this board changed" (a delay, a cancellation,
a platform change) instead of the widget asking on a clock. Still budgeted by iOS, so it adds to the clock above, it does not
replace it. What it needs, all of it, before any code ships:

1. Apple: Push Notifications on the widget's App ID (`com.maisysen.nswtransport.widget`), and a new App Store profile for the
   widget with `aps-environment`. Both can be done with the App Store Connect key on file; nothing for the owner.
2. Widget extension (build 211 or later): a push handler on each widget configuration, behind `if #available(iOS 26, *)`,
   that receives the widget push token and the widgets it covers, and sends them to the server with the install's profile
   (`POST /api/widget/token {token, profile, widgets: [{kind, stop, lines} | {kind, from, to}]}`). `aps-environment` in
   `targets/widget/expo-target.config.js`. Exact type and method names to be read from the iOS 26 SDK headers on the Mac
   before writing it.
3. Server: store tokens per profile (drop on APNs 410), and in the existing minute job, for each token whose widget shows a
   service in the next 30 minutes, compare the first two services with what was last pushed; on a change of 2 minutes or
   more, a cancellation or a platform change, send one APNs request with push type `widgets`, topic
   `com.maisysen.nswtransport.push-type.widgets` and body `{"aps":{"content-changed":true}}`, reusing the APNs key the Live
   Activity pushes use. At most one push per token per 5 minutes; none from 12:30 to 5am.
4. Privacy: the token is a device push address tied to the random install profile, the same kind the Live Activity already
   sends; no new data type, but the privacy page's push line should mention widgets.

Size: about a day of work plus a build. Worth doing after 210 is on phones and the clock above is measured.
