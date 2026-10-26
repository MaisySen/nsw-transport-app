# Changelog

What changed in Transport, newest first. Times are Sydney time. Build numbers, update ids and links are in [docs/RELEASES.md](docs/RELEASES.md).

## 26 Oct 2026

### Speed: search as you type and saved boards (server 26 Oct, 11:38 and 11:47 AM, transport-api 670c8952 then 863d521d; over the air 26 Oct, 11:58 AM, group f9c48f4c, roll back to fd6a8763)
Bidur at 11:20 AM: "app still slow as hell right now. Keep loading in every search".
* Search shows stops as you type, from lists kept on the phone: every train, metro, light rail, ferry, bus and coach stop in NSW. 19 to 41 ms to results on screen in the web build, no spinner; before, every search waited for the server (453 ms median for a first search from the US build box, up to 1.4 s) plus a 220 ms pause. The server is still asked after 280 ms and adds addresses, places and anything not in the lists; a newer keystroke cancels it.
* The server answers stop search from its own index (no Trip Planner call when the answer is clear) and keeps search copies 6 hours: a first search 239 ms median from the US box, was 453 ms.
* A stop's first open gets the server's saved board at once with its real age, then fresh times about 2 s later: 207 ms median (469 ms at the 90th percentile) from the US box for a stop opened in the last 15 minutes or one of 50 busy interchanges, was 1,255 ms (1,547 ms). Live times are still 15 s at most once fresh.
* The server keeps the 50 busiest interchanges and every stop opened in the last 30 minutes saved: at most 8 Transport for NSW calls a minute, none at night, none when busy, none past 40,000 a day.
* A finger on a stop result or recent stop starts its board. Smart Placement is on (Cloudflare was still deciding at 11:50 AM, so not yet in the numbers).

### Many phones: shared fetching and the load test (server 26 Oct, 10:11 to 10:44 AM, transport-api 2592d738)
* Phones looking at the same stop, trip or service share one copy and one Transport for NSW call, and a burst for one stop waits for that one answer instead of asking again. No copy holds anything about a person.
* With a copy in hand a phone waits at most 700 ms for a new answer; a slow answer finishes in the background for the next poll. The "Updated" time says how old the copy is.
* When Transport for NSW is busy or refuses us (our key allows 5 calls a second and 60,000 a day), phones get the last copy instead of an error, and refused calls are asked again for about 5 s.
* Load test from the US west coast: 100 phones p95 783 ms, 0 errors. 1,000 phones (63 requests a second) p95 678 ms, 18 errors of 11,375 in the first 15 s of a surge onto an empty cache, all from Transport for NSW's limit; 0 errors after the ramp. Server CPU about 1 ms a request. The plan for 10,000 and 100,000 phones is in [docs/SCALING.md](docs/SCALING.md).

### Item 3: fares Did you mean, Simple mode statuses, alert text, airport names, more stop lists (server 26 Oct, 10:05 AM, transport-api 6ad9d3a5; over the air 10:12 AM, group fd6a8763)
* Fares, Did you mean: a fare question in Ask (typed or dictated) checks each station name against our own station and suburb lists, which the phone keeps, so it works offline. A clear slip is used ("Strathfeild", "Parramtta"). A name that matches several places gets up to 5 real stops, best first, each with its modes ("Kings Cross, Train", "Kingsford, Light rail"), one tap each. A suburb with no station offers its nearest stations and the suburb itself. Nothing is guessed between close names and nothing is made up. 49 messy names from all over NSW checked, all as expected.
* Simple mode (Bidur's 8:50 AM screenshot, Strathfield to Five Dock Shops): the 27 and 22 min late were real (T1 and T2 delays from overhead wiring repairs at Homebush). A big delay now also says the timetable time ("27 min late, was due 10:04am"), and the arrive time counts a live delay once. The D400 is a Bridj on demand bus you book ahead; it showed as Timetable and now shows "On demand, book ahead", once per list. A trip with a change that gets there no sooner than a direct one leaving within 20 minutes goes under it; it is still shown.
* Alerts: no web code in any alert (tags, encoded tags, cut off tags, entities), on the server and again on the phone, also for copies kept offline.
* Airport stations: Domestic and International no longer show blank stop names (their platforms have only ", Platform 2" as a short name).
* Train stop lists: City Circle runs go round the loop to Central (or end at Circular Quay where the run itself ends there), a train that skips a stop shows it as Not stopping, and a slower run the trip planner leaves out for a faster one is found. At 8 busy stations, 54 of 64 lists were whole on the old server and 61 of 64 on the new code in the same minutes.
* The station lists phones keep for Ask were not served by api.transportsydney.app (404 since the move), so a phone setting up Ask after the move had no place lists. They are served again.
* Platform view stays hidden.

### Train stop lists and regional badges (server 26 Oct, 8:34 AM, transport-api 12a75142; over the air 8:48 AM, group 3edfe9f1)
* A train's stop list on the service screen runs from your stop to the real end of the line with every stop it makes. Before, through trains to Hornsby, Berowra and North Sydney stopped at Central (the feed gave Central's id as their destination), some trains had no list (the trip planner offered another train or a change instead), and Sydney Trains' feed left out stops it had no news for. At 8 busy stations, 39 of 63 lists were whole at 8:07 AM and 59 of 63 at 8:36 AM.
* The two T1 trains to Hornsby that leave Blacktown in the same minute (platforms 1 and 5) are both real, and each now only ever shows its own stops.
* Regional trains and coaches that come with only a route number show Regional or Coach on their row ("427" was the Dubbo train). Route chips keep the number.
* Platform view stays hidden.

### Battery and data, buses at big stations (over the air, 26 Oct, about 8:22 AM, group fbf3cff7)
Item 2 of the plan Bidur approved at 12:04 AM, and the 415 to Chiswick missing from Strathfield Station at 7:47 AM.
* The 415 was not dropped: a board answer is 40 services, and at Strathfield at that hour 40 covers about 15 minutes (7:51 to 8:07). The next 415 to Chiswick was 8:10 from the same Stand G. Tapping Buses (or Trains, Metro) or a route at a station with several modes now loads 40 services of that mode, so buses at Strathfield reach about 50 minutes ahead and the 415 shows its Chiswick and Campsie trips. All is unchanged.
* Battery: with no push token and nothing watched, the alerts check runs once a minute instead of every 20 seconds, on every screen. Starting a watch puts it back to every 20 seconds at once.
* A fresh install used to make two to four device ids in its first second; it now makes one.
* Server (transport-api 89566d44): `mode` on `/api/departures` asks the trip planner for that mode only. Rollback 98fd6119.

### Platform view hidden (over the air, 26 Oct, about 8:18 AM, group 9a46269a)
Bidur at 7:57 AM: not to be used until it is reliable.
* The platform button at the top of a train station and Platform view in the hold menu of train and metro rows are gone. The stop screen, the full screen board, the service screen and the trip list are unchanged.
* The screen stays in the code behind one switch (`PLATFORM_VIEW` in `app/src/lib/features.ts`, off). A link straight to it opens Home.

### Speed and offline (over the air, 26 Oct, about 1:26 AM, group 2ed17e31)
Item 1 of the plan Bidur approved at 12:04 AM.
* Times for one stop, train, time or trip never show under another one. Every screen that loads live data now drops an answer that arrives for what it showed a moment before, and asks for the new one at once (the same kind of race put a wrong stop list on Platform view on 25 Oct). The trip list's extra services and Plan B, Simple mode's Earlier and Later, the walk stop search, the next way on after a missed change and the live trip follow the same rule.
* Kept times say how old they are: "Updated 4 min ago, refreshing" until the live answer lands, on Home, stops, the board, Platform view, trips, Simple mode and the service screen. They are never shown as live.
* No signal: the same screens show the kept times with "Offline, showing times from 8:05am" (a banner on the trip list, a note on Home's trip card) and keep trying with a growing gap. The service screen now keeps its own copy.
* Startup: the first screen asks for its times before the app refreshes its settings and alerts.
* Production group 2ed17e31-5480-48ac-9237-a86b78cd691f from main c9c0401 (preview f83a3b7c); roll back with `npx eas-cli update:republish --group 211c1057-dea1-47ff-a61b-355b962684da --destination-branch production --non-interactive`. No server change. Not yet seen on a device.

### Platform view fixes (over the air, 26 Oct, about 12:37 AM, group 211c1057)
Bidur's iPhone at 11:59 PM and 12:00 AM showed gone trains, a wrong stop list and cut off times.
* A train that has gone never shows, as the next train or in Next service. Live trains count until a minute after their live time; untracked or not tracking ones until their timetable minute has passed.
* A stop list shows only under the train it belongs to. A list still arriving for the train shown a moment before was landing under the next one (a CCN to Newcastle showed a T9's Burwood, Redfern); now each list is kept with its own service. The list comes from the same server as the board.
* Times stay on one line at every text size (11:54pm, Not tracking, the Next service times), and the station name above the board is never cut off.
* Departs sits right under the platform and cars, with no gap under a short stop list.
* Checked live at 12 stations, two phone sizes, light and dark, and a wide window before it went out.

## 25 Oct 2026

### Platform view looks like the station platform screen (over the air, 25 Oct, about 11:57 PM, group f8c00900)
Bidur sent a photo of the real platform screen and approved the mock at 11:31 PM ("Yes").
* A white board (dark in dark mode) with an orange Next train bar and the time now, the line and destination in large type with "via" under it.
* The stops it calls at in large bold type, in their own scrolling list; the platform, carriages, departure time and next services stay still.
* Platform large in orange with a grey "8 cars" pill (only when the live feed reports carriages), Departs in orange, Limited Stops only when the service says so, and a Next service, Platform, Departs table with the next two trains.
* When a stop list is empty or does not include the station (as during this weekend's closure between Strathfield and Central), the board shows the destination and "Full stop list not available yet"; a cancelled service says so. Skipped stops are listed under Not stopping at.
* Two columns on wide windows (720 pt and up). Large text, VoiceOver, TalkBack, Reduce Motion and Speak kept. Entry points unchanged.
* Server: empty stop lists were our bug. When several stop list requests arrived in the same second the data service answered "rate limit" and the server sent an empty list. It now retries, shares one request between people asking about the same train, keeps lists for a minute, and says why when there is none (`stopsStatus`). Worker transport-api 98fd6119; roll back with `npx wrangler@4 rollback 0c748a01-d066-4de2-881d-07283cc761c3`.
* Production group f8c00900-e5f7-4cec-8a4a-05b452fc33bd from main 5df871e (preview 4e3b6e31); roll back with `npx eas-cli update:republish --group 6789f5bf-efa9-44a3-81b8-ccba08e8ecd4 --destination-branch production --non-interactive`. Not yet seen on a device.

### Platform view, and the app on wide screens (over the air, 25 Oct, about 11:17 PM, group 6789f5bf)
Bidur approved the mock at 10:50 PM.
* Platform view: tap the new platform button at the top of a train or metro station, or hold a train departure and choose Platform view. One train, full screen: line and destination, the platform, how many carriages when the live feed reports them, minutes until it leaves (or Not tracking with the timetable time), the stops it calls at after this station, and the next two services. Stops it runs through are listed as Not stopping at. Speak reads it all out.
* The Domestic and International Airport stops, which come with no name in the stop list, are named from the station list.
* Large text, dark mode, Reduce Motion, VoiceOver and TalkBack ("Platform 23, 8 cars, departs in 4 minutes, stops at ..."). On a wide window it uses two columns.
* Nothing else moved: tapping a departure still opens the service.
* Wide screens (an open iPhone Duo, a fold, a tablet): screens now turn and resize; a phone stays upright as before. The Ask field and the undo bar keep clear of a side tab bar, and Simple mode keeps clear of the side edges. Simple mode's heading stays Plan Your Trip.
* Production group 6789f5bf-efa9-44a3-81b8-ccba08e8ecd4 from main 2f97e1f (preview 1a25656b); roll back to group 62b97fcd (10:45 PM). No server change. Not yet seen on a device, an iPhone Duo or a fold.

### Ask understands far more (over the air, 25 Oct, about 10:45 PM, group 62b97fcd)
Bidur: "We need to work to make ask screen and tab more smarter. Really smart", then "cant do it with only this suburb".
* Type it any way: typos and short forms ("strathfeild to kings x", "katomba", "cq", "parra", "stn") are matched against every station, wharf, light rail stop and NSW suburb. Landmarks and streets go to the place search as typed.
* Plain time words: "after 6", "around 8:30", "by 9am", "in 20 min", "tonight", "tomorrow morning", "this weekend", "leave at 8 arrive by 9". Another day is planned for that day.
* "Home" and "work" are your saved places. Follow ups work: "and the one after", "earlier", "what about by bus", "from there", "the way back", "what about tomorrow".
* Delays on a line, trackwork, car parks, lifts, fares (the Opal estimate from the trip answer), "when does my bus come", stops near you.
* Not sure what you meant? One short question with 2 or 3 choices to tap, never a dead end. Every time and number comes from live data; still no AI and no paid service.
* Each answer shows what was understood, one card, and Open trip, Open board, Directions or Speak under it, with Earlier and Later. Chips under the box come from your own trips.
* Measured on 309 questions from all over Sydney and NSW: 62% understood before, 100% now. Production group 62b97fcd-4bef-48f3-b292-cf9fe1f44deb from main cc1939c (preview b3cc0cbc); roll back to group d5346636 (10:25 PM). Not yet seen on a device.

### Live bus status (over the air, 25 Oct, about 10:25 PM, group d5346636)
Bidur: "live bus traffic on 410/D400", then "cant do it with only this suburb".
* Every bus with live data, anywhere in NSW: bus rows say how late or early the bus is and where it is ("4 min late", "3 stops away", "At the stop"). With no live data a row says "Timetable only" and nothing more.
* The departures board shows a bus's delay beside its stand and where it is on the line under it.
* Tap a bus: its trip screen draws the bus on the line of stops, at the stop it is at or just before the next one.
* "Running slow in traffic" shows only when the live times say the bus is losing time on the road ahead: the predicted delay grows by 3 minutes or more over the stops ahead and the bus ends that stretch at least 3 minutes late. It works the same for any route. Bus legs of a trip get the same line.
* Simple mode: the first Speak on a phone with only its basic voice offers Get a better voice, once ever. Its heading stays Plan Your Trip.
* Server: transport-api 0c748a01 sends the delays ahead with live bus rows (`ahead`); roll back to 60316eaa. App: preview group 272f2bda, production group d5346636-3945-4785-bc31-3b2a10794007 from main 703a204; roll back to group 30e7648e (10:05 PM). Not yet seen on a device.

### Get a better voice (over the air, 25 Oct, about 10:05 PM, group 30e7648e)
Bidur: "Can we set the direct button to that audio setting in phone from our app??"
* More > Voice has a Get a better voice row. On iPhone it shows three short steps to download a Premium or Enhanced voice (Settings, Accessibility, Read & Speak, Voices, English) and an Open Settings button. Apple has no public link to the voice list, so the button opens the app's page in Settings; no private settings link is used.
* On Android the row opens the phone's text to speech settings directly, and Download voice data opens the speech engine's voice downloads.
* Come back to the app after downloading and it says Better voice found and plays a sample from the live board. Every spoken line uses the new voice from then on.
* The first time you tap Speak departures on a phone with only its basic voice, the app offers this once. Not now means never again.
* Roll back to group b4fd3a9a (10:00 PM). Not yet seen on a device.

### Simple mode: Plan Your Trip (over the air, 25 Oct, about 10:00 PM, group b4fd3a9a)
Bidur at 9:37 PM: "User come. Look this to that place. They get the list like this. Thats it." And at 9:50 PM: "Just write Plan Your Trip".
* Simple mode (More > Simple mode, off by default) is now one plain screen headed Plan Your Trip. From is your current location when location is already on; To is where you pick. Your places (Home, Work, recent places, starred stops) are big rows: one tap fills To and finds trips.
* The trips come as a plain list: leave and arrive times, how long, changes, lines, on time or late or cancelled, and the minutes to go, with Earlier and Later. Tap one for big simple steps (walk to the platform, take the line, change, get off) and a Speak button that reads them.
* No swiping, no chips, no maps. Leave now or pick a time. The gear turns Simple mode off.
* Preview group f953ea90-9367-442d-8644-7668aa4c790f, production group b4fd3a9a-96aa-49d3-9e8c-68572201802d (iOS 01a172b7-861f-7620-9ec1-e2d322be6806, Android 01a172b7-861f-7658-ac00-c103ce730b92) from main 607323c. Roll back: `npx eas-cli update:republish --group a3a6ee75-552f-414b-b126-b2714bb106b5 --destination-branch production --non-interactive` (the 9:55 PM update).
* Tests: `app/test/simple.test.mjs`. Not yet seen on a real iPhone or Android phone.

### Car parks and holding a departure (over the air, 25 Oct, about 9:55 PM, group a3a6ee75)
Bidur: "Do everything. Keep building."
* Car parks: a train station with a Park and Ride car park shows "Car park: N free of M" under its name, with when Transport for NSW read them. Tap for the car park: free spaces, how full, the address and Directions (Apple Maps on iPhone, Google Maps on Android). More > Car parks lists them all, closest first when location is already on, else A to Z. Only real counts: a car park without one says so, and a station without one shows nothing.
* Holding a departure on a stop screen, the full board or a Home stop card now opens the iPhone menu under the row (Watch or Stop watching, Show stops), the Material 3 menu on Android. It used to start watching at once.
* Simple mode is unchanged in this update. Roll back to group c39b687d (9:31 PM). Not yet seen on a device.

### Simple mode, a better voice and a lighter app (over the air, 25 Oct, about 9:31 PM, group c39b687d)
Bidur at 8:57 PM: "A simple mode in setting... It just show what bus in this stand. What time. Same with train or anything. Like tripviewlite." And about the trip voice: it sounded robotic.
* Simple mode: More > Simple mode (off by default) opens the app on one screen. Here shows the stop, stand or platform nearest you, with chips to switch (Stand D, Platform 4); with location off, your starred stops and Home and Work. Swipe for To work, To home and the trips saved on this phone: depart and arrive, duration, changes and platform. Each row has the line, destination, scheduled time, on time or late or cancelled, and the minutes to go. Tap for the service or trip, pull to refresh, the gear turns it off. It opens on To work in the morning and To home in the evening. Only the page on view refreshes.
* Voice: every spoken line now uses the best voice already on the phone (Premium, then Enhanced, then the default; Australian English first; novelty voices left out) at the phone's natural pace. Nothing to download. More > Voice lists the English voices, with Play sample read from your stop's live times, and a download tip only when the phone has compact voices alone. Guidance reads like an announcement: "Your train to Redfern leaves in 3 minutes, from platform 1."
* Speak departures: a speaker button on the Home commute card, the stop screen and the full screen board reads the next services aloud.
* Lighter: departures refresh every 15 s only when the next service is within 5 minutes (30 s to 15 minutes, then once a minute), countdowns redraw once a minute, Home's lists read once a minute, a fresh start shows the last times at once ("Updating, from 8:51pm"), maps load just after the screen. On the web export, Home idle for 90 s made 7 requests instead of 27, and a second open showed the commute card in 211 ms instead of 2123 ms.
* Comfort: with Reduce Motion on the live dot no longer pulses; one light tap when it's time to leave and on arrival; VoiceOver reads countdowns in Ask as minutes.
* Preview group 8ab3786f-1490-4d94-9137-876414d67d9c, production group c39b687d-f788-4a94-976f-65ebed518bfd (iOS 01a1729d-1b5a-7c84-aaa2-1da7c254c091, Android 01a1729d-1b5a-7cc0-a421-a30f0b143b64) from main beb9c01. Roll back: `npx eas-cli update:republish --group 42b8a9e7-f136-45db-8d51-65ba0baeb4a7 --destination-branch production --non-interactive` (the 9:20 PM update).
* Tests: `app/test/voice.test.mjs`, `app/test/perf.test.mjs`, `app/test/simple.test.mjs`. Not yet seen on a real iPhone or Android phone. Native items left for build 209: [docs/IOS27.md](docs/IOS27.md#build-209-1-nov).

### Native menus on iPhone, Material 3 menus on Android (over the air, 25 Oct, about 9:20 PM, group 42b8a9e7)
Bidur at 8:42 PM about the centred action sheet: "vibe coded and bad". The + was fixed at 8:56 PM; this does the same for every other menu.
* Hold a trip on Home (Home and Work, your commute, a saved trip, one of your trips, a recent one): on iPhone the trip lifts and the system context menu opens under it (Edit trip, Show first, Delete trip in red; Change home, Change work, Remove both in red; and so on), with SF Symbols and no Cancel row. On Android a Material 3 menu opens under the trip.
* Hold a starred stop's name on Home, or a Recent trip or stop in Search: the same context menu (Unstar stop, Remove from Recent in red).
* Save this trip: the star on the trip screen is a system bar button with its own menu on iPhone (Save trip, Save as Home, Save as Work). Before, the Home and Work menu was only reached on trips with legs, which save straight away, so it never showed. Android: a Material 3 menu under the star.
* Settings: Opal fare type (a tick beside the current one), Privacy and data and a commute row now drop the system pull-down menu from the row on iPhone, with the note as the menu's title. Android: a Material 3 menu under the row.
* VoiceOver and TalkBack: every menu row is also an action on the row (swipe up or down), so nobody needs a long press.
* The time picker and the reminder editor stay sheets, now with the system grabber and larger corners; a drag down on the grabber or the title bar closes them.
* Confirmations (Delete trip?, Clear All, Delete all my data) stay native alerts.
* Every native view is looked up first: expo-router `Link.Menu` and `Stack.Toolbar.Menu`, @expo/ui SwiftUI `Menu`, all compiled into builds 201 to 208. A build without them keeps the old menus. How it works: [docs/IOS27.md](docs/IOS27.md#native-menus-update-25-oct-920-pm).
* Preview group ca9faf00-97c4-483c-8d31-7bf2dd0e5b2e, production group 42b8a9e7-f136-45db-8d51-65ba0baeb4a7 (iOS 01a17293-9ea4-7727-9fed-9f8d5320cd96, Android 01a17293-9ea4-7624-bbfa-cac1d3d40ebd) from main 66ec078. Roll back: `npx eas-cli update:republish --group 8a2d8055-1c15-437e-ac01-c8f3d8711f2d --destination-branch production --non-interactive` (the 9:00 PM update).
* Tests: `app/test/nativemenus.test.mjs`. Not yet seen on a real iPhone or Android phone.

### Website SEO and polish (transportsydney.app, 25 Oct, about 9:00 PM, Pages deployment 6a797b2c)
Bidur at 8:51 PM: "Favicon, Hero icon, Page description, Seo. All those 20 checklist all checked??"
* The page looks the same. Links inside running text (the footer publisher line, the email and Privacy Policy links in Support, Privacy and Terms) are now underlined, so they do not rely on colour alone. These styles are in the new file `site/extra-1.css`. `site.css` and `home.css` are unchanged, so a rollback still looks right.
* `site/site.webmanifest` is new: name, short name "Sydney Live", icons 192 and 512, theme and background colour, display standalone. Every page links it. The CSP now has `manifest-src 'self'`, so the browser can load it, and `connect-src 'self'`.
* Home page: the hero icon has alt text ("Transport: Sydney Live app icon"). JSON-LD now describes the app as a SoftwareApplication (iOS and Android, TravelApplication, free in AUD, published by Fintex) and Fintex Australia Pty Ltd as an Organization (https://fintex.au, with its own logo). There are no ratings or reviews. The h1 reads "Transport: Sydney Live" to screen readers.
* The sitemap entries now have `lastmod`. `/beta` stays out of the sitemap because it is a redirect.
* Support, Privacy, Terms, the 404 and the Open in the app page have a `twitter:card`. Every indexed page already had its own title, description, canonical, og:title, og:description and og:url, and a test now checks them.
* The zone was adding two scripts to every page: Cloudflare's analytics beacon and its email link rewriter. The CSP blocked both, but they showed as console errors, and an analytics beacon does not belong on a site that says "no tracking". The HTML pages are now served `Cache-Control: public, max-age=0, must-revalidate, no-transform`, so the zone leaves them alone. Side effect: the HTML (5 to 12 KB a page) is served uncompressed. Pages that do not exist still get the beacon (it stays blocked by the CSP) until Web Analytics is turned off for the zone in the dashboard.
* Lighthouse, mobile, on the live site (Performance, Accessibility, Best Practices, SEO): home 99, 95, 93, 92 before and 100, 100, 100, 100 after. Support 100, 96, 93, 92 before and 100, 100, 100, 100 after. Privacy and Terms are also 100 in all four. Two things were behind the drops: the footer link was not underlined, and the CSP blocked Lighthouse from reading robots.txt.
* Checked after deploy: home, support, privacy and terms return 200. `/site.webmanifest` returns 200 as `application/manifest+json`. The JSON-LD parses and has the required fields. `/trip/<id>` returns 302 to the live trip page, `/beta` returns 302, and a random path returns 404 with a link home. www and http both redirect with a 301 to https://transportsydney.app.
* Roll back to 564bc47c (the 8:50 PM simple home page): Cloudflare dashboard, Workers and Pages, `transportsydney`, Deployments, 564bc47c, Rollback; or `curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/564bc47c-7128-4534-83e1-b4fdce138fd4/rollback"`.

### The + on Home opens Apple's menu from the button (over the air update for iPhone and Android, 25 Oct, 8:56 PM, group ffda4f33)
Bidur at 8:42 PM, with a screenshot of 8:34 PM's + menu still in the middle of the screen: "Also this??".
* Why the 8:34 PM fix did not work: React Native's `ActionSheetIOS` uses its `anchor` only on iPad (`RCTActionSheetManager` sets the popover source view under `UIUserInterfaceIdiomPad`), so on iPhone it is always the action sheet, which iOS 26 draws as the floating panel with capsule buttons and Cancel.
* iPhone: the + is now a system bar button in the navigation bar with its own menu (UIMenu), made by expo-router's `Stack.Toolbar` (react-native-screens header items). Tapping it drops the menu from the button with SF Symbols (New trip, Star a stop, Change Home, Change Work) and no Cancel row; on iOS 26 and 27 it is the Liquid Glass menu. The live time sits beside it. The native part is react-native-screens 4.30.0, the same in the lockfiles of builds 201, 205, 206, 207 and 208, so no new build is needed.
* Android: a Material 3 menu drops from the + in the top app bar (4 dp corners, 48 dp rows, leading icons); the web preview draws the iPhone menu's shape under the + (blurred, 13 pt corners, icons on the right, separators, solid with Reduce Transparency). A tap outside closes it; the chosen item runs once it has gone.
* VoiceOver: the + is "Add"; each item is a button. The trip and stop hold menus and Save this trip still use the system action sheet.
* Screens (web stand in, light and dark): files/plus-menu-25oct/. Not yet seen on a real iPhone or Android phone.
* Roll back: `npx eas-cli update:republish --group c9a4913d-b324-434c-9cb7-f4f17c1f53f5 --destination-branch production --message "Roll back" --non-interactive`.

### Website home page is simple again (transportsydney.app, 25 Oct, about 8:50 PM, Pages deployment 564bc47c)
Bidur at 8:41 PM: "website is over explaining. Make it simple and little nice marketing style. Nothing else. But focus should be on our previous kind of site before this last push".
* The home page is back in the style it had before the 5:10 PM feature list (Pages deployment cff75587, commit 3afc3c3): app icon, name and one line, then the buttons, now as a TestFlight button (Join the iPhone beta, TEMP until the App Store listing) and Google Play coming soon, and "Free. No account, no ads, no tracking."
* One real Home screen from the app (the Line glow commute card, captured from the web build with live data; a light and a dark copy picked by the system setting) and five one line highlights: your commute first, widgets and Lock Screen, Apple Watch, alerts that stay out of the way, every mode. On desktop the screen and the highlights sit side by side.
* Removed from the home page: the four screens, the What it does list and Coming in the next iPhone build (and their images in `site/img/`), and `site/beta.css`. Footer: Privacy, Support, Terms, the publisher line and the Transport for NSW credit.
* Privacy (with the Calendar and data deletion sections), Support and Terms are unchanged. The app links only to `/`, `/support/` (and `#delete`), `/privacy/`, `/trip/` and `/plan`, so no help or features page was needed.
* Home page styles are in `site/home.css`, not `site/site.css`: the zone keeps `site.css` at the edge for up to 4 hours and the API token cannot purge the cache, so the first deploy of this change (d00d65ab) showed the new page with the old stylesheet for about a minute. `site.css` is back to its previous bytes. Change a stylesheet by giving it a new file name.
* Checked after deploy: home, privacy, support, terms, the images, `/.well-known/apple-app-site-association`, `/open/`, `/stop/...` and `/plan` answer 200, `/beta` and `/trip/<id>` answer 302 (the trip to `https://api.transportsydney.app/live/?t=<id>`), a random path 404. Screens at 390 x 844 and 1440 x 900, light and dark: files/site-simple-25oct/after/ (before: files/site-simple-25oct/before/).
* Roll back to the previous site (602309ac, the 6:41 PM deployment with the feature list): Cloudflare dashboard, Workers and Pages, `transportsydney`, Deployments, 602309ac, Rollback; or `curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/transportsydney/deployments/602309ac-953b-4334-b168-ff66bd27f161/rollback"`.

### Earlier departures on stop boards (server 8:45 PM, version 60316eaa; over the air update for iPhone and Android, 25 Oct, 9:00 PM, group 8a2d8055)
Bidur at 7:13 PM: "Should be able to see all previus ir earlier ones as well". The trip screen got this at 7:42 PM; the departures board for a station or stop could not, because its server call always asked for now.
* Server (api.transportsydney.app only): `/api/departures` takes `time` (HHMM) and `date`, the board from any moment in the service day back to 4am, services that already left kept with `departed: true` and the live delay they left with, and `at` echoed so the app can tell the server honoured it. No time is unchanged. The first address was not deployed and ignores the parameter.
* App: an Earlier departures row at the top of a stop's list (Now too), the same row as the trip screen's Earlier services: each tap loads the services before the first one shown, back to 4am; a busy station's batch is filled up to the list (a board answer is 40 services).
* A time chip under the live stamp: Now, or From a time (the time wheel with Now and From), shows the board from that time with the gone services first.
* Gone services are greyed Left rows in the board's layout: "Left 8:25 · 2 min late" with the live time, "Left 8:16 · Scheduled" with only the timetable, "Cancelled 8:20". They open the service like any row.
* These boards are asked of api.transportsydney.app directly; if it does not answer: "Earlier departures need a newer server, which did not answer just now. Pull down to try again." A server answering without `at` hides the row and the chip for the session.
* Now is as before; Recently departed shows on Now until Earlier departures are loaded (they list the same services). `/stop/<id>?time=HHMM` opens a board from a time.
* Update: production group 8a2d8055-1c15-437e-ac01-c8f3d8711f2d (iOS 01a1727f-ec7e-754e, Android 01a1727f-ec7e-7ab8) from main a6b98ca, preview 6e8ceb73. Roll back to ffda4f33 (the 8:56 PM update); the server rolls back to transport-api 78b63aa1. Not yet seen on a phone.
* Files: backend/src/worker.js, backend/test/departures-at.test.mjs (new), app/src/app/stop/[id].tsx, app/src/lib/boardTimeCore.ts (new), app/src/lib/api.ts, app/src/lib/types.ts, app/src/components/LeftRow.tsx, app/src/components/WhenPicker.tsx, app/test/boardtime.test.mjs (new), docs/API.md, docs/FEATURES.md, docs/TEST_PLAN.md, docs/RELEASES.md, CHANGELOG.md.

### Commute card in Line glow, iPhone menus are the system action sheet (over the air update for iPhone and Android, 25 Oct, 8:34 PM, group c9a4913d)
Bidur at 7:33 PM: "I think we need little shiny or metallic border and main card element here", at 7:43 PM of the + menu: "This looks vibe coded and bad", at 7:44 PM of the dark Home: "Still not distinguished", then "Ok whatever you choose best".
* The commute card (or Next trip card) is drawn in look B, Line glow: a 2 pt ring that runs between the trip's line colours (T4 blue into T1 orange on Kings Cross to Strathfield, meeting in a light sheen; a one line trip runs from its colour into silver). In dark a glow in those colours sits behind the card and the card is lifted to #232326 above the other cards; in light it is white with a soft shadow. Every other card stays flat, so the commute stands out. The countdown is bigger and heavier in this look (64 pt).
* With Reduce Transparency or Increase Contrast on (High contrast text on Android) the card has a solid 1.5 pt border in the line colour and no glow. Plain React Native styles: no native module, nothing animates.
* iPhone menus: the + button opens the system action sheet from the button itself (on iOS 26 it grows from the button instead of a panel mid screen). The same system sheet is used for the trip and stop hold menus, Save this trip (Home or Work), the Recent rows in Plan and the menus in More and Ask. Yes or no questions stay system alerts. Android keeps its bottom sheet and dialogs. The time picker and trip reminder editor are still the app's own sheets.
* "Then 11, 20 min" under the countdown now reads "Next 11 min, 20 min" ("Next now, 13 min" when one is due now). VoiceOver says "1 minute", not "1 minutes".
* The big countdown uses the normal text colour and turns red only once the service has gone or is cancelled (it was red at 1 min, which read as an error). A late service keeps its orange status line.
* The Trackwork chip is quiet like the alerts chip: plain text with a small orange icon, no red.
* The "Home" title hidden behind the tabs ("Hor") was in the web preview only: there expo-router draws the tabs as a floating pill at the top. On iPhone and Android the tabs are at the bottom and the title was never covered. The web header now starts below the pill; the phones are unchanged (standard titles, large titles stay off since the 8:22 AM fix).
* Commits df6b6d3 (menus, wording, countdown colour, chip, the three looks behind a development switch) and 1995ef2 (Line glow), 098661f (web header), 0221030 (Next now, 1 minute). Checked in the web build at 390 x 844, light and dark, both directions with live data: files/home-commute-hero-25oct/shipB/. Not yet seen on a device.
* Group c9a4913d-b324-434c-9cb7-f4f17c1f53f5 (from main 8656464; iOS 01a17269-7ed0-7401-927e-d4da423e517d, Android 01a17269-7ed0-7d0b-aefa-62f66a596342). Preview group 3848db3b checked first: manifests on both platforms, runtime 1.0.0, launch asset hashes equal to the built bundles; the production manifests serve the same hashes. Roll back to a76b515a (the 7:42 PM update): `npx eas-cli update:republish --group a76b515a-17e5-4e05-8d84-21b83dfc294e --destination-branch production --message "Roll back" --non-interactive`.

### Leave at a time that has passed shows the trains you missed (over the air update for iPhone and Android, 25 Oct, 7:42 PM, group a76b515a, the same update as the Home entry below)
Bidur at 7:09 PM, on Kings Cross to Strathfield at 6:27pm with Leave 6:15pm: "I choose to see old trip but app still shows next trains. Not older ones."
* Cause: the trip screen dropped every service that had left more than 2 minutes ago, whatever time was picked, so the server's 6:18 and 6:24 never showed. Earlier services also stopped half an hour before now. The server was fine: both servers return the services from the time asked, gone ones included (checked live on both).
* Leave at or Arrive by a past time now lists the services from that time. Gone ones are greyed rows that say "Left 6:21 · 3 min late" (the live time it left at, where known) or "Left 6:18 · Scheduled", and the first service you can still take opens.
* An Earlier services row at the top of every trip list, Now included (Bidur, 7:13 PM: "Should be able to see all previous or earlier ones as well"). Each tap (or a pull down) loads the services before the first one shown, gone ones as Left rows, back to the start of the service day (4am); over a quiet stretch it steps back further by itself. The planner's own answer for Now still drops services gone over 2 min ago.
* A picked time keeps its day: Leave 6:15pm picked at 6:27pm stays today's 6:15pm as the clock moves on (before, after 6:45pm it quietly became tomorrow's 6:15pm).
* Times up to 30 min ago work on both servers. Older times today go to api.transportsydney.app with today's date (the first server plans them for tomorrow); if it doesn't answer, the screen says "Earlier trips need a newer server, which did not answer just now. Pull down to try again." The first server was not changed or redeployed. A trip with a change stop asks its second part with the date when needed too.
* Plan B looks only at services you can still take.
* Not yet seen on a device; checked in the web build with real data (files/trip-past-25oct) and app/test/trippast.test.mjs.

### Home: your commute first, alerts as chips; Ask: long chats open fast, Clear chat (over the air update for iPhone and Android, 25 Oct, 7:42 PM)
Bidur at 7:07 PM, with a mockup: "Yes commute should be main element here. Alerts should be minimized until open." and "Ours look too much". Also: "chat history gets slow when loaded. There should be option for clearing it too".
* Home: the commute card (or Next trip card) is now the first card, right under the title. Above it there is at most one slim bar: "In transit · Central to Strathfield" with the line badge while a trip is live (tap for the live trip), or "Watching · ..." for a single watched trip. A watch of the live trip shows once, in that bar.
* Notifications under the card: one row of small chips, closed until you tap one, for example "9 trip alerts", "Trackwork this weekend", "T4 Delays" (only lines with a problem), a high priority alert by its first words, and "Watching 2 trips" when more watches are running. A tap opens that chip's full text in place, with links to Transport for NSW's pages or the watched trip; a second tap closes it. They replace the orange alert banner, the Watching now list, "N alerts on your trips", the Trackwork this weekend card and the line status chips above the card. Lines with good service are no longer listed on Home (More > Status of my lines still lists every line). The Thursday trackwork heads up is unchanged.
* In the card: "Show when to leave" and "Check my trip before I go" are now small buttons ("When to leave", "Check before I go"), and once your location is on, the leave time is one line with a bell button for the reminder. Plan B and Why it's late stay one line each in the card.
* Below the card, in the same order as before: Make this your commute, Calendar leave by, Last way home, Your trips, Starred stops, Nearby.
* VoiceOver reads the card first, then the chips; each chip is a button whose label is the full alert text and which says whether it is open. Checked in the web build at 390 x 844 with Bidur's commute (Kings Cross to Strathfield, To home) and live data, with a trip in progress, its watch, 9 trip alerts and weekend trackwork all present: the card sits at 192 to 387 px of 844, nothing alert related above it. Screenshots: files/home-commute-hero-25oct/.
* Ask: opens on the last 30 messages, with Load 30 earlier messages at the top (or scroll up to it). Messages are drawn once and not again on every key press or countdown tick (the cards inside were rebuilt on every change before). Up to 200 messages are kept on the phone (was 40), the oldest dropped. Measured in the web build with 200 messages: opening Ask 1465 ms before, 488 ms after (median of 5); typing 21 characters 1140 ms before, 154 ms after.
* Clear chat: the trash button at the top right of Ask, and More > Privacy and data > Clear Ask chat, both ask first ("Clear chat?") with the system alert on iPhone and Android. The chat is only kept on the phone; the server keeps no Ask chat (trips searched from Ask count as trip history, which has its own delete in More). Delete all my data also clears the chat on screen.
* Also carries the trip screen past-times fix (Leave at a past time shows the trains already gone as Left rows), commits 840d470 to bc79e56, and the Earlier services row (16a1504): see the entry above.
* Group a76b515a (from main 6ee721d; preview group 62ac2636 checked first: manifests on both platforms, runtime 1.0.0, launch asset hashes equal to the built bundles). Roll back to f773ab8e (the 6:40 PM update): `npx eas-cli update:republish --group f773ab8e-7f99-4f06-851b-b5b810a7fd8b --destination-branch production --message "Roll back" --non-interactive`.
* Not yet seen on a device.

### Expo access token rotated (25 Oct, 7:06 PM)
* The Expo token used for builds and updates was written to a build log today, so it was replaced. The new one belongs to a robot (service) account, `transportsydney-ci-2026-10-25`, with only publish and view rights, instead of a personal token with full account rights. The old personal token `tab-cli` is revoked.
* It lives only in the build machine's secrets file. No workflow in this repo uses an Expo token, so no repo secret was added. How to rotate: docs/RUNBOOK.md, section 7, Expo token rotation. Nothing changes in the app.

### Calendar leave by, ready for build 208 (over the air update for iPhone and Android, 25 Oct, 6:40 PM)
* More > Calendar leave by, off by default. When on, Home shows "Leave by 7:44pm for Team meeting (Barangaroo)" for events in the next 6 hours that have a place, with the live trip from where your usual trip starts (the commute card's start, else your first trip). Tap it for the trip screen at Arrive by the event's start, with the trip you'd take open.
* Read only and read on the phone, only while Home is open, at most every 5 minutes. Only the event's place (as a place search, once, then kept on the phone) and the trip query leave the phone, with no install ID, so neither goes into trip history. The event's name, notes and people never leave the phone. Online meetings, all day events and places that can't be found show nothing.
* Hidden on every build in use today: iPhone 206 and 207 have the calendar with add only access, which can't read events, and earlier builds have no calendar. It lights up by itself on iPhone build 208, which gets full calendar access with its own text (branch native-207, checklist in TEST_PLAN.md there), and on the first Android build with the calendar module.
* The trip screen at Arrive by now opens the trip that leaves last and still arrives in time, not the earliest one.
* Privacy policy on transportsydney.app (Calendar section, live from Pages deployment 602309ac, checked 200) and docs/STORE_PRIVACY.md say what Calendar leave by reads and sends. Details: [docs/CALENDAR-LEAVE-BY.md](docs/CALENDAR-LEAVE-BY.md). Not yet seen on a device.
* Group f773ab8e (from main 2180c62; native part on native-207 8c5dd94 and e5a6cc2). Roll back to 0c0bffd6 (the 5:43 PM update): `npx eas-cli update:republish --group 0c0bffd6-6f89-40e8-91d9-94b34346b675 --destination-branch production --message "Roll back" --non-interactive`.

### iPhone build 207 on TestFlight (25 Oct, 6:02 PM)
* Apple Watch: redesigned app with trip cards (a big countdown in whole minutes, platform, lines, late in amber or red) and new complications. Swap direction and Refresh are rows at the end of the trip list, so nothing covers the first card.
* Bus stop widgets show the stop number; Edit Widget lists starred bus stops with their stop numbers and routes.
* Speak alerts use their own audio session: spoken with Silent mode on, other audio lowered while a line is read.
* New Liquid Glass app icon for iOS 26.
* Carries the JavaScript of every update through the 5:43 PM one (group 0c0bffd6); over the air updates keep arriving (runtime 1.0.0).
* EAS build cfa52f8c from native-207 3419ed2, App Store Connect build f2614902, What to Test set, in the Internal and Public groups, Beta App Review approved. Not submitted for App Store review. Not yet seen on a real iPhone or Apple Watch: Build 207 device checklist in docs/TEST_PLAN.md.

### Choose bus on a trip, an endless list of services, and any time or day (over the air update for iPhone and Android, 25 Oct, 5:43 PM)
Bidur at 5:20 PM, on Strathfield to Town Hall: "How to choose bus? ... For later service, i have to keep clicking later button??"
* Mode chips on the trip screen: Any, Train, Bus, plus Metro, Light rail or Ferry when that trip uses them. Tap Bus for bus only trips (Strathfield to Town Hall now shows the 415, 458, 461X, 492, 52 and 504 ways, with stand and stop numbers; there is no direct bus, so they have changes). Train and Bus together works too. The choice stays with that trip on your phone; the default is Any. When nothing runs: "No bus-only trips at this time. Try Any." Works now: bus only trips are planned on api.transportsydney.app (asked directly, like long trips, with no profile or device). If that server does not answer, the phone filters the usual results and says some bus trips may be missing.
* No more Earlier and Later buttons: later services load by themselves as you scroll near the end, earlier ones when you pull down at the top, with a small loading row. At most 8 later and 3 earlier batches per visit, one at a time, only while the screen is on view, stopping at 4am or when there are no more, then Choose a time.
* A Leave now chip at the top opens Leave at or Arrive by with a day row (today to 7 days ahead). Now is one tap back. Another day is planned on api.transportsydney.app.
* Kept: Step free, Include trips with a change, alerts, live labels, seats, Track and Start trip.
* Shipped in the same update as Why it's late (group 0c0bffd6, built from main e6bac7d, which is this change). Not yet seen on a device.

### Why it's late and a full screen departure board (over the air update for iPhone and Android, 25 Oct, 5:43 PM)
* A late, cancelled or changed service says why in one line, in Transport for NSW's words: "Delayed: signal repairs at Redfern", "T4 delayed: incident requiring emergency services at Allawah" on a trip with more than one ride. Tap it for the full alert. Only a reason from an alert linked to that service is shown, and nothing when the alert names no cause. On departure rows, trip rows and legs, Home trip cards and the live trip.
* Board on a station or stop: a big full screen board like the platform screens, with the platform or stand, where the next trains stop, minutes and Live, Timetable or Not tracking on every row. Dark by default with a Light board button, grows with your text size, works sideways, and keeps the screen on only while it is open.
* Also carries the trip screen mode chips (Any, Train, Metro, Bus, Light rail, Ferry) and "Usually on time on weekends around midday" wording.
* Group 0c0bffd6. Roll back to a8766080 (the 5:28 PM update): `npx eas-cli update:republish --group a8766080-ee8f-4c4c-8d4f-d7b2feb64c59 --destination-branch production --message "Roll back" --non-interactive`.

### Delete all my data now really deletes everything, and the server tidies up after itself (25 Oct, 5:28 PM)
* Delete all my data (More) also deletes the iPhone Lock Screen trip card and the phone's notification token from the server, straight away. Before, these two stayed behind. Works now on iPhone builds 205 and 206 after the update (close and reopen the app twice); earlier builds never sent them.
* After Delete all my data the iPhone does not send its notification token again until you turn alerts back on.
* The server deletes a trip card's token when the trip ends, and never keeps one longer than 24 hours. A phone's notification token the app has not sent for 30 days is deleted. Expo and web notification tokens that have not worked for 30 days are deleted when nothing you set up could still send an alert.
* The server keeps recorded live times for 45 days (what Reliability and predictions read) and deletes older ones every hour, so its database stays small on the free plan.
* Privacy policy on transportsydney.app updated to match.
* Update group a8766080 (server version 0eaaf004, Pages ce0e84d3). Roll back the app to edf0b9e8 (the 5:25 PM update): `npx eas-cli update:republish --group edf0b9e8-1e1c-4ac1-8e7a-67ab8a0a03a6 --destination-branch production --message "Roll back" --non-interactive`. Roll back the server: `npx wrangler@4 rollback` in `backend/`.

### App Store Connect text (25 Oct, 5:30 PM)
* The en-AU description and promotional text (store/apple/listing.md) and the Notes for Review (docs/REVIEW-NOTES.md) were written to App Store Connect, version 1.0.0, through the API and read back. Nothing was submitted; build, price, availability and everything else were left as they were.

### Plan B on Home, Last way home on your current build, weekend trackwork now (over the air update for iPhone and Android, 25 Oct, 5:25 PM)
* Plan B on Home: when the next service of a trip is cancelled, on a suspended line, will miss a change or uses replacement buses, a line under the trip says so and the best other way: "Plan B: T1 suspended. Try the 8:04am M1 from Epping, arrives 8:41am." Tap for the trip and its Plan B card. Works now.
* Trackwork counts for Plan B: a trip with replacement buses gets a way without them when one arrives no more than 10 minutes later; otherwise the trip screen says the buses are still the quickest way. Works now.
* A tapped morning check alert opens its trip with live times and Plan B, not the list of checks. Works now. The Plan B words inside the alert itself come with the server move.
* Last way home: Remind me 15 min before on the Last train home answer and the last service tonight now works on the current server, on iPhone and Android. The phone sets the notification itself and, whenever the app is open, checks live times again: a late service moves the reminder, a cancelled one is replaced by the last one still running, and Home says when nothing is left. It asks for notifications only when you tap Remind me. After the server move the iPhone gets the server's reminder, which also follows the service while the app is closed.
* Weekend trackwork card from Thursday 6pm now works on the current server, from Transport for NSW alerts on the lines your trips use ("Sat and Sun: Trains run to a changed timetable..."). How much longer the trip takes comes with the server move.
* More > Weekend trackwork heads up (off until you turn it on): one notification on Thursday 6pm, only when work this weekend touches one of your trips. It is set when you open Home earlier in the week; nothing runs in the background.
* No server change. No new build needed.
* Group edf0b9e8. Roll back to 003790dc (the 4:44 PM update): `npx eas-cli update:republish --group 003790dc-2dc0-4475-b817-5270feeaf7f8 --destination-branch production --message "Roll back" --non-interactive`.

### Website and docs (transportsydney.app, 25 Oct, 5:10 PM)
* The home page says what the app does now (your next trip first, Live, Timetable and Not tracking, buses by stop number and route, reminders on your days, Check my trip, Ask, iPhone widgets, Siri and Apple Watch), with four screens from the current app, and lists what is coming in the next iPhone build (Apple Watch redesign, bus stop widget with stop number, Speak alerts in Silent mode, new icon).
* Support: what Live, Timetable and Not tracking mean, reminders, Speak alerts and Silent mode, the + on Home.
* Privacy policy: the iPhone also sends a notification token and, during a trip, the Lock Screen card's push token; the last way home reminder; reminders and Speak alerts stay on the phone; Ask works by fixed rules.
* Docs: new docs/FEATURES.md; README, ROADMAP, RUNBOOK (over the air updates and iPhone builds as done today), TEST_PLAN, REVIEW-NOTES, STORE_PRIVACY, ARCHITECTURE, REQUIREMENTS and the store texts brought up to date.
* Pages deployment 6a3ba944. Roll back in Cloudflare Pages, project transportsydney, Deployments.

### Trip reminders and how late a route usually is (over the air update for iPhone and Android, 25 Oct, 4:44 PM)
* Reminders on a saved trip: open it and scroll to Reminders. Add several, each with its own time and days (for example 7:30am on weekdays and 9:00am on Saturday). They ring on your phone with the app closed, and a tap opens the trip with live times.
* Transport asks to send notifications only when you save your first reminder.
* Deleting a trip removes its reminders (Undo keeps them).
* Coming with the move to the new server: "Usually 3 min late on weekday mornings" for a route at your stop, on the stop board (choose a route), on the service screen and on each leg of a trip. It is hidden until then.
* Group 003790dc. Roll back to 0b1d956d (the 4:34 PM update): `npx eas-cli update:republish --group 0b1d956d-ee83-4f92-81af-2677b2b82f4a --destination-branch production --message "Roll back" --non-interactive`.

### Server: usual lateness (api.transportsydney.app, 25 Oct, 4:31 PM)
* New `/api/usual` on the new address only, built once a day from the live times the server already records, kept as counts per route, stop, weekday or weekend and part of the day, with no trips, times or devices stored. Deployed from main cd4b8e7; the old address was not touched. Checks after deploy in docs/DEPLOY_CLOUDFLARE.md.

### A calmer Home (over the air update for iPhone and Android, 25 Oct, 4:34 PM)
* Your next trip is the big card on top: the countdown, line badges, the platform (for a bus, the stand and stop number), whether it is live, leave and arrive, and the next two times ("Then 12, 19 min"). It is your commute when Home and Work are set, otherwise the first trip in your list.
* Every other trip is one slim row with its next time. The star, seats, journey time, third service and alert counts moved off the rows; they are all on the trip screen, one tap away.
* One + at the top right adds a trip, stars a stop, or sets Home or Work. No more Add button in the middle of the page.
* Alerts on your trips are one line that opens in place.
* No trips yet: one big Add a trip button.
* Delete a trip (swipe, hold, or VoiceOver) and Undo shows above the tab bar for 5 seconds.
* Hold a trip and choose Show first to make it the big card. Dragging trips keeps the card on top.
* On Android, hold menus no longer lose a choice (Home and work lost Change home).
* Group 0b1d956d. Roll back to eadd0cc6 (the 4:29 PM update): `npx eas-cli update:republish --group eadd0cc6-7c92-434a-a4e7-06684bac02e6 --destination-branch production --message "Roll back" --non-interactive`.

### Honest live times and cleaner bus stop boards (over the air update for iPhone and Android, 25 Oct, 4:29 PM)
* Every countdown says where its time comes from: "Live, updated 15 s ago", "Timetable" (grey, no live data for that service) or "Not tracking".
* No more ghost buses: when a bus's live position goes stale, the time shows the timetable time and "Not tracking" instead of counting down to Now and then saying it has gone. A timetable time that has passed shows the time, never "left".
* Bus stops: tap a route chip (410) to see only that route; tap it again, or All routes, to see every route. "Route 410: all stops and live buses" opens the route.
* Recently departed, one row above the departures: "Left 4:21pm" only when live data followed the service to its departure, otherwise "Due 4:20pm, not tracked".
* Open a bus or train leg from a trip and its stop list marks GET ON and GET OFF on your two stops.
* Group eadd0cc6. Roll back to 96c008eb (the 3:30 PM update): `npx eas-cli update:republish --group 96c008eb-0386-4368-9c14-7061aeefd02e --destination-branch production --message "Roll back" --non-interactive`.

### Cleaner bus picker in New trip (over the air update for iPhone and Android, 25 Oct, 3:30 PM)
* Choosing where you get on the bus starts with bus stops near you (with the stop number and how far), your saved and recent bus stops, then Sydney routes in number order with where each goes on two lines, nothing cut off. It no longer opens on trackwork and regional routes.
* Trackwork buses, school buses and regional and coach routes have their own sections at the end, closed until you tap them.
* Type a route number (410), a stop number from the sign (2046100) or a street or stop name. Sydney routes come first.
* Near you shows only when you have already allowed location; otherwise tap Show bus stops near me.

### Ask and the floating tab bar (over the air update for iPhone and Android, 25 Oct, 3:26 PM)
* Ask: the field where you type is no longer hidden behind the tab bar on iPhone. It sits above the bar, and when the keyboard opens it moves up and sits right on top of the keyboard.
* Ask opens on your latest message every time you switch to it, and stays at the newest message as answers come in, unless you have scrolled up to read.
* Home: the Undo bar after deleting a trip or stop shows above the tab bar instead of behind it.
* Lists and search results leave room for the keyboard, so the last results stay reachable.

### Speak alerts and buses (over the air update for iPhone and Android, 25 Oct, 3:15 PM)
* Speak alerts now talk during a trip. Before, nothing was said once notifications were on. You hear short lines once each: "Your bus leaves in 2 minutes from stand X1", "Redfern is next. Change here for the T4", "Five Dock Shops is next. Get off here", a platform or stand change, running late, a tight change and "You've arrived". Music is lowered, not stopped. The switch stays on for your next trip. Speech needs the app open; on build 206 Silent mode mutes the speaker (headphones still work).
* Bus routes: tap Route on a bus, on a bus leg in a trip, or a route badge on a bus stop, or search a route number (410, M90) in Plan. You see every stop in order with its stop number, where the buses are now, the next times at a stop you tap, the other direction and a map.
* Stop numbers: search the number on a bus stop sign (for example 2046100) to find that stop. Bus stops, departure rows, Home stop cards and bus legs show "Stop 2046100".
* Bus legs say where to wait: the stop, stand and stop number, on the walk to the stop and on the live trip.
* Widgets get the stop number and routes of starred bus stops and the modes of saved trips (shown by a later widget build).

### Station picker and search fields (over the air update for iPhone and Android, 25 Oct, 3:06 PM)
* New trip, choosing where you get on or off: the Back button and the From or To title no longer sit on top of the screen on iPhone. The question is now in the search field ("Where do you get on?", "Kings Cross to where?"), the search field sits above A to Z, By distance and By map, stations fill the full width with the A to Z letters clear of the names, and the list ends above the home indicator. Same for train, metro, ferry, light rail and bus.
* Search fields no longer switch on capitals (the bus search used caps lock), autocorrect or spell check, and the keyboard shows a Search key: station picker, bus search, Add a trip, Plan and Set up.

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
