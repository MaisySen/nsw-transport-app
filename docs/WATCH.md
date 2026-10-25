# Apple Watch app

Branch `watch-app`, merged into the next iPhone build. watchOS 10 and later, companion to the iPhone app.

## What it shows

* Trip in progress (from the iPhone trip card): line, "Leaves in 4 min" and platform while you wait, "Get off at Redfern" with minutes while on board, next stop, and the warning on the card (a change at risk shows in red). The watch taps the wrist about a minute before the train gets to your stop, when the watch app is open (best effort; the iPhone "Wake me before my stop" alarm also reaches the watch when the phone is locked).
* Commute: Home to Work before 12pm, Work to Home after, swapped when the commute card on the phone was swapped for this half day (same rule as the phone widget). The next 3 trips with line, minutes, platform and a Live or Timetable mark.
* Starred stops (up to 8, in the app's order) with the next departure; tap one for the next 3.
* "Updated 9:41am" under the times; "Offline. Updated 9:41am" when the last refresh could not reach the server. Times already gone are left out.
* Empty states say what to do: open Transport on the iPhone once, or set Home and Work.

Complications and Smart Stack (watch face editor or Smart Stack, "Transport", "Next train"):

* Rectangular: "T1 4:12, Plat 2" counting down, what it is for ("To work", "Your trip", "Off at Redfern") and the next service time, the get off stop, or "Updated h:mm" when the kept times are over 5 minutes old.
* Circular: a ring that empties over the last 15 minutes, with the line and the countdown.
* Inline: "T1 4:12, Plat 2".
* Corner: the countdown with the line and platform.

## Battery

* The complications never load anything. They draw the times the watch app last loaded and the trip card from the phone, with system countdowns (`Text` timer style, `ProgressView(timerInterval:)`), so a timeline has one entry per service, not one a minute. They reload on their own at most every 15 minutes (every 5 while a trip runs), and the watch app asks for a reload only when the service or trip they show changes.
* The watch app loads live times only while it is on screen (on open, then at most once a minute), with 8 second timeouts; the kept times show when a load fails. No background refresh.
* The phone sends the context at most every 2 seconds and only when it changed; the trip card goes without its progress fraction and with its load time to the minute, so a running trip does not resend every few seconds.
* One wrist tap per get off stop per trip, remembered across launches.
* When the times the app loaded have all gone, the complications say "Open Transport for times"; the app loads 6 trips ahead for the commute so that is rarely before the next time it is opened.

## Data path

* iPhone: `platform/iosBridge.ts` builds the context with `platform/watchShare.ts` (server address, profile, Home, Work, the commute swap, starred stops, trip card) whenever the widget data or the trip card changes, and calls `sendWatchContext` in `modules/transport-ios` (`WatchLink.swift`, WatchConnectivity application context, plus a direct message when the watch app is open). Builds without the function (201 to 205) skip it, so an update from main changes nothing there.
* Watch: `targets/watch` reads the context, loads `/api/trip` (commute) and `/api/departures` (starred stops) from the server the phone named while it is on screen, and keeps the context and the last times in a keychain group shared with the complications (`targets/watch-widget`).
* `WatchCore.swift` is the same file in both watch targets (test/watchshare.test.mjs checks it, and that the Swift fields match what the phone sends).

## Signing

* Bundle ids (registered 25 Oct 2026 through the App Store Connect API): `com.maisysen.nswtransport.watchkitapp` (7LC3QGW793) and `com.maisysen.nswtransport.watchkitapp.complications` (47JKVK83LM).
* No App Group on the watch targets, so nothing has to be ticked on developer.apple.com. The watch app and the complications share data through the keychain group `$(AppIdentifierPrefix)com.maisysen.nswtransport.watch`; every App Store profile of the team allows `keychain-access-groups` `B85KQRQZW7.*`.
* App Store profiles (Apple Distribution certificate 4D44J7J7N7, expire 24 Oct 2027), in the build box secrets folder `ios-expo/`: "Expo Transport Watch AppStore" (`Expo_Transport_Watch_AppStore.mobileprovision`) and "Expo Transport Watch Complications AppStore" (`Expo_Transport_WatchComplications_AppStore.mobileprovision`).
* `credentials.json` (git ignored) needs two more entries beside the app and the widget, keyed by Xcode target name, with the same distribution certificate:
  * `TransportWatch`: the Watch profile
  * `TransportWatchWidget`: the Watch Complications profile
* Versions: apple-targets sets MARKETING_VERSION from app.json `version` and CURRENT_PROJECT_VERSION from `ios.buildNumber` on every target, so the watch app matches the iPhone app.

## Not checked on a real watch

Pairing, WatchConnectivity delivery, the keychain group at run time, complications on a face and in the Smart Stack, and the wrist tap. Compiled in EAS simulator builds only (iPhone app with both watch targets, watchOS simulator SDK).
