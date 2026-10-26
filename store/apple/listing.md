# App Store listing (App Store Connect)

Set in App Store Connect through the API on 25 Oct 2026 (app 6826543653, version 1.0.0). This file is the source; if you change a text here, change it there too.

26 Oct 2026, 5:50 PM (g25): checked for other app names and Transport for NSW branding. No other app is named anywhere in the listing. Three changes, written to App Store Connect (en-AU, the only localization) through the API and read back (match): "an Opal fare estimate" is now "a fare estimate", "Opal machines near you" is now "card top up machines near you" (Opal is a Transport for NSW brand), and the Ask example is "next train Parramatta to Central". Name, subtitle, promotional text and keywords were already clean and are unchanged. The attribution line ("Contains transport information from Transport for NSW Open Data, licensed under CC BY 4.0 ... not made or endorsed by Transport for NSW") stays: CC BY 4.0 requires the credit, and it is a credit, not branding.

## App information

* Name (30 max): Transport: Sydney Live
* Subtitle (30 max): Trains, buses, metro, ferries
* Bundle ID: com.maisysen.nswtransport
* SKU: nswtransport-ios-1
* Primary language: English (Australia)
* Primary category: Navigation
* Secondary category: Travel
* Content rights: Uses third party content (Transport for NSW Open Data, CC BY 4.0), with the rights to use it.
* Age rating: 4+ (every item None or No, see age-rating.md)
* Price: Free. No in-app purchases. No ads.
* Availability: Australia only
* Copyright: 2026 Fintex Australia Pty Ltd
* Export compliance: standard HTTPS only. ios.config.usesNonExemptEncryption is false in app.json, so builds carry ITSAppUsesNonExemptEncryption false and App Store Connect asks nothing.

## URLs

* Support URL: https://transportsydney.app/support/
* Marketing URL: https://transportsydney.app/
* Privacy policy URL: https://transportsydney.app/privacy/

## Promotional text (170 max)

Live times for trains, metro, buses, light rail and ferries. Your next trip first, honest live labels, bus stop numbers, reminders on your days. No ads.

## Description (4000 max)

Live Sydney and NSW public transport for iPhone. Trains, metro, buses, light rail and ferries, with live times for when each service leaves.

YOUR NEXT TRIP FIRST
Add home and work once. Home opens on your next trip as one big card: the countdown, line, platform or stand, whether it is late, and the next two times. Your other trips sit below as slim rows, and one + adds a trip or a stop.

TIMES YOU CAN TRUST
Every countdown says where it comes from: Live with how fresh it is, Timetable when a service sends no live data, or Not tracking when a bus stops reporting. A bus that never came is never marked as left.

BUSES DONE PROPERLY
Search the stop number on the sign or a route number. See every stop on a route with its stop number and the live buses along it, filter a stop's board by route, see what recently departed, and get GET ON and GET OFF on your two stops.

PLAN ANY TRIP
Trips with changes, leave and arrive times, a fare estimate, and earlier and later services. Step free trips avoid lifts that are out of service.

FOLLOW YOUR TRIP
Tap Start trip to follow it on a live map with the next stop, stops left and your arrival time, also on the Lock Screen and in the Dynamic Island. Get an alert before your stop and at each change. Speak alerts can read them out loud. Share trip sends a link others can open; it stops working when the trip ends.

REMINDERS ON YOUR DAYS
Add several reminders to a saved trip, each at its own time on the weekdays you pick. They ring with the app closed.

CHECK MY TRIP BEFORE I GO
Set your usual leave time and days. Before your trip you get one alert, only if something is wrong: a delay, a cancellation, trackwork, a platform change or a lift out of service.

WATCH A SERVICE
Swipe left on a departure to watch it. Transport alerts you when it is time to leave, if it runs late or if the platform changes.

WIDGETS, SIRI AND APPLE WATCH
Home Screen, Lock Screen and StandBy widgets for a stop or trip you choose. Ask Siri "Next train home in Transport". Control Center buttons, and an Apple Watch app with complications.

ASK
Type a question like "next train Parramatta to Central", "is the T1 late" or "last train home" and get a short answer with live times you can tap.

MORE
Live free spaces at Park and Ride car parks, and card top up machines near you.

NO ACCOUNT
No sign up, no ads, no tracking. Saved trips belong to a random ID made on your phone, and Delete all my data in More removes them.

Contains transport information from Transport for NSW Open Data, licensed under CC BY 4.0. Map data from OpenStreetMap contributors. Transport: Sydney Live is an independent app by Fintex Australia Pty Ltd. It is not made or endorsed by Transport for NSW.

## Keywords (100 max, commas, no spaces)

train,bus,ferry,metro,light rail,timetable,departures,trip planner,nsw,commute,widget,platform,delay

## What's New

App Store: not shown for the first version (1.0.0).

## TestFlight What to Test (build 207)

Set on build 207 in App Store Connect (en-AU and en-US) on 25 Oct, 6:17 PM, exactly as below:

```
New in build 207:
- Apple Watch: redesigned app and new complications. Install from the Watch app on your iPhone. Swap direction and Refresh are at the end of the trip list.
- Bus stop widgets show the stop number. Edit Widget lists your starred bus stops with their stop numbers and routes.
- Speak alerts now talk with Silent mode on, and lower your music while they speak.
- New app icon for iOS 26.
Also in this build, from the updates since 206: the Next trip card on Home, Live, Timetable and Not tracking labels, bus routes and stop numbers, bus stop boards with Recently departed, trip reminders by weekday, Plan B when your line has a problem, Last way home reminder, weekend trackwork heads up, why a service is late, the full screen departure board, and trip mode chips (Train, Bus and more) with an endless list and a Leave at or Arrive by time.
Please check: the watch app and complications, a bus stop widget, Speak alerts with Silent mode on, and the icon on the Home Screen. Feedback: support@transportsydney.app
```

## Screenshots

Made from the Expo app's web export with live data, light mode (store/screenshots/README.md says how, and what is still open):

* iPhone 6.9 inch (1320 x 2868): screenshots/apple-6.9/, uploaded (set APP_IPHONE_67)
* iPhone 6.5 inch (1284 x 2778): screenshots/apple-6.5/, uploaded (set APP_IPHONE_65)
* iPhone Duo: uploaded (set APP_IPHONE_DUO)
* iPad: not needed (supportsTablet false, iPhone only)
* Apple Watch: required, because builds 206 and later carry the Watch app, and not made yet (no set in App Store Connect on 26 Oct). See store/screenshots/README.md

Order: 01 Home with the commute card, 02 Central departures, 03 a trip, 04 Ask, 05 Check my trip before I go.
