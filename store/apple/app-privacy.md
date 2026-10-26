# App Privacy answers (App Store Connect)

The answers to click in App Store Connect, App Privacy, and the code facts behind them. This file and [../google/data-safety.md](../google/data-safety.md) are the source; docs/STORE_PRIVACY.md points here.

## Status

* Published in App Store Connect on 25 Oct 2026, 10:54 AM (the four types below). The App Store Connect API has no App Privacy endpoint, so the published answers cannot be read back by code; they were clicked from the same list.
* Checked again against the code on 26 Oct 2026, 5:50 PM Sydney (g25, main `6ac34d9` plus the server deploy `3e88773d`): **the published answers stay correct; nothing to change in App Store Connect.**
* What the check covered: every D1 table the server writes (`INSERT` in `backend/src/worker.js`) and every `DELETE` that ends it; every `/api` call in `app/src/lib/api.ts`, the Watch app and the widgets; each `Location` call in `app/src` (all foreground, `Balanced` or `Low`); the push token paths; the Workers Logs settings on the live script; the live board push (g17), own planner (g18), trip tracking (g19) and budget guard (g20) added on 26 Oct.
* Found and fixed on 26 Oct: (1) Workers Logs invocation logs kept the full request address (install ID, a position, an Ask question) for up to 7 days, against "not kept"; turned off and deployed. (2) A watched trip starting from a point could put that point in the 90 day trip history; now skipped. (3) The policy said positions are never kept, but a last way home reminder set from where you are keeps its starting point until 12 hours after the service; the policy now says so (published 26 Oct, site deployment `462d58fc`), and that case is inside the Precise Location answer already given.
* Still to recheck: worker g22 (alerts for saved trips) is building now; if it keeps anything new on the server, add it here before submitting.

## Judgement calls the owner can overrule

* "Linked to you: No" for all four. There are no accounts; the IDs are random and made on the phone, and nothing ties them to a name, email or phone number. Apple's wording counts data tied to a device as linked in some readings; if the owner wants the safer label, change all four to "Linked: Yes" (it only adds a "Data Linked to You" box; nothing else changes).
* Coarse Location is not ticked: the server and Cloudflare see IP addresses to answer requests (rate limit counters live 5 minutes), but no location is worked out from them or kept.
* Ask questions are not collected: they are answered and not kept (and, since 26 Oct, not logged).

## Answers (App Store Connect > App > App Privacy)

The App Store Connect API has no endpoint for App Privacy, so this is clicked by hand (about 5 minutes):

1. App Privacy > Get Started. "Do you or your third party partners collect data from this app?" Yes.
2. Tick these data types and nothing else:
   * Location > Precise Location
   * Identifiers > Device ID
   * Search History > Search History
   * User Content > Other User Content
3. For each of the four: Used for App Functionality only. Linked to the user's identity: No (there are no accounts; the IDs are random and made on the phone). Used for tracking: No.
4. Publish.

Why each: Precise Location only when the user chooses it: Include my location on Share trip (kept while the share is live, at most 6 hours) or a last way home reminder set from where you are (kept until 12 hours after the service). Either way it is kept, so it counts as collected. Device ID is the random install and profile IDs plus the push token. Search History is the trip searches kept 90 days. Other User Content is saved trips, commutes, watches and checks.

Not collected under Apple's definition: the position sent for nearby stops and trip planning (used to answer the request and not kept), Ask questions, calendar events (read on the phone; only an event's place is sent, as a search, with no ID, and not kept), Usage Data, Diagnostics, Contact Info. So Calendar leave by adds no App Privacy answer. Build 208 asks for full calendar access (iOS 17 and later) with the text in [docs/CALENDAR-LEAVE-BY.md](../../docs/CALENDAR-LEAVE-BY.md).

Tracking: No. ATT is not needed (no IDFA, no tracking SDK). NSPrivacyTracking is false.

The privacy manifest in app/app.json lists the same four types (not linked, no tracking, App Functionality); every build after 201 carries it. The widget and Watch complications carry their own manifests (UserDefaults CA92.1); the Watch app gets the app's manifest at prebuild (a second file there fails the build, `app/test/leaveby206.test.mjs`).

## What the code does

Kept only on the phone (never sent): home and work stations, starred and recent stops, the fare type, Ask chat history, trip reminders (local notifications, 25 Oct), the Speak alerts switch, settings. Speak alerts use the phone's own speech.

Calendar (Calendar leave by, More, off by default; iPhone build 208 and later, Android builds with the calendar module; [docs/CALENDAR-LEAVE-BY.md](../../docs/CALENDAR-LEAVE-BY.md)): events in the next 6 hours are read on the phone, read only, while Home is on screen. The event name, notes, people and calendar never leave the phone. Two requests leave it, and neither is kept: the place written in the event, as a place search (`/api/places`, the same as typing in Plan), and the trip query to the place found, Arrive by the start time, sent with no install ID, profile or names so the server cannot add it to trip history or link it to a phone. Places found are kept on the phone (30 days, at most 60) and deleted when the switch is turned off or with Delete all my data. The server's place search keeps its usual in memory copy of answers by search text for up to 6 hours, not linked to any phone.

Sent to the server and kept, keyed by a random install ID and a random profile ID that the app makes on first launch (not the advertising ID, not the vendor ID, no name, email or phone number):

| Data | Server table | How long | Why |
| --- | --- | --- | --- |
| Saved trips (name, stops, legs) | saved, saved_legs | Until the user deletes them | Trips on Home and in widgets |
| Commutes and dismissed suggestions | commutes, dismissed | Until deleted | Commute card |
| Trip searches (from, to, day, time of day) | searches | 90 days | Commute suggestions |
| Watched services and trips | watches, watch_sent | 30 days after they end | Leave now, late and platform alerts |
| Alerts sent to the phone | notes | 3 days | Alert history in the app |
| Check my trip before I go settings | morning_checks, morning_sent | Until deleted | The morning check |
| Last way home reminder: the trip home and its time; when set from where you are (Ask, "last train home"), that starting point (longitude and latitude) instead of a stop | last_home | 12 hours after the service | The reminder push |
| Car parks and stations chosen for alerts | park_watches, lift_alerts | Until deleted | Nearly full and lift alerts |
| Push token (iPhone, Expo push) | expo_tokens | Until the app unregisters (alerts off, Delete all my data) or Apple says it is invalid. On api.transportsydney.app also deleted after 30 days with no working push when nothing on the server can still push to that install (no live watch, morning check, lift alert, car park watch or last way home) | Sending alerts |
| iPhone trip card (Live Activity) push token, the trip and its legs (build 205 and later) | live_activities | Deleted when the trip ends on the phone; otherwise by the hourly clean up once the card has ended or expired, and never kept longer than 24 hours. Delete all my data deletes it at once (25 Oct, 5:28 PM) | Updating the Lock Screen card while the phone is locked |
| iPhone device push token (build 205 and later) | apns_devices | The app sends it each time it opens; deleted when it has not been sent for 30 days. Delete all my data deletes it at once and the app does not send it again until alerts are turned on (25 Oct, 5:28 PM). Nothing is sent to it yet | Alerts later |
| Shared trip, with the latest position only if the user taps Include my location | shares | Deleted when the trip ends or sharing stops, otherwise 30 min after arrival, never longer than 6 hours | The Share trip link |

Sent for one request and not kept: the position for nearby stops, top up machines, Park and Ride distances and trip from where you are; Ask questions; with Calendar leave by on, an event's place (as a place search) and the trip query to it, with no install or profile ID.

Not user data: "Usually N min late" (`/api/usual`, new server only) is counted from the public live feed per route, stop, day type and part of the day; no trips, devices or times of any person are kept for it.

Kept for 5 minutes only: request counters per IP address for rate limiting (ip_rate), deleted by the minute cron.

Server logs (checked 26 Oct): Workers Logs keeps one request in 10 for up to 7 days. What it keeps is the request line `reqLog` writes (path, method, status, time, NSW calls, copy tag, `app` or `ext`, Cloudflare data centre), errors, and nothing else: invocation logs are off since transport-api `3e88773d` (26 Oct, 5:45 PM; `invocation_logs = false` in `backend/wrangler.toml.template`, read back from the Cloudflare script settings). Before that the invocation logs kept each sampled request's full address, query included (install ID, a position for nearby stops, an Ask question), which contradicted "not kept" above. No IP address, query or ID is in the request line (`test/reqlog.test.mjs`).

Trip history keeps stops only: `logSearch` skips a trip whose start or end is a point (`lon:lat:EPSG:4326`). The search path already did; since `3e88773d` a watched trip does too (`test/search-points.test.mjs`).

Other server data that is not about a person: `obs` and `late_agg` (public feed delays per route and stop), `board_copies` and the trip copies (a stop's or a stop pair's last board or trip answer, with no ID), `park_full`, `usage` (daily counts), `hits` and `feedback` (the old web host's page counter and contact form; transportsydney.app has no script and no form, and the apps call neither), the live board push (`/api/live?stop=`, carries no ID, off for phones), the budget guard (reads Cloudflare usage only).

Apple Watch app and widgets (builds 206 and later): they ask the server with the same random profile ID the phone app uses (`profile` in the query), nothing else.

Not in the app: accounts or login, name, email, phone number, contacts, photos, microphone, camera, health, payments, ads, analytics or crash SDKs, advertising ID, tracking across apps or sites. No ad or analytics library is in app/package.json.

Delete all my data (More) asks the server to delete everything above for this install (POST /api/history/delete with scope all) and resets the phone. The iPhone trip card and phone push tokens are kept on api.transportsydney.app whichever address the app uses, so the app also calls POST /api/live-activity/forget there (from the 25 Oct, 5:28 PM update; skipped when the app already uses that address, quiet if the route is missing). A phone still on an older update is covered by the clean up above (24 hours, 30 days). By email: privacy@transportsydney.app (forwards to contact@fintex.au). Web: https://transportsydney.app/support/

Service providers that see a request: Apple (APNs, MapKit maps on iPhone), Expo (push relay and over the air updates; sees the push token, the alert text and the IP address; the update library sends its own random install ID with each update check, covered by Device ID below), OpenFreeMap (map tiles on Android; sees the IP address), Cloudflare (hosting). Transport for NSW receives only the server's own data requests, with no user data.
