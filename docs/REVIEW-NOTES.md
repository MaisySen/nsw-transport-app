# Notes for Review (App Store Connect)

The text under Notes is the source for App Store Connect, version 1.0.0, App Review Information, Notes (limit 4000 characters; this text is 3412). Updated 25 Oct 2026, 5:20 PM for the app as it is after the 4:44 PM update: the Next trip card and live labels, bus route and stop number search, trip reminders and when notification permission is asked, and Usually N min late. Written to App Store Connect through the API at 5:30 PM on 25 Oct and read back (3412 characters, matches); the earlier text (3963 characters, the morning of 25 Oct) is replaced. Write it again whenever this text changes. Contact fields stay as they are (Bidur Khatri, contact@fintex.au, and his mobile, which is on file in App Store Connect and not written here because the repo is public). Sign in required: No.

Why it lists server features: App Review Guideline 2.5.19 (added 16 Oct 2026) does not allow hidden, dormant or undocumented features, and 2.3.1(a) asks for new features to be described in Notes for Review. The features in the server section read api.transportsydney.app only (docs/RELEASES.md: 25 Oct 2:08 AM, 9:52 AM, 10:11 AM, 11:13 AM, 11:21 AM and 4:44 PM rows).

When notification permission is asked (checked in the code: `canNotify(true)` and `enablePush` callers): never at launch, only when the person first turns on something that notifies: saving the first trip reminder, watching a trip, Check my trip before I go, lift alerts, Wake me or Remind me on a trip, the last way home reminder, or the alerts switch in More. Location is asked only when a location button is tapped; the bus picker shows Near you only if location was already allowed.

Before submitting:
* If api_base has moved to api.transportsydney.app by then (remote config, src/lib/server.ts), delete the sentence starting "The app reads its server address", so the notes match what the reviewer sees.
* The text describes build 206 and later (Siri, Control Center, widget buttons, Apple Watch, Add to Calendar, Speak alerts). The plan is to submit with build 207; select it on the version page.
* Features added after 25 Oct 2026 go in the notes too.

## Notes

Transport: Sydney Live shows live Sydney and NSW public transport times from Transport for NSW open data (CC BY 4.0). No accounts or sign in, so no demo account is needed. Nothing is paid or locked, and every screen works from any location.

HOW TO TEST
1. First launch: pick Strathfield as Home and Town Hall as Work. Home shows the next trip as a big card. Every countdown says Live (with its age), Timetable or Not tracking.
2. Plan: search Central for a live departure board. Swipe left on a departure to watch it; the app asks for notifications then. Leave now, Leave at and Arrive by set the time. Step free shows lift outages.
3. Buses: in Plan search 410 for the route with every stop and live buses, or 2046100 (the number on a stop sign) for that stop's board.
4. Reminders: open a saved trip, Reminders, Add a reminder, pick a time and days. Notification permission is asked only when the first reminder is saved. They are local notifications.
5. Ask: type "next train Burwood to Central" or "is the T1 late". Answers come from live data with fixed rules. Ask does not use generative AI and does not connect people.
6. Start trip: open a trip and tap Start trip for a live map, the next stop and a Live Activity. Speak alerts (in trip mode) reads alerts aloud. Add to Calendar opens the system event sheet. Share trip makes a link that stops working when the trip ends.
7. More > Check my trip before I go: set a leave time and days.
8. More > Delete all my data removes what the server keeps and resets the app.

SYSTEM FEATURES (set Home and Work first)
Siri and Shortcuts: "Next train home in Transport", "Next train to work in Transport", "When is my next train in Transport", "Start my commute in Transport".
Widgets: Edit the Home Screen, Add Widget, Transport. The Next trip widget has Refresh, Swap direction and Start buttons. Lock Screen and StandBy widgets show the next service.
Control Center (iOS 18 and later): Add a Control, search Transport.
Apple Watch: install Transport from the Watch app (commute, starred stops, trip in progress); complications are under Transport when editing a face.

FEATURES THAT DEPEND ON SERVER DATA (guideline 2.5.19)
All are in this build; none is behind a setting or a code. Each shows when our server has data for it:
- Weekend trackwork card on Home, and a Thursday evening notification for trips with a morning check.
- Status of my lines on Home and in More.
- Plan B inside the morning check alert.
- "Usually 3 min late on weekday mornings" for a route at a stop.
- Reliability: "Left on time 9 of the last 10 weekdays".
- Remind me 15 min before the last service home.
- Park and Ride "Usually full by 7:40am".
- Live traffic incidents on bus legs.
- Quieter carriages, where occupancy is sent.
- Live times for NSW TrainLink, regional coach and Manly Fast Ferry.
These come from our API at api.transportsydney.app. The app reads its server address from remote configuration; while it is still our earlier address, which lacks these endpoints, they stay out of sight and appear without an app update when it moves. Remote configuration can only change the address or switch a feature off.

Location is optional, asked for only when you tap a location button, and never used in the background. From about 1am to 4am many lines have no services.

Published by Fintex Australia Pty Ltd. An independent app, not made or endorsed by Transport for NSW.
