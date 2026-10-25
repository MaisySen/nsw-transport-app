# Apple Watch app

Branch `watch-app`, merged into the next iPhone build. watchOS 10 and later, companion to the iPhone app.

## What it shows (build 207)

Laid out the way TripView shows trips on the wrist (Bidur's photos, 25 Oct):

* The app opens straight to your trips: a list you scroll with the Digital Crown, "Transport" and the time at the
  top. Each row is the line colour bar on the left (one stripe per line when a trip uses several, from the last
  times loaded) and the route on up to two lines, "Town Hall to Strathfield". No times in the row. A saved trip's own
  name shows small above the route when it says more ("To work" on the Home and Work row).
* Order: Home to Work before 12pm and Work to Home after (swapped when the commute card on the phone was swapped for
  this half day), then the trips under Your trips on the iPhone in the same order (active commutes, trips saved on the
  phone, saved trips, then your own drag order). Nearest first is not done: it would need location on the watch.
* Tap a row: the trip screen, titled with the stop you leave from ("Town Hall", back at the top left), lists the next
  6 services as cards: line colour bar, a big countdown in whole minutes ("Now" under a minute, "1 min", "4 mins",
  "1 h 20 min"), "Platform 4", "T4, T9 Lines", "11:56 to 12:18" (leave and arrive) and, when late, "26 min late".
  The countdown and the late line are green on time, amber 2 to 4 minutes late, red 5 or more or cancelled, from the
  live delay; timetable times are green. The top card also says "To Strathfield" and "Next: 7, 12 mins".
* Swap direction (a row at the end of the trip screen) shows the same trip the other way at once (a trip with changes
  is reversed leg by leg); Refresh (the row under it) loads again; pull down to refresh too. Swipe a row on the list
  for Swap direction. They are list rows, not bottom bar buttons, because bottom bar buttons float over the first card.
* Tap a service card: when it leaves and arrives, how late, and each leg with its line, platforms and times.
* VoiceOver reads each row and card in one go ("Town Hall to Strathfield, next train in 4 minutes, platform 4, T4 and
  T9 lines, then 7 and 12 minutes") and offers Swap direction as an action on a row.
* The trip in progress from the iPhone stays on top while it runs; starred stops are under the trips (tap one for
  its next 3). The wrist tap before your stop is unchanged.
* The end of the list has Refresh with "Updated 2:41pm", "No connection. Updated 2:41pm" or "No connection. Times
  from your iPhone."
* Empty: "Save a trip on your iPhone to see it here." When the phone has never sent anything it adds "Then open
  Transport on your iPhone once." and a Try Again button that asks the phone again.
* Buttons that act in place (Refresh, Swap direction, Try Again) give a light click; moving between screens does not.

Complications and Smart Stack (watch face editor or Smart Stack, "Transport", "Next train"): the trip in progress,
else the first trip on the list (Home to Work or back, else your first saved trip). Bidur, 25 Oct: "Apple watch
widget. Trip view like feature."

* Rectangular, three lines: "T1 Strathfield" (the line in its colour and where it goes), "2, 16, 18 min" (the next
  service and the two after it, amber or red when the first runs late), then "From Kings Cross, Plat 1" ("To work,
  Plat 1" for Home and Work) or "Updated 2:41pm" when the kept times are over 5 minutes old or came from the iPhone.
* Inline: "T1 2, 16, 18 min". Circular: the line over the minutes, with a ring that empties over the last 15 minutes.
  Corner: the minutes, with the line and platform.
* Tap any of them: the watch app opens on that trip's screen (its next 6 services), with Back to the list. During a
  trip in progress the tap opens the app as usual.
* Whole minutes only, one timeline entry a minute, from the times the watch app last loaded. The complication never
  loads times itself and never shows a seconds timer.

## iPhone widget badges (build 207)

Bidur, 25 Oct, beside the Opal app's widget: "Icons are inconsistent". Ours mixed grey badges with a bus glyph (D400
with no live data) and blue ones with a bus glyph (410). Every line badge in the widgets, on the Lock Screen and in the
Live Activity is now one style: the official colour (buses and school buses always the bus blue, a grey colour from
the server falls back to the mode colour; "No live data" stays as text), one size, one corner radius and no glyph
inside. On tinted and clear Home Screens it stays outlined.

## Why the 206 watch app felt static

Bidur's words on 25 Oct with build 206 on his watch: "It's interactive. Our one isnt." In 206 the only things you could
tap were starred stops. The commute rows were plain text, saved trips never reached the watch (the phone sent only
Home, Work and starred stops), there was no refresh button or pull to refresh, and loading happened on a fixed minute
timer. Without Home and Work set the screen was one line of text, "Set Home and Work in Transport on your iPhone".
Build 207 sends every saved trip and makes every card, service and button do something.

## Battery

* The complications never load anything and never count seconds. They draw the times the watch app last loaded (or
  the times the phone sent) and the trip card from the phone, as a timeline worked out in advance with one entry per
  minute for the next hour at most. They reload on their own at most every 15 minutes (every 5 while a trip runs),
  and the watch app asks for a reload only when the service or trip they show changes.
* The watch app loads live times only while it is on screen and in front: when it opens and when the wrist comes up
  (scene phase active), then every 30 seconds, all trips and starred stops at the same time, with 8 second timeouts.
  The loop stops as soon as the wrist goes down or the app leaves the screen. Countdowns move every 10 seconds while
  on screen. No background refresh, no location on the watch.
* The last times are kept, so opening shows them at once while the new ones load. With no signal the cards show the
  times the phone last loaded (sent with the context, marked "From iPhone").
* The phone sends the context at most every 2 seconds and only when it changed. A trip's phone times are replaced at
  most every 5 minutes (sooner when there were none or they have all gone), so Home refreshing every 15 seconds does
  not resend. The trip card goes without its progress fraction and with its load time to the minute.
* One wrist tap per get off stop per trip, remembered across launches.

## Data path

* iPhone: `platform/iosBridge.ts` builds the context with `platform/watchShare.ts` whenever the store, the widget
  data, the trip card or a kept answer changes, and calls `sendWatchContext` in `modules/transport-ios`
  (`WatchLink.swift`, WatchConnectivity application context, plus a direct message when the watch app is open).
  Builds without the function (201 to 205) skip it.
* Context version 2 (build 207 watch app): `trips` (from `watchTripsFor`: the server lists Home keeps as
  `offline:home:lists` and the store's trips and order; each trip has its key, name, ends and, for a trip with
  changes, its legs as `/api/plan` takes them) and `times` (from `watchNextFor`: the next 3 services of the answers
  Home and the trip screen keep as `offline:trip:<key>...`). The build 206 watch app reads the version 1 fields and
  ignores these.
* Watch: `targets/watch` reads the context, loads `/api/trip` (or `/api/plan` for a trip with changes, 7 journeys)
  for each card and `/api/departures` for starred stops from the server the phone named, and keeps the context and
  the last times in a keychain group shared with the complications (`targets/watch-widget`).
* `WatchCore.swift` is the same file in both watch targets (test/watchshare.test.mjs checks it, that the Swift fields
  match what the phone sends, that there is no seconds timer in the complications and no sample trips in shipping
  code).
* Screenshots: the `watchshots` EAS profile (`.eas/build/watch-shots.yml`) runs the simulator compile check, then
  `tools/watch-shots.sh` installs the watch app on watch simulators, writes a context with three real trips where the
  app reads it, lets the app load live times and takes screenshots (list, trip, service), uploaded as build artifacts.
* Complication screenshots: a simulator cannot put a complication on a face from a script, so `tools/widget-shots.sh` compiles
  `Complications.swift` (without its `@main`) and `WatchCore.swift` with `tools/widget-shots/ComplicationShots.swift`, runs it
  on a watch simulator, loads live times through `WatchAPI` and `NextProvider` like the watch does, and draws `NextView` in
  each family (`familyOverride`, only set by this tool) onto a plain black face. Everything lands in `$HOME/shots`
  (`watch/`, `widgets/`, `complications/`), which the upload step reads by absolute path.

## Signing

* Bundle ids (registered 25 Oct 2026 through the App Store Connect API): `com.maisysen.nswtransport.watchkitapp` (7LC3QGW793) and `com.maisysen.nswtransport.watchkitapp.complications` (47JKVK83LM).
* No App Group on the watch targets, so nothing has to be ticked on developer.apple.com. The watch app and the complications share data through the keychain group `$(AppIdentifierPrefix)com.maisysen.nswtransport.watch`; every App Store profile of the team allows `keychain-access-groups` `B85KQRQZW7.*`.
* App Store profiles (Apple Distribution certificate 4D44J7J7N7, expire 24 Oct 2027), in the build box secrets folder `ios-expo/`: "Expo Transport Watch AppStore" (`Expo_Transport_Watch_AppStore.mobileprovision`) and "Expo Transport Watch Complications AppStore" (`Expo_Transport_WatchComplications_AppStore.mobileprovision`).
* `credentials.json` (git ignored) needs two more entries beside the app and the widget, keyed by Xcode target name, with the same distribution certificate:
  * `TransportWatch`: the Watch profile
  * `TransportWatchWidget`: the Watch Complications profile
* Versions: apple-targets sets MARKETING_VERSION from app.json `version` and CURRENT_PROJECT_VERSION from `ios.buildNumber` on every target, so the watch app matches the iPhone app.

## Not checked on a real watch

Pairing, WatchConnectivity delivery (now with saved trips), the keychain group at run time, complications on a face and in the Smart Stack, the wrist tap, swipe actions and the bottom toolbar on a real watch, haptics, and how the cards read at each Dynamic Type size. Compiled in EAS simulator builds only (iPhone app with both watch targets, watchOS simulator SDK).
