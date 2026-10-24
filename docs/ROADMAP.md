# Roadmap

Open items, in the order they are planned. Updated 24 Oct 2026, 2:20 PM.

## Now

| Item | Detail | Status |
| --- | --- | --- |
| iPhone build 8 fix run | CI run 21: test script fix for the side index jump, bus stop row colour | In progress |
| Security review | Secret scan, dependency audit, endpoint input checks, headers, mobile config | In progress |

## Next

| Item | Detail |
| --- | --- |
| Multi leg trips on iPhone | Port from web and Expo using `/api/plan`, plus Ask "Open trip" and "Save trip" for multi stop answers |
| Android native build (versionCode 5) | Widget shows multi leg trips, long press app shortcuts, large stop board widget; new APK on the download page and a new AAB |
| Store submission | As soon as Bidur's keys arrive (see [Store](STORE.md)): TestFlight, Play internal testing, closed test, review |
| Android push when the app is closed | Needs a Firebase project (google-services.json, FCM key uploaded to Expo) |
| Google Assistant shortcut | The Android match for the Siri shortcuts |
| Fix `site.test.mjs` | Update the out of date "Live" label check |

## Known gaps

* New features have been tested in phone size previews and in the iPhone simulator, not yet on real Android and iPhone devices (map taps, drag handle feel, new icons).
* Leg reordering is up and down buttons, not drag. Walk time is set by hand, not worked out from the map.
* A leg set to one mode can show another mode when the planner has no direct service of that mode (for example Central to Chatswood by train showing Metro M1).
* Bus route numbers that exist in two regions keep only one region's version (for example route 46).
* Late night buses often have no realtime in the Transport for NSW feeds; they show as Scheduled.
* Delay predictions need a week or more of recorded data to be useful.
* Play phone screenshots are rendered, not device captures.
* Generated station, suburb and stop data files are not in the repo; rebuild them with `backend/tools/`.
* The terms page says "Transport" until a seller or legal name is known.
* The App Store build simulator status bar shows UTC time in screenshots; a status bar time override would fix it.

## Last: move to Bidur's Windows PC

Planned at the end, after the store work. Goal: Bidur can build, run and publish everything without Tab.

1. A setup script and guide for Windows: Node 20, Git, Java 17, Android SDK, Expo and EAS CLI.
2. Backend and web: run locally with a Worker dev server, and choose hosting (a Cloudflare account of Bidur's, with D1 and R2) or keep Tab hosting.
3. Expo: EAS Update and APK and AAB builds from the PC, with the keystore moved to a safe place on the PC and a backup.
4. iPhone: stays on GitHub Actions macOS runners (no Mac needed).
5. Secrets and accounts handed over: Transport for NSW, Expo, cron-job.org, the keystore, Apple and Google keys, repo secrets.
6. A final credentials email and a walkthrough.
