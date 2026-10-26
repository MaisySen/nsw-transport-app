# App Review notes (App Store Connect > version 1.0.0 > App Review Information)

Source for the Notes field. Written to App Store Connect through the API on 26 Oct 2026, 5:48 PM Sydney (g25) and read back: 3562 characters (limit 4000), matches the text below. Contact fields unchanged: Bidur Khatri, contact@fintex.au, and his mobile, which is on file in App Store Connect and is not written here because the repo is public. Sign in required: No. Nothing was submitted; the version is still Prepare for Submission. docs/REVIEW-NOTES.md points here.

## What changed from the 25 Oct text

* Test steps use NSW wide examples (Parramatta, Wynyard, Central, Chatswood to Bondi Junction, route 333) instead of the owner's own stations.
* New DATA SOURCE paragraph: Transport for NSW Open Data under CC BY 4.0, credited in More and in the description, independent app, no Transport for NSW logos.
* New PERMISSIONS paragraph: location (foreground only, on a tap), notifications (never at launch), calendar (Calendar leave by, off by default, read only).
* Live Activities named under system features; the outage behaviour (timetable times marked as such) is in step 1.
* The sentence about the earlier server address is gone (the app moved to api.transportsydney.app over the air on 26 Oct). Remote configuration now says what it can do: switch a feature off, change the address, or send boards over a WebSocket instead of polling (the live board push of 26 Oct, off for phones today). Saying "it can only switch a feature off" would have been untrue once the push flag is used.
* Example values ("3 min", "7:40am") replaced with words, and private operator names left out.

## Before submitting (root or owner)

* Attach the newest build to version 1.0.0. On 26 Oct the version page still has build 206; Calendar leave by needs 208 and the text names it. From 1 Nov, build 209.
* Apple Watch screenshots must be uploaded first (store/screenshots/README.md).
* If worker g22 ships alerts for saved trips or the Limited Stops tag before submission, add one line each under HOW TO TEST.
* If Platform view (`PLATFORM_VIEW` in app/src/lib/features.ts, off at the owner's request) is ever turned on by an over the air update after approval, that is a new feature: describe it in the notes of the next submitted version (guidelines 2.3.1(a) and 2.5.19).
* Submit only with the owner's written OK.

## Notes

Transport: Sydney Live shows live Sydney and NSW public transport times. It is free, with no accounts, sign in, ads or in-app purchases, so no demo account is needed. Every screen works from any location.

DATA SOURCE
Transport information comes from Transport for NSW Open Data, licensed under Creative Commons Attribution 4.0 (CC BY 4.0). The app credits it in More and in the description. It is an independent app by Fintex Australia Pty Ltd, not made or endorsed by Transport for NSW, and it uses no Transport for NSW logos.

HOW TO TEST
1. First launch: pick Parramatta as Home and Wynyard as Work. Home shows the next trip as a big card. Every time says Live (with its age), Timetable or Not tracking. If live data is unavailable, the app shows timetable times marked as such.
2. Plan: search Central for a departure board. Plan Chatswood to Bondi Junction with Leave now, Leave at or Arrive by. Step free avoids lifts that are out of service.
3. Buses: in Plan search route 333 for every stop with live buses, or a stop number from a stop sign for that stop's board.
4. Ask: type "next train Parramatta to Central" or "is the T1 late". Ask answers from live data by fixed rules. It does not use generative AI and does not connect people.
5. Start trip: open a trip and tap Start trip for a live map, the next stop, your arrival time and a Live Activity on the Lock Screen and in the Dynamic Island. Alerts come before your stop and at each change. Share trip makes a link that stops working when the trip ends.
6. Reminders: open a saved trip, Reminders, Add a reminder (local notifications). More > Check my trip before I go sends one alert only if something is wrong.
7. More > Delete all my data removes what the server keeps for this install and resets the app.

PERMISSIONS
Location: optional, asked only when you tap a location button (stops near you, plan from where you are, your position on the trip map). Foreground only, never in the background.
Notifications: never asked at launch. Asked the first time you turn on something that alerts: a reminder, watching a trip, Check my trip before I go, lift alerts or the alerts switch in More.
Calendar: only for Calendar leave by in More (off by default), read only.

SYSTEM FEATURES (set Home and Work first)
Live Activities: step 5.
Widgets: Edit the Home Screen, Add Widget, Transport. The Next trip widget has Refresh, Swap direction and Start buttons. Lock Screen and StandBy widgets show the next service.
Siri: "Next train home in Transport", "Next train to work in Transport", "When is my next train in Transport", "Start my commute in Transport".
Control Center (iOS 18 and later): Add a Control, search Transport.
Apple Watch: install Transport from the Watch app; complications are under Transport when editing a face.

SERVER DATA (guideline 2.5.19)
All of these are in this build and none is behind a setting or a code. Each shows when our server (api.transportsydney.app) has data for it: weekend trackwork on Home; status of my lines; Plan B in the morning check alert; how late a route usually runs at a stop; reliability ("left on time 9 of the last 10 weekdays"); a reminder before the last service home; when a Park and Ride usually fills; traffic incidents on bus legs; quieter carriages where occupancy is sent; live times for regional trains and coaches. Remote configuration can switch a feature off, change the server address, or send live boards over a WebSocket instead of polling (the same data). It cannot add features.

From about 1am to 4am many lines have no services.
