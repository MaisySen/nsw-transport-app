# Store privacy answers (App Store App Privacy and Play Data safety)

Written 25 Oct 2026 from the code on main (app/ Expo app for iPhone and Android, backend/ server at api.transportsydney.app and the first address). Re-check whenever the app or server starts keeping something new.

## What the code does

Kept only on the phone (never sent): home and work stations, starred and recent stops, the fare type, Ask chat history, settings.

Sent to the server and kept, keyed by a random install ID and a random profile ID that the app makes on first launch (not the advertising ID, not the vendor ID, no name, email or phone number):

| Data | Server table | How long | Why |
| --- | --- | --- | --- |
| Saved trips (name, stops, legs) | saved, saved_legs | Until the user deletes them | Trips on Home and in widgets |
| Commutes and dismissed suggestions | commutes, dismissed | Until deleted | Commute card |
| Trip searches (from, to, day, time of day) | searches | 90 days | Commute suggestions |
| Watched services and trips | watches, watch_sent | 30 days after they end | Leave now, late and platform alerts |
| Alerts sent to the phone | notes | 3 days | Alert history in the app |
| Check my trip before I go settings | morning_checks, morning_sent | Until deleted | The morning check |
| Last way home reminder | last_home | 12 hours after the service | The reminder push |
| Car parks and stations chosen for alerts | park_watches, lift_alerts | Until deleted | Nearly full and lift alerts |
| Push token (iPhone, Expo push) | expo_tokens | Until the app unregisters or Apple says it is invalid | Sending alerts |
| Shared trip, with the latest position only if the user taps Include my location | shares | Deleted when the trip ends or sharing stops, otherwise 30 min after arrival, never longer than 6 hours | The Share trip link |

Sent for one request and not kept: the position for nearby stops, Opal machines, Park and Ride distances and trip from where you are; Ask questions.

Kept for 5 minutes only: request counters per IP address for rate limiting (ip_rate), deleted by the minute cron.

Not in the app: accounts or login, name, email, phone number, contacts, photos, microphone, camera, health, payments, ads, analytics or crash SDKs, advertising ID, tracking across apps or sites. No ad or analytics library is in app/package.json.

Delete all my data (More) asks the server to delete everything above for this install (POST /api/history/delete with scope all) and resets the phone. By email: privacy@transportsydney.app (forwards to contact@fintex.au). Web: https://transportsydney.app/support/

Service providers that see a request: Apple (APNs, MapKit maps on iPhone), Expo (push relay and over the air updates; sees the push token, the alert text and the IP address), OpenFreeMap (map tiles on Android; sees the IP address), Cloudflare (hosting). Transport for NSW receives only the server's own data requests, with no user data.

## Apple App Privacy (App Store Connect > App > App Privacy)

The App Store Connect API has no endpoint for App Privacy, so this is clicked by hand (about 5 minutes):

1. App Privacy > Get Started. "Do you or your third party partners collect data from this app?" Yes.
2. Tick these data types and nothing else:
   * Location > Precise Location
   * Identifiers > Device ID
   * Search History > Search History
   * User Content > Other User Content
3. For each of the four: Used for App Functionality only. Linked to the user's identity: No (there are no accounts; the IDs are random and made on the phone). Used for tracking: No.
4. Publish.

Why each: Precise Location only when the user chooses Include my location on Share trip (kept while the share is live, so it counts as collected). Device ID is the random install and profile IDs plus the push token. Search History is the trip searches kept 90 days. Other User Content is saved trips, commutes, watches and checks.

Not collected under Apple's definition: the position sent for nearby stops and trip planning (used to answer the request and not kept), Ask questions, Usage Data, Diagnostics, Contact Info.

Tracking: No. ATT is not needed (no IDFA, no tracking SDK). NSPrivacyTracking is false.

The privacy manifest in app/app.json now lists the same four types (not linked, no tracking, App Functionality). Build 201 shipped with an empty list; the next iPhone build carries the new one.

## Google Play Data safety (Play Console > App content > Data safety)

* Does your app collect or share any of the required user data types? Yes.
* Is all of the user data collected by your app encrypted in transit? Yes.
* Do you provide a way for users to request that their data is deleted? Yes (Delete all my data in More; privacy@transportsydney.app; https://transportsydney.app/support/).
* Account creation: the app does not have accounts.
* Data shared with third parties: None. Share trip is a user initiated transfer. Expo, Google and Cloudflare act as service providers.

| Data type | Collected | Processed ephemerally | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Location: Approximate location | Yes | Yes | Optional | App functionality |
| Location: Precise location | Yes | No (only with Include my location on Share trip, at most 6 hours) | Optional | App functionality |
| App activity: In-app search history | Yes | No (90 days) | Required | App functionality |
| App activity: Other user-generated content | Yes | No | Optional | App functionality |
| App activity: Other actions | Yes (watched services, checks, chosen car parks and stations) | No | Optional | App functionality |
| Device or other IDs | Yes (random install and profile IDs; push token once Android push ships) | No | Required | App functionality |

Not collected: personal info, financial info, health and fitness, messages, photos and videos, audio, files and docs, calendar, contacts, web browsing, app info and performance, advertising ID.

Security: encrypted in transit Yes; deletion request Yes; Families policy No; independent security review No.

The older answer files store/apple/app-privacy.md and store/google/data-safety.md point here.
