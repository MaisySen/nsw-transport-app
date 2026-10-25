# Home redesign proposal (branch home-redesign, not shipped)

Bidur, 25 Oct 3:09 PM: "Home page looks clustered. Add buttons in middle of screen. Hard to find. Plan something better."

Both options run on the real app code with live data. On this branch open `/home?design=a` or `/home?design=b` in the web preview; without the parameter Home is unchanged, so the branch is safe to merge and switch later. Screenshots (390 x 844, light and dark, Expo web, the floating tab bar drawn in the screenshot to match the iPhone): `files/home-redesign/`. Today's Home for comparison: `current-home-390-*.png`.

## What is cluttered today (from the current screenshots)

* Each saved trip is a card with three full service rows (countdown, times, status, platform, duration, seats chip, badges). Three trips fill about three screens.
* "6 alerts", "9 alerts" under every trip, repeating the same alerts.
* The only Add is a small button in the middle of the page (the Your trips section header, next to Clear all), so it moves as cards load and sits under other content.
* Add home and Add work tiles in the middle of the list, a star on every saved trip (they are all saved), Clear all next to Add.

## Shared by both options

* One Add, always in the same place: a plus button in the navigation bar, top right, as in Apple's own apps (HIG: the primary action of a screen goes in the toolbar). It offers New trip, Star a stop, Set or change Home, Set or change Work. On Android the same menu (Material 3 top app bar action).
* Empty Home: one centred card, "Save the trips you take" with a large Add a trip button.
* Alerts collapsed into one line at the top, "N alerts on your trips", which opens in place to list them. Line status and trackwork stay as they are (one line each, only when something is on).
* Removed from the trip list: the star on saved trips, the seats chip, journey duration, the third service and the per trip alert counts. All of it is still on the trip screen, one tap away.
* Moved: Add home and Add work into the plus menu; Clear all into a later Edit mode (swipe to delete and long press stay).
* Same badge style as the rest of the app, countdown colours unchanged (red 3 min or less, amber 4 to 9, green 10 plus).

## Option A: Next trip, then a short list (files option-a-*)

* "Next trip" card at the top, TripView style: a big countdown (56 pt), platform, line badges, status, leave and arrive, and "Then 11, 18 min". It is your commute when one is set for this half of the day, otherwise the first trip in your order.
* "Your trips": every other trip as one compact row (name; badges, status and platform; "Then 8, 11 min"), the next countdown at the right, drag handle kept.
* Starred stops and Nearby below, as today.
* Best for: one main trip you check every day. One glance answers "how long until my train and which platform".

## Option B: One list at a time (files option-b-*)

* A segmented control under the title: Trips, Stops, Nearby. Only one list is on screen, so Home is never longer than your trips.
* Every trip is the same card: name, then the next three departures as countdown chips (the first one larger), badges, status, platform, leave and arrive. No hero, every trip looks the same.
* Best for: several trips of equal weight (both directions of a commute, a bus and a train). Closest to TripView's list.
* On iPhone the segmented control is the iOS one; the web preview shows the Android (Material 3) style.

## Recommendation

Option A. It answers the question people open the app for in the first second and keeps everything on one scroll. With the same three trips, one starred stop and Nearby, Home is 1027 pt tall instead of 1615 pt today (full page at 390 pt wide, measured from the screenshots); Option B's Trips list fits on one screen (844 pt). Option B is a good fallback if Bidur prefers equal cards.

## Not done yet (after a pick)

* The chosen option becomes the default; the other is removed with the `design` switch.
* Edit mode for Clear all and reordering without the drag handle.
* VoiceOver pass on the new rows (labels are written: name, countdown, platform, status, then times).
* Not seen on an iPhone yet.
