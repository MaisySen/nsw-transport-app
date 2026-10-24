# Browser checks on the web export

Build the web export with the Android look and serve it as a single page app:

    EXPO_PUBLIC_LOOK=android npx expo export --platform web --output-dir dist-web
    (serve dist-web on a port, every unknown path returning index.html)

Then, with Playwright installed (`playwright-core` and a Chrome; set CHROME to its path):

- `node test/e2e/buttons.mjs out.json PORT` starts like a first launch (the home and work setup, then the commute card, its swap, Leave in and Remind me), then Check my trip before I go from the commute card (time, days, lead, save, Check now, edit, delete), then taps each main button once (bottom tabs, Step free on Plan and on the trip, occupancy chips against the live feed, Opal fare, Later services, Include trips with a change, a service row, Start trip, Share trip, End trip, Save trip, star a stop, More rows, a menu sheet choice, the About rows for Fintex, the Opal machines list and filter) and checks it acted on the first tap.
- `node test/e2e/mapscroll.mjs PORT` checks that the map on the Opal machines page does not trap the page scroll (no wheel zoom on the embedded map, + and - buttons instead) and that the page scrolls on and off the map.
- `AXE=<path to axe.min.js> node test/e2e/a11y.mjs OUT PORT` runs axe (WCAG 2.1 A and AA) on every main screen in light and dark, and lists tappable things smaller than 48 by 48 (on the web hit slop is not counted, so header icons with a 13 dp slop and the web tab bar show up there; on Android the native tab bar is 80 dp tall).
- `node test/e2e/live-replay.mjs OUT light PORT Burwood "Burwood Station" Strathfield "Strathfield Station"` plans a real short trip, taps Start trip, then moves a fake clock through boarding, the stop, arrival and 15 minutes past it. Each stage is screenshotted and every alert, ongoing notification change and the trip end is written to OUT/replay.json. Set NOWATCH=1 to run with phone side alerts instead of the server watch. Set WAKE=1 to turn on Wake me before my stop after Start trip: the phone's alarms are simulated in the page, and replay.json shows when the alarm was set, moved and rang.
- `node test/e2e/missed.mjs OUT light|dark PORT` seeds a live trip Ashfield to Kings Cross with a change at Redfern, makes the first train 8 min late so the T4 is missed, checks the next option card (from the real /api/plan) and Switch to this.

The unit replay in `test/livereplay.test.mjs` covers the same stages with a fake feed and runs with the other tests.
