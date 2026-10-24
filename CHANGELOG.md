# Changelog

What changed in Transport, newest first. Times are Sydney time. Build numbers, update ids and links are in [docs/RELEASES.md](docs/RELEASES.md).

## 24 Oct 2026

### Clear history and no hard coded stations (web, 3:40 PM)
* The Popular stations list (Central, Town Hall, Strathfield) is gone from the Trips screen and from the stop list. Nothing is hard coded or seeded: an empty Trips screen shows Add a trip and Nearby when location is allowed.
* Recent trips and Recent stops are their own groups below saved trips, labelled Recent, each with Clear (with Undo). Remove one by swiping left or tapping and holding. Starred stops have their own group.
* Saved trips: Edit at the top of Trips shows a remove button on each item; swipe left or tap and hold a trip for Edit trip and Delete trip. Deleting also removes it on the server. Editing replaces the trip, also when its name changes.
* Settings has Clear history: clear recent searches, recent stops and recent trips; Delete my trip history on server; Delete all my data. Both deletes ask first.
* New `POST /api/history/delete` (profile scoped, rate limited). Privacy and support pages explain how to delete your data.

### Android versionCode 5 (3:10 PM)
* The APK on the download page is now versionCode 5. A signed AAB of the same build is kept for Google Play.
* Next trip widget shows multi leg trips: the first leg's line badge followed by the next lines (for example T1 › M1, or +2 when there are more), "Arrive 3:42 PM, 48 min" for the whole chain, then rows for later options with their lines, arrival time and Tight or Missed when a change is too short or a delay breaks it. Trips come from `/api/plan`, the same planner as the app. Tapping opens the multi leg trip.
* New Departure board widget (4 x 3, resizable): pick one of your stops or search, then a mode when the stop has more than one. Shows the next 4 to 6 services by widget height with line badge, destination, platform or stand, and the live countdown or delay. Refreshes about every minute while the screen is on. Tapping opens the stop.
* Long press shortcuts on the app icon: Home, Work, Ask, and your top 2 other trips in Home screen order. Home and Work come from your saved places, or a trip named Home or Work. They update when you open or leave the app.
* Widgets read trips saved on this phone as well as server saved trips, so new multi leg trips appear in the widget picker.
* App backup is off (`allowBackup=false`), so the install id and stored data are not copied to a new phone by Android backup. Launcher badge and foreground service permissions are removed; the app asks only for location while in use and notifications.
* Over the air update to production and expo-go with the same JavaScript (ids in [docs/RELEASES.md](docs/RELEASES.md)).

### Backend follow ups from the security review (2:50 PM)
* `/api/ask` replies are now 5 to 21 KB instead of 180 to 490 KB (about 1 to 2.5 KB gzipped). They carry only what the web, Android and iPhone Ask screens read; the full planner output and the internal error text are gone.
* TfNSW alert links are links only when they start with `https://`.
* The cron-job.org scheduler job sends its key in an `x-admin-key` header instead of the URL. `?key=` still works.
* New admin endpoint `POST /api/admin/profile-copy` copies everything stored under one profile to a new private id. Bidur's data was copied off the public "bidur" profile; the "bidur" fallback stays until his devices move.
* Android: `nswtransport://profile/<id>` now opens a screen that asks before switching this phone to that profile (new file `app/src/app/profile/[id].tsx`).
* The security review summary is in [docs/SECURITY.md](docs/SECURITY.md).
* Tests: the old "Live" label check in `site.test.mjs` now matches the current UI. Backend suite: 35 of 35 pass.

### In progress
* iPhone build 8 fix run (CI run 21): the new trip UI test filters the list after the side index jump; bus stop rows use the primary text colour.

### Added
* Live trip tracking on the web: Start trip on any trip result or saved trip opens a live map with your position (optional, stays on the phone), the live vehicle, stops left, next stop and live arrival times, for one leg or many. Get off alerts one stop before your stop and at each change, tight and missed connection warnings, and Share trip: a link anyone can open to follow the trip live, deleted when the trip ends. New `/api/share` endpoints, `track` on watches, a `/live/` viewer page, 7 new tests, privacy page updated.
* Ask handles several stops in one question (2:15 PM): "campsie to hornsby via central and chatswood", "via C via D", "changing at C and D", "stopping at C, D", "A then C then D then B", "A, C, D, B". The reply lists the chain, each leg's next service, change times, total time and arrival. Open trip and Save trip open or save it as a multi leg trip on web and Android; a single via answer opens as a two leg trip.
* Multi leg trips on web and Android (1:50 PM): 1 to 6 legs, any mode including walk, add, remove and reorder legs, change time per stop, direct services per leg. Each first leg service is paired with the first connection you can catch. Warnings for tight changes and for connections missed because of delays. New endpoint `/api/plan`.
* Ask understands places properly (1:37 PM): landmarks, every station and 5,087 NSW suburbs come before businesses; typos are fixed; unclear names get Did you mean choices; "via" is supported; every reply starts with the From, Via and To it understood.
* Website launch checklist (1:07 PM): landing page for first time visitors, custom 404, title and description per page, favicon set, robots.txt, sitemap.xml, 1200 x 630 share image, terms page, contact form with thank you page, page counter with no cookies, sticky mobile buttons, compressed images.
* iPhone build 8 (1:26 PM): the new trip flow on iPhone, with UI tests for train and bus trips.
* New trip flow on web and Android (11:45 AM): mode picker (Train, Metro, Bus, Ferry, Light rail, Search any stop), A to Z station list with a side index, By distance and By map, bus route then direction then stops, Confirm trip sheet with rename, Extend trip and connection time, direct services by default with an All services switch, drag to reorder trips. New endpoint `/api/stations`.
* Store pack (11:20 AM): App Store and Play listings, App Privacy and Data safety answers, age ratings, review notes, attribution, audit, screenshots, feature graphic, `SUBMIT.md`, TestFlight upload workflow, Play upload script.
* iPhone build 7 and Android versionCode 4 (11:01 AM): store readiness (see Fixed and Changed).
* iPhone build 6 (10:18 AM): Trips home, Ask tab, Siri shortcuts "Next train home" and "Ask Transport".
* Ask tab on Android and Expo Go (9:19 AM).
* Android Next trip home screen widget, versionCode 3 (8:48 AM).
* Trips home on web and Android (8:32 AM): Add home and Add work, Home to Work first before noon, alerts banner, countdown colour by time left, crowding, departed services skipped, Earlier and Later services, travel time.
* iPhone widgets (8:17 AM): any trip or stop, Smart Home and Work, ticking countdown, large and StandBy layouts, Lock Screen ring, stop board widget.
* iPhone UI tap through tests and widget snapshot tests (7:21 AM).
* Native iPhone app and Expo app (1:25 AM to 2:15 AM): native tabs, live boards, trip planner, live vehicle map, watches and push; first unsigned iPhone builds; Android APK on the download page.
* v3 (12:41 AM): watch any trip with phone notifications, connection rescue, commute memory, delay predictions, installable web app, iOS style redesign, minute scheduler.
* v2 (12:00 AM): auto refresh with ticking countdowns, Live and Scheduled badges, GTFS realtime merged into the planner's times, live vehicle map, trips with change times, saved trips by name, alerts on services.

### Changed
* iPhone Release builds compile one file at a time; the whole module build hung for 25 minutes. CI job limit raised to 90 minutes.
* Bundle id and application id are now `com.maisysen.nswtransport` on both platforms, with app group `group.com.maisysen.nswtransport` for the iPhone widget.
* Location usage text says what location is for: nearby stops and trips from where you are.
* Keywords no longer use other brands' names.
* Android permissions trimmed: overlay, storage and two unused location foreground services removed.
* The offline cache on the web keeps only the app shell (`/`).

### Fixed
* Every install of every app used one shared profile, so all users would have seen and changed the owner's saved trips. Each install, and each new web visitor, now gets its own random profile. Existing installs keep their data.
* The privacy policy was inaccurate and data was kept forever. It is rewritten, and the server deletes trip searches after 90 days and finished watches after 30 days.
* The support link pointed at the APK download page; there is now a real support page.
* "campsie to newcastle via chatswood" planned to a restaurant in Newcastle West and dropped the via.
* Station sort put Balmain after Balmain West; the map was light in dark mode.

## 23 Oct 2026

### Added
* v1 (5:14 PM): the Transport Bot web app. Stop number or station for a live board, "A to B" trip planning with "at" and "by" times, alerts, nearby stops, plain text answers. Transport for NSW Open Data account and API key created.
