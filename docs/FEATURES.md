# Features

What Transport: Sydney Live does today, where to find each thing, and what is still to come. Written for testers, support and App Review. Updated 25 Oct 2026, 7:45 PM Sydney time.

The iPhone and Android apps are one Expo app (`app/`). Anything below marked "over the air" reaches every iPhone build in the field (201 to 208) and the Android app without a new build. Release ids are in [RELEASES.md](RELEASES.md), and what changed when is in the [Changelog](../CHANGELOG.md).

## Home

* **Next trip card** on top, the first card under the title (25 Oct, evening): the big countdown, line badges, platform (for a bus, the stand and stop number), the live label, leave and arrive times and the next two times ("Next 12 min, 19 min"). Drawn in the Line glow look: a 2 pt ring running between the trip's line colours (T4 blue into T1 orange), a glow in those colours and a lifted surface in dark, a soft shadow in light; a solid 1.5 pt line colour border with Reduce Transparency or Increase Contrast. Other cards stay flat. The countdown turns red only once the service has gone or is cancelled. It is your commute when Home and Work are set (home to work in the morning, work to home after midday), otherwise the first trip in your list. Hold a trip and choose Show first to make it the card. See [HOME-REDESIGN.md](HOME-REDESIGN.md).
* **Other trips** as slim rows with their next time; starred stops; Nearby.
* **One +** at the top right: New trip, Star a stop, Set Home, Set Work. On iPhone it opens the system action sheet from the button; the hold menus, Save this trip and the Recent rows use the same system sheet. Android keeps its bottom sheet.
* **In transit bar:** while a trip is live, one slim bar above the card ("In transit · Central to Strathfield", line badge), tap for the live trip. With no live trip and one watched trip, the same bar shows that watch.
* **Notifications** under the card: one row of small chips, closed until tapped: trip alerts with a count, Trackwork this weekend, lines with a problem ("T4 Delays"), a high priority alert, other watched trips. A tap opens the full text in place. Nothing alert related sits above the card. See [HOME-REDESIGN.md](HOME-REDESIGN.md).
* **When to leave** and **Check before I go** as small buttons in the commute card.
* **Delete** a trip by swiping, holding or with VoiceOver; Undo shows above the tab bar for 5 seconds.

## Live times

**Stop lists from the timetable run (26 Oct, g24, server).** The service screen's stop list is now the run you tapped, from our own timetable: every stop of the trip and of the trips the same train carries on as (Sydney Trains splits a run at Central), to the station on the front of the train, with live times on it. This fixes the T5 from Parramatta to Blacktown, T9 runs to Hornsby shown "via Strathfield", and T1 runs that stopped at Gordon, and works the same for metro, light rail, buses and ferries. A train that turns into another service keeps the old list. With the Trip Planner down, a trip to a service's last stop (Circular Quay to Manly on the F1) now has timetable trips too. Live once the server is deployed and the nightly planner pack is loaded; nothing changes in the app.

**Train stop lists and regional badges (26 Oct, about 8:45 AM).** The service screen's stop list for a train now runs from your stop to the real end of the line with every stop the train makes (server change, see docs/API.md): before, through trains to Hornsby, Berowra and North Sydney stopped at Central, some trains had no list, and Sydney Trains' feed left out stops it had no news for. On a service's own row, a regional train or coach that comes with only a route number shows Regional or Coach (the number stays in what VoiceOver and TalkBack read); route chips keep the number.

* **Live labels** on every countdown (departures, trip screen, live trip, Home): "Live, updated 15 s ago", "Timetable" (grey, no live data for that service) or "Not tracking" (live data went stale, so the timetable time is shown instead of a countdown). A timetable time that has passed never says "left". See [LIVE-LABELS.md](LIVE-LABELS.md).
* Departure boards refresh while open and pause in the background ([PERFORMANCE.md](PERFORMANCE.md)).
* **Why it's late** (over the air): a late, cancelled or changed service shows one line with the reason from its own Transport for NSW alert ("Delayed: signal repairs at Redfern"); tap it for the full alert. Nothing is shown when the alert gives no reason. On departure rows, trip legs and services, Home trip cards and the live trip. See [WHY-LATE.md](WHY-LATE.md).
* **Hold a departure** (over the air, 25 Oct, about 10:00 PM): on a stop screen, the full board's list rows and Home stop cards, tap and hold opens the system context menu on iPhone (Watch or Stop watching, Show stops, SF Symbols, no Cancel), the Material 3 menu on Android; VoiceOver lists both as actions. A swipe still watches in one move.
* **Departure board** (over the air): Board at the top right of a station or stop opens a full screen board like the platform screens: line, destination, platform or stand, where trains stop after this station, minutes and Live, Timetable or Not tracking on every row. Dark, with a Light board button; grows with the text size setting; works in portrait and landscape; keeps the screen on only while it is open.

### 26 Oct, speed (g10): search and saved boards
* **Search as you type, on the phone.** Plan's Departures and Trip boxes, Add trip, Simple mode and setup show stops the moment you type, from lists the phone keeps: every train, metro, light rail and ferry stop (the lists Ask already keeps) and every bus and coach stop (`/stations/bus-stops.json`, about 370 KB once, kept 14 days, read 6 s after start). Exact names first, then names that start with what you typed (a whole word first: "kings" is Kings Cross before Kingswood), then every typed word at the start of a word, then a slip of one or two letters for stations ("strathfeild", "wolongong"). Short forms work ("parra", "kings x", "bondi jnct"), and a stop number finds its stop. Bus stands never push stations off the list.
* **The server still helps.** After a 280 ms pause the server is asked; addresses, streets, landmarks and stops not in the lists are added under the phone's results. A newer keystroke cancels the request still out. The spinner shows only while nothing at all is on screen; "No stops match" waits for the server.
* **Press in.** A finger on a stop result or a recent stop starts that stop's board.
* **Saved boards on the server.** A stop someone opened (or one of 50 busy interchanges) has its last board saved; the next first open gets it at once with its age ("Updated 4 min ago, refreshing") and fresh times about 2 s later. Live times are still at most 15 s old once fresh.

### 26 Oct, speed (g10): app side
* Stop and trip screens that open on a copy the server saved earlier ask for fresh times about 2 s later, once, so live times arrive within seconds of opening.
* Touching a stop row starts loading that stop before the tap ends, so the stop screen opens on its departures.
* Countdowns on the trip list change exactly when the minute changes.
* No white flash behind screens in dark mode.

### 26 Oct, fastest live data (g17, all off)
* Live push also for stops still served by the Trip Planner (`LIVE_PUSH`, server; app flag `livePush` in remote config, from g14): the open stop screen gets the new board when it changes, about every 15 s, instead of waiting for its own poll. Socket limits per address and per stop, and a renewal every 10 minutes.
* Data age per row (`LIVE_DATA_AGE` in app/src/lib/features.ts, off): "Live 30 s ago" counts from when the server read that row's time upstream (`liveAt`), corrected for the phone's clock, on the stop screen, Home cards and the board wherever rows already show Live. Pushed boards get their ages the same way.
* Watch and widgets: a board or trip they ask for is answered at once from the server's kept copy (up to 2 minutes old) while the fresh one is fetched for their next ask (server, on).
* Request numbers: one log line per request (path, status, time, NSW time and calls, copy tag, app or watch/widget) so slow and failing endpoints can be measured (server, on, sampled 1 in 10 in Workers Logs).

## Car parks (over the air, 25 Oct, about 10:00 PM)

* **Car park row on a station:** a train station with a Transport Park and Ride car park shows one row under its name, "Car park: 218 free of 228" (or "Car parks" with the free spaces across a station's car parks) and when Transport for NSW read it ("Updated 9:40pm, 3 min ago"). A car park without a live count says "no live count right now"; a station without one shows nothing. Tap opens the car park.
* **Car park detail:** live free spaces of the total, Spaces free, Nearly full or Full, a fill bar, the reading time, "usually full by" when the server has it, the address, and **Directions**: Apple Maps on iPhone, Google Maps on Android, driving to the car park's coordinates. On iPhone it opens as a sheet with a grabber.
* **More > Car parks:** every Park and Ride car park with live spaces, closest first when location is already allowed (low accuracy, never asks), else A to Z; a tap opens the same detail, with Station departures. The alert bell stays on the station's Park and Ride section.
* Data: `/api/parking` on the server (Transport for NSW Car Park API, the server's own key, readings cached 90 s), see [API.md](API.md). No numbers are made up.

## Buses

* **Live bus status** (over the air, 25 Oct, about 10:25 PM; Bidur: "live bus traffic on 410/D400", then "cant do it with only this suburb"): every bus and coach with live data, anywhere in NSW. Bus rows on stop screens say how the bus is running ("4 min late", "On time", "2 min early") and where it is ("3 stops away", "At the stop"); with no live data they say "Timetable only" and nothing else. The departures board shows the same: the delay beside the stand, where the bus is on the line under it. The bus trip screen draws the bus on its line of stops (at a stop, or just before its next stop) and says BUS IS HERE at the stop it is at. **Running slow in traffic** shows on a bus row, the board, the bus trip screen and bus legs of a trip only when the live predicted delay grows by 3 minutes or more over the stops ahead of the bus and the bus ends that stretch 3 or more minutes late (`busLiveCore.slowInTraffic`; no route or stop is named anywhere in the rule). The server sends those delays with each live bus row (`ahead`, docs/API.md). A Live Traffic incident on the route still takes the line first on a trip leg.
* **Stop numbers:** search the number on a bus stop sign (for example 2046100). Bus stops, departure rows, Home stop cards, bus legs and the live trip show "Stop 2046100".
* **Route view:** Route on a bus service, on a bus leg, a route badge on a bus stop, or search a route number (410, M90) in Plan. Every stop in order with its stop number, the live buses along the route, next times at a stop you tap, the other direction and a map.
* **Earlier departures on stop boards** (over the air, 25 Oct): an Earlier departures row at the top of a station or stop's list (Now too) loads the services before the first one shown, one batch a tap, back to 4am (the start of the service day); a time chip ("Now", or "From 6:15pm") opens a time wheel with Now and From and shows the board from that time, services already gone included. Gone services are greyed Left rows: "Left 8:25 · 2 min late" with the live time it left at, "Left 8:16 · Scheduled" with only the timetable, "Cancelled 8:20". These boards come from api.transportsydney.app (`/api/departures` with `time`); if it does not answer the board says "Earlier departures need a newer server, which did not answer just now. Pull down to try again."; a server without the parameter hides the row and the chip. Now is unchanged. A link can open a board from a time: `/stop/<id>?time=HHMM`.
* **Stop boards:** route chips filter the board (tap 410 for only the 410); a Recently departed row ("Left 4:21pm" only when live data followed the service to its departure, otherwise "Due 4:20pm, not tracked").
* **Further ahead at big stations** (over the air, 26 Oct, item 2): a board answer is 40 services, so at a station with trains and many bus stands the mixed list covers about 15 minutes. Tapping Buses (or Trains, Metro) or a route chip there now loads 40 services of that mode alone: buses at Strathfield reach about 50 minutes ahead instead of 15, so the 415 to Chiswick shows with the 415s to Campsie. All is unchanged. These boards come from api.transportsydney.app (`mode` on `/api/departures`), with the server in use as the fallback.
* **GET ON and GET OFF** on your two stops when a bus or train leg is opened from a trip.
* **Bus picker in New trip:** opens on bus stops near you (only when location is already allowed), then saved and recent bus stops, then Sydney routes in number order. Trackwork, school and regional routes sit in closed sections at the end.

## Four rider wins (g31, on main, not in an over the air update yet)

App only, JavaScript, no new native module, no server change. Not tried on a real phone yet.

* **Where the bus is** on Home trip cards (the big card and the slim rows) and on the trip screen's service rows: one line such as "3 stops away" under the status (the status line beside it already says "4 min late" or "On time", so the delay is said once, g32), with a location glyph, in green (orange when 2 min or more late). It uses only what the server already puts on a ride leg (`vehicle`, `stopsAway`, `delayMin`, and `ahead` for the delay at your stop) and shows only while the row's own label is Live; timetable, Not tracking, cancelled and kept offline rows show nothing new. Any mode with a live position (bus, light rail, ferry, train). Hidden past 20 stops or with a position older than 3 min. VoiceOver reads it in the row's label. Departure boards already said "N stops away" for buses and are unchanged. Code: `app/src/lib/whereNowCore.ts`, `app/src/components/WhereNow.tsx`.
* **Walking** on the trip screen (A to B trips; trips with a change stop already set a walk per leg): a row under the mode chips, "Walking: Any", opening the system menu (iPhone sheet, Material menu on Android): Any walk, Up to 5, 10, 15 or 20 min, and Prefer a bus. Kept on the phone for every trip (`walkPref` in the store). The phone leaves out trips whose longest single walk is over the limit and says how many ("1 trip with a walk over 10 min not shown."); when every trip walks longer they all stay, with a note, so the list is never empty because of it. Prefer a bus puts a trip with a walk over 8 min just below a trip that walks less and arrives at most 10 min later. With a limit the request asks for 8 trips (the most the server gives) and carries `maxWalk` and `lessWalk`; the server ignores both today (no server change in this work), so the filtering is all on the phone. Home cards are not filtered. Code: `app/src/lib/walkPrefCore.ts`, `app/src/components/WalkChoice.tsx`.
* **Get me home** on Home, under the commute card: one row, "Get me home, from where you are to Penrith" (your Home's name). One tap asks for your position (the same permission Nearby uses, balanced accuracy, asked once) and opens the trip screen from that point (`lon:lat:EPSG:4326`, which `/api/trip` already plans from) to your saved Home. With no Home it asks once, then opens Set Home. Location off: a plain message with Open Settings; outside NSW: says so. A trip from your position is not added to recent trips and has no Save button (it is not a stop). No new tab, no change to any existing tap. Code: `app/src/lib/goHomeCore.ts`, `app/src/components/GetMeHome.tsx`.
* **Exact stand pin** in an open trip, above each ride leg: "Stand C3 on the map" (or "Platform 2", "Wharf 3"; "Where to board" when the name has none). A tap opens a small map with a pin at the stand's own point (the first point of the leg's path from the trip planner, not the station's centre) and the start of the bus's road, plus "Walk there in Maps" (Apple Maps walking on iPhone, a geo link on Android). For buses and coaches it adds "Stand C3 is across the road from where your walk starts" when the walk's start is 12 to 300 m from the stand on the right of the bus's first 40 m or more of road (NSW buses stop at the left kerb); otherwise no hint. Timetable answers have no path, so no pin. The map loads only when opened. Code: `app/src/lib/standPinCore.ts`, `app/src/components/StandPin.tsx`.

## Plan and trips

* Plan from any station or stop, or from where you are. Leave now, Leave at, Arrive by; Step free avoids stations with a lift out of service.
* Multi leg trips, tight and missed connection warnings, Opal fare estimates (NSW TrainLink trips show their own fare note).
* Station picker: the question is in the search field ("Where do you get on?"), with A to Z, By distance and By map.
* **Choose the mode** on the trip screen (over the air, 25 Oct): chips under the Step free and Include trips with a change switches: Any, Train, Bus, plus Metro, Light rail or Ferry when a result for that trip uses them. Several can be on (Train and Bus). Bus asks the planner for buses only, so Strathfield to Town Hall shows real bus trips with stand and stop numbers. The choice is kept per trip on the phone; the default is Any. When nothing runs: "No bus-only trips at this time. Try Any." with an Any button. Mode only trips are planned on api.transportsydney.app (called directly, like long trips, with no profile or device); if it does not answer, the phone filters the usual results and says some trips may be missing.
* **Endless trip list** (over the air, 25 Oct; pages 27 Oct): scroll up and down through trips up to 7 days back and 7 days ahead, no Earlier services row or Later button. A plain A to B trip loads pages of about 10 trips (the most one Trip Planner call gives) from api.transportsydney.app (one Trip Planner call a page, the planner's answer shared by every phone for 10 minutes, live times kept to the 15 s rule), and the next page either way is asked for while you are still a screen and a half from the end, so scrolling does not wait. Earlier pages load when you scroll up near the top (never by themselves on open), go in above without moving the trip you are looking at, and show gone ones as Left rows. Skeleton rows stand in while a page loads. One page at a time each way, only while the screen is on view; a direction ends 7 days out or when the planner has nothing new, then offers Choose a time. A trip via a stop, or an older server, loads batches from a time as before (at most 8 later a visit, stopped at 4am). Whole days (on main 27 Oct, server part behind `OWN_PLANNER`, off): when the server's own planner is on, the first page is the whole day from our timetable (3 AM to 3 AM) with live times, the next day comes about 50 rows before either end, and earlier rows already loaded go in above a block at a time; past the days the planner holds the list carries on with Trip Planner pages.
* **A time in the past** on the trip screen (over the air, 25 Oct): Leave 6:15pm picked at 6:27pm lists the services from 6:15pm, and the ones already gone stay as greyed Left rows ("Left 6:21 · 3 min late" with the live time it left at, "Left 6:18 · Scheduled" with no live time). The first one you can still take opens. Arrive by in the past works the same. Scrolling up at the top of every trip list (Now too), or a pull down, loads the services before the first one shown, gone ones as Left rows (pages, see Endless trip list). The day is fixed when the time is picked, so a time picked for today stays today's as the clock moves on. Times up to 30 min ago work on both servers; older times today are planned on api.transportsydney.app (the first server plans those for tomorrow), and if it does not answer the screen says "Earlier trips need a newer server, which did not answer just now. Pull down to try again." Plan B looks only at services you can still take.
* **Leave now chip** at the top of the trip screen (over the air, 25 Oct): opens Leave at or Arrive by with the time wheel and a day row (today to 7 days ahead; iOS sheet on iPhone, Material dialog on Android, built in JS so builds 201 to 206 have it). Now is one tap back. Another day is planned on api.transportsydney.app (`date=`).

## Follow a trip

* **Start trip:** live map, next stop, stops left, arrival time, alerts before your stop and at each change. On iPhone the trip shows as a Live Activity on the Lock Screen and in the Dynamic Island, updated by push while the phone is locked (build 205 and later). The trip follows the real service, never the timetable alone: a leg ends when the live feed or the vehicle's position shows it past your stop, its live arrival has passed, your location (when allowed, only on the trip screen) shows you at the stop, or you tap **I'm at** the stop. A late train's delay carries on to your stop off, so the arrival and the ETA move with it, and the leg shows how late it is ("9 min late"). Without live data the trip says "Not live, running to timetable", names no next stop and waits for your location or your tap; your location before your stop always holds the leg. A change the live times say you will miss is flagged at once with the next way on, and never counted as made on timetable times. The notification, Live Activity, Watch and widget card show the same.
* **Get off alert** (trip mode, under Wake me before my stop; kept on the phone for every trip): one system menu with 1, 2 or 3 stops before, and Get off now. 1 stop before is the Next stop alert as it always was (the default, nothing new is set). 2 or 3 stops before adds "3 stops to Central" (at a change it names the next line) as the service leaves that stop, then the Next stop alert at the stop before as usual. Get off now ("Get off now: Central", "Change here to the T4." at a change) comes a minute before the live arrival at your stop, never before the service leaves the stop before. Both come only from the live stop times the trip already reads (no location, no extra request), are set on the phone as local alerts on the trip alerts channel so they ring with the app closed, move when the live times move, and are taken back when the trip ends, the leg is over, you switch to the next way on, or you change the choice. With the app open, the service's live position decides: a time that has passed while the live times still show it before that stop waits 30 s more instead of ringing early. No live times: nothing is set (the same rule as Next stop). A ride shorter than the choice gets no heads up (the Next stop alert covers it). With Speak alerts on, each is read out once ("3 stops to Central.", "Get off now. Central."); builds without the speech module just skip that. Code: `app/src/lib/getOffCore.ts`, `getOffNotify.ts`, `app/src/components/GetOffChoice.tsx`.
* **Speak alerts** (switch in trip mode, remembered for the next trip): short spoken lines once each, such as "Your bus leaves in 2 minutes from stand X1", "Redfern is next. Change here for the T4" and "You've arrived". Needs the app open. On iPhone build 206, Silent mode mutes the speaker (headphones work); build 207 fixes that.
* **Watch** a service (swipe left on a departure) for leave now, running late and platform change alerts.
* **Share trip:** a link that stops working when the trip ends.

## Reminders and checks

* **Trip reminders** (over the air, 25 Oct): open a saved trip, Reminders under the services. Several per trip, each at a time on the weekdays you choose (up to 6). Local notifications on the phone: nothing polls and nothing goes to the server. Notification permission is asked only when the first reminder is saved. See [REMINDERS.md](REMINDERS.md).
* **Check my trip before I go** (More): one alert before your usual leave time, only when something is wrong.
* **Calendar leave by** (More, off by default; shows from iPhone build 208): "Leave by 7:44pm for Team meeting (Barangaroo)" on Home for events in the next 6 hours that have a place, from where your usual trip starts, live. Tap for the trip at Arrive by the start time. Read only, read on the phone while Home is open (at most every 5 minutes); only the event's place and the trip query leave the phone, with no ID. See [CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md).

## Ask

Ask anything about getting around Sydney and NSW, the way you would say it: "strathfeild to kings x", "next 333 from bondi beach", "trains after 6pm tomorrow to parramatta", "is the t1 running late", "lift at redfern?", "parking at ashfield", "last train home". Answers come from live data with fixed rules; there is no generative AI and no paid service.

The phone reads the question first (`src/lib/askBrain.ts`, pure and offline), then sends one clear question to the server:
* **Places**: every train, metro, light rail and ferry stop and every NSW suburb, from the lists the server publishes (`/stations/*.json`, kept on the phone for 14 days by `src/lib/askPlaces.ts`). Typos are matched by spelling distance ("parramata", "katomba", "woolongong", "wolli ck"), short forms by rule ("kings x", "cq", "parra", "stn", "rd", "nth", "jn"). Landmarks, hospitals, streets and shopping centres that are not in the lists go to the server's place search as typed. A word that names several places ("the airport", "uni", "the city", "the beach") gets a question with the choices.
* **Times and days**: "after 6", "around 8:30", "by 9am", "half past 7", "in 20 min", "tonight", "tomorrow morning", "friday arvo", "this weekend", "leave at 8 arrive by 9". A clock time with no am or pm is the next time that clock reads. Another day is planned with the trip planner for that day.
* **You**: "home" and "work" are your saved places; chips under the box come from your own usual and recent trips, home and work, and starred stops, never a fixed list.
* **Follow ups** (for 30 minutes, kept in memory only): "and the one after", "later", "earlier", "what about by bus", "by ferry instead", "from there", "and from there to Bondi Beach", "the way back", "what about tomorrow".
* **What it answers**: trips (with via, no changes, step free), departures at a stop or for a route at a stop, the last service, delays on a line or mode, trackwork, Park and Ride car parks, lifts and access, fares (the Opal estimate that comes with the trip answer; without one it says where to see what a trip cost), "when does my bus come" (your usual bus trip, or a question with your stops), stops near you.
* **Never a dead end**: when it is unsure it asks one short question with 2 or 3 choices you tap (from your own places, or Use my location). It never makes up a time or a number; every one comes from live data.
* **Fares, Did you mean**: in a fare question each station name is checked against the station and suburb lists kept on the phone (offline once kept). A clear slip is used; a name that matches several places shows "Did you mean:" with up to 5 real stops, best first, each with its modes ("Kings Cross, Train"); a suburb with no station offers its nearest stations (with the distance) and the suburb itself ("Mona Vale, any stop"). Rule based: exact name, start of a name, a word in a name, then spelling slips; close candidates are never picked between.

Each answer shows what was understood in small type above it ("Katoomba to Central, tomorrow, from 6:00 am"), then one card, then **Open trip** or **Open board**, **Directions** (car parks, to Apple Maps or Google Maps) and **Speak** (the next services read out from the card, with the one time better voice offer), plus Earlier and Later chips on trips and boards. A trip with no start uses where you are only when location is already allowed (a recent fix, no prompt).

Ask opens on the latest message and its field sits above the tab bar and the keyboard. It shows the last 30 messages, with Load earlier at the top; up to 200 are kept on the phone. **Clear chat** is the trash button at the top right of Ask and in More > Privacy and data, and asks first. The chat is only kept on the phone.

Measured: `app/test/ask-corpus.test.mjs`, 309 questions from all over Sydney and NSW (every region and mode, at most 5% on one commute): 192 of 309 (62%) read right by the old path (the question as typed, the server's rules, exact names), 309 of 309 (100%) by the new one. A second batch of 60, written after the first passed, scored 58 of 60 (97%) on its first run before fixes.

## Instant start and offline (over the air, 26 Oct, item 1)
* Home, the stop screen, the full screen board, the trip list, Simple mode and the service screen show the last answer kept on the phone at once, with "Updated 4 min ago, refreshing" until the live answer replaces it. Kept times are never shown as live, and services already gone are left out.
* With no signal the same screens show the kept times with "Offline, showing times from 8:05am" (a banner over the trips on the trip list) instead of an error, and try again with a growing gap while the screen is on view.
* Data for one stop, service, time or trip never shows under another one: an answer still on its way when you switch is dropped.

## Timetable on the phone (server 26 Oct, 12:20 PM, transport-api 2ef1ad9f; over the air 26 Oct, 12:54 PM, group 54aa4d52)
* Stops you use (starred, on saved trips, home and work, opened lately; 24 at most) keep their timetable for today and tomorrow on the phone, from api.transportsydney.app's `/api/pack`. Fetched once a day, at start or when the app comes back to the front, one stop at a time; 0.7 to 14 KB each.
* The stop screen, Home's starred stop cards and the full screen board show those departures in the first frame, with no signal too, marked "Timetable times, getting live times" (or "Live times unavailable, showing timetable times"), each row in grey as Timetable. The live board replaces them when it lands. A copy of the live board from the last 10 minutes still goes first.
* Checked: every timetable row at 20 stops NSW wide was on the Trip Planner's board at the same minute (370 of 370). Details: [TIMETABLE_PACKS.md](TIMETABLE_PACKS.md).

## Button check fixes (26 Oct, g23; next over the air update)

* Commute card in the busy hour: the leave line ("Leave in N min", Remind me) now shows when every loaded service leaves before you could reach the station; the card asks once for services from the moment you could board (`reachFrom` in `src/lib/smart.ts`).
* A watch the server no longer has (`/watch/<id>`, for example from an old notification) says "This watch has ended" with Show Watching, and stops asking.
* Car parks with an empty list says "No car parks to show".
* A link to a screen the app does not have (an old Platform view link) shows "This link isn't in the app" with Go to Home.
* Details: [BUTTON_CHECK.md](BUTTON_CHECK.md).

## Platform view (removed 26 Oct)

Removed from the app on 26 Oct (Bidur at 5:36 PM: better not to keep it, he does not use it, and it may cost requests). It had been hidden since 8:30 AM that day. The screen (`app/platform.tsx`), its helpers (`lib/platform.ts`, `lib/platformCore.ts`), its tests, the `PLATFORM_VIEW` switch, the stop screen header button, the hold menu item and the two `api.ts` calls only it used (`platformDepartures`, `platformService`) are deleted (g23, main `e33c2fe`). An old link to `/platform` opens a plain "This link isn't in the app" screen with Go to Home (`app/+not-found.tsx`). While hidden it made no requests: the route redirected before the screen mounted and `openPlatform()` returned at once. It used no server endpoint of its own (it read `/api/departures` and `/api/service`, which every stop and service screen uses); the `cars` count on departure rows is now read by no screen, while the `quiet` hint next to it is still used by the quiet carriage tag. What it looked like is in git history before `e33c2fe` and in the CHANGELOG entries of 25 and 26 Oct.

## Wide windows (over the air, 25 Oct, about 11:17 PM)

On an open iPhone Duo, a fold's inner screen or a tablet, screens turn and resize with the window; on a phone sized window (shortest side under 600 pt) they stay upright as before and only the departure board turns. Pinned bottom content in tabs (the Ask field, the Home undo bar) keeps clear of a tab bar standing on a side edge, and Simple mode keeps clear of the side safe areas and sits at a readable width in the middle.

## Simple mode

More > Simple mode (off by default) opens the app on one plain screen headed **Plan Your Trip**, for anyone who wants less on screen. **From** is Current location when location is already allowed (low accuracy, never asked on launch); otherwise tap it for Use my location or search. **To** is empty until you pick a place, with a swap button between the two. **Your places** are big rows (Home, Work, recent places, starred stops); one tap fills To (or From) and searches at once. **Leave now** or Leave at opens the time picker. The trips come as a plain list: leave and arrive times, duration, changes, line badges, on time or late (a delay of 5 min or more also says the timetable time: "27 min late, was due 10:04am") or cancelled, on demand buses such as the D400 as "On demand, book ahead" (once per list, the step says to book with Bridj before you go), and the whole minutes to go; a trip with a change that gets there no sooner than a direct one leaving within 20 minutes is listed under it, with **Earlier** and **Later** at the ends. Tap a trip for big simple steps from its real legs (Walk to the platform, Take the line to a station with the stop count, Change at a station and platform, Get off) and a **Speak** button that reads them aloud. No swiping, no chips, no maps. The list refreshes only while it is on view. The gear turns Simple mode off, after a confirm. VoiceOver reads each trip as one sentence.

## Voice

Spoken trip guidance and Speak departures (Home commute card, stop screen, full screen board) use the best voice already on the phone: Premium, then Enhanced, then the default, Australian English first, then British, then American; novelty voices left out. Nothing to download. More > Voice lists the English voices with Play sample, read from your stop's live times, and a tip on downloading a better voice only when the phone has nothing but compact voices. Guidance reads like a station announcement: "Your train to Redfern leaves in 3 minutes, from platform 1." "Next stop, Redfern. Change here for the T4 line."

**Get a better voice** (Bidur, 25 Oct 9:51 PM: going into the phone's settings to download a voice is hard work). Apps can only speak with voices on the phone, so the app helps people get a natural one. More > Voice always has a **Get a better voice** row; its second line says when the phone only has its basic voice. On iPhone it opens a small sheet with three numbered steps (1. Open Settings, then tap Accessibility. 2. Tap Read & Speak, then Voices, then English; Spoken Content before iOS 26. 3. Pick a voice marked Premium or Enhanced and tap download) and an **Open Settings** button. Apple allows no link straight to the voice list, so the button opens the app's own page in Settings and the sheet says to go back to the main list; no private settings URL is used anywhere. On Android the row opens text to speech settings directly (then Accessibility, then the app's settings if a phone has neither), and **Download voice data** opens the speech engine's voice downloads (or text to speech settings when the engine has none). When the person comes back, the voices are read again; a new Premium or Enhanced voice shows **Better voice found** with its name and plays a sample from the live board (your home stop or a starred stop), and from then on every spoken line uses it. If nothing new is there yet, one quiet line says a download can take a few minutes. The first tap on a Speak departures button (Home commute card, stop screen, full screen board) on a phone with only its basic voice also offers this once, as the same sheet with Show me how and Not now; it is saved as seen the moment it shows and never comes back. Simple mode's Speak button does not show the prompt (More > Voice still has the row).

## Comfort (quiet defaults)

Reduce Motion stops the live dot pulsing. One light tap (haptic) when it's time to leave and on arrival on a followed trip. Countdowns read as "4 minutes", not "4 min".

## iPhone only (in build 206)

Home Screen, Lock Screen and StandBy widgets; Siri, Spotlight and Shortcuts ("Next train home in Transport", "Start my commute in Transport"); Control Center buttons (iOS 18); Apple Watch app and complications ([WATCH.md](WATCH.md)); Add to Calendar.

## Coming in build 207 (not built yet)

Native changes, so they need a new build (branches `native-207` and `native-207-bus`, see [RELEASES.md](RELEASES.md)):

* Apple Watch redesign and new complications.
* Bus stop widget with the stop number; starred bus stops with stop number and routes in Edit Widget.
* Speak alerts heard with Silent mode on (spoken audio session that lowers other audio).
* Liquid Glass app icon for iOS 26.

## Build 208 (built 25 Oct, 6:48 PM, on TestFlight)

* Calendar leave by: build 208 carries the calendar read access it needs (full access text on iPhone), so More > Calendar leave by shows on 208 and later; builds 201 to 207 keep it hidden. Android needs a build with READ_CALENDAR (versionCode 6). See [CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md).
* Widget layout fixes: times in one column, alerts on 2 or 3 lines, nothing in the rounded corners, a bigger countdown on the small widget.
* Not yet seen on a real iPhone. The next build is 209 on 1 Nov ([IOS27.md](IOS27.md), "Build 209").

## The new server (over the air, 26 Oct)

The app reads from api.transportsydney.app. Since the 26 Oct, 3:39 PM update a read goes to the first server only when the new one cannot be reached at all (no answer), with no hold; a 5xx or 429 shows the copy kept on the phone or the timetable instead. Saves always go to the new server. The first launch on this update carries the phone's saved trips, push token and morning checks over. These now show for everyone on the update ([API.md](API.md), [REVIEW-NOTES.md](REVIEW-NOTES.md)):

* "Usually 3 min late on weekday mornings" on stop boards (with a route chosen), the service screen and trip legs. Real answers need a few weeks of live times on the new server.
* Weekend trackwork card, Status of my lines, Plan B in the morning check, reliability lines, last way home reminder, Park and Ride "usually full by", live traffic on bus legs, carriage occupancy, and live times for NSW TrainLink, regional coach and Manly Fast Ferry services.

Fresh times: boards refresh every 15 s while the next service is 10 minutes away or less and 15 s after opening; trip lists, Simple mode and Home trip cards every 15 s while the first service leaves within 10 minutes. "Live, updated" shows when the times were read on the server ([PERFORMANCE.md](PERFORMANCE.md)).

Many phones (server, 26 Oct, 10:44 AM): phones at the same stop share one copy and one Transport for NSW call; a burst for one stop waits for that one answer (each request checks for it on its own timers, 26 Oct, g28); a slow answer is waited for at most 700 ms when a copy exists; when Transport for NSW is busy or refuses us, phones get the last copy (its "Updated" time says how old) instead of an error. Load tested at 100 and 1,000 phones ([SCALING.md](SCALING.md)).

## Privacy on the server (26 Oct, transport-api 3e88773d)

* Server logs keep the request line only (path, status, time; one request in 10, up to 7 days). Invocation logs are off, so no request address with its query (install ID, a position, an Ask question) is kept.
* Trip history (commute suggestions, 90 days) keeps stops only: a trip from a point is never logged, searched or watched.
* Store answers and policy: store/apple/app-privacy.md, store/google/data-safety.md, https://transportsydney.app/privacy/.

## Board engine (server, behind a flag, 26 Oct)

Every stop board in NSW built ahead of time on the server from the network feeds, so a board is a cache hit and Transport for NSW calls stay flat whatever the number of phones. Since 26 Oct (g14) boards are built by 16 shard objects that write them to Cloudflare's cache, and the worker reads the cache first. Off for phones until it matches the Trip Planner on 95% of services on a fresh sample, with no object restarts and 0 errors at 1,000 phones. docs/ENGINE.md, docs/SCALING.md.

**Timetable times when live data is down** (server, 26 Oct, 1:58 PM): when the Trip Planner refuses or fails and no copy of a stop's board is kept, the stop board shows the engine's timetable times instead of an error, every row marked Scheduled, with the alert "Live times unavailable, showing timetable times" on top. The next live answer replaces it. No app update needed.


## When Transport for NSW is down (26 Oct, g16)

* Trip cards, the trip screen and Ask show timetable trips (direct, or one change) labelled "Timetable times. Live
  trips are unavailable right now." instead of an error, and never "No more services today" unless a live answer
  truly had none. Nearby comes from our own stop list and works with no Trip Planner at all.
* A slow Trip Planner is not an outage (27 Oct, server): the newer app gets timetable trips after 1.5 s labelled
  "Timetable times for now. Getting live times." and asks again at 6 s and 10 s. Older app versions (builds 201 to 208,
  updates up to ecb0882d) wait up to 6.5 s for the live trips instead, so they no longer say "Live trips are unavailable"
  on a first open while the planner is only a few seconds slow.
* Messages say where the fault is: "check your signal" only when the phone has no connection; otherwise Transport for
  NSW's live data is unavailable or slow. No status codes anywhere.
* A server error or slow answer shows the times kept on the phone (or the timetable pack) instead of an error,
  labelled "Live times unavailable, showing times from ..." (header tag "No live times"), not "Offline".
* Trip searches wait 10 s at most and are not asked again for 45 s after a refusal; boards wait 8 s when a kept copy
  is on screen, 15 s with nothing. The old server is asked only when the new one cannot be reached at all.
* The server keeps the last live answer of each trip for 15 minutes and gives it at once on a first open, with its age.

A Transport for NSW answer that is not JSON (an HTML maintenance page, `null`, a cut off body) counts as Transport for NSW being down (26 Oct, g28, on main, not deployed): the same timetable board, kept copy and words as a refusal, never "Something went wrong on our side".

## Our own trip planner (server, behind a flag, 26 Oct)

Trip searches answered from our own copy of the NSW timetable with RAPTOR, so a search makes no Transport for NSW call and searches stop growing NSW calls with users (docs/SCALE_1M.md). Same answer shape as before, live times added to the legs the same way. Changes at stations and walks between nearby stops (up to 400 m), walks to and from your position (up to 1 km), stops where nobody may board or get off respected. Off for phones (`OWN_PLANNER`) until its trips match NSW's planner on a recorded sample after the key resets; step free trips, trips via a stop and trips leaving out a mode stay on NSW's planner for now. Checks: `/api/raptor/plan` (engine load key).

## Budget mode (server, 26 Oct, g20)

The server stays on the Cloudflare Workers Paid base fee (US$5 a month) for up to 1,000 people ([COSTS.md](COSTS.md)).
* Nothing costly runs while nobody uses the app: engine objects stop 5 minutes after the last read, 4 board shards, no
  engine learn calls while the engine is off for phones, the timetable loaded every second night.
* Hourly budget guard: projects the month end from Cloudflare's usage numbers; at 80% of any included amount it
  switches the engine, push and own planner off for the rest of the billing cycle and emails contact@fintex.au. At 50%
  it emails a warning once a cycle.
* Load test keys do not work on production.
* Phones see no change.

## Limited stops tag (g22, on main, not deployed or released)
* Departure rows and trip legs show a small "Limited stops" tag when that service skips stations its line normally serves. Worked out from the timetable for every line in NSW (trains, metro, light rail, buses, ferries), not a list of lines. iPhone: a filled grey capsule; Android: an outlined chip; caption size, theme colours, light and dark; read out as "Limited stops. Does not stop at every stop on the line.". Not a button.
* Server: `limited: true` on `/api/departures` items and `/api/trip` transit legs (docs/API.md). Needs the nightly planner pack with `tripLim` (docs/TIMETABLE_PACKS.md); `LIMITED_STOPS=off` turns it off.
* Known edges: ferry and coach trip ids carry the date, so they match only on the pack's own day; Church Point Ferry request stop wharves are often marked; a bus that runs the same pattern every trip is not marked unless its name says express or limited stops.

## Alerts for my trips (g22, on main, not deployed or released)
* More > Alerts for my trips, off until switched on. Pushes only when a service alert or planned work touches a trip on Home (saved trips, Home and Work, the usual commute): its line on the stretch you ride, the whole line, or the stops you board and get off at. Nothing for other lines or stops.
* When: delays, fewer services and detours from an hour before one of the trip's times (its trip reminders and morning checks) to two hours after, once a day per alert; planned work once, from 6 PM the evening before the first time it touches (a trip with no times: the evening before the work starts). Nothing between 10 PM and 6 AM unless it is inside a travel time. Several at once are one push. What already touches the trips when you switch it on is shown then, not pushed.
* Respects the notification settings: asks for permission when switched on, uses the same push as the other alerts, and turning it off deletes the trips on the server.
* Battery: nothing polls. The phone sends its trips when the switch is turned on and when the trips, their reminders or their morning checks change (one request). The matching is on the server, every 10 minutes, with no Transport for NSW call.
* Shows only when the server's remote config has `tripAlerts: true`, so builds 201 to 208 get it in an over the air update without a native change.
* Not the same as the weekend trackwork push (Thursday evening, trips with a morning check): a trip with both can hear about the same weekend work twice.

## Instant screens (27 Oct speed pass, on main, ships with tonight's update)

* Every screen paints from what the phone already has: the copy kept for that screen, or what the screen before showed. A service opened from a board or a trip shows its line, destination, delay and your stop at once; Nearby shows the last list when you are still near where it was made; car parks and bus routes open on their kept copy. Each says how old its times are until the live answer replaces it.
* A finger on a service row starts loading that service (bounded: once per 20 s per service, 8 a minute).

## Plan tab trip rows (27 Oct, on main, ships with tonight's update)

* Times in the phone's clock: "12:56 pm" on a 12 hour phone, "12:56" on a 24 hour phone (Sydney time either way).
* A time left badge on each row: "Now", "N min", then "1 hr", "2 hrs", "3 hrs" (rounded down), days for tomorrow; grey from an hour out.
* Where you get on with its platform over the leave time, where you get off over the arrive time, the lines under it.
* On time, late and early only with a live reading (a moved estimate, a placed vehicle, or within the hour); otherwise Scheduled.
* Trip detail and the Home trip cards use the same clock ("12:56 pm" or "12:56").
* The Home countdown chip an hour or more out shows the clock time with am or pm ("12:56" and "pm" small), or 24 hour digits.
* "Tight change" on a trip row and in trip detail when a change is shorter than the rule allows: 3 min on the same mode and platform, 5 min to another mode, platform or stop, or the walk plus 2 min. From leg times and modes only.
* The server uses the same rule for its own tight change warnings (transfer.risk, the warning line under a trip with your own change, the ask answers), so the app and the server never disagree and only one warning shows (on main, deploy follows).

## Old apps keep server B's answers (27 Oct, server, deployed 1:10 PM, transport-api 807c3663)

The server parts of speed pass part 2 steps C and D that a phone could meet (the train quick answer on the service screen from the engine's timetable, tags on kept station list and pack copies) go only to the newer app, which sends its ids as x-device and x-profile headers. Phones on builds 201 to 208 and every update up to the crash net get exactly what server B gave them. See docs/API.md "Old apps".

## Crash safety net (27 Oct, on main, ships with tonight's update; emergency branch hotfix-crash-27oct)

* A screen that hits an error shows Something went wrong with Try again and Go to Home instead of closing the app; after a retry, Clear saved times and reload.
* Each error is reported once to the support inbox with the screen, build, update and the last server paths asked, so the cause can be read.

## Not in the app

No accounts or login, no ads, no analytics or tracking, no Opal card balance. Crash reports are sent only to fix faults (the crash safety net, and Sentry from build 209); the privacy policy lists them. Privacy details: [STORE_PRIVACY.md](STORE_PRIVACY.md) and https://transportsydney.app/privacy/.
