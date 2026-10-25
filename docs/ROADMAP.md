# Roadmap

Open items, in the order they are planned. Updated 25 Oct 2026, 5:15 PM. What the app does today: [FEATURES.md](FEATURES.md).

## Done on 25 Oct 2026 (over the air, iPhone builds 201 to 206 and Android)

| Item | Update |
| --- | --- |
| Station picker and search fields: no header over the screen on iPhone, the question in the search field | 3:06 PM |
| Speak alerts speak during a trip; bus route view; stop numbers (search and show) | 3:15 PM |
| Ask field above the floating tab bar and the keyboard; Ask opens on the latest message; Home Undo bar above the tab bar | 3:26 PM |
| Bus picker in New trip: near you, saved and recent, Sydney routes in order, trackwork, school and regional routes tucked away | 3:30 PM |
| Live labels (Live with its age, Timetable, Not tracking): the ghost bus fix. Bus stop boards: route chips, Recently departed, GET ON and GET OFF | 4:29 PM |
| Home, Option A: Next trip card, slim rows, one + button, alerts in one line, a working Undo | 4:34 PM |
| Trip reminders: several per saved trip, by weekday, asked for notifications only on the first one | 4:44 PM |
| "Usually N min late": in the app and on the new server (`/api/usual`, deployed 4:31 PM); hidden until the server move | 4:44 PM |
| Website: feature list, screens from the current app, support and privacy brought up to date | 5:10 PM |

Release ids and rollback commands: [RELEASES.md](RELEASES.md).

## Now

| Item | Detail | Status |
| --- | --- | --- |
| iPhone build 207 | Merge `native-207-bus` into `native-207`, merge main, one simulator compile check, then the production build. Contains: Apple Watch redesign and complications, bus stop widget with stop number, starred bus stops with routes in Edit Widget, Speak alerts in Silent mode, Liquid Glass icon | In progress; device checklist in [TEST_PLAN.md](TEST_PLAN.md) |
| Plan B inside alerts, a "Remind me" for the last way home, weekend trackwork heads up for saved trips | Over the air where the old server address allows; anything new on the server waits for the move | In progress |
| Device checks of the 25 Oct updates | Every 25 Oct item was checked in the web build at phone size and in unit tests only | Waiting on Bidur's iPhone (list in [TEST_PLAN.md](TEST_PLAN.md), Manual and device testing) |

## Next

| Item | Detail |
| --- | --- |
| Move the apps to api.transportsydney.app | Flip `api_base` in remote config ([API.md](API.md)). Lights up Usually N min late, the added time on the weekend trackwork card, Plan B words inside the morning alert, reliability, the iPhone's server last way home push (follows the service while the app is closed), Park and Ride, bus traffic and occupancy. Plan B on Home and the trip screen, the phone's last way home reminder and the weekend trackwork card already work on the current address (25 Oct, 5 PM). Then update the review notes as [REVIEW-NOTES.md](REVIEW-NOTES.md) says |
| App Store submission | Version 1.0.0 with build 207 or later, once the 207 device checks pass ([STORE.md](STORE.md)) |
| Google Play | Internal, closed test, then review ([STORE.md](STORE.md)) |
| Android push when the app is closed | Needs a Firebase project (google-services.json, FCM key uploaded to Expo) |
| Google Assistant shortcut | The Android match for the Siri shortcuts |
| Delete all my data: trip card tokens | `live_activities` and `apns_devices` rows are not removed by Delete all my data and have no clean up yet. Add both to `/api/history/delete` and the minute clean up, then add them to the privacy policy's delete list |

## Known gaps

* The 25 Oct updates have been tested in the web build at phone size and in unit tests, not yet on a real iPhone or Android phone.
* Expo web cannot draw the native tab bar, navigation bar or widgets, so overlap and glass checks need a device.
* A leg set to one mode can show another mode when the planner has no direct service of that mode (for example Central to Chatswood by train showing Metro M1).
* Bus route numbers that exist in two regions keep only one region's version (for example route 46).
* Late night buses often have no realtime in the Transport for NSW feeds; they show as Timetable.
* "Usually N min late" needs a few weeks of live times on the new server before its answers mean much.
* Until api_base moves: the phone's Last way home reminder follows the service only while the app is open, the weekend trackwork card has no added time, and a trip wholly inside a named trackwork section is missed (docs/LAST-WAY-HOME.md, docs/TRACKWORK.md).
* Play phone screenshots are rendered, not device captures.
* Generated station, suburb and stop data files are rebuilt with `backend/tools/`.

## Last: move to Bidur's Windows PC

Planned at the end, after the store work. Goal: Bidur can build, run and publish everything on his own machine and accounts.

1. A setup script and guide for Windows: Node 20, Git, Java 17, Android SDK, Expo and EAS CLI.
2. Backend and web: run locally with a Worker dev server, on the Fintex Cloudflare account (done: see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md)).
3. Expo: EAS Update and APK and AAB builds from the PC, with the keystore moved to a safe place on the PC and a backup.
4. iPhone: EAS Build in the cloud (no Mac needed).
5. Secrets and accounts handed over: Transport for NSW, Expo, cron-job.org, the keystore, Apple and Google keys, repo secrets.
6. A final credentials email and a walkthrough.
