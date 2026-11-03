# iPhone store screenshots (uploaded to App Store Connect)

iphone-6.9 and iphone-6.5: reshot on 3 Nov 2026 from the iOS Simulator (owner, 3:56 PM: "Reshoot from sim"). The real app, build-215-rc code with its JavaScript bundle, compiled for the simulator only (Release, unsigned, updates off; no archive, no upload, no version bump), on a GitHub Mac (Xcode 27.1, iOS 27.0), live data from production (api.transportsydney.app), light mode, status bar set to 9:41 with full signal and battery. Maestro tapped what a person taps (set up Home Parramatta and Work Wynyard, the Trains filter, typing in Ask). The 6.9 inch set was taken 5:41 to 5:48 PM on an iPhone 17 Pro Max simulator, the 6.5 inch set 6:07 to 6:17 PM on an iPhone 14 Plus simulator. Both replaced the 27 Oct web export sets in App Store Connect (en-AU, version 1.0.0), processed Complete. The throwaway harness lived on branch iphone-shots-3nov (deleted).

iphone-duo: still the 27 Oct web export shots below. The iPhone Duo simulator opens folded only, so its open (inner) screen cannot be shot there.

| Folder | Size | App Store Connect set |
| --- | --- | --- |
| iphone-6.9 | 1320 x 2868 | APP_IPHONE_67 (iPhone 6.9 inch), en-AU, 1.0.0, uploaded 3 Nov (simulator) |
| iphone-6.5 | 1284 x 2778 | APP_IPHONE_65 (iPhone 6.5 inch), en-AU, 1.0.0, uploaded 3 Nov (simulator) |
| iphone-duo (inner-*) | 2007 x 2853 (669 x 951 points, scale 3) | APP_IPHONE_DUO, open (inner display), first five in the set, en-AU, 1.0.0, uploaded 27 Oct (web export) |
| iphone-duo (outer-*) | 1398 x 2034 (466 x 678 points, scale 3) | APP_IPHONE_DUO, closed (outer display), last five in the set, en-AU, 1.0.0, uploaded 27 Oct (web export) |

Screens: 01 Home (home Parramatta, work Wynyard, phone placed at Bondi Junction), 02 Town Hall departures (Trains), 03 Parramatta to Bondi Junction trip, 04 Ask "next train Parramatta to Central", 05 Check my trip before I go. No owner stations, no personal data.

## 27 Oct web export (the Duo set, and the earlier iPhone sets)

Reshot on 27 Oct 2026 between 4:33 and 4:42 AM Sydney with live data from production (api.transportsydney.app), light mode, from the web export of main 108a512, by app/test/e2e/store-shots.mjs. These replace the 25 Oct sets, which showed the owner's own stations.

| Folder | Size | App Store Connect set |
| --- | --- | --- |
| iphone-6.9 | 1320 x 2868 | APP_IPHONE_67 (iPhone 6.9 inch), en-AU, 1.0.0, uploaded 27 Oct |
| iphone-6.5 | 1284 x 2778 | APP_IPHONE_65 (iPhone 6.5 inch), en-AU, 1.0.0, uploaded 27 Oct |
| iphone-duo (inner-*) | 2007 x 2853 (669 x 951 points, scale 3) | APP_IPHONE_DUO, open (inner display), first five in the set, en-AU, 1.0.0, uploaded 27 Oct |
| iphone-duo (outer-*) | 1398 x 2034 (466 x 678 points, scale 3) | APP_IPHONE_DUO, closed (outer display), last five in the set, en-AU, 1.0.0, uploaded 27 Oct |

Screens: 01 Home (home Parramatta, work Wynyard, phone placed at Bondi Junction), 02 Town Hall departures (Trains), 03 Parramatta to Bondi Junction trip, 04 Ask "next train Parramatta to Central", 05 Check my trip before I go. No owner stations, no personal data.

Commands (web export served as a single page app on PORT):

    GEO_LAT=-33.8915 GEO_LON=151.2477 BOARD='/stop/200070?name=Town%20Hall%20Station' BOARD_FILTER=Trains \
    TRIP='/trip?from=215020&fromName=Parramatta+Station&to=202210&toName=Bondi+Junction+Station' \
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 440 956 3 light ios   # 6.9 inch
    (same with 428 926 for 6.5 inch, 669 951 for iPhone Duo inner and 466 678 for iPhone Duo outer)

Why these choices: with the phone placed at Parramatta, Nearby listed a T2 service "via Strathfield"; Central's board carried a Transport for NSW notice worded "Temporary timetable changes for testing"; Wynyard's board showed a Stand G bus. Town Hall with the Trains filter and a Parramatta to Bondi Junction trip showed none of these.

iPhone Duo: reshot on 27 Oct between 4:52 and 4:55 AM Sydney with the same commands and settings from the web export of main e8c6ff3. The outer 02 departures shot was retaken once because its first take caught the board before live times loaded (three rows read Not tracking). An App Store Connect set takes at most 10 screenshots, so the 25 Oct files were swapped one for one.
