# Home redesign (shipped: Option A)

Bidur, 25 Oct 3:09 PM: "Home page looks clustered. Add buttons in middle of screen. Hard to find. Plan something better." Two options were shown at 3:43 PM (screenshots in `files/home-redesign/`); Bidur asked for a recommendation at 4:04 PM and Option A was picked. Option A is Home on `main` from the over the air update of 25 Oct, 4:34 PM (group 0b1d956d, docs/RELEASES.md). Option B and the `?design=` switch are gone. Before and after screenshots: `files/home-a-ship/`.

## Home now, top to bottom

1. Navigation bar: title Home, the live stamp (or Offline) and one Add button (plus icon) at the top right.
2. Trip in progress bar, the high priority alert banner, Watching now, and the commute suggestion, each only when there is one.
3. Alerts on your trips: one line, "6 alerts on your trips", that opens in place to list them. Last train home, weekend trackwork and line status: one card or line each, only when something is on.
4. Next trip card (titled Your commute when Home and Work are set, else Next trip): a big countdown, line badges, where to board (Platform 2; for a bus the stand and stop number, Stand X1, Stop 213723), the live label (3 min late, Live, updated 20 s ago; Timetable; Not tracking), leave and arrive with the journey time, and "Then 12, 19 min". The commute card keeps the swap button and the leave time and morning check lines.
5. Your trips: every other trip as a compact row (name; badges, status and where to board; the next two times; the countdown at the right edge), the drag handle to reorder, swipe to delete, Clear all in the section header.
6. Starred stops, then Nearby, as before.
7. No trips: "Save the trips you take" with a large Add a trip button.

## Which trip is the Next trip card

Your commute (Home to Work before 12 pm, Work to Home after, unless swapped) when Home and Work are set. Otherwise the first trip in your order. Hold a row and choose Show first to make it the card; dragging rows never moves the card (`dragOrder` and `toFront` in src/lib/homeCore.ts).

## Add

The plus button offers New trip, Star a stop, Set (or Change) Home and Set (or Change) Work.

* iPhone: the system action sheet. On iOS 26 and 27 the system draws the glass behind bar buttons, so the button is a plain plus icon (22 pt, tint colour), like the star on the trip screen, and shares the bar's glass with the live stamp.
* Android: a 48 dp top app bar action that opens the app's bottom sheet (components/Sheet.tsx). An Android dialog shows at most 3 buttons, so the 4 choices are not an alert. The web uses the same sheet (React Native web has no alerts).
* VoiceOver and TalkBack: "Add", with the hint "New trip, star a stop, or set Home or Work".

## What left the trip rows (still on the trip screen, one tap away)

The star on saved trips, the seats chip, the journey time, the third service and the per trip alert counts. The add home and add work tiles moved into Add.

## Delete and Undo

Swipe a row (or the Next trip card) and tap Delete, or hold and choose Delete trip, or use the VoiceOver action. The trip leaves Home at once and "Strathfield to Kings Cross deleted" with Undo shows above the tab bar for 5 seconds (TabBarSafe). The server copy of a saved trip is deleted only after the bar has gone, or straight away when the app goes to the background; Undo puts the trip and its place in your order back. The saved trip data format is unchanged, so widgets and the watch read the same list (`undoableDelete` in homeCore.ts).

## Hold menus on Android

Android dialogs drop all but the last 3 buttons, so when a hold menu has 3 actions the Cancel button gives way (tap outside or Back closes it). This also fixed the Home and Work menu, which lost Change home on Android.

## VoiceOver labels

* Next trip card: "Strathfield to Kings Cross. 14 minutes, leaves 4:29 from Platform 2, 3 min late, Live, updated 20 s ago, arrives 4:56, T1 and T4. Then 25, 29 min", hint "Opens the trip with every service".
* Row: the same, shorter, with the Reorder trip handle and the Delete action.

## Dynamic Type

Trip names wrap to two lines, the status and where to board wrap, the countdown chip grows with the text (capped at 1.3 times), and the card's big countdown is capped at 1.2 times so the badges and platform wrap under it instead of squeezing. Checked on the web with every font size 1.35 times larger (`files/home-a-ship/after-bigtext-390-dark.png`); not yet checked at the largest accessibility sizes on a phone.

## Not checked on a device yet

The plus button inside the iOS 26 and 27 glass bar, the action sheet from it, the Android top app bar action and bottom sheet, the Undo bar above the floating tab bar after a delete, and VoiceOver reading the card.
