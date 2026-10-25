# Notes for Review (App Store Connect)

The text below is in App Store Connect, version 1.0.0, App Review Information, Notes (set through the API on 25 Oct 2026, 3963 of 4000 characters). Contact fields were left as they were (Bidur Khatri, contact@fintex.au, [redacted-phone]). Sign in required: No.

Why it lists server features: App Review Guideline 2.5.19 (added 16 Oct 2026) does not allow hidden, dormant or undocumented features, and 2.3.1(a) asks for new features to be described in Notes for Review. The features in the server section read api.transportsydney.app only (docs/RELEASES.md: 25 Oct 2:08 AM, 9:52 AM, 10:11 AM, 11:13 AM and 11:21 AM rows).

Before submitting:
* If api_base has moved to api.transportsydney.app by then (remote config, src/lib/server.ts), replace the two sentences starting "The app reads its server address" with "They come from our API at api.transportsydney.app." so the notes match what the reviewer sees.
* The text describes build 206 and later (Siri, Control Center, widget buttons, Apple Watch, Add to Calendar, Speak alerts). Select build 206 or later on the version page; a version with build 201 would not have them.
* Features added after 25 Oct 2026 go in the notes too.

## Notes

Transport: Sydney Live shows live Sydney and NSW public transport times from Transport for NSW open data (CC BY 4.0). No accounts or sign in, so no demo account is needed. Nothing is paid or locked, and every screen works from any location.

HOW TO TEST
1. First launch: type Strathfield and pick it as Home, then Town Hall as Work. Home shows the commute card with live countdowns.
2. Plan: search Central for a live departure board. Swipe left on a departure to watch it (allow notifications). From and To also find addresses and places, for example "1 Martin Pl" or "Sydney Opera House". Leave now, Leave at and Arrive by set the time. Step free avoids stairs and shows lift outages.
3. Ask: type "next train Burwood to Central" or "is the T1 late". Answers come from live data with fixed rules. Ask does not use generative AI and does not connect people.
4. Start trip: open a trip and tap Start trip. It shows a live map and the next stop, and a Live Activity on the Lock Screen and in the Dynamic Island. Speak alerts (in trip mode) reads alerts aloud. Add to Calendar opens the system event sheet. Share trip makes a link that stops working when the trip ends.
5. More > Check my trip before I go: set a leave time and days. Check now shows what the alert would say.
6. More > Delete all my data removes everything the server keeps and resets the app.

SYSTEM FEATURES (set Home and Work first)
Siri, Spotlight and Shortcuts, no setup needed: "Next train home in Transport", "Next train to work in Transport", "When is my next train in Transport", "Start my commute in Transport".
Widgets: touch and hold the Home Screen, Edit, Add Widget, Transport. The medium and large Next trip widget has Refresh, Swap direction and Start buttons. Lock Screen and StandBy widgets show the next service.
Control Center (iOS 18 and later): open Control Center, tap +, Add a Control, search Transport, then add Next train home or Start my commute.
Apple Watch: install Transport from the Watch app on the iPhone (commute, starred stops, trip in progress). Complications are under Transport when editing a watch face.

FEATURES THAT DEPEND ON SERVER DATA (guideline 2.5.19)
All of these are in this build. None is hidden behind a setting or a code. Each shows when our server has data for it:
- Weekend trackwork card on Home (Thursday 6pm to Sunday, when planned work touches your trips), and a Thursday 6pm to 9pm "Trackwork this weekend" notification for trips with a morning check.
- Status of my lines: line chips on Home and a section in More.
- Plan B inside the morning check alert when a service is cancelled, runs more than 5 minutes late, a change will be missed or trackwork is on.
- Reliability line on services: "Left on time 9 of the last 10 weekdays".
- Remind me 15 min before the last service home, from Ask and trip results, with a Home card while it is set.
- Park and Ride: "Usually full by 7:40am on weekdays", once 5 weekday mornings are recorded.
- Live traffic incidents on bus legs.
- Quieter at the front, back or either end, where Transport for NSW sends occupancy per carriage.
- Live times from their own feeds for watched and saved NSW TrainLink, regional coach and Manly Fast Ferry services.
These come from our new API at api.transportsydney.app. The app reads its server address from its remote configuration. While the address is still nsw-transport-bot.sites.tab.bot, which does not have these endpoints, the items above stay out of sight; when the address moves they appear without an app update. Remote configuration can only change the server address or switch a feature off. It cannot add anything that is not in this build.

Location is optional, asked for only when you tap a location button, and never used in the background. From about 1am to 4am many lines have no services, so boards can be short.

Published by Fintex Australia Pty Ltd. Transport: Sydney Live is an independent app, not made or endorsed by Transport for NSW.
