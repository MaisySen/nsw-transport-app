# Browser checks on the web export

Build the web export with the Android look and serve it as a single page app:

    EXPO_PUBLIC_LOOK=android npx expo export --platform web --output-dir dist-web
    (serve dist-web on a port, every unknown path returning index.html)

Then, with Playwright installed (`playwright-core` and a Chrome; set CHROME to its path):

- `node test/e2e/buttons.mjs out.json PORT` taps each main button once (bottom tabs, Opal fare, Later services, Include trips with a change, a service row, Start trip, Share trip, End trip, Save trip, star a stop, More rows) and checks it acted on the first tap.
- `node test/e2e/live-replay.mjs OUT light PORT Burwood "Burwood Station" Strathfield "Strathfield Station"` plans a real short trip, taps Start trip, then moves a fake clock through boarding, the stop, arrival and 15 minutes past it. Each stage is screenshotted and every alert, ongoing notification change and the trip end is written to OUT/replay.json. Set NOWATCH=1 to run with phone side alerts instead of the server watch.

The unit replay in `test/livereplay.test.mjs` covers the same stages with a fake feed and runs with the other tests.
