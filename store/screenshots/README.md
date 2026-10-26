# Store screenshots

## Status (27 Oct 2026, 4:50 AM)

The iPhone 6.9 and 6.5 inch sets were reshot on 27 Oct with live data and no owner stations, uploaded to App Store Connect in place of the 25 Oct sets, and moved to [../apple/screenshots/](../apple/screenshots/). The iPhone Duo and Play sets below are still the 25 Oct ones.

## Status (26 Oct 2026, 5:50 PM, g25)

| Set | Required | State |
| --- | --- | --- |
| iPhone 6.9 inch, 1320 x 2868 (`APP_IPHONE_67` in App Store Connect) | Yes | 5 uploaded, light, live data, reshot 27 Oct without owner stations: [../apple/screenshots/](../apple/screenshots/) |
| iPhone 6.5 inch, 1284 x 2778 (`APP_IPHONE_65`) | Only used if 6.9 is missing; kept anyway | 5 uploaded, light, reshot 27 Oct: [../apple/screenshots/](../apple/screenshots/) |
| iPhone Duo (`APP_IPHONE_DUO`) | From April 2027 | 10 uploaded, 25 Oct |
| iPad | No: `supportsTablet` false, iPhone only | none |
| Apple Watch | **Yes**, builds 206 and later carry the Watch app | **None yet.** App Store Connect will not take the submission without at least one |

The uploaded iPhone shots are valid and light. Two things are worth a reshoot before submission, both root or owner decisions:

1. They show the owner's own commute: Home is Burwood to Strathfield and the Ask screen asks "next train Strathfield to Kings Cross". Public store images then show his home and work stations. `test/e2e/store-shots.mjs` now defaults to NSW wide examples (Home Parramatta, Work Wynyard, the board at Central, a Chatswood to Bondi Junction trip, Ask "next train Parramatta to Central").
2. A reshoot needs live data, which needs the production NSW key: not before 11 PM by the owner's rule, and the key is over quota until about 1 AM. Few services run from 1 to 4 AM, so the first useful window is about 4:30 to 5 AM on 27 Oct (inside the 11 PM to 5 AM test window), or a later night with the root's OK. Not done in this pass. The commands are below; they make about 30 server requests.

Apple Watch screenshots cannot be made on this Linux box (the Watch app is SwiftUI; there is no watchOS simulator here). Two ways:

* **Owner, about 5 minutes:** on the iPhone, Watch app > General > Enable Screenshots. On the watch with Transport (build 207 or 208), open the commute, a starred stop and a trip in progress, and press the side button and the Digital Crown together on each. They land in the iPhone's Photos at the watch's own size (for example 422 x 514 on Ultra, 416 x 496 on a 46 mm Series 10 or 11), which App Store Connect accepts as they are. Send 3 to 5 to the assistant, which uploads them to a new Apple Watch set after the root's OK.
* **CI:** a macOS GitHub Actions job that builds the Watch target for the simulator and captures it with `xcrun simctl io booted screenshot`. Not built (it needs an Expo prebuild of the native project and live data at the same time; it is not an EAS build and ships nothing).


Made on 25 Oct 2026 from the Expo app (main at 7bc7ac3) with live data, light mode, by test/e2e/store-shots.mjs on the web export. The web export draws the same screens as the phones; there is no status bar and the bottom tab bar is not drawn on the web.

| Folder | Size | Look | Store |
| --- | --- | --- | --- |
| ../apple/screenshots/iphone-6.9 | 1320 x 2868 | iPhone | App Store, iPhone 6.9 inch (uploaded 27 Oct) |
| ../apple/screenshots/iphone-6.5 | 1284 x 2778 | iPhone | App Store, iPhone 6.5 inch (uploaded 27 Oct) |
| apple-duo-inner | 2007 x 2853 | iPhone Duo, open (inner display) | App Store, iPhone Duo (uploaded 25 Oct 2026, first five in the set) |
| apple-duo-outer | 1398 x 2034 | iPhone Duo, closed (outer display) | App Store, iPhone Duo (uploaded 25 Oct 2026, last five in the set) |
| play | 1080 x 2160 | Android | Google Play phone screenshots, plus feature-graphic.png (1024 x 500) and icon-512.png |

Screens in the uploaded set (25 Oct): 01 Home with the commute card (home Burwood, work Strathfield), 02 Central departures, 03 Central to Parramatta trip, 04 Ask "next train Strathfield to Kings Cross", 05 Check my trip before I go. A reshoot with today's script gives: 01 Home (home Parramatta, work Wynyard), 02 Central departures, 03 Chatswood to Bondi Junction, 04 Ask "next train Parramatta to Central", 05 Check my trip before I go. Set HOME_Q, WORK_Q, TRIP or ASKQ to change them. On the iPhone shots of screen 05 the web only note about notifications is hidden, because an iPhone with notifications on does not show it; the Android shot keeps its note, which is true for versionCode 5.

To make them again:

    cd app
    npx expo export --platform web --output-dir /tmp/web-ios
    EXPO_PUBLIC_LOOK=android npx expo export --platform web --output-dir /tmp/web-android
    (serve each as a single page app, unknown paths return index.html)
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 440 956 3 light ios       # 6.9 inch
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 428 926 3 light ios       # 6.5 inch
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 360 720 3 light android   # Play

iPhone Duo (25 Oct 2026, main at cc20371, live data, light mode): the same five screens from the same web export, at 669 x 951 points (inner display) and 466 x 678 points (outer display), scale 3.
App Store Connect accepts both sizes in one iPhone Duo set (display type APP_IPHONE_DUO; Apple's API reference does not list it yet, but the API created the set and took all ten files).
Apple requires iPhone Duo screenshots for every app built with the iOS 27.1 SDK or later from April 2027.

    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 669 951 3 light ios   # iPhone Duo inner
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 466 678 3 light ios   # iPhone Duo outer
