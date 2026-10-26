# Features

What Transport: Sydney Live does today, where to find each thing, and what is still to come. Written for testers, support and App Review. Updated 25 Oct 2026, 7:45 PM Sydney time.

The iPhone and Android apps are one Expo app (`app/`). Anything below marked "over the air" reaches iPhone builds 201 to 206 and the Android app without a new build. Release ids are in [RELEASES.md](RELEASES.md), and what changed when is in the [Changelog](../CHANGELOG.md).

## Home

* **Next trip card** on top, the first card under the title (25 Oct, evening): the big countdown, line badges, platform (for a bus, the stand and stop number), the live label, leave and arrive times and the next two times ("Next 12 min, 19 min"). Drawn in the Line glow look: a 2 pt ring running between the trip's line colours (T4 blue into T1 orange), a glow in those colours and a lifted surface in dark, a soft shadow in light; a solid 1.5 pt line colour border with Reduce Transparency or Increase Contrast. Other cards stay flat. The countdown turns red only once the service has gone or is cancelled. It is your commute when Home and Work are set (home to work in the morning, work to home after midday), otherwise the first trip in your list. Hold a trip and choose Show first to make it the card. See [HOME-REDESIGN.md](HOME-REDESIGN.md).
* **Other trips** as slim rows with their next time; starred stops; Nearby.
* **One +** at the top right: New trip, Star a stop, Set Home, Set Work. On iPhone it opens the system action sheet from the button; the hold menus, Save this trip and the Recent rows use the same system sheet. Android keeps its bottom sheet.
* **In transit bar:** while a trip is live, one slim bar above the card ("In transit · Central to Strathfield", line badge), tap for the live trip. With no live trip and one watched trip, the same bar shows that watch.
* **Notifications** under the card: one row of small chips, closed until tapped: trip alerts with a count, Trackwork this weekend, lines with a problem ("T4 Delays"), a high priority alert, other watched trips. A tap opens the full text in place. Nothing alert related sits above the card. See [HOME-REDESIGN.md](HOME-REDESIGN.md).
* **When to leave** and **Check before I go** as small buttons in the commute card.
* **Delete** a trip by swiping, holding or with VoiceOver; Undo shows above the tab bar for 5 seconds.

## Live times

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

## Plan and trips

* Plan from any station or stop, or from where you are. Leave now, Leave at, Arrive by; Step free avoids stations with a lift out of service.
* Multi leg trips, tight and missed connection warnings, Opal fare estimates (NSW TrainLink trips show their own fare note).
* Station picker: the question is in the search field ("Where do you get on?"), with A to Z, By distance and By map.
* **Choose the mode** on the trip screen (over the air, 25 Oct): chips under the Step free and Include trips with a change switches: Any, Train, Bus, plus Metro, Light rail or Ferry when a result for that trip uses them. Several can be on (Train and Bus). Bus asks the planner for buses only, so Strathfield to Town Hall shows real bus trips with stand and stop numbers. The choice is kept per trip on the phone; the default is Any. When nothing runs: "No bus-only trips at this time. Try Any." with an Any button. Mode only trips are planned on api.transportsydney.app (called directly, like long trips, with no profile or device); if it does not answer, the phone filters the usual results and says some trips may be missing.
* **Endless trip list** (over the air, 25 Oct): no Earlier or Later buttons. Later services load by themselves as you near the end of the list, earlier ones (back to the start of the service day, gone ones as Left rows) with the Earlier services row at the top or a pull down, each with a small loading row. At most 8 later and 3 earlier batches per visit, one at a time, only while the screen is on view, and it stops at 4am (end of the service day) or when the planner has nothing new, then offers Choose a time.
* **A time in the past** on the trip screen (over the air, 25 Oct): Leave 6:15pm picked at 6:27pm lists the services from 6:15pm, and the ones already gone stay as greyed Left rows ("Left 6:21 · 3 min late" with the live time it left at, "Left 6:18 · Scheduled" with no live time). The first one you can still take opens. Arrive by in the past works the same. An Earlier services row at the top of every trip list (Now too), or a pull down, loads the services before the first one shown, gone ones as Left rows, one batch a tap, back to the start of the service day (4am). The day is fixed when the time is picked, so a time picked for today stays today's as the clock moves on. Times up to 30 min ago work on both servers; older times today are planned on api.transportsydney.app (the first server plans those for tomorrow), and if it does not answer the screen says "Earlier trips need a newer server, which did not answer just now. Pull down to try again." Plan B looks only at services you can still take.
* **Leave now chip** at the top of the trip screen (over the air, 25 Oct): opens Leave at or Arrive by with the time wheel and a day row (today to 7 days ahead; iOS sheet on iPhone, Material dialog on Android, built in JS so builds 201 to 206 have it). Now is one tap back. Another day is planned on api.transportsydney.app (`date=`).

## Follow a trip

* **Start trip:** live map, next stop, stops left, arrival time, alerts before your stop and at each change. On iPhone the trip shows as a Live Activity on the Lock Screen and in the Dynamic Island, updated by push while the phone is locked (build 205 and later).
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
* Home, the stop screen, the full screen board, Platform view, the trip list, Simple mode and the service screen show the last answer kept on the phone at once, with "Updated 4 min ago, refreshing" until the live answer replaces it. Kept times are never shown as live, and services already gone are left out.
* With no signal the same screens show the kept times with "Offline, showing times from 8:05am" (a banner over the trips on the trip list) instead of an error, and try again with a growing gap while the screen is on view.
* Data for one stop, service, time or trip never shows under another one: an answer still on its way when you switch is dropped.

## Timetable on the phone (server 26 Oct, 12:20 PM, transport-api 2ef1ad9f; over the air 26 Oct, 12:54 PM, group 54aa4d52)
* Stops you use (starred, on saved trips, home and work, opened lately; 24 at most) keep their timetable for today and tomorrow on the phone, from api.transportsydney.app's `/api/pack`. Fetched once a day, at start or when the app comes back to the front, one stop at a time; 0.7 to 14 KB each.
* The stop screen, Home's starred stop cards and the full screen board show those departures in the first frame, with no signal too, marked "Timetable times, getting live times" (or "Live times unavailable, showing timetable times"), each row in grey as Timetable. The live board replaces them when it lands. A copy of the live board from the last 10 minutes still goes first.
* Checked: every timetable row at 20 stops NSW wide was on the Trip Planner's board at the same minute (370 of 370). Details: [TIMETABLE_PACKS.md](TIMETABLE_PACKS.md).

## Platform view (over the air, 25 Oct, about 11:17 PM; station board look 25 Oct, about 11:57 PM)

**Hidden since 26 Oct, about 8:30 AM** (Bidur at 7:57 AM: not to be used until it is reliable). The switch is `PLATFORM_VIEW` in `app/src/lib/features.ts`, off: no platform button on the stop screen, no Platform view in the hold menu, `openPlatform()` does nothing and a link straight to `/platform` goes to Home. The code below stays; turning it back on is that one line and an over the air update, after the stop list check reaches 95% or more and Bidur says so.

One train or metro at a station, full screen and readable from a distance, laid out like the departure screens on station platforms (Bidur's photo of the real screen, approved mock 25 Oct 11:31 PM; our own build with system fonts and no logos). Open it with the platform button at the top of a train or metro station's screen, or hold a train or metro departure and choose **Platform view** (the row's tap still opens the service). Above the board: close, the station name, and **Speak**. The board:
* A white board (dark in dark mode) with an orange bar: Next train (or Next metro) and Time now.
* The line badge and the destination in large type, with "via ..." under it and a plane mark when it runs via the airport stations.
* The stops after this station in large bold type down the left, in their own scrolling list with a soft fade at the bottom when it is longer than the space. Everything else stays still. Skipped stops are left out and listed under Not stopping at. Stops sent with no name (Domestic and International Airport) are named from the station list the server publishes, by place. When the list is empty or does not include this station (for example a train still shown at a station it will not start from during a closure), the board shows the destination and "Full stop list not available yet"; a cancelled service says so.
* On the right: Platform with the number large in orange and a grey "N cars" pill, only when the live feed reports carriages (Platform not given yet without one), then Departs with the minutes large in orange and Live or Timetable with the clock time; a stale live time shows Not tracking and the timetable time, the same rule as every other countdown.
* A grey Limited Stops or All stops pill only when the service's own description says so.
* A Next service, Platform, Departs table with the next two train or metro services at the station, any platform.
* **Speak** reads the line, destination, platform, carriages, time and stops, with the one time Get a better voice offer.
Works at every train and metro station; nothing is written in for a station. From 720 pt wide (an open iPhone Duo, a fold, a tablet), by width alone, two columns: destination and stops on the left, departs, platform and next services on the right. Dynamic Type (with very large text or a short window the whole board scrolls instead of only the stop list), dark mode, Reduce Motion (no transition), VoiceOver and TalkBack ("Platform 23, 8 cars, departs in 4 minutes, stops at ...").


Fixes after Bidur's phone at 11:59 PM and 12:00 AM (over the air, 26 Oct):
* A train that has gone never shows, as the next train or in the Next service rows. A live train counts until a minute after its live time; a train with no live time, or one whose live time has gone stale (Not tracking), counts until its timetable minute has passed. Rows are ordered by the time they show. The rule is `stillToCome` in `platformCore.ts`, with the same live label the departure rows use.
* A stop list is shown only under the service it was asked for and only when it includes this station. When the next train takes over, an answer still arriving for the one before is dropped and the new list is asked for at once (`serviceKey`, `serviceFits`). Otherwise the board says "Full stop list not available yet". The list is asked of api.transportsydney.app first, the same server as the board (it retries a busy trip planner), with the server in use as the fallback.
* Times stay on one line: Departs, Not tracking, the timetable time and the Next service times are sized to fit their column at every text size (`fitSize`), and shrink further on a phone if needed.
* Departs sits right under the platform and cars. The board is as tall as what it shows, so a short stop list leaves no gap; a long one still scrolls in its own area.

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

## Coming in build 208 (not built yet)

* Calendar leave by: the calendar read access it needs (full access text on iPhone, READ_CALENDAR on Android) is on branch `native-207` for build 208; the JavaScript is already in the over the air update and stays hidden until then ([CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md)).

## The new server (over the air, 26 Oct)

The app reads from api.transportsydney.app. A read it cannot get there (no answer, or a 5xx) is asked of the first server once, and reads stay there for a minute; saves always go to the new server. The first launch on this update carries the phone's saved trips, push token and morning checks over. These now show for everyone on the update ([API.md](API.md), [REVIEW-NOTES.md](REVIEW-NOTES.md)):

* "Usually 3 min late on weekday mornings" on stop boards (with a route chosen), the service screen and trip legs. Real answers need a few weeks of live times on the new server.
* Weekend trackwork card, Status of my lines, Plan B in the morning check, reliability lines, last way home reminder, Park and Ride "usually full by", live traffic on bus legs, carriage occupancy, and live times for NSW TrainLink, regional coach and Manly Fast Ferry services.

Fresh times: boards refresh every 15 s while the next service is 10 minutes away or less and 15 s after opening; trip lists, Simple mode and Home trip cards every 15 s while the first service leaves within 10 minutes. "Live, updated" shows when the times were read on the server ([PERFORMANCE.md](PERFORMANCE.md)).

Many phones (server, 26 Oct, 10:44 AM): phones at the same stop share one copy and one Transport for NSW call; a burst for one stop waits for that one answer; a slow answer is waited for at most 700 ms when a copy exists; when Transport for NSW is busy or refuses us, phones get the last copy (its "Updated" time says how old) instead of an error. Load tested at 100 and 1,000 phones ([SCALING.md](SCALING.md)).

## Board engine (server, behind a flag, 26 Oct)

Every stop board in NSW built ahead of time on the server from the network feeds, so a board is a cache hit and Transport for NSW calls stay flat whatever the number of phones. Since 26 Oct (g14) boards are built by 16 shard objects that write them to Cloudflare's cache, and the worker reads the cache first. Off for phones until it matches the Trip Planner on 95% of services on a fresh sample, with no object restarts and 0 errors at 1,000 phones. docs/ENGINE.md, docs/SCALING.md.

**Timetable times when live data is down** (server, 26 Oct, 1:58 PM): when the Trip Planner refuses or fails and no copy of a stop's board is kept, the stop board shows the engine's timetable times instead of an error, every row marked Scheduled, with the alert "Live times unavailable, showing timetable times" on top. The next live answer replaces it. No app update needed.


## When Transport for NSW is down (26 Oct, g16)

* Trip cards, the trip screen and Ask show timetable trips (direct, or one change) labelled "Timetable times. Live
  trips are unavailable right now." instead of an error, and never "No more services today" unless a live answer
  truly had none. Nearby comes from our own stop list and works with no Trip Planner at all.
* Messages say where the fault is: "check your signal" only when the phone has no connection; otherwise Transport for
  NSW's live data is unavailable or slow. No status codes anywhere.
* A server error or slow answer shows the times kept on the phone (or the timetable pack) instead of an error,
  labelled "Live times unavailable, showing times from ..." (header tag "No live times"), not "Offline".
* Trip searches wait 10 s at most and are not asked again for 45 s after a refusal; boards wait 8 s when a kept copy
  is on screen, 15 s with nothing. The old server is asked only when the new one cannot be reached at all.
* The server keeps the last live answer of each trip for 15 minutes and gives it at once on a first open, with its age.

## Not in the app

No accounts or login, no ads, no analytics or tracking, no Opal card balance. Privacy details: [STORE_PRIVACY.md](STORE_PRIVACY.md) and https://transportsydney.app/privacy/.
