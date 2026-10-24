# Transport for iPhone (native SwiftUI)

A native iPhone app for live Sydney and NSW public transport, written in SwiftUI. It uses the same live backend as the web app (https://nsw-transport-bot.sites.tab.bot), so the Transport for NSW key stays on the server and nothing secret lives in the app.

## What is in it

* **Four tabs** (Home, Search, Watching, Settings), each a `NavigationStack` with large titles and inset grouped lists.
* **Home**: your commute, saved trips (like "home") and starred stops as live cards that refresh themselves, plus a "Make this your morning trip?" card when the server notices a repeated trip.
* **Search**: `.searchable` stop search (names or stop numbers), stops near you, recent stops, and the trip planner.
* **Departure boards**: live countdown that ticks every second (`TimelineView`), the live time as the main time with the timetable time struck through, a Live or Scheduled badge on every row (a scheduled time is never shown as live), platform changes, crowding, alerts. Refreshes every 15 seconds (15, 20 or 30 in Settings) and on pull to refresh.
* **Swipe actions**: swipe left on a service to watch it, swipe right to star the stop. Long press for more.
* **Live map**: tap a service for a full screen Apple Map with the route, the stops and the vehicle moving as it refreshes, and a pull up sheet (`presentationDetents`) with where it is, the stop list with live times, your stop, the next stop and occupancy.
* **Trips**: A to B with a live leave in countdown, each leg with its live delay, platform, change time and alerts. Watch the trip, put it on the Lock Screen, save it by name or make it your commute.
* **Watching**: everything the server is following for you, its live state and recent alerts. New alerts become local notifications while the app runs and on background refreshes.
* **Widget** (`TransportWidget` extension): next live trips for your commute or first saved trip, in small, medium and Lock Screen sizes.
* **Live Activity**: Lock Screen card and Dynamic Island for a followed service, with a countdown that ticks on its own.
* **Build 9**:
  * No suggested or popular stations anywhere. Home shows only what you saved, then Recent trips and Recent stops, each with Clear and Undo, and Remove by swipe or long press. Saved trips have Edit and Delete.
  * Settings > Clear history: recent stops, recent trips, trip history on the server (`POST /api/history/delete`) and Delete all my data, each with a confirmation.
  * Opal fare estimates: pick Adult, Child, Concession or Gold in Settings (sent as `fare`). A fare chip on each trip, a fare card on the trip with each leg, and an off peak nudge at peak times.
  * Multi leg trips from Ask (`/api/plan`): Open trip and Save trip.
  * Start trip: live map, countdown, next stop, get off alerts, connection warnings, Share trip (`/live/?t=`), a Trip in progress bar on Home, and a Live Activity with Dynamic Island updated while the app runs.
  * Park and Ride live spaces, station access and lift outages, step free marks on each leg, Settings > Accessibility (step free trips, lift alerts for saved trip stations) and an Opal machine finder.
  * Profile links (`nswtransport://profile/<id>`) ask before switching. The old shared test profile is never used; an install still on it moves to a private one and saves its trips again.
* Haptics, Dynamic Type (system text styles everywhere), dark mode, VoiceOver labels.
* Links: `nswtransport://stop/213516`, `nswtransport://track/213516`, `nswtransport://trip/213410/10101100`, `nswtransport://tab/watching`, `nswtransport://profile/<id>`, `nswtransport://go` (the trip in progress).

## Layout

```
Package.swift            SwiftPM package that xtool builds
xtool.yml                bundle id, Info.plist, icon, widget extension
project.yml              XcodeGen spec of the same app, for Xcode and CI
Support/                 Info.plist files, app icon
Sources/TransportKit/    models, API client, formatting, Live Activity attributes (shared)
Sources/Transport/       the app (SwiftUI)
Sources/TransportWidget/ widget and Live Activity (WidgetKit, ActivityKit)
Tools/KitCheck/          Linux check: builds TransportKit and decodes live backend answers
Tools/make_icon.py       draws the app icon
Tools/ci_screens.sh      simulator screenshots in CI
```

## Build

**Linux or Windows (WSL) with xtool.** Install Swift 6.4 and xtool (https://xtool.sh), download Xcode from https://developer.apple.com/download/all/?q=Xcode with your own Apple ID, then:

```
xtool setup                # log in with your Apple ID and point it at Xcode.xip
python3 Tools/make_icon.py # once, draws Support/AppIcon.png
xtool dev                  # builds, signs and installs on the iPhone plugged in by USB
xtool dev build --ipa      # or just build an unsigned .ipa
```

**Mac with Xcode.** `brew install xcodegen && python3 Tools/make_icon.py && xcodegen`, open `Transport.xcodeproj`, pick your team under Signing, run.

**GitHub Actions.** `.github/workflows/ios-native.yml` builds on a hosted Mac on every push to `ios-native/`: an unsigned .ipa with xtool and with Xcode, a simulator build and screenshots of every screen in light and dark mode. The .ipa is attached to a GitHub release on the repo.

**Linux check of the shared code** (no Apple SDK needed):

```
cd Tools/KitCheck && swift run KitCheck Fixtures
```

It compiles the models and API client and decodes saved and live answers for Strathfield 213516, Central, and Burwood to Central.

## Limits with a free Apple ID

* The app must be re-signed every 7 days (AltStore and SideStore can do it on their own).
* At most 3 sideloaded apps at once, and 10 app ids a week. This app uses 2 (the app and its widget).
* No push notifications (Apple only gives the push entitlement to paid accounts). Alerts arrive as local notifications while the app runs or gets a background refresh, and the Live Activity is updated by the app itself. The web app and WhatsApp keep sending alerts as before.
* No TestFlight or App Store until there is a paid Apple Developer account.

See INSTALL.md for the install steps and the TestFlight path.

## Tests

The CI workflow runs two test targets on an iPhone 16 Pro simulator with live data:

- TransportUITests taps through every flow (search, star, board, swipe to watch, live map and sheet, trip planner, watch and save a trip, Home, Watching, Settings, Dynamic Island) and saves a screenshot of each step, once in light and once in dark. It uses the "uitest" profile on the backend, so real saved trips are never touched.
- TransportSnapshotTests renders the home screen widgets, the Lock Screen widgets, the Live Activity and the Dynamic Island from the widget extension's own views with ImageRenderer.
