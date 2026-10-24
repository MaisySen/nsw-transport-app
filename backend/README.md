# Transport Bot

Live Sydney and NSW public transport in your pocket: live departure boards, live vehicle tracking on a map, and trip planning with live leave-in countdowns. Built in the spirit of the old Transport for NSW "Transport Bot" on Messenger, with the live feel of the Opal Travel app and TripView.

Live at **https://nsw-transport-bot.sites.tab.bot**

## Native app (v4)

The Android and iPhone app lives in the private repo MaisySen/nsw-transport-app (folder `app/`). Download page: https://nsw-transport-bot.sites.tab.bot/download/

| New endpoint | What it does |
| --- | --- |
| `POST /api/push/expo` | Saves an Expo push token for a device (native app alerts) |
| `POST /api/push/expo/unregister` | Removes one |
| `GET /api/app` | Latest Android APK (size, version) and the Expo Go link |
| `GET /download/transport.apk` | The Android APK, served from R2 (binding `FILES`) with range support |
| `PUT /api/admin/file?key=ADMIN_KEY&name=transport.apk` | Uploads a new APK into R2 |

Every alert now goes to Web Push subscriptions and Expo push tokens for the device. `/download/` and `/privacy/` are static pages.

## What is new in v3: it comes to you

* **Watch any trip.** Swipe left on any departure, or tap Watch on a trip or on the live map. The server follows it every minute and sends real phone notifications (Web Push): "Leave now: your T4 is 6 min away, on time", "Now 8 min late", "Platform changed to 3", "Cancelled, next one at 7:57", "Arriving at Central in 2 min". Watches end on their own when the trip ends.
* **Connection rescue.** On a trip with a change, if a late leg means you will miss the next one, it replans the rest live and tells you: "Connection at risk: your T9 is 7 late, you'll miss the 8:31am T4. Take the 8:41am T4 from Platform 11. Gets you in at 8:57am."
* **Commute memory.** Search or watch the same trip at a similar time on two days and Home offers "Make this your morning trip?". A commute gets a heads up about 30 minutes before (only when something is wrong: delays, serious alerts, a tight change), then a leave now alert for the best trip near your usual time, and that trip is then followed until you arrive. Times, days and on or off are editable in Settings.
* **Honest predictions.** Live times are recorded at busy stations and your stops every few minutes. Once a service has 5 or more recorded trips around the same time of day (weekdays and weekends kept apart), it shows its usual delay, for example "usually 4 min late", always marked as a prediction with how many trips it comes from, never as live.
* **A real app.** Installable PWA (manifest, icons, offline shell, standalone), redesigned to feel like iOS: large titles, grouped lists, a tab bar (Home, Search, Watching, Settings), the live map in a pull up sheet, swipe actions, full light and dark mode. Home shows your commute and watched trips first.

### Install on a phone

* iPhone (iOS 16.4 or later): open the link in Safari, tap Share, then Add to Home Screen. Open Transport from the Home Screen, then tap Turn On Alerts. Notifications on iPhone only work from the Home Screen app.
* Android: open the link in Chrome, tap Install app (or menu, Add to Home screen), then Turn On Alerts.

### How the proactive layer works

* `GET /api/tick?key=TICK_KEY` runs the scheduler: it follows every active watch and commute, then samples a few busy stops for the delay history. An external cron service calls it every minute (Worker sites here have no cron of their own). A D1 lease stops two ticks overlapping, and an open app keeps its own watches moving if the cron goes quiet.
* Notifications are Web Push with VAPID (ES256) and aes128gcm payload encryption, written with WebCrypto inside the Worker, no libraries. The private key stays on the server.
* API budget: every upstream call is counted per day in D1 (`/api/usage`). Background sampling stops above 40,000 calls and watches above 56,000, inside the 60,000 a day plan.
* New tables: `push_subs`, `watches`, `notes` (every alert sent, also shown as an in app banner when notifications are off), `searches`, `commutes`, `dismissed`, `meta`, `usage`.

| New endpoint | What it does |
| --- | --- |
| `POST /api/push/subscribe` | Saves a device's push subscription |
| `POST /api/push/test` | Sends a test notification to a device |
| `POST /api/watch` / `DELETE /api/watch?id=&device=` | Start or stop watching (legs, lead time, optional stop to get off) |
| `GET /api/watches?device=` | Active watches with their latest live snapshot, and recent alerts |
| `GET/POST/DELETE /api/commutes?profile=` | Commutes, plus a suggestion when a trip repeats |
| `GET /api/predict?line=&stop=&planned=` | Usual delay from the recorded history, if there is enough |
| `GET /api/usage` | Today's upstream calls, ticks and recorded observations |

## What is new in v2

* **Live everywhere.** Every board and trip refreshes itself every 15 to 20 seconds while it is open, countdowns tick every second, and the header shows `Live · updated 23:41:05` with a pulse on each refresh.
* **Honest times.** Each service shows a green **Live** badge or a grey **Scheduled** badge. Live times are the big number; the timetable time is struck through when they differ. A scheduled time is never shown as live.
* **Realtime filled in from GTFS realtime.** The Trip Planner already carries realtime for many services. v2 also reads the TfNSW GTFS realtime trip update and vehicle position feeds (buses, Sydney Trains, Metro, light rail, ferries) and fills in live times the planner is missing, matched by trip id.
* **Live vehicle tracking.** Tap any service to open it: a live map (Leaflet with OpenStreetMap data) with the vehicle moving as it refreshes, the full stop list with live times, where the vehicle is now, the next stop, how many stops away it is, and how full it is when the feed says so.
* **Trips like Opal.** "Burwood to Central" shows a live leave-in countdown, each leg with live delay and platform, change times between legs (tight and at risk changes are flagged), and a Track button for each leg.
* **Saved trips by name.** Save a trip as "home" or "work", then just type `home` for the next live services. Saved trips and starred stops sit on the home screen as live cards that update themselves.
* **Alerts and platform changes** are attached to the services they affect.
* **Plain text answers** (`/api/ask?q=...&format=text`) include Live or Scheduled for every line and where the vehicle is now, short enough for a WhatsApp message.

## You type, you get

| You type | You get |
| --- | --- |
| `213516` (any stop number) | Live board for that stop or stand |
| `Strathfield`, `Central` | Live board for the whole station, with mode tabs |
| `next train from Strathfield` | Same, filtered to trains |
| `Burwood to Central` | Next trips with live leave-in countdowns and every leg |
| `Parramatta to Town Hall at 8am`, `... by 9am` | Trips leaving at, or arriving by, that time |
| `save Burwood to Central as home` | Saves a named trip |
| `home` | Next live services for your saved trip |
| `alerts T1`, `alerts buses` | Current alerts |

## API

All endpoints return JSON. Add `format=text` for a short plain text answer.

| Endpoint | What it does |
| --- | --- |
| `GET /api/ask?q=...&profile=bidur` | Answers any message (stop, station, trip, saved trip name, alerts) |
| `GET /api/departures?stop=213516&mode=bus` | Live board for one stop |
| `GET /api/trip?from=ID&to=ID&time=0800&arriveBy=1` | Live trips between two stop ids |
| `GET /api/service?trip=ID&mode=bus&line=415&stop=213516` | One service: stop list, live times, vehicle position, next stop |
| `GET /api/status?trip=ID&mode=bus&line=415&stop=213516` | Same without the stop list, plus a one line `text` (for schedulers) |
| `GET /api/next?profile=bidur&name=home` | Next live services for a saved trip |
| `GET /api/saved?profile=bidur` | List saved trips (`POST` `{profile, name, from, to}` to add, `DELETE ?name=` to remove) |
| `GET /api/search?q=strath` | Stop search for autocomplete |
| `GET /api/nearby?lat=..&lon=..` | Closest stops |
| `GET /api/alerts?q=T1` | Current alerts |
| `GET /api/obs?route=415&stop=213516` | Recorded realtime observations (for delay prediction) |
| `GET /api/health` | Feed cache state |
| `POST /api/hit` `{p, r}` | Website page view counter: one daily total per page and referring site, no cookies, no IP or IDs stored |
| `GET /api/stats?key=ADMIN_KEY&days=30` | Page view totals by day, page and referrer |
| `POST /api/feedback` | Contact form (form post redirects to /support/thanks/, JSON gets `{ok}` or field `errors`) |
| `GET /api/feedback?key=ADMIN_KEY` | Read contact form messages (`DELETE ?key=&id=` removes one) |

## Website

`/` shows a landing page to first time browser visitors and the web app to everyone else (installed app, `/#/...` links, returning users, `?source=` or `?me=`). `/?about` always shows the landing page. Other pages: `/download/`, `/support/` (help and contact form), `/support/thanks/`, `/privacy/`, `/terms/`, `404.html`, `robots.txt`, `sitemap.xml`. Shared styles are in `site.css`, the page counter in `hit.js`.

## How it works

* `src/worker.js` is a Cloudflare Worker. It calls the Transport for NSW Trip Planner APIs (`stop_finder`, `departure_mon`, `trip`, `coord`, `add_info`) and the GTFS realtime feeds, merges them and returns tidy JSON.
* GTFS realtime is protobuf. The worker has a small built in protobuf reader. Big feeds (the bus trip update feed is about 1 MB) are indexed in one quick pass and a trip is decoded in full only when it is needed.
* Feeds are cached for 15 seconds and shared across users through a named edge cache, so the API key stays well inside its daily limit.
* Every live time seen on a board is recorded in a D1 database table `obs` (one row per day, trip and stop, with planned time, latest estimate and delay). This is the base for delay prediction later.
* Saved trips are stored in D1 table `saved`, per profile, so the same names work in the web app and in chat.
* `src/public/` is the web app (plain HTML, CSS and JavaScript). `src/public/stops/` holds stop names and locations from the GTFS static timetable, built by `tools/build_stops.py`.
* The API key is only used inside the worker. It never reaches the browser and is not in this repository.

## Running your own copy

1. Get a free API key at https://opendata.transport.nsw.gov.au (profile, API Tokens).
2. Copy `.env.example` to `.env`, paste the key after `TFNSW_API_KEY=`, run `node tools/vapid.mjs` for the push keys, and set `TICK_KEY` and `ADMIN_KEY` to long random strings.
3. `node build.mjs` writes a ready to deploy folder to `site/` (static files plus `worker.mjs`).
4. Deploy `site/` as a Cloudflare Worker with static assets (`ASSETS` binding) and a D1 database bound as `DB`.
5. Point any cron service at `https://YOUR-SITE/api/tick?key=TICK_KEY` every minute.

## Data

Live data from Transport for NSW Open Data, used under its licence. Map data and tiles from OpenStreetMap contributors. This project is not made by or affiliated with Transport for NSW.


## Ask tab (chat)

The Ask tab (`#/chat`, files `src/public/ask.js` and `ask.css`) is a chat with Transport Bot in the style of the old Transport for NSW Messenger bot. Every answer comes from live Transport for NSW data through `GET /api/ask`.

`/api/ask?q=...` understands questions like "next train Burwood to Central", "when's the 461 from Burwood", "is the T1 late", "departures Strathfield", "how do I get to Bondi Beach" (needs `lat`/`lon`, otherwise it asks where from), "last train home" (uses `home` and `work`, each `stopId|Name`, or `lat`/`lon`) and stop numbers. The JSON keeps every earlier field and adds `reply` (short text), `cards` (departures, trip, alerts, stops), `links` (stop board, trip, live map, each with `kind`, ids and a web `href`) and `suggestions`. `format=text` still returns plain text.

`/api/departures` answers are shared for 12 s per stop, slow realtime feeds are waited on for at most 2.5 s (they keep loading for the next request) and planner calls time out after 12 s.

## Station access, Park and Ride and Opal machines

Station screens, trip legs, the Opal machine finder and Ask read two data files built from Transport for NSW open data:

* `src/public/data/facilities.json`: access level, lifts, escalators, Opal machines, facilities and peak times for 797 stations, wharves and stops (Public Transport Location Facilities and Operators).
* `src/public/data/carparks.json`: the 41 Park and Ride car parks with a live count, their station and capacity (Car Park API).

Rebuild both with `python3 tools/build_facilities.py` (reads `TFNSW_API_KEY` from the environment or `.env`). Live spaces and lift outages are read at request time. Endpoints are listed in `docs/API.md`.
