# Store screenshots

Made on 25 Oct 2026 from the Expo app (main at 7bc7ac3) with live data, light mode, by test/e2e/store-shots.mjs on the web export. The web export draws the same screens as the phones; there is no status bar and the bottom tab bar is not drawn on the web.

| Folder | Size | Look | Store |
| --- | --- | --- | --- |
| apple-6.9 | 1320 x 2868 | iPhone | App Store, iPhone 6.9 inch (uploaded) |
| apple-6.5 | 1284 x 2778 | iPhone | App Store, iPhone 6.5 inch (uploaded) |
| apple-duo-inner | 2007 x 2853 | iPhone Duo, open (inner display) | App Store, iPhone Duo (uploaded 25 Oct 2026, first five in the set) |
| apple-duo-outer | 1398 x 2034 | iPhone Duo, closed (outer display) | App Store, iPhone Duo (uploaded 25 Oct 2026, last five in the set) |
| play | 1080 x 2160 | Android | Google Play phone screenshots, plus feature-graphic.png (1024 x 500) and icon-512.png |

Screens: 01 Home with the commute card (home Burwood, work Strathfield), 02 Central departures, 03 Central to Parramatta trip, 04 Ask "next train Strathfield to Kings Cross", 05 Check my trip before I go. On the iPhone shots of screen 05 the web only note about notifications is hidden, because an iPhone with notifications on does not show it; the Android shot keeps its note, which is true for versionCode 5.

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
