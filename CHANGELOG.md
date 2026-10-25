# Changelog

What changed in Transport, newest first. Times are Sydney time. Build numbers, update ids and links are in [docs/RELEASES.md](docs/RELEASES.md).

## 25 Oct 2026

### Swipe to delete and line badges (over the air update for iPhone and Android, 25 Oct, 2:48 PM)
* Home: the red Delete button no longer peeks out beside a saved trip. It shows only when you swipe the trip left, sits inside the card's rounded corners, and swiping back hides it. Opening one trip's Delete closes any other. VoiceOver offers Delete as an action on the trip.
* Line badges look the same everywhere in the app (Home, Plan results, departures, trip details, live trip, Ask, line status): the official line or mode colour, always (buses are blue even without live data; "No live data" stays as text), one size and shape, line name only.
* Plan results: the "Towards" line no longer runs into Track on narrow screens.

### Fits any window: iOS 27 and iPhone Duo (over the air update for iPhone and Android, 25 Oct, 12:49 PM)
* On iPhone Duo and other resizable windows (iOS 27), screens keep clear of the status bar and bars when they sit on the right edge, and of the Dynamic Island in landscape.
* On a wide window (iPhone Duo open, iPhone Mirroring, iPad) lists and cards stay at a comfortable reading width in the middle instead of stretching edge to edge. Sheets do the same.
* Phones in portrait look the same as before.

### iPhone build 206 on TestFlight (25 Oct, 11:30 AM)
* Siri: "Next train home in Transport", "Next train to work in Transport" and "When is my next train in Transport" answer out loud with the next service and platform from Home and Work; "Start my commute in Transport" opens the trip and starts it. They also show in Spotlight and Shortcuts with no setup. Without signal Siri answers from the times the widget kept.
* Control Center (iOS 18): Next train home and Start my commute buttons.
* Widgets: Refresh, Swap direction and Start buttons on the Next trip widget. Reloads at most every 15 minutes (5 near the end of the kept times or during a live trip).
* Apple Watch app and complications (see docs/WATCH.md).
* Add to Calendar on a trip opens the system event sheet with a leave by reminder. Asks only for add access, and only if the system needs it.
* Speak alerts in trip mode reads trip alerts out loud.
* No second trip notification while the Live Activity shows the trip.
* Needs iOS 17 or later.

### NSW TrainLink fares and the weekend trackwork push (over the air update for iPhone and Android, 25 Oct, 11:21 AM, and server)
* Regional NSW TrainLink trips (Albury, Dubbo) no longer show an Opal fare, since Opal is not used on them. The trip shows "NSW TrainLink fare. Not an Opal trip. Book a seat ahead." with a Book link. A trip that is part Opal, part TrainLink keeps the Opal estimate and says the TrainLink part is booked ahead. Works now.
* Thursday 6pm to 9pm: one push per phone per weekend when planned trackwork this weekend is on a trip it has a morning check for: "Trackwork this weekend: Strathfield to Central. Sat and Sun: Buses replace trains between Strathfield and Lidcombe." After the server move.

### Long distance trips, Plan B in the morning alert, traffic on bus legs, quieter carriages (over the air update for iPhone and Android, 25 Oct, 11:13 AM)
* Regional trips plan again: Central to Albury, Dubbo or Grafton used to stop at "Live data didn't answer" after 12 seconds. The app now asks the new server, which waits up to 35 seconds and keeps the answer for 2 minutes. After 6 seconds the trip screen says "Still searching. Long distance trips can take up to 30 seconds." Works now.
* Long trips show hours: "7 h 26 min", not "446 min". A TrainLink note that showed web code now reads "Book your seat with NSW TrainLink". Works now.
* Watched trips and the trip you are on keep which live feed each service is in (NSW TrainLink, regional buses and coaches, Manly Fast Ferry), so their live times come from the right feed. Trips watched before this update get it once from the stop's board. Matters after the server move.
* Morning check: when the usual service is cancelled, late, a change will be missed, or trackwork is on the line, the alert ends with the best other way: "Plan B: the 8:44am M1 from Epping, arrives 9:11am." After the server move.
* Bus legs show a crash, breakdown or hazard on the route from Live Traffic NSW: "Crash on Victoria Road at Gladesville. Your 501 may run late." After the server move.
* Departure rows and the service screen show "Quieter at the back", "Quieter at the front" or "Quieter at either end" when Transport for NSW sends occupancy per carriage (Sydney Trains, intercity, Metro) and part of the train is fuller. After the server move.

### Battery and smoothness (over the air update for iPhone and Android, 25 Oct, 10:44 AM)
* Nothing refreshes in the background any more, and a screen stops refreshing when another screen covers it. Coming back refreshes once.
* After a failed refresh the app waits longer each time (up to 5 minutes) instead of trying again every 15 seconds.
* Countdowns update every 5 seconds, exactly on the minute, instead of redrawing every screen every second.
* Live trip map: your position uses about 100 m accuracy every 10 seconds instead of GPS every 5 seconds, and only while that screen is open.
* Two parts of the app asking for the same times share one request.
* Buttons that talk to the server show a spinner and ignore a second tap. Every button says it is a button to VoiceOver and TalkBack.
* Close on the departure board, Cancel on a new trip and Back on a service go somewhere when the screen was opened from a link or notification. Before, they did nothing.
* Stop watching and Not now say when they fail.
* iPhone: the tab bar uses the system look, so iOS 26 shows Liquid Glass.

### Plan: addresses, leave and arrive times, Clear All (over the air update for iPhone and Android, 25 Oct, 10:33 AM)
* Plan finds addresses, streets, landmarks and suburbs, not only stops, and plans trips from and to them. Each result says what it is, for example "Address, Sydney".
* Leave now, Leave at or Arrive by: tap the When row under From and To, pick a time on the wheel, and the trip shows services for that time. A time already gone today means tomorrow, and the row says so.
* Clear All on Your trips and on Starred stops, each asking first. Home and Work stay.
* Home's header says "Live 9:52am", the same clock as the rows.

### Ask answers (new server address, 25 Oct, 10:20 AM)
* "How much is the fare from Central to Parramatta" answers with the fare first.
* Nonsense gets "I didn't get that" with examples, instead of a far away stop.
* Last train: the sentence names every train of the trip it shows ("T4 then T9, change at Redfern"), and intercity trains are named ("Blue Mountains Line").
* Bus interchanges such as Railway Square no longer show the station's lifts and access.
* These answers reach the app when it moves to the new server address.

### Car parks, bus delays and regional live times (over the air update for iPhone and Android, 25 Oct, 10:11 AM)
* Park and Ride: each car park learns when it fills on weekday mornings and says "Usually full by 7:40am on weekdays". Until it has 5 weekday mornings it says how many it has. Shows once the app moves to the new server address.
* Trip screen: bus and coach legs say how the bus is running right now, for example "Bus running 6 min late", when the bus sends live data.
* NSW TrainLink trains and coaches, regional buses and Manly Fast Ferry now get live times, cancellations and positions from their own live feeds. Manly Fast Ferry's feed still lists July trips, so those stay scheduled until Transport for NSW fixes it.

### iPhone build 205: lock screen trip card stays live (TestFlight, 25 Oct, 10:04 AM)
* The trip card on the Lock Screen and in the Dynamic Island now gets live times from the server every minute while the phone is locked, and ends on its own when you arrive. Before, it only changed while the app was open.
* A card whose live times are more than 2 minutes old shows clock times with "Leaves about" or "Get off about" and "Updated 8:21am" instead of a countdown. A change at risk shows red.
* The departure board turns sideways on iPhone; every other screen stays upright.
* The phone's push token is saved on the server so alerts can come later. No alerts are sent yet.

### Shared trip links open in a browser again (server, 25 Oct, 10:03 AM)
* A trip shared from the app and opened by someone without the app showed "This trip has ended" straight away, because the link's page asked the new server, which did not have the share. It now finds the share and shows the live trip. No update needed.

### QA pass A fixes (over the air update for iPhone and Android, 25 Oct, 10:00 AM)
* Trip screen: services from Earlier services that have already left say Left instead of Now.
* Trip legs and the live trip say 1 stop instead of 1 stops.
* Home: touch and hold the commute card, and the Home and work menu now has Cancel. On iPhone it could not be closed without picking an action.
* Home: a saved trip you delete goes at once. Before, it stayed for about 9 seconds until the server answered, so it looked like Delete did nothing.
* Home: a saved trip with the same two stops as your Home and Work commute says it shows in the commute card, instead of "Save the trips you take".
* Plan: back from a trip, old search results no longer cover Recent trips, and a Show this trip row plans the same trip again.
* Plan: a search with no match says "No stops match that", and with no connection "Can't search right now. Check your connection."

### QA pass B fixes (over the air update for iPhone and Android, 25 Oct, 9:57 AM)
* Stop screens: the two alerts at the top are the ones that touch the most services there, so a generic "Station Update" shows once instead of under every train. With a mode filter on (for example Ferries at Circular Quay), only that mode's alerts show.
* No signal and nothing kept on the phone: the stop screen and cards now say "Live times unavailable right now, trying again" and "You're offline. Check your connection." The old words promised kept times that were not there.
* Nearby on Home no longer lists Circular Quay twice: a station's light rail or wharf stop folds into the station when the station covers that mode.
* Ask: a slow answer ends after 25 seconds instead of spinning, a server error says "Ask isn't answering right now", and its buttons and text box have roles and labels for VoiceOver and TalkBack.
* More: the Version row shows the build and the update running ("1.0.0 (204) · update 01a17022"), which helps with support. Contact us and the privacy email say where to write when the phone has no mail app.
* Watching: the empty screen says to swipe left on a departure or touch and hold it.
* No new build needed.

### Weekend trackwork and status of my lines (over the air update for iPhone and Android, 25 Oct, 9:52 AM)
* From Thursday 6pm to Sunday, Home shows a Trackwork this weekend card, only when planned work this weekend touches your Home and Work trip or a saved trip. Each row says which trip, the days and what Transport for NSW says ("Sat and Sun: Buses replace trains between Central and Bondi Junction"), and when the planner shows it, "Buses replace trains Central to Kings Cross. Your trip takes about 25 min longer." Tap a row for the full details.
* Status of my lines: under that card, one chip per line on your Home trips (Good service, Delays, Trackwork, Suspended; Changes for buses and ferries), problems first. More has the same list with what is wrong.
* Both come from Transport for NSW service alerts and need the new server, so they show once the app moves to api.transportsydney.app. No new build needed.

### Plan B on the trip screen (over the air update for iPhone and Android, 25 Oct, 9:12 AM)
* When the trip you picked has a cancelled service, a line Transport for NSW says is suspended, or a change the live times say you will miss, a Plan B card at the top of the trip screen says what is wrong ("The 8:04am T1 is cancelled") and offers the best other way: the earliest arrival that avoids the cancelled service or the suspended line, with lines, leave and arrive times. Show this trip opens it.
* If none of the trips on screen avoids it, the app asks the planner once for the services leaving from now. A way with a change is offered as Show trips with a change.
* No new build needed.

### Offline, departure board and station maps (over the air update for iPhone and Android, 25 Oct, 9:05 AM)
* Offline from a fresh start: the app keeps the last times for Home and Work, your saved trips and starred stops on the phone. With no signal, even right after opening the app, Home, the trip screen and stop screens show those times with "Offline, times from 8:05am", leave out services that have already gone, and the Home header says Offline. Live times take over as soon as the signal is back.
* Departure board: tap Board on a stop screen for a full screen board with large rows: line, destination, platform, minutes and a Live or Timetable mark. The screen stays on while it is open and the board fills as many rows as fit. It turns sideways on Android; on iPhone it stays upright until a build allows landscape.
* Station map: stop screens show a Station map row where Transport for NSW lists one on the stop's page (for example Redfern, Town Hall, Parramatta, Central). It opens their map of entrances, lifts and platforms. Stops without a published map show no row.
* No new build needed.

### Trip mode follows the live times (over the air update for iPhone and Android, 25 Oct, 8:39 AM)
* On 25 Oct the T1 from Strathfield ran 4 minutes late. The Lock Screen card said "Get off now" at 8:22 and switched to "T4 leaves 8:26am" at 8:24 while the T1 had not reached Redfern. The card is only changed by the app while it is open, so it counted down to the last time it was given; and a leg ended when the stop list moved past your stop, which follows the timetable clock when a feed has no live times for that stop.
* A train's live position short of your stop now keeps you on that leg. Once the estimate is 30 seconds old and the live feed still shows the train before your stop, the countdown stays at about a minute instead of "now".
* A change the live times say you will miss moves the arrival later ("Arrive at Kings Cross, about 8:40"). Once you have missed it, the trip screen says "Change at risk: the 8:26am T4 has likely left" with the next way on below it, the card names the next service ("Change at risk. Next T4 8:31am") and counts to it, and the trip no longer ends when the train you missed gets to your stop.
* When the app goes to the background the card says when its times are from: "Updated 8:21am. Open the app for live times" (or after a tight change warning). Without push updates the card cannot refresh while the app is closed, and now it says so.
* No new build needed for the above. The next iPhone build (branch live-card-v2) adds the native part: a card left without fresh times shows "Get off about 8:26am" and "Updated 8:21am" two minutes after its last refresh, instead of a countdown or "You've arrived".

### iPhone build 204: the Next trip widget shows your commute (TestFlight, 25 Oct, 8:38 AM)
* With Home and Work set, the Next trip widget showed "Touch and hold, then Edit Widget to pick a trip". Home and Work were kept only inside the app, and the widget looked for commutes and saved trips on the server instead.
* The app now shares Home and Work and the trips saved on your phone with the widgets. Home and Work (auto) shows Home to Work before 12pm and Work to Home after, the same as the commute card on Home, with no setup. Show starts on Home and Work (auto).
* While a trip is running, the Next trip widget follows it: the line, the minutes to leaving or to your stop, and "Get off at Redfern" or "Change at Redfern".
* Saved trip lists the trips saved on your phone; the stop pickers suggest Home and Work.
* When live times cannot be loaded, the widget keeps the last times that have not left and says "Offline, times from 8:14am" instead of going blank. With nothing to show it says what to do: "Set Home and Work in the app" or "Open the app once to share Home and Work".
* Dynamic Island on the train: "Off Redfern" or "Change Redfern" next to the minutes, and the line badge only before you board.
* Lock Screen trip card and Dynamic Island: stop names drop "Station" even when the feed adds a suburb ("Arrive Kings Cross 8:36am"). This part came over the air at 8:29 AM for builds 201 to 203 as well.
* Widgets need build 204; open the app once after installing it.

### Home opens at the top with its header (over the air update for iPhone and Android, 25 Oct, 8:22 AM)
* On iPhone, Home opened with an empty dark band at the top (only the Live pill showing) and the content starting lower down; a scroll up was needed to see the normal Home header. The large "Home" title was being drawn behind the header's blur.
* Home, Plan, Ask, More and the stop screen now use the normal header title, the same one you saw after scrolling, so every launch and every return to the app looks the same. Pull to refresh and the tab bar are unchanged.
* Android looks the same as before. No new build needed: iPhone builds 201, 202 and 203 get it over the air.

### iPhone build 203: widgets share your trips, simpler widget settings (TestFlight, 25 Oct, 8:05 AM)
* The app and the widgets now share the app group `group.com.maisysen.nswtransport`, so widgets see the app's profile, starred stops and saved trips without picking them again.
* Next trip widget, Edit Widget: one Show choice (Home and Work (auto), Saved trip, Pick stops). Saved trip shows only Trip, Pick stops shows only From and To, Home and Work shows nothing more. With no saved trips the Trip list says "Save a trip in the app first".
* Stop names drop the word Station in the pickers, the Next trip widget and the stop board, so names fit.
* Widget description: "Live countdown to your next trip."
* Widgets set up before this build keep showing what they showed.
* Build 202 (7:58 AM) had the group on the app only; 203 replaces it. Version 1.0.0, runtime 1.0.0, same over the air updates as 201.

### Store readiness (no app update, 25 Oct, 8 AM)
* App Store Connect: version 1.0.0 with build 201 attached, listing rewritten for the Expo app, review notes, 6.9 and 6.5 inch screenshots uploaded. Not submitted.
* app.json, for the next native builds: the unused Always location, motion and full accuracy purpose strings are removed, the When In Use string gives the full reason, and the privacy manifest lists the data the server keeps.
* New: docs/STORE_READINESS.md (App Store and Play checklists), docs/STORE_PRIVACY.md (App Privacy and Data safety answers from the code), fresh screenshots and Play feature graphic from the Expo app.

### Ask answers easy to scan (over the air update for iPhone and Android, 25 Oct, 7:37 AM)
* A trip answer in Ask is now a short card instead of one long paragraph: the departure time large with minutes to go, the line chips and platform, then "Arrives Kings Cross 7:55 am · 1 change".
* Status as a chip in the same words and colours as the rows below: On time in green, N min late in orange, Cancelled in red.
* Lift outages on the trip are one warning row ("Lift 1 at Kings Cross not working"); a tap shows the full messages.
* The fare is a small line: "Fare about $3.76 · Adult off peak".
* The From to To line no longer repeats in the bubble, and compact places (the trip card header, suggestion chips) drop the word Station.
* Other answers stay as chat bubbles, split into short paragraphs of at most two sentences.
* VoiceOver and TalkBack read the trip card as one sentence and can open the lift details. Text follows the phone's text size.

### Reliability pick and last way home reminder (over the air update for iPhone and Android, 25 Oct, 2:08 AM)
* Service rows on the commute card, Home trips and trip results can show one quiet line: "Left on time 9 of the last 10 weekdays". It counts days the server actually saw that service leave that stop (under 3 min late counts as on time) and shows nothing under 5 days.
* Ask "Last train home" and the last service tonight in trip results get Remind me 15 min before. The server finds the last service itself, looks at live times again as the time comes near, follows it if it is late or replaced, and sends one notification. Cancel from the button or the Home card; Delete all data removes it.
* iPhone gets the notification. Android shows the reminder on Home and says so, because this Android version has no server push until versionCode 6.
* Both need the new server: they stay hidden while the app talks to the first address, and appear once api_base moves to api.transportsydney.app. Server flags reliabilityPick and lastWayHome turn them off without an update.

### iPhone app: round 4 and transportsydney.app links (over the air update, 25 Oct, 1:30 AM)
* iPhone now has everything Android got at 1:18 AM: Check my trip before I go, crowding chips, Step free trips, one server address, transportsydney.app links and emails.
* Links into the app: transportsydney.app/trip/<id> opens a Shared trip screen that shows the live trip, /stop/<id> opens that stop, and /plan?from=..&to=.. opens the trip. On iPhone they open the app where the build carries the transportsydney.app link permission; Android needs versionCode 6 (App Links) first.
* Android production is unchanged by this update.

### Site: shared trip links work in a browser (25 Oct, 1:25 AM)
* transportsydney.app/trip/<id> sends the browser to the live trip page (302, the id kept). /stop and /plan links show Open in the app with the store badges. The .well-known files are still served as JSON with no redirect.

### Android app: check before I go, crowding, step free, one server address (over the air update, 25 Oct, 1:18 AM)
* Check my trip before I go: More has a new screen for it, and the commute card has a link to it. It uses your saved home and work. Pick the trip (Home to Work or Work to Home), your usual leave time (5 minute steps, also adjustable with TalkBack), the days, how long before to check (5 to 30 min, 15 by default) and optionally how you usually go (train, metro, bus, ferry, light rail). About that long before you leave, the server looks at live times once and sends one alert, only if something is wrong: a delay over 5 min, a cancellation, trackwork, a platform change, a change too tight to make, or a lift out of service at either end. Check now shows what it would say right now, without sending anything. Edit, Delete, and Delete all checks. Delete everything in Privacy and data deletes them too. If the server has nowhere to send the alert, the app asks for notifications before saving. While this Android build has no background push (it needs Firebase, see app/NEEDS_BIDUR.md), the screen says so plainly: the check is kept and starts sending once a build with push is installed. Server switch: morningCheck.
* Crowding: a small chip ("Few seats", "Standing room") on departures, on each leg of a trip and on the trip rows, only where Transport for NSW sends occupancy for that service. Nothing is shown when it does not. Standing room and fuller show in the warning colour. Server switch: occupancy.
* Step free: a Step free switch on Plan and at the top of trip results (the same setting as More, Accessible trips). Turning it on or off asks again at once. With lift aware trips, results say when trips were left out because of a lift out of service, or that every trip found passes one; each trip shows "Step free" when every station is, and "Lift out at" each station with a lift out now. Server switch: liftAwareRouting (hides the lift notes; step free itself stays).
* Remote config: the app now reads /api/app/config?platform=android at launch and each time it comes to the front (every 30 min at most), keeps the last good copy, and every feature is on until it hears otherwise.
* One server address: the address is written once, in app/src/lib/server.ts, with the hosts it may move to (the one in use today and api.transportsydney.app). Remote config copy.api_base, or a top level api_base, moves the app to another address with no build: https only, a bare host, on an allowed domain; anything else is ignored and the last good address stays; removing it goes back to the default. Privacy and Help and support now open https://transportsydney.app/privacy and /support (one constant). Contact us writes to support@transportsydney.app, and Privacy and data has Email privacy@transportsydney.app. Share trip now sends https://transportsydney.app/trip/<share id> instead of the server's own address (the site has to serve that path). A /plan?from=..&to=.. link opens the trip in the app; https app links for /trip, /stop and /plan need the intent filter in the next native build (versionCode 6). The Web version link in More is gone, and no old server or tab.bot names are left in the Android app's text, links, comments or docs; the default API host is written once, in server.ts, until remote config moves it. The home screen widgets read the address the app saves (key apiBase); that widget change is native and arrives with the next APK (versionCode 6).

### iPhone: the Expo app, with over the air updates
* The iPhone app is now the same Expo app as Android (build 201 on TestFlight, same App Store Connect app and bundle id as the SwiftUI build). JavaScript changes reach iPhones over the air, like Android.
* Widgets (small, medium, large, Lock Screen inline, rectangular and circular) and the trip Live Activity come across from build 108 as a native extension: "13 min" instead of timers, a title on every size, one line alerts, tapping a row opens that trip.
* One Lock Screen card per trip: waiting, on board, tight or missed change, then "You've arrived" for 2 minutes.
* Updates are checked on every start and when the app comes back to the foreground. Channels come from the build profile (preview or production); the runtime stays 1.0.0, so Android versionCode 5 keeps getting updates.
* Not yet: the app group (Bidur registers it on developer.apple.com), so widgets cannot see saved trips and starred stops; iPhone push notifications need an APNs key.

### Own domain: transportsydney.app (server and website)
* New public website at https://transportsydney.app: store links (coming soon until the listings are live), Support, Privacy Policy and Terms of Use, light and dark, no scripts, no cookies, no tracking. Published by Fintex Australia Pty Ltd. Plain files in `site/` on Cloudflare Pages.
* Email on the domain: support@, privacy@ and hello@transportsydney.app, forwarded to contact@fintex.au.
* App links: `/.well-known/apple-app-site-association` and `assetlinks.json` for com.maisysen.nswtransport; `/trip/...`, `/stop/...` and `/plan` open the app, or a page with the store links.
* The server is ready to run on the Fintex Cloudflare account at https://api.transportsydney.app: API only on that address (the site's pages redirect to the website), a Cron Trigger for the minute tick, Worker secrets, a D1 migration with every table, a data export from the first deploy, and deploy scripts. Steps in [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).
* Remote config `copy.api_base` moves the apps to the new address when an admin sets it (not set yet); the server accepts only an https origin.
* Old names and the first address removed from the server, website, docs and store texts.
* Fixed: two morning check tests failed whenever the clock minute was 24 or later (a test helper bug, not the server).
* Server tests: 134 of 134.

### Android app: it just knows (over the air update, 25 Oct, 12:18 AM)
* Two question setup: on first launch the app asks for your home station, then your work station (search, or Skip). Kept on this phone only. Change or clear them any time in More, Home and work. Delete everything in Privacy and data clears them and the setup shows again.
* Your commute: one card on top of Home. Before 12pm it goes Home to Work, after 12pm Work to Home, with live times. The swap button beside its title shows the other way until the next 12. It sits outside the card's tap area, so a tap on it never also opens the trip.
* Leave in N min: with location allowed, the commute card says when to leave for the first service you can still make, walking at 5 km/h in a straight line to where it leaves, plus a minute for the platform. Hidden when location is refused, when you are more than a 25 minute walk away, or when nothing can be reached. Location is never asked for on its own: a "Show when to leave" button asks. Remind me sets one alert on this phone at the leave time (tap again to cancel).
* Wake me before my stop: a switch on the live trip. It sets an alarm on the phone for when the service leaves the stop before yours (for a one stop ride, when it leaves your boarding stop), from the live stop times the trip already reads, and moves it when the times move. It rings once with a long strong buzz on its own notification channel, even with the app closed, and replaces the plain "Next stop" alert so nothing doubles. Turning it off or ending the trip cancels it.
* Missed connection: when the live times say you will miss a change, the live trip shows the next option at once, planned with /api/plan from the change station to your destination (never the train you are missing, never one that leaves before you reach the platform), with Switch to this. Switching keeps the leg you are on and replaces the rest; its alerts and alarms start fresh. If nothing is found it says so and links to all trips from the change stop.
* Needs a new native build, not done: exact alarm timing while the phone is asleep. The installed build has no exact alarm permission, so Android may run the Wake me and Remind me alarms a little late in deep sleep (they are on time while the app is open). Adding SCHEDULE_EXACT_ALARM (or USE_EXACT_ALARM) to the manifest needs versionCode 6.
* Shipped over the air to Android: preview update 01a16e0f-4afc-7cf3-8031-bfd6c7adf62d (manifest checked: runtime 1.0.0, bundle hash matches the local export), then production update 01a16e0f-c2fa-7298-ae3e-5cfd32af7fa8. Commit dab02b2.
* Tests: 21 new unit tests in test/smart.test.mjs (commute direction and swap, walk and leave times, wake alarm replays for Burwood to Strathfield and a 3 stop Ashfield to Strathfield trip on time, late, early, delayed mid ride and with the app asleep, missed change, next option and switch). Browser: setup, commute card, swap, Leave in, Remind me, Wake me, More Home and work in test/e2e/buttons.mjs; Wake me in the Burwood to Strathfield replay (WAKE=1); new test/e2e/missed.mjs for the next option card against the real planner. Unit tests 81 of 81 (79 and 2 skipped offline), browser taps 39 of 39, full walk light and dark with no errors, axe clean on 11 screens light and dark (Home and work setup included).

## 24 Oct 2026

### iPhone app build 108: widgets, Lock Screen widgets, travel updates, server address in one place
* Widgets never show a seconds timer. Every row says "13 min", "Now", or the clock time when it leaves an hour or more from now. The first row has the same layout as the others, only larger.
* Every widget size has a title: the saved trip's name, or "From to To" with short names (no "Station").
* Each row shows "Plat 1", the status ("On time", "2 min late", or "No live data" instead of "Scheduled"), and a small "1 change" or walk when it applies. Tapping a row opens that trip at that departure.
* An alert shows as one compact line with a warning icon, only when it affects the services shown. It drops the line name the badge already shows and ends at a whole word ("Trains run to a changed timetable..."). Tapping it opens the alerts for the trip.
* The Track and refresh buttons are gone. The widget redraws each minute and at the moment each service leaves (so a service that has left is never shown) and fetches fresh times about every 5 minutes, or when the next one leaves.
* Large widget: fewer rows, so the title is never pushed off the top.
* Lock Screen: inline "T1 4 min, Plat 2", and the rectangular widget shows the next commute departure (title, line, wait, platform, then the status and the next two).
* Travel updates on a live trip: Leave now, Board, Next stop (get off, or change here), Change, and You've arrived, each once. Steps still to come are scheduled with iOS, so they arrive on time with the app closed, and each refresh moves them to the latest live time under the same identifier, so a delay never makes a second alert. Nothing is said after arrival, and the trip's older alerts are cleared from the Lock Screen when it ends (You've arrived stays until you next open the app 10 or more minutes later). The iPhone gets no push from the server, so the phone says these itself and the server watch's notes for the trip are never shown again.
* The server address is written in one place in the app. Remote config `api_base` can move it without a build, only to an https host on the allowed list (api.transportsydney.app, one line in APIBase.swift) or the current host; the last good value is kept and the widgets follow it. Help, privacy and terms open https://transportsydney.app/support, /privacy and /terms (one constant), About has Contact us (contact@fintex.au), and Ask uses the app name.
* Tests: Burwood to Strathfield replayed on time, 3 min late and 1 min early, a trip with a change at Strathfield, the app asleep while iOS shows each step, a late start, End trip; widget words and timeline; the address allowlist. Widget snapshots for small, medium, large and the Lock Screen widgets in light and dark. CI runs the unit and snapshot tests in their own step before the UI tests and puts the widget snapshots on ci-out.
* Plan a trip: the trips come right under From and To (and any alert line); the fare, Park and Ride and the Departs in or Travel time switch follow them, so the trips are on screen without scrolling.
* Docs: ios-native/INSTALL.md points at store/apple/ for the listing; the old ios-native/AppStore/listing.md is removed.

### Server: morning check, platform change alerts, occupancy, lift aware trips, server switches (24 Oct 2026, 11:55 PM)
* Morning check: a phone registers a usual trip (from, to, usual time, days) at `/api/morning-check`. About 15 minutes before the usual time the server looks at live data once and sends one alert, only if something is wrong: a delay over 5 minutes, a cancellation, trackwork, a platform change, a change that is now too tight, or a lift out of service at either end (train or metro). Silent when all is fine. Each check is claimed in the database before it runs, so it never sends twice. List, edit and delete by device with no login; Privacy and data, Delete everything removes them too. `/api/morning-check/preview` shows what the check would say now without sending.
* Platform change while waiting: fixed a false alert. When the departure board did not answer for a minute, the planned platform stood in and read as a change back. Now only a platform the board reports counts, and nothing is sent once the service has left. Still one alert per real change.
* Occupancy: departures, trip and plan legs show crowding only when Transport for NSW sends it for that service; otherwise nothing (no guesses). Tests now cover both.
* Accessible trips (`acc=1`): trips through a station with a lift out of service right now are left out when another trip avoids it, and trips that are step free at every station come first. Each trip says `stepFree` and lists any `liftOutages`.
* Remote config: new flags `morningCheck`, `platformAlerts`, `occupancy` and `liftAwareRouting`, all on. `platform=server` switches the server's part of each off for every app within a minute, with no deploy.
* Request and answer shapes for the app workers are in [docs/API.md](docs/API.md). Backend tests: 118 of 118 pass (31 new).

### Android app: Fintex in About, map scroll, taps that buzzed and did nothing, contrast and touch targets (over the air update, 11:16 PM)
* About in More: Made by Fintex Australia Pty Ltd, Contact us (opens an email to contact@fintex.au), Fintex website (fintex.au) and a copyright line. No other email address is left in the app.
* Opal machines: dragging the map moves the map and the page stays still; the page scrolls again when your finger lifts. The small map no longer rotates or tilts. On the web preview it has + and - buttons and the mouse wheel scrolls the page.
* Fixed: on Home, tapping near the arrow on a trip card buzzed and did nothing (the reorder handle took the tap). A tap there opens the trip; press and drag the handle to reorder.
* Fixed: a choice in a bottom menu (for example Opal fare type, Privacy and data) could vanish on Android when it opened a dialog. It now runs once the menu has closed.
* Start trip opens the live trip straight away; the notification prompt follows. End trip and Done leave the screen at once. Buttons behind a swipe (Watch, Delete) use a press that the swipe can't swallow. Vibrations never hold up a tap.
* Easier to read: every text colour is at least 4.5:1 in light and dark, line badges use dark text on light colours (T1, buses), countdowns, the lift out and Cancelled labels and the Trip in progress bar are darker, and the bottom tabs have set colours. TalkBack skips icons and reads the Accessible trips and Lift outage alerts switches by name.
* Bigger touch targets (48 dp): rows, the Trip and Departures switch, the From and To fields, the Ask field, the fare row, Earlier and Later, card headers, header icons and filter chips.
* Checked: axe finds no problems on 10 screens in light and dark (it found 86 before), 26 of 26 buttons act on the first tap in the browser, and Burwood to Strathfield replays to one You've arrived with and without server alerts.

### Android app: cleaner screens, one way to do each job, buttons act on the first tap (over the air update, 10:33 PM, and 10:37 PM)
* Four tabs: Home, Plan, Ask and More. Watching moved into More (with a count of what is being watched), and Settings is now the Settings section of More.
* One place to plan: the Plan tab, with From and To (and a swap button) for a trip, or Departures for a stop. Home no longer has its own search field or + button, and the Search tab's separate Stops and Trip planner screens are one screen. Recent trips and recent stops show only in Plan, each with Clear.
* Home: Your trips (with Add), Add home and Add work, starred stops and up to 3 nearby stops. Trip cards lost the colour stripe, the rainbow countdown, the crowding icons, the fare chip and the "To home" tag; each row is the countdown, departure and arrival, then status, platform and travel time.
* Trip page: one Start trip button (Watch is gone; Start trip turns on the alerts). The Opal fare shows once, folded behind a tap, instead of a top card, a chip on every row and a line in the details. The Departs in and Travel time switch, the per row Lift out line, and the duplicate countdown and status inside each leg are gone. Walk only options are left out when there is a service, so the first trip that opens can always be started.
* Live trip: the Show where I am and Get off alerts rows only show when location or notifications are off, the Opal estimate and the footer note are gone, and the current leg says Now instead of a second live dot. One Live tag.
* Stop page: an alert shows once at the top instead of under every departure, the peak fare banner is gone, and the hint is one line.
* More: Park and Ride and Opal top up machines (no longer also in Plan), commutes when you have some, Notifications, Accessible trips, Lift outage alerts, Opal fare type, Privacy and data, Help, Privacy policy, Web version and Version. The duplicate saved trips list and the WhatsApp text are gone.
* Ask: suggestions come only from your own recent trips (and Last train home once home is set), and each answer row no longer repeats the fare.
* Every main button was tapped once in a browser test and acted on the first tap: the four tabs, Opal fare, Later services, Include trips with a change, a service row, Start trip, Share trip, End trip, Save trip, star a stop, Watching and Opal fare type (`app/test/e2e/buttons.mjs`).
* Live trip replay: the unit replay now also runs Burwood to Strathfield (one stop: on time, 3 min late, 1 min early) and Burwood to North Strathfield with a change at Strathfield, and a browser replay (`app/test/e2e/live-replay.mjs`) plans a real trip, taps Start trip and moves a fake clock to 15 minutes past arrival, logging every alert. Each alert fires once, You've arrived fires once, and nothing happens after the trip ends.
* The web export can be built with `EXPO_PUBLIC_LOOK=android` to show the Android styling in a browser.

### Android app: live trip ends at your stop, each alert once (same over the air update, 10:33 PM)
* Fixed: the live trip could roll on to the next train after you arrived. The app only accepts the same run (planned time within 5 minutes, and never a vehicle behind your boarding stop once you have boarded), so it ends at your stop with one You've arrived and stops all alerts.
* Each alert fires once per leg with a stable id, and "Arriving in 2 min" and "Next stop" for the same moment are one alert. When the server follows the trip (notifications on), it sends every alert and the one You've arrived and ends its watch at your stop; the phone posts none of its own, so nothing doubles. Without the server the phone sends them, each once.
* One live trip engine runs on every screen, so the trip keeps updating and ends on time when you leave the trip screen.
* No Lock screen button: the ongoing notification starts with the trip.
* New replay test (`app/test/livereplay.test.mjs`): a two leg trip changing at Redfern to the T4 for Kings Cross, on time, delayed and early, to 15 minutes past arrival.

### iPhone app: live trip map and arrival on the Lock Screen (11:05 PM)
* The live trip map draws only the part you ride (boarding stop to the stop you get off at), not the whole line out to Penrith, and frames that part plus where you are. The locate button goes back to that frame.
* The live trip screen no longer shows the Opal fare (it is on the trip details).
* At arrival the Lock Screen card says "You've arrived at Strathfield" with the time the train got in, then leaves the Lock Screen 2 minutes later. Even if the app is not running, the card switches to the arrived state at the arrival time instead of sitting at "Next stop" and 0:00.
* Tests: the map frame for Burwood to Strathfield is under 5 km and holds both stops, nothing is drawn towards Penrith, and the card at arrival is the arrived state.
* CI no longer uploads to third party file hosts: the full bundle is a GitHub Actions artifact and the screenshots and replay timelines go to the ci-out branch.

### Remote config for the iPhone app (10:45 PM)
* New `GET /api/app/config` on the server (deployed) and a matching reader in the app, fetched at launch and when the app comes to the front, with the last good copy kept for offline launches. From the server, without a new build: hide a feature, pause one with a message (kill switch), change the welcome title and the Start trip footer, change alert timings and the live refresh rate, and reorder the tabs. Trip and alert decisions stay on the server as before. Details in docs/API.md.
* An admin can change it with `POST /api/app/config` (stored in D1, merged over the defaults).
* Tests: backend `appconfig.test.mjs` (defaults, merge, admin only, junk ignored); app `RemoteConfigTests` (defaults, flags, kill, copy, tab order, bounds, bad parts ignored). 87 backend tests pass.

### iPhone app: simpler layout, four tabs (10:40 PM)
* Four tabs instead of five: Home, Plan, Watching, More. Ask, Park and Ride, Opal machines, Settings and About now live under More.
* One way to plan: the Plan tab, with Plan a trip at the top, then recent trips and recent stops, each with Clear. Home no longer has its own search field, plan icon or recent lists.
* Home shows your trips under "Your trips", starred stops and nearby stops. With nothing saved it shows a welcome with one Plan a trip button. Watching lives only on its tab. Commute reminders live on their trip, not in Settings too.
* A lift outage shows once per trip card and once in the planner, not on every service row. A stop board shows a shared alert once at the top, not on every departure.
* Trip screen: Start trip, then Save trip and Remind me every weekday. The save banner reads "Saved as X. It shows on Home with live times".
* Settings: "Alerts" is now "Notifications"; the clear history buttons moved to the Plan tab next to the lists they clear; About is its own screen with the publisher, Fintex Australia Pty Ltd.
* New UI test FullJourneyTests walks every screen in light and dark.

### iPhone app: one Lock Screen card per trip (10:35 PM)
* Fixed: a trip could show two Live Activities at once (a followed service card and the trip card). Starting a trip now ends every card first, including ones left from earlier trips, and a refresh can never ask for a second one. Following a service replaces the trip card the same way.
* The one card changes with the trip. Waiting: "To Central, leaves 9:51pm, Platform 2". On board: "Get off at Redfern, 3 stops". After a change it shows the next leg. The bottom line always reads "Arrive Kings Cross 10:36pm".
* The countdown is whole minutes ("in 26 min") on iOS 18 and later, not a 26:21 seconds timer. iOS 17 shows the clock time. Followed service cards count the same way.
* Short names without "Station", so "Board at Strathfield St..." no longer cuts off. The fare line is gone from the Lock Screen.
* Unit tests: starting a trip twice leaves one card, cards from earlier trips are ended, minutes never show seconds.

### iPhone app: trip screen buttons, one Start trip, journey replay (10:25 PM)
* Fixed: on the trip screen the map link and Start trip could buzz and do nothing. Every link in the trip flow now opens by value (trip, map, planner), so each stack knows where it goes, and Start trip presents the live trip again even when an earlier one left it marked open.
* Start trip and Watch trip were the same job: Watch trip is gone. Start trip asks for notifications once and also follows the trip on the server, so alerts arrive with the app closed. It ends at your stop.
* The trip card shows one LIVE badge (at the top), not one per leg. Step free chips show only when a lift is out.
* "Track" on each leg is now "Map".
* Journey replay (launch argument -liveReplay YES): Start trip on any planned trip runs the real live trip engine on a fake clock, 60 times faster, with fake live data, and logs every alert, Lock Screen state and trip state. -liveReplayDemo YES replays a trip with a change (T1 late to Redfern, T4 early to Kings Cross).
* New UI tests: test15 taps every button on the trip screen and checks each one acts; test16 plans Burwood to Strathfield with live data and replays it to 15 minutes past arrival; test17 replays the trip with a change. Both check each alert once, one You've arrived, the trip ends at arrival and nothing after.
* CI: ios-native.yml takes `only` and `note` inputs to run chosen tests.

### Server: trip alerts once, and a trip ends at your stop (10:15 PM)
* Fixed: two checks of the same watch running together (the minute tick and an open app) could both send "Arriving at Kings Cross in 2 min". Each alert is now claimed in D1 (new table `watch_sent`) before it is sent, so it goes out once.
* A leg gets one get ready alert: "Next stop" (from where the train really is) or "Arriving in N min", never both.
* A trip started with Start trip ends at your stop: one "You've arrived at Kings Cross" with the time the train got in, then the watch ends. Nothing follows it.
* "You'll miss the" alerts name the live departure time, the same time the change alert uses.
* New test `journey-replay.test.mjs` replays a whole trip (Strathfield to Redfern on a late T1, change to an early T4, off at Kings Cross) on a fake clock, with two checks racing at each arrival, and checks every alert. 83 backend tests pass. Deployed.

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
* Web release 3 (12:41 AM): watch any trip with phone notifications, connection rescue, commute memory, delay predictions, installable web app, iOS style redesign, minute scheduler.
* Web release 2 (12:00 AM): auto refresh with ticking countdowns, Live and Scheduled badges, GTFS realtime merged into the planner's times, live vehicle map, trips with change times, saved trips by name, alerts on services.

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
* First release (5:14 PM): the web app. Stop number or station for a live board, "A to B" trip planning with "at" and "by" times, alerts, nearby stops, plain text answers. Transport for NSW Open Data account and API key created.
