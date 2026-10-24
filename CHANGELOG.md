# Changelog

What changed in Transport, newest first. Times are Sydney time. Build numbers, update ids and links are in [docs/RELEASES.md](docs/RELEASES.md).

## 24 Oct 2026

### iPhone app: live trip ends at your stop, each alert once (10:10 PM)
* Fixed: a live trip could roll on to the next train after you arrived. Once a run has finished the server can answer with the next service on the line; the app now only accepts an answer for the same run (the stop you board at planned within 2 minutes of your leg), so arrival stays arrival.
* The live trip now ends when you arrive: one "You've arrived" alert, then the Lock Screen card and the share link stop. Before, it kept running for 10 more minutes.
* Each trip alert is said once. When the server follows your trip, the app no longer posts its own copy of the same alert, and alerts about the same moment ("Arriving at Kings Cross in 2 min", "Next stop: Kings Cross") post once.
* The Lock Screen buttons on the trip screen and the service map are gone. Start trip puts the countdown on the Lock Screen by itself.
* New unit tests for arrival, no rollover and alert dedupe (LiveTripLogicTests, also run on Linux).

### Web and server: audit fixes (security, privacy, accessibility, 5:20 PM)
* Fixed: the Watching tab crashed for anyone without alerts turned on. It now shows a Turn on alerts card (or why alerts cannot work in that browser). A headless check opens every route in light and dark and fails on any page error.
* The shared fallback profile is gone. With no profile the server logs no searches and returns no saved trips or commutes, and writes answer "profile needed". A profile id must be 6 to 40 safe characters. Browsers still on the old shared profile move to a new random one and their saved trips are uploaded again. The web app and Ask send the profile in an `x-profile` header, not the address. `/api/history/delete` also deletes the searches this device made under an older profile id.
* Every page (Trips, download, privacy, support, terms, live trip and the 404 page) is now served by the worker with HSTS, a Content Security Policy with frame-ancestors none, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and COOP. No `_headers` file is written any more.
* Shared live answers are cached for 15 seconds, keyed without profile or device. New per address limits shared by every copy of the worker (120 upstream reads and 60 writes a minute, in D1). Inputs are checked before any upstream call: place and stop ids, questions up to 300 characters, count 1 to 8, time, lat and lon.
* `/api/health` needs the admin key and `/api/usage` without it shows only the recorded live time count. Admin and scheduler keys are read only from the `x-admin-key` header.
* Accessibility: text contrast at least 4.5:1 in light and dark (darker blue and secondary text in light, solid buttons in dark, black text on light line colours), 44 point hit areas on small buttons, tab roles on segmented controls, landmarks on the download page, heading order, and text sizes in rem so browser text size settings work.
* Web maps use OpenFreeMap vector tiles (light and dark styles) instead of the OpenStreetMap tile servers.
* The download page no longer tells people to bypass Play Protect or sends iPhone users to Expo Go; iPhone users get the web app until the App Store listing.
* A trip link with only stop ids now shows the station names.
* Privacy policy: a sentence on how the services we use protect data, and the map provider.
* The generated station, bus route and stop data are now in the repo, so a clean clone passes all 80 backend tests. New CI workflow `backend.yml` runs them on every push.

### Android app: Park and Ride, lifts and station access, Opal machines (over the air update, 4:29 PM)
* Station screens show Park and Ride car parks with live spaces free, a fill bar and a Spaces free, Nearly full, Full or No live count badge. The bell on each car park sets a notification for when it gets nearly full in the next 3 hours.
* Station screens show the access level, lifts and escalators, live lift outages (tap one for the Transport for NSW alert), Lifts working when none are out, the Opal machine, short platform, facilities and peak times, with the sources named under each section.
* Trips that start at a Park and Ride station show its live spaces above the trip list. Trip rows and saved trips on Home show a red Lift out line when a lift is out at a station on the trip, and each leg shows step free or lift out chips for both stations.
* Settings > Accessibility: Accessible trips (step free trips only; trips show "Step free trips only."), Lift outage alerts for stations on saved trips (kept in step when saved trips change), and Opal top up machines near me.
* New Opal machines screen (from Search and Settings): a map and a list, closest first, with All machines and Takes cash. New Park and Ride screen in Search: every car park with live spaces, closest first.
* Ask shows Park and Ride and station answers as cards.
* Fixed: the Commute menu in Settings had 5 actions but Android dialogs show at most 3, so Weekdays only, Delete and Cancel could be hidden. It is now a bottom sheet with every action.

### Park and Ride, lifts and station access, Opal machines (web and server, 4:15 PM)
* Station screens show Park and Ride car parks with live spaces free, a fill bar and a Nearly full or Full badge. Tap the bell on a car park for a notification if it gets nearly full in the next 3 hours.
* Trips that start at a Park and Ride station show its live spaces above the trip list. Search has a Park and Ride list with every car park, closest first.
* Station screens show access (step free, assisted or not step free), lifts, escalators, live lift outages, the Opal machine (cash or card, card only, top up only, none), facilities, short platform and peak times.
* Trip details mark each station as step free or not, and a lift outage shows in red on the trip and in the leg.
* Settings > Accessibility: Accessible trips (step free trips only, from the Trip Planner), Lift outage alerts for stations on saved trips, and the Opal machine finder.
* Opal top up and ticket machine finder: a map and a list, closest first, with a Takes cash filter. Opal retailers are not in the open data, so they are not listed.
* Ask answers "parking at Tallawong", "is Kellyville car park full", "lifts at Central", "is Redfern step free", "top up at Campsie", "top up near me" and "accessible trip from Burwood to Central".
* All from Transport for NSW open data (Location Facilities, Car Park API, service alerts), named on each screen. New endpoints: `/api/station`, `/api/parking`, `/api/topup`, `/api/lifts`, `/api/lifts/alerts`, `/api/parking/watch`; `acc=1` on trip requests.

### Android app: live trip, fares and Clear history (over the air update, 3:55 PM)
* Start trip on any trip opens a full screen live map: your train or bus, your position (only after you allow location), the arrival time with a countdown, the next stop, stops left, change times with spare minutes, and tight or missed connection warnings with a link to find the next connection. Refreshes every 15 seconds.
* Get off alerts one stop before your stop and at each change, plus tight change and connection at risk alerts. With notifications on, the server sends the same alerts while the app is closed.
* An ongoing notification shows the line, the next stop, stops left and the arrival time with minutes to go, with Share and End trip buttons. It updates while the app is running.
* Share trip makes a link (`/live/?t=`) anyone can open, with your location only if you turn it on. It stops working when the trip ends.
* Home shows a Trip in progress bar while a trip is running.
* Opal fare estimates: a fare chip on every trip row, a fare breakdown in the trip details (each leg, peak or off peak, transfer discount, airport fee, daily cap), the off peak nudge, the fare on the live trip screen and in Ask trip cards. Settings has the fare type (Adult, Child or Youth, Concession, Gold Senior or Pensioner). Stop screens show when off peak starts during peak.
* No hard coded stations: the Popular stations list is gone. An empty Home shows Add a trip and Nearby.
* Recent trips and Recent stops are their own groups below saved trips and starred stops, each with Clear and Undo. Swipe left or tap and hold to remove one. Saved trips: tap and hold for Edit trip and Delete trip, or swipe left to delete; deleting also removes the server copy.
* Settings > Clear history: clear recent stops, recent trips and the Ask chat; Delete my trip history on server; Delete all my data. Both deletes ask first.

### Opal fare estimates (web and server, 4:00 PM)
* Every trip shows an Opal fare estimate: a chip on each trip row (trip results and saved trips on Home) and a breakdown in the trip details with each leg's distance, peak or off peak, transfer discount, airport station access fee and daily cap.
* The live trip screen and Ask show it too. Ask replies end with "Opal fare estimate $X (Adult, peak)" and its trip cards show the fare.
* Settings has a fare type: Adult (default), Child or Youth, Concession, Gold Senior or Pensioner.
* During peak, trips show "Off peak from 7pm, save $X" and stop boards show when off peak starts.
* Our Trip Planner key returns no fare tickets, so the server works it out from the Opal fare tables read 24 Oct 2026. Always labelled an estimate. Nothing needs an Opal login.
* `stopName` now falls back to the full stop name when a platform's short name is only ", Platform 2" (some trip legs showed an empty destination).

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
