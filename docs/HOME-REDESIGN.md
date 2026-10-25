# Home redesign (shipped: Option A)

Bidur, 25 Oct 3:09 PM: "Home page looks clustered. Add buttons in middle of screen. Hard to find. Plan something better." Two options were shown at 3:43 PM (screenshots in `files/home-redesign/`); Bidur asked for a recommendation at 4:04 PM and Option A was picked. Option A is Home on `main` from the over the air update of 25 Oct, 4:34 PM (group 0b1d956d, docs/RELEASES.md). Option B and the `?design=` switch are gone. Before and after screenshots: `files/home-a-ship/`.

## Home now, top to bottom

Updated 25 Oct, evening: Bidur at 7:07 PM sent a mockup with "Yes commute should be main element here. Alerts should be minimized until open." and his own Home with "Ours look too much" (a Trip in progress bar, Watching now, "9 alerts on your trips" and a large trackwork card all sat above the commute card, which started halfway down).

1. Navigation bar: title Home, the live stamp (or Offline) and one Add button (plus icon) at the top right.
2. One slim bar, only when there is something live: "In transit · Central to Strathfield" with the line badge while a trip is in progress (opens the live trip), or "Watching · title · Departs in 5 min" for a single watched trip when nothing is in progress. A watch of the live trip is not shown again (`topBar` in src/lib/noticesCore.ts).
3. Next trip card (titled Your commute when Home and Work are set, else Next trip), drawn in the Line glow look (below): a big countdown, line badges, where to board, the live label, Why it's late (one line), leave and arrive with the journey time, "Next 12 min, 19 min", Plan B (one line). The countdown uses the normal text colour and turns red only once the service has gone or is cancelled (a late service keeps its orange status line). The commute card keeps the swap button; When to leave and Check before I go are small buttons at its foot, and the leave time with its bell is one line.
4. Notifications: a small header and one row of quiet chips (plain text with a small icon; trackwork's icon is orange, the text is not red) that scrolls sideways, all closed at first (components/Notices.tsx, `noticeChips` in noticesCore.ts). In order: a high priority alert by its first words (count when more), each line with a problem ("T4 Delays"), "9 trip alerts", "Trackwork this weekend" (count when more), "Watching 2 trips". A tap opens the chip's full text under the row, each line linking to Transport for NSW's page, the trip or the watch; a second tap closes it; one chip is open at a time.
5. Make this your commute (when suggested), Calendar leave by, Last way home, in that order.
6. Your trips: every other trip as a compact row, the drag handle to reorder, swipe to delete, Clear all in the section header.
7. Starred stops, then Nearby, as before.
8. No trips: "Save the trips you take" with a large Add a trip button.

Checked in the web build at 390 x 844 (light and dark) with Kings Cross to Strathfield (To home) and live data, a trip in progress and its watch, 9 trip alerts and weekend trackwork: the card sits at 192 to 387 px, so it is fully on screen. Before and after: `files/home-commute-hero-25oct/`.

## The card's look: Line glow (look B)

Bidur, 25 Oct 7:33 PM: "I think we need little shiny or metallic border and main card element here", then at 7:44 PM, of the dark Home: "Still not distinguished", and "Ok whatever you choose best". Three looks were built behind a development switch (A Titanium, B Line glow, C Glass; `files/home-commute-hero-25oct/variants/`) and B ships in the over the air update of 25 Oct, 8:34 PM (group c9a4913d, docs/RELEASES.md) (`SHIPPED_SKIN = 'line'` in src/lib/cardSkin.ts, the styles in `skinStyle` and `lineGlow` in src/lib/cardSkinCore.ts).

* Ring: 2 pt, running corner to corner between the next service's line colours in order, for example T4 blue into T1 orange, meeting in a light sheen so the middle is never a muddy mix. Three lines are three even stops; one line runs from its colour into silver; no known colour is silver only.
* Dark: a glow behind the card tinted with those colours (the first up and to the left, the last down and to the right, a soft halo in the first), and the card's surface lifted to #232326 from the #1C1C1E of the other cards (Android: its card colour 3% towards white). A faint highlight runs along the inside top edge.
* Light: the white card with a soft shadow and a faint tint of the first line colour.
* Every other card on Home stays flat.
* Reduce Transparency or Increase Contrast on iPhone, or High contrast text on Android: a solid 1.5 pt border in the first line colour, no ring, glow or highlight.
* Built from styles React Native already draws (a gradient background and box shadows): no native module, nothing animates, so it reaches builds 201 to 208 over the air. The countdown is 64 pt heavy in this look (56 pt in the plain card).
* In development the other looks stay switchable (`?card=plain`, `titanium` or `glass` on the web).

Checked in the web build at 390 x 844, light and dark, with Bidur's commute both ways and live data (`files/home-commute-hero-25oct/shipB/`): in dark the card clearly stands apart from the flat cards below it.

## Which trip is the Next trip card

Your commute (Home to Work before 12 pm, Work to Home after, unless swapped) when Home and Work are set. Otherwise the first trip in your order. Hold a row and choose Show first to make it the card; dragging rows never moves the card (`dragOrder` and `toFront` in src/lib/homeCore.ts).

## Add

The plus button offers New trip, Star a stop, Set (or Change) Home and Set (or Change) Work.

* iPhone: the system action sheet, opened from the plus button itself (anchored to it, so on iOS 26 and 27 it grows from the button). The same system sheet handles the trip and stop hold menus, Save this trip (Home or Work), the Recent rows in Plan and the menus in More and Ask; yes or no questions stay system alerts. The time picker and the trip reminder editor are still the app's own sheets (a native picker would need a native module). On iOS 26 and 27 the system draws the glass behind bar buttons, so the button is a plain plus icon (22 pt, tint colour), like the star on the trip screen, and shares the bar's glass with the live stamp.
* Android: a 48 dp top app bar action that opens the app's bottom sheet (components/Sheet.tsx). An Android dialog shows at most 3 buttons, so the 4 choices are not an alert. The web uses the same sheet (React Native web has no alerts).
* VoiceOver and TalkBack: "Add", with the hint "New trip, star a stop, or set Home or Work".

## What left the trip rows (still on the trip screen, one tap away)

The star on saved trips, the seats chip, the journey time, the third service and the per trip alert counts. The add home and add work tiles moved into Add.

## Delete and Undo

Swipe a row (or the Next trip card) and tap Delete, or hold and choose Delete trip, or use the VoiceOver action. The trip leaves Home at once and "Strathfield to Kings Cross deleted" with Undo shows above the tab bar for 5 seconds (TabBarSafe). The server copy of a saved trip is deleted only after the bar has gone, or straight away when the app goes to the background; Undo puts the trip and its place in your order back. The saved trip data format is unchanged, so widgets and the watch read the same list (`undoableDelete` in homeCore.ts).

## Hold menus on Android

Android dialogs drop all but the last 3 buttons, so when a hold menu has 3 actions the Cancel button gives way (tap outside or Back closes it). This also fixed the Home and Work menu, which lost Change home on Android.

## VoiceOver labels

* Order: the bar, the card, then the Notifications header and each chip. A chip reads its full alert text, "button", and expanded or collapsed, with the hint "Shows the details".
* Next trip card: "Strathfield to Kings Cross. 14 minutes, leaves 4:29 from Platform 2, 3 min late, Live, updated 20 s ago, arrives 4:56, T1 and T4. Next 25 min, 29 min", hint "Opens the trip with every service". One minute reads "1 minute".
* Row: the same, shorter, with the Reorder trip handle and the Delete action.

## Dynamic Type

Trip names wrap to two lines, the status and where to board wrap, the countdown chip grows with the text (capped at 1.3 times), and the card's big countdown is capped at 1.2 times so the badges and platform wrap under it instead of squeezing. Checked on the web with every font size 1.35 times larger (`files/home-a-ship/after-bigtext-390-dark.png`); not yet checked at the largest accessibility sizes on a phone.

## The title on the web preview

In the web preview expo-router draws the tabs as a floating pill fixed 24 px from the top, which covered the navigation bar title ("Hor" showed). That pill only exists on the web: on iPhone the tabs are the system tab bar at the bottom and on Android the Material bar at the bottom, so the title was never covered on a phone. The web header now starts below the pill (`WEB_PILL_CLEAR` in src/lib/headerOptions.ts). Phones keep the standard title: large titles stay off because iOS 26 drew them behind the blurred header (update 25 Oct, 8:22 AM).

## Not checked on a device yet

How the Line glow ring, glow and lifted surface look on an iPhone and an Android phone (the web build draws the same styles; the phones draw gradients and box shadows natively), the solid border with Reduce Transparency or Increase Contrast on, the action sheet anchored to the plus button on iOS 26 and 27. Also: the plus button inside the iOS 26 and 27 glass bar, the action sheet from it, the Android top app bar action and bottom sheet, the Undo bar above the floating tab bar after a delete, and VoiceOver reading the card.
