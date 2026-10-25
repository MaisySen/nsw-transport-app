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

* **Live labels** on every countdown (departures, trip screen, live trip, Home): "Live, updated 15 s ago", "Timetable" (grey, no live data for that service) or "Not tracking" (live data went stale, so the timetable time is shown instead of a countdown). A timetable time that has passed never says "left". See [LIVE-LABELS.md](LIVE-LABELS.md).
* Departure boards refresh while open and pause in the background ([PERFORMANCE.md](PERFORMANCE.md)).
* **Why it's late** (over the air): a late, cancelled or changed service shows one line with the reason from its own Transport for NSW alert ("Delayed: signal repairs at Redfern"); tap it for the full alert. Nothing is shown when the alert gives no reason. On departure rows, trip legs and services, Home trip cards and the live trip. See [WHY-LATE.md](WHY-LATE.md).
* **Departure board** (over the air): Board at the top right of a station or stop opens a full screen board like the platform screens: line, destination, platform or stand, where trains stop after this station, minutes and Live, Timetable or Not tracking on every row. Dark, with a Light board button; grows with the text size setting; works in portrait and landscape; keeps the screen on only while it is open.

## Buses

* **Stop numbers:** search the number on a bus stop sign (for example 2046100). Bus stops, departure rows, Home stop cards, bus legs and the live trip show "Stop 2046100".
* **Route view:** Route on a bus service, on a bus leg, a route badge on a bus stop, or search a route number (410, M90) in Plan. Every stop in order with its stop number, the live buses along the route, next times at a stop you tap, the other direction and a map.
* **Stop boards:** route chips filter the board (tap 410 for only the 410); a Recently departed row ("Left 4:21pm" only when live data followed the service to its departure, otherwise "Due 4:20pm, not tracked").
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

Type "next train Burwood to Central", "is the T1 late" or "last train home". Answers come from live data with fixed rules; there is no generative AI. Ask opens on the latest message and its field sits above the tab bar and the keyboard. It shows the last 30 messages, with Load earlier at the top; up to 200 are kept on the phone. **Clear chat** is the trash button at the top right of Ask and in More > Privacy and data, and asks first. The chat is only kept on the phone.

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

## After the server move (api_base)

The app still reads the first server address. These are in the app now and show by themselves when remote config moves `api_base` to api.transportsydney.app ([API.md](API.md), [REVIEW-NOTES.md](REVIEW-NOTES.md)):

* "Usually 3 min late on weekday mornings" on stop boards (with a route chosen), the service screen and trip legs. Real answers need a few weeks of live times on the new server.
* Weekend trackwork card, Status of my lines, Plan B in the morning check, reliability lines, last way home reminder, Park and Ride "usually full by", live traffic on bus legs, carriage occupancy, and live times for NSW TrainLink, regional coach and Manly Fast Ferry services.

## Not in the app

No accounts or login, no ads, no analytics or tracking, no Opal card balance. Privacy details: [STORE_PRIVACY.md](STORE_PRIVACY.md) and https://transportsydney.app/privacy/.
