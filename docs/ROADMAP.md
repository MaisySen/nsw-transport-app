# Roadmap

Open items, in the order they are planned. Updated Wed 28 Oct 2026, 4 PM Sydney. What the app does today: [FEATURES.md](FEATURES.md). What is live right now: [STATE.md](STATE.md). Release ids and rollback commands: [RELEASES.md](RELEASES.md).

Rules that shape the order: one over the air update a night (server only work does not count, but always with a rollback ready); nothing that needs a native module before build 209 on 1 Nov; the board engine, our own planner, live push and the Workers Cache stay off until each passes its gate and the owner agrees.

## Shipped 25 to 28 Oct

### 25 Oct (over the air, builds 201 to 206 and Android)

* Station picker and search fields, Speak alerts during a trip, bus route view and stop numbers, the Ask field above the tab bar.
* Bus picker in New trip; live labels (Live with its age, Timetable, Not tracking); bus stop boards with route chips, Recently departed, GET ON and GET OFF.
* Home, Option A (Next trip card, slim rows, one + button, a working Undo); several trip reminders per saved trip.
* Plan B on the trip screen and Home cards; trackwork as a Plan B reason.
* Simple mode, a better voice, car parks, live bus status, Ask understands far more.
* Delete all my data also deletes the trip card and push tokens; stale tokens cleaned hourly.

### 26 Oct (server and over the air, groups up to 27efc6bd)

* The apps moved to api.transportsydney.app (remote config `api_base`), which lit up Usually N min late, the trackwork added time, Plan B words in the morning alert, reliability, the server last way home push, Park and Ride, bus traffic and occupancy.
* Timetable on the phone (packs), search as you type, saved boards, battery and data passes.
* When Transport for NSW refuses: timetable trips, Nearby and honest messages; outage trips to a service's last stop (g24).
* Live trip follows the real train; Limited Stops tag; Alerts for my trips (More, off until switched on).
* Budget mode (US$5 a month, no overage) with the budget guard; break it pass and its server fixes.
* App Store pack checked against the code; Platform view removed; get off alert the rider controls.

### 27 Oct (server, then the 11:34 PM update f5b9ac08)

* Speed passes 1 to 5: every screen paints from a kept copy in its first frame; Home in one request; shared edge copies; less data on every refresh.
* Crash safety net (an error screen and a report instead of a closed app) after the morning crash loop.
* Plan tab rows with am and pm, time left, where you get on and off, an honest On time; Tight change rule shared by the phone and the web page; endless trip list pages.
* Board engine: buses after midnight, night trains, trackwork trips, learnt stand names (still off for phones).
* Our own planner, a day of trips at a time (behind `OWN_PLANNER`, off).
* Store screenshots reshot with live data; build 208 on version 1.0.0.

### 28 Oct (server live now; app parts in tonight's 11:15 PM update)

* Get off now 30 s before the live arrival, never after, on by default (de524bc).
* Crash path fix: a kept board with a broken row is skipped instead of crashing the screen (afe9b05).
* Board engine: Sydney Metro from its own feed when our timetable is the other version (server, flag still off; match measured tonight).
* Max walk chips (5, 10, 15 min, Prefer bus), kept per trip, and the walking limit sent to the trip planner (server).
* Often does not run on bus times that often never show live (server, stricter bar: at least 12 counted buses over at least 4 days; no hour qualifies yet, the earliest is about 30 Oct).
* Get off alert 1, 2 or 3 stops early, and a spoken "Get off now at (stop)" (66ad47c).
* Not stopping at (stop) today for bus detours and closed stops, from service alerts (server and app).
* Off peak hint on peak hour trips, from the server's fare saving (9d10699).
* Liveness pass: no time older than 5 min by the feed's own timestamp is ever shown as Live; per feed freshness on the server (941b228).
* App Review notes list every server feature and switch, saved in App Store Connect as a draft ([APP_REVIEW_NOTES.md](APP_REVIEW_NOTES.md)).
* Done 28 Oct (server, transport-api 2ff6fdda): outage fallback for trips that end at a last stop (the open bug from 26 Oct); live from the 29 Oct 2:40 AM timetable load, to check on production with the planner refused.

## Now: to 1 Nov

| Night | Item | Status |
| --- | --- | --- |
| Wed 28 Oct, 11:15 PM | Tonight's update from main: everything in the 28 Oct list above. Full tests, battery, preview on two phone sizes, both manifests on runtime 1.0.0, then production and a 15 min watch. Rollback f5b9ac08 | Scheduled |
| Wed 28 Oct, after 11 PM | Board engine re-match with the Metro fix (capped); expect Metro well above 20 of 39. Our own planner compare when the day is loaded | Scheduled |
| Thu 29 Oct | Owner's phone check of the 27 and 28 Oct updates (Home, a trip, a stop board, a live trip, the get off alert on a real ride); fixes from it. Last stop outage fallback if not done 28 Oct | Waiting on the update |
| Fri 30 Oct | Fixes only from the phone check and the crash hunt; first day Often does not run can qualify | Planned |
| Sat 31 Oct | Freeze night: bug fixes only, no new screens. Reread the review notes against main | Planned |

The plan's items for 29 and 30 Oct (get off timing, no show counts, bus detours, off peak hint) all shipped on 28 Oct, so those nights are for fixes.

## Build 209 checklist (Sun 1 Nov)

Every step, with commands and what to show Bidur before any submit: [BUILD_209_CHECKLIST.md](BUILD_209_CHECKLIST.md) (29 Oct). Branches ready: `sentry-build209`, `island-209`, `widget-209` (widgets drop Live, 29 Oct), throwaway `int-209` (all merged, tests green).

1. Branch from main. Merge the Sentry branch (head f8479c2) and the short Dynamic Island branch `island-209` (3e77300: station with a colon on the left, a self updating countdown on the right). Fix the STORE_PRIVACY.md line that says "not changed on this branch".
2. Add the EAS secret SENTRY_AUTH_TOKEN. On Android, set SENTRY_DISABLE_AUTO_UPLOAD until a token is in place.
3. Give build 209 its own runtime (proposed 1.1.0) because it adds native modules. From then each night's update is published to both runtimes from the same commit, so builds 201 to 208 keep working. Owner to confirm.
4. Native list ([IOS27.md](IOS27.md), Build 209):
   * Time sensitive notification entitlement, so Get off now breaks through a Focus.
   * Get off now moved by push while the phone is locked (options in IOS27.md).
   * Widgets drop Live after the same 5 min rule as the app (liveness pass).
   * Widgets and Watch read the phone's copies first (App Group board and trip files), network second.
   * Widget and Live Activity updates by push, not their own timeline fetches.
   * Speak only with headphones (audio route read).
   * Simple mode "Here" stand on a Lock Screen widget.
   * Built in server address moved to api.transportsydney.app in the widget and intents, with the old one still allowed.
   * Timetable packs refresh on Wi-Fi only.
   * Background warm of the commute about 10 min before the usual departure.
   * Android: read the phone's 24 hour setting.
   * Pin the EAS image (Xcode 27.1) in eas.json.
5. One simulator compile check (including the 209 island layout), then one production build: 2 of the 15 November builds.
6. TestFlight Internal: the owner runs the device checklist in [TEST_PLAN.md](TEST_PLAN.md) (ten cold opens, Home, a live trip, widgets, the Watch, a Live Activity, Speak with headphones, a test Sentry event reaching the dashboard).
7. Apple Watch screenshots from the 209 simulator, with no personal stations.

## App Store submission (after 209)

1. Attach build 209 to version 1.0.0 (208 is attached today).
2. Reread the Notes for Review ([APP_REVIEW_NOTES.md](APP_REVIEW_NOTES.md), in App Store Connect as a draft since 28 Oct) against 209.
3. Upload the Watch screenshots.
4. Owner saves the Crash Data answer in App Privacy (not linked to the user, not used for tracking).
5. Owner presses Submit, or tells Tab to in writing.

## Waiting on the owner

* Crash log from his iPhone for the 27 Oct crash loop (Settings > Privacy & Security > Analytics & Improvements > Analytics Data).
* Phone check of the 27 and 28 Oct updates.
* Crash Data answer in App Store Connect; OK to submit 1.0.0 with 209; the 1.1.0 runtime proposal.
* NSW quota reply (1,000,000 a day); nothing to do unless they ask.
* Google Play app in Play Console and the Firebase project for Android alerts with the app closed.

## Next (November)

| Item | Detail |
| --- | --- |
| Google Play | versionCode 6 with Firebase alerts, Sentry, the 24 hour setting and the Android widget; Internal testing, then 12 testers for 14 days on a personal account ([STORE.md](STORE.md)) |
| Apple Watch | Times from the phone, a tap on the wrist one stop before yours, complications refreshed by push |
| Widgets and Live Activities | Where the bus is and when to leave; a Live Activity for a watched departure; StandBy countdown |
| Board engine | 95% match across every mode, then the owner decides whether it serves boards |
| Own planner | A valid compare, the same 95% gate, then the owner's OK |
| Speed from Sydney | Measure on the phone itself; every screen under 1 s for 95% of requests |
| Workers Cache | Stays off until request logs and trip history no longer depend on every request reaching the server |
| Google Assistant shortcut | The Android match for the Siri shortcuts |

## Known gaps

* The 26 to 28 Oct updates have been tested in unit tests and the web build at phone size, not yet on a real iPhone or Android phone (the get off alert timing and the spoken line on a real ride most of all).
* Expo web cannot draw the native tab bar, navigation bar or widgets, so overlap and glass checks need a device.
* Not stopping today shows on rows only when an alert names a stop still in the timetable; today's diversions name lines but no stops.
* Often does not run needs at least 4 days of live times per hour, so no bus gets it before about 30 Oct.
* The off peak hint shows only once a trip after the peak is loaded, which at 7:30 AM can mean scrolling.
* A leg set to one mode can show another mode when the planner has no direct service of that mode.
* Bus route numbers that exist in two regions keep only one region's version (for example route 46).
* Late night buses often have no realtime in the Transport for NSW feeds; they show as Timetable.
* The owner's mobile number is still in old git history (a force push removes it, owner's call).

## Last: move to Bidur's Windows PC

Planned at the end of November, after the store work. Goal: Bidur can build, run and publish everything on his own machine and accounts.

1. A setup script and guide for Windows: Node 20, Git, Java 17, Android SDK, Expo and EAS CLI.
2. Backend and web: run locally with a Worker dev server, on the Fintex Cloudflare account (done: see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md)).
3. Expo: EAS Update and APK and AAB builds from the PC, with the keystore moved to a safe place on the PC and a backup.
4. iPhone: EAS Build in the cloud (no Mac needed).
5. Secrets and accounts handed over: Transport for NSW, Expo, cron-job.org, the keystore, Apple and Google keys, repo secrets.
