# App Review notes (App Store Connect > version > App Review Information)

Set through the API on 25 Oct 2026 for build 201 (Expo). Contact: Bidur Khatri, contact@fintex.au, [redacted-phone]. Sign in required: No.

Transport: Sydney Live shows live Sydney and New South Wales public transport times from Transport for NSW open data (CC BY 4.0). There are no accounts and no sign in, so no demo account is needed. Every screen works from any location.

How to test:
1. First launch: type Strathfield as the home station and pick it, then Town Hall as the work station. Home shows the commute card with the next services and live countdowns. Tap a service to see its stops.
2. Plan tab: search Central and open Central Station for a live departure board. Swipe left on a departure to watch it (allow notifications when asked); Watching in More lists it. Plan a trip between two stations; Step free plans a trip that avoids stairs and shows lift outages.
3. Ask tab: type "next train Burwood to Central" or "is the T1 late". Ask answers from live timetable data with fixed rules. It does not connect people and does not use generative AI.
4. Start trip: open a trip and tap Start trip. The live screen shows a map, the next stop, stops left and the arrival time, and the same trip appears as a Live Activity on the Lock Screen. Share trip makes a link that people you send it to can open to follow the trip. The link stops working when the trip ends.
5. Check my trip before I go: More > Check my trip before I go. Set a leave time and days; Check now shows what the alert would say.
6. Widgets: long press the Home Screen, tap Edit, Add Widget, Transport, then Edit Widget to pick a stop or trip.
7. More > Delete all my data removes everything the server keeps for this install and resets the app.

Location is optional and is asked for only when you tap Show stops near me, Use my location in Ask, or the location button on a live trip. For nearby stops and trip planning the position is sent for that one request and is not stored. If you choose Include my location when sharing a trip, the server keeps the latest position only while the shared trip is live (at most 6 hours). Location is never used in the background.

Live times depend on the Transport for NSW feeds. Late at night (about 1am to 4am Sydney time) many lines have no services, so boards can be short.

Published by Fintex Australia Pty Ltd. Transport: Sydney Live is an independent app, not made or endorsed by Transport for NSW.
