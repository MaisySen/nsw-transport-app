# iPhone store screenshots (uploaded to App Store Connect)

Reshot on 27 Oct 2026 between 4:33 and 4:42 AM Sydney with live data from production (api.transportsydney.app), light mode, from the web export of main 108a512, by app/test/e2e/store-shots.mjs. These replace the 25 Oct sets, which showed the owner's own stations.

| Folder | Size | App Store Connect set |
| --- | --- | --- |
| iphone-6.9 | 1320 x 2868 | APP_IPHONE_67 (iPhone 6.9 inch), en-AU, 1.0.0, uploaded 27 Oct |
| iphone-6.5 | 1284 x 2778 | APP_IPHONE_65 (iPhone 6.5 inch), en-AU, 1.0.0, uploaded 27 Oct |

Screens: 01 Home (home Parramatta, work Wynyard, phone placed at Bondi Junction), 02 Town Hall departures (Trains), 03 Parramatta to Bondi Junction trip, 04 Ask "next train Parramatta to Central", 05 Check my trip before I go. No owner stations, no personal data.

Commands (web export served as a single page app on PORT):

    GEO_LAT=-33.8915 GEO_LON=151.2477 BOARD='/stop/200070?name=Town%20Hall%20Station' BOARD_FILTER=Trains \
    TRIP='/trip?from=215020&fromName=Parramatta+Station&to=202210&toName=Bondi+Junction+Station' \
    STEPS='["home","board","trip","ask","morning"]' node test/e2e/store-shots.mjs PORT OUTDIR 440 956 3 light ios   # 6.9 inch
    (same with 428 926 for 6.5 inch)

Why these choices: with the phone placed at Parramatta, Nearby listed a T2 service "via Strathfield"; Central's board carried a Transport for NSW notice worded "Temporary timetable changes for testing"; Wynyard's board showed a Stand G bus. Town Hall with the Trains filter and a Parramatta to Bondi Junction trip showed none of these.
