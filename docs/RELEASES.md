# Releases

Every shipped build and update. Times are Sydney time (AEDT). Updated 25 Oct 2026, 12:20 AM.

## iPhone (native SwiftUI)

Unsigned builds from CI, attached to GitHub releases. Install with Sideloadly or AltStore ([ios-native/INSTALL.md](../ios-native/INSTALL.md)). Version 1.0 throughout. Builds 1 to 6 used a temporary bundle id; build 7 and later use `com.maisysen.nswtransport`.

| Build | Released | CI run | Commit | What changed |
| --- | --- | --- | --- | --- |
| [8](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-8) | 24 Oct, 1:26 PM | 20 | 5a3675a (built at ec65e4b) | New trip by mode with A to Z side index, By distance, By map; bus route, direction and stops; Confirm trip with rename, Extend trip and connection time; direct services with an All services switch; reorder trips. Release builds compile one file at a time. Fix run 21 in progress |
| [7](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-7) | 24 Oct, 11:46 AM | 16 | e8f387f | Store readiness: per install profile, privacy manifests, app group, bundle id `com.maisysen.nswtransport`, location text, TfNSW attribution with support and privacy links, offline start test, App Store screenshots |
| [6](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-6) | 24 Oct, 10:18 AM | 15 | 76f21bc | Trips home with Add home and Add work, countdown colours, crowding, Earlier and Later services; Ask tab; Siri shortcuts "Next train home" and "Ask Transport" |
| [5](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-5) | 24 Oct, 8:31 AM | 9 | 3e96a01 | UI tap through tests, Home as a live board, widgets (any trip or stop, Smart Home and Work, large, StandBy, Lock Screen, stop board), dark Live Activity |
| [4](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-4) | 24 Oct, 2:19 AM | 4 | a7e3baa | One line service alerts in rows |
| [3](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-3) | 24 Oct, 2:14 AM | 3 | 00b81c3 | Tidier departure rows, mode icons, hour countdown |
| [2](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-2) | 24 Oct, 2:05 AM | 2 | 1f97343 | Screenshot script opens screens by launch argument |
| [1](https://github.com/MaisySen/nsw-transport-app/releases/tag/ios-native-build-1) | 24 Oct, 1:43 AM | 1 | 3bf98e4 | First native iPhone app |

No TestFlight or App Store build yet. TestFlight signing works since 24 Oct 2026 (workflow "iOS TestFlight upload"):

| Run | Time (AEDT) | Commit | Result |
| --- | --- | --- | --- |
| 1 and 2 | 24 Oct, 7:13 PM and 7:26 PM | 6ae178d | Failed: App IDs and team profiles created, but the app group `group.com.maisysen.nswtransport` is not registered (an API key cannot register it) |
| 3 | 24 Oct, 7:42 PM | 96f12f9 | Fell back to signing without the app group, then codesign hung on a keychain prompt until the job limit |
| 4 (build 104) | 24 Oct, 8:23 PM | 241d63c | Archive signed (throwaway unlocked keychain). Upload stopped at "exportArchive Error Downloading App Information": no App Store Connect app record yet |

Next: Bidur creates the app record ([SUBMIT.md](../SUBMIT.md), iPhone step 1), then run the workflow again. Builds stay without the
app group (widgets cannot read the app's starred stops and saved trips) until Bidur registers it (SUBMIT.md, item 5).

## Android (Expo)

Package `com.maisysen.nswtransport`, versionName 1.0.0, signed with one upload key throughout.

| versionCode | Built | Commit | Form | What changed |
| --- | --- | --- | --- | --- |
| 5 | 24 Oct, 3:07 PM | 1302300 | APK, on the download page since 3:10 PM, and signed AAB for Google Play (`transport-1.0.0-vc5.aab`, kept on the build box) | Multi leg trips on the Next trip widget (each leg's line, total time, arrival, tight and missed change warnings); new Departure board widget (next 4 to 6 services with line badge, platform and live or delay, refreshes about every minute); long press shortcuts Home, Work, Ask and your top 2 trips; app backup off, launcher badge and foreground service permissions removed; random install ids |
| 4 | 24 Oct, 11:01 AM | e8f387f | Signed AAB for Google Play (`transport-1.0.0-vc4.aab`, kept on the build box) | Target API 36, per install profile, widget reads the install profile, fewer permissions, attribution and links in Settings |
| 3 | 24 Oct, 8:48 AM | 19bcfff | APK, on the download page since 8:47 AM | Next trip home screen widget (small and medium) |
| 2 | 24 Oct, 7:40 AM | 2706fc4 | APK | Live flag on the service sheet, all tab labels, one retry on dropped requests, x86_64 build |
| 1 | 24 Oct, 1:32 AM | 06185d9 | APK | First Android app |

The download page serves versionCode 5. Every JavaScript change since then reaches installed apps as an over the air update. Widgets and shortcuts are native, so they need the versionCode 5 APK.

## Over the air updates (EAS Update)

Project `cf1f4c4c-5157-41bf-a254-4480223f6368`, owner `bidurtab`. Runtime version 1.0.0 for every Android build, so every installed APK and AAB takes JavaScript updates without a new build. Only a native change (a new module, a permission, widget code, app.json native fields) needs a new versionCode, and then the runtime version goes up with it.

Channels and branches (each channel reads the branch of the same name):

| Channel | Branch | Who gets it |
| --- | --- | --- |
| `production` | `production` | Every Android build so far (versionCode 2 to 5; checked in the versionCode 5 AAB manifest: channel `production`, runtime 1.0.0). eas.json profile `production` |
| `preview` | `preview` | Builds from eas.json profile `preview` (internal APK). No installed build reads it yet, so a preview update is checked by its manifest and the web export before it is promoted |
| `expo-go` | `expo-go` | The iPhone preview in Expo Go (runtime exposdk:58.0.0) |

How to ship a JavaScript change (from the app folder, `EXPO_TOKEN` set):

1. `npx tsc --noEmit` and `OFFLINE=1 node --test test/*.test.mjs` pass, and the browser checks in [app/test/e2e](../app/test/e2e/README.md) pass on the web export.
2. Publish to preview: `npx eas-cli update --branch preview --environment production --platform android --message "..." --non-interactive`.
3. Test it: on a preview build, open the app twice (it downloads on the first open and runs on the next), or fetch its manifest with the headers `expo-channel-name: preview`, `expo-runtime-version: 1.0.0`, `expo-platform: android` from `https://u.expo.dev/cf1f4c4c-5157-41bf-a254-4480223f6368`.
4. Promote the same bundle to everyone: `npx eas-cli update:republish --group <preview group id> --destination-branch production --message "..." --non-interactive`. Installed apps get it on their next launch, and run it on the launch after.
5. Undo: `npx eas-cli update:republish --group <previous production group id> --destination-branch production`, or `npx eas-cli update:roll-back-to-embedded --branch production --runtime-version 1.0.0`.

Newest first.

| Time (about) | Update | production group | expo-go group |
| --- | --- | --- | --- |
| 25 Oct, 12:18 AM | It just knows: home and work setup on first launch (More, Home and work to change), commute card on top that flips at 12pm with a swap, Leave in N min from your location with Remind me, Wake me before my stop on the live trip, next option card after a missed change with Switch to this (commit dab02b2). Preview first (update 01a16e0f-4afc-7cf3-8031-bfd6c7adf62d, group a7ee6f12-6c1b-4166-829c-f002bbd5e178), manifest checked on the preview channel (runtime 1.0.0, launch asset hash UF3Abmx-3xMtI-Oy9Wnq7-ZJy-8j-DdXBue1gt53vlY matches the local export), then republished to production; the production manifest serves the same hash | 01a16e0f-c2fa-7298-ae3e-5cfd32af7fa8 (group b1421447-bfdf-43e6-a385-6068c7fcb112) | none |
| 24 Oct, 11:16 PM | About: Made by Fintex Australia Pty Ltd, Contact us, Fintex website. Opal machines map no longer fights the page scroll. Fixed taps that buzzed and did nothing (trip card reorder handle, menu sheet choices, Start trip waiting on the notification prompt, swipe buttons). Contrast 4.5:1 light and dark, 48 dp targets, TalkBack labels (commit 0b1c859). Preview first (update 01a16dd6-5392-7282-a2bb-b81a7bf27d18, group fa4df9ea-3aa6-474d-b0d3-039437e1392b), manifest checked on the preview channel (runtime 1.0.0, bundle hash matches the local export), then republished to production | 01a16dd6-dde0-7b47-a960-78a487c67041 (group bd278cae-d1ec-4146-97e1-66071d13c012) | none |
| 24 Oct, 10:37 PM | With notifications on, the server follows the trip and sends every alert and the one You've arrived, and the phone posts none of its own (the server now ends its watch at your stop, commit 2a3225b), so nothing doubles. Same screens as 10:33 PM. Preview first (update 01a16db2-ea28-7dc3-94ba-8540e6a92427, group d7c796ae-674b-497c-8c0b-f05b09b97947), manifest checked, then republished to production. Commit 93f13d9. Update id: production 01a16db3-1586-7aef-a02a-29c69f9633f8 | fbb8d29e-117d-407c-bee3-a27d9bc389c1 | not published (iPhone uses the native app) |
| 24 Oct, 10:33 PM | Live trip ends at your stop with one You've arrived and never rolls on to the next train; each alert once with stable ids; no Lock screen button. Cleaner screens: Home, Plan, Ask and More tabs, one Plan screen, one Start trip button, fare shown once, stop alerts once, live trip without setup rows. Published to `preview` first (update 01a16daf-d2b9-7517-be3c-4873190ec543, group f2d49e91-7387-478a-9706-395b6b73a809), manifest checked (runtime 1.0.0, bundle hash matches the export), then republished to `production`. Commits 7e7397d and 93f13d9. Update id: production 01a16db0-5216-747a-a562-83f4e3bcb408 | 716bb629-4ac9-47a8-a632-c6056f7b2c4a | not published (iPhone uses the native app) |
| 24 Oct, 4:29 PM | Park and Ride live spaces with Nearly full alerts (station screen, trips from a Park and Ride station, Park and Ride list in Search); station access, lifts and live lift outages on station screens; step free and lift out marks on trip legs; Settings > Accessibility (Accessible trips sends acc=1, Lift outage alerts); Opal machine finder with a Takes cash filter; Ask parking and station cards; the Commute menu in Settings is a bottom sheet so all 5 actions show on Android. Commit 5eb62a5. Update ids: production 01a16c61-a7e2-7fa2-917b-ce685cbec033, expo-go 01a16c62-8dd2-7ff7-a98a-03f253205988 | d3be033e-c835-4084-a635-78c16cdc6664 | 11d4ee34-d711-4e8d-b80b-1ec7b82e5a8a |
| 24 Oct, 4:00 PM | Live trip tracking (Start trip, live map, next stop, countdown, stops left, get off and connection alerts, Share trip, ongoing notification with Share and End trip, Trip in progress bar); Opal fare estimates with a fare type setting; no hard coded stations; Recent trips and stops with Clear and Undo; saved trip Edit and Delete; Clear history and Delete all my data. Commits db1f3aa and the Edit trip fix after it. Update ids: production 01a16c46-b2d9-72bc-9251-2e1907293f77, expo-go 01a16c47-41a7-7fc3-8c8e-aeb2b447c653 | 644d626e-54bd-4927-ba1a-41b86f7a5a79 (republished over 646ed232-d5ba-4c93-95f7-5d1084bb4ca6 from 3:54 PM) | 874c3185-364f-4120-baf9-bea6dd4b673e (over f933e5e8-d6b1-42c8-9ea5-9b9282a9d234) |
| 24 Oct, 2:55 PM | Published with Android versionCode 5: the current JavaScript, including random install ids and the private profile page | ae1ab30a-fffe-413a-b3eb-054dc99ed2da | c2641a5f-66e8-4ad2-9fb0-a93797177115 |
| 24 Oct, 2:15 PM | Ask: several stops in one question, Open trip and Save trip open as a multi leg trip | 809a3a8e-74dd-4fb6-b082-2ace00c68948 (republished over 1e683ee4-ff26-4485-ade0-f1858ab1f73c) | edd8ad30-66d9-4347-b8de-1108c7dc2801 |
| 24 Oct, 1:50 PM | Multi leg trips: add, remove and reorder legs, change time per connection, walk legs, tight and missed connection warnings | c0bd6116-bf5f-49b4-8c7f-ef849f15092d | db5cefd5-b7fe-478e-bf63-a6fb114d64dd |
| 24 Oct, 11:45 AM | New trip by mode, confirm trip with extend and connection time, direct services with All services, drag to reorder | 6372d294-62c6-4557-a2e5-a683dc3b898b | 88b28c86-7280-4d9b-9ca2-d997d4ca0566 |
| 24 Oct, 9:19 AM | Ask tab: chat with live answers, cards open the board, trip or live map | 48f77045-bb8d-4445-a29b-ea75943a5d3b | 69c9d3d5-9c12-4c93-9c5d-5d0438de9e6a |
| 24 Oct, 8:32 AM | Trips: Add home and work, alerts banner, countdown colour by time left, crowding, skip departed, earlier and later services, travel time | 84710310-906e-4eb3-9b60-179ddae7da22 | 6b466af0-22c1-4c96-b576-d31c38b91955 |
| 24 Oct, 8:17 AM | Home redesign: live trip boards with countdowns, recent and nearby stops, add a trip | 33171cff-54ee-4c34-9135-5a290a0896c3 | f52734e8-023f-47ce-bdf6-62fd1751726a |
| 24 Oct, 7:40 AM | Live flag on the service sheet, all tab labels, one retry on dropped requests | 98632aea-4a22-443c-a7f5-173a01a0a876 (and fc26c497-f6ef-4015-bfdf-dbbab9468867 just before) | f51f20f7-3610-4a5d-a7ed-f2d24c39ed47 |
| 24 Oct, about 2 AM | Map fits the trip, labelled tabs | 4a6fec34-7921-4542-b1a0-63220072f97e | d92b1829-47d1-4d9c-9996-4ac096fde073 |
| 24 Oct, about 2 AM | Live alerts text and map fixes | dcb4e7d6-77e0-4d79-82b9-a707bf07628f | 5f86471e-c7a4-438b-984a-e841ba6b05f6 |
| 24 Oct, about 1:30 AM | First Expo Go previews | none | e000aa11-9766-4cc5-83b1-06dfdf926c0f, 4287579e-5d31-4d23-a0cd-0b82017faf87, 3db1bc27-f63e-4f61-ba26-af2cc678314a, 0272c9f6-f415-477c-8c00-c7db35ed144e |

## Web (backend, web app and site)

Until the switch: published to the first address (each publish replaces the whole site). From the switch: Cloudflare Worker `transport-api` at https://api.transportsydney.app and Pages at https://transportsydney.app, see [Deploy on Cloudflare](DEPLOY_CLOUDFLARE.md).

| Time (about) | Release | Commit |
| --- | --- | --- |
| 24 Oct, 2:15 PM | Ask with several stops, Open trip as a multi leg trip | 2be460a |
| 24 Oct, 1:55 PM | Multi leg trips and `/api/plan` | 1bed1c1, d7e5eb8 |
| 24 Oct, 1:37 PM | Ask: stations and suburbs before businesses, typo fixes, Did you mean, via | 9ac2c5a, bb563d7 |
| 24 Oct, 1:07 PM | Website launch checklist: landing page, 404, meta tags, favicon set, robots and sitemap, share image, terms, contact form with thank you page, page counter without cookies, per visitor profile on the web | bd8ed89 |
| 24 Oct, 11:45 AM | New trip by mode and `/api/stations` | 7ff789c |
| 24 Oct, 11:20 AM | Support page, rewritten privacy policy, data retention (90 and 30 days) | 388203e |
| 24 Oct, 8:32 AM | Trips home redesign | d46c5a4 |
| 24 Oct, about 1:30 AM | Release 4: download page, APK from R2, Expo push, `/api/app` | |
| 24 Oct, 12:41 AM | Release 3: watches with Web Push, connection rescue, commute memory, predictions, PWA, iOS style redesign; cron-job.org scheduler | |
| 24 Oct, about midnight | Release 2: auto refresh, Live and Scheduled badges, GTFS realtime, live vehicle map, saved trips | |
| 23 Oct, 5:14 PM | First release: stop boards, trip planning, alerts, nearby, text answers | |

Before 24 Oct, 11:45 AM the backend source lived only on the build machine and in a separate private repo; it has been in `backend/` of this repo since commit 7ff789c.
