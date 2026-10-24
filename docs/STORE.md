# App Store and Google Play

Where submission stands and what is waiting on Bidur. Updated 24 Oct 2026, 5 PM.

Both apps are ready to submit except for the steps that need Bidur's developer accounts. Nothing has been registered, created or paid for yet.

* Step by step submission checklist: [SUBMIT.md](../SUBMIT.md)
* Store pack (listing text, privacy answers, ratings, review notes, attribution, audit): [store/](../store/README.md)
* Policy audit with every blocker found and fixed: [store/AUDIT.md](../store/AUDIT.md)
* Screenshots: [store/screenshots/](../store/screenshots/)

## Identifiers

| Item | Value |
| --- | --- |
| Proposed name | Transport: Sydney Live (fallback: Transport Live: Sydney NSW; availability not checked yet) |
| Subtitle | Trains, buses, metro, ferries |
| iPhone bundle id | `com.maisysen.nswtransport` (widget `com.maisysen.nswtransport.widget`, app group `group.com.maisysen.nswtransport`) |
| Android application id | `com.maisysen.nswtransport` |
| Version | iPhone 1.0 (build 8 in CI; TestFlight builds start at 101). Android 1.0.0, versionCode 5 (JavaScript kept current by over the air updates) |
| Minimum OS | iOS 17.0, iPhone only. Android 7.0 (API 24), target API 36 |
| Category | Navigation (Apple), Maps & Navigation (Play) |
| Support URL | https://nsw-transport-bot.sites.tab.bot/support/ |
| Marketing URL | https://nsw-transport-bot.sites.tab.bot/?about |
| Privacy policy | https://nsw-transport-bot.sites.tab.bot/privacy/ |

## Status

| Item | Apple | Google |
| --- | --- | --- |
| App code ready (privacy manifests, attribution, no shared data, offline start) | Done | Done |
| Signed build | Waiting on API key and Team ID (CI signs automatically once they exist) | Done: signed AAB, versionCode 5 (kept on the build box, same upload key as versionCode 4) |
| Listing text and privacy answers | Done | Done (Data safety and content rating redone 24 Oct for Share trip, lift and car park alerts) |
| Screenshots | Done: 6.9 inch light and dark, 6.5 inch light, from CI with live data | Done: 6 phone shots (rendered at phone size, to be replaced with device captures), feature graphic, 512 icon |
| App record in the console | Not created (needs Bidur's account) | Not created (needs Bidur's account) |
| Upload | Not started | Not started |
| Review | Not started | Not started; a new personal account needs a closed test first |

## Waiting on Bidur

1. **App Store Connect API key** with Admin access: the `.p8` file, Key ID and Issuer ID, emailed to bidur@mail.tab.bot (App Store Connect, Users and Access, Integrations, App Store Connect API, Generate).
2. **Apple Team ID** (developer.apple.com, Account, Membership details).
3. **Seller or legal name** for the copyright line and the terms page.
4. **A phone number for App Review** contact.
5. **Google Play Console invite** to bidur@mail.tab.bot with Admin permission. Google needs a Google account on that address, which Tab can create and verify from the mailbox.
6. **12 testers for 14 days** if the Play account is a new personal account: Google requires a closed test before production. Friends with Android phones, opted in by email.

## Once the keys arrive

1. Add repo secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`.
2. Create the App Store Connect record (web page, one time).
3. Run "iOS TestFlight upload". The build appears in TestFlight after processing.
4. Create the Play app, upload the AAB to internal testing on the web page (first upload must be manual), fill App content from `store/google/`.
5. Later Play uploads: `node store/play-upload.mjs` with a service account.

## Notes for Bidur's own phone

The App Store build has a new bundle id, so it starts with an empty profile. Open the private profile link Tab sent (`nswtransport://profile/` followed by your own id) once on the phone after installing to get the saved trips back. The id is private, so it is not written here. The Play build keeps the same package and key, so an existing Android install keeps its data.

The old shared test profile is retired: an Android install still on it moves to a fresh private id on its next launch and saves its phone's trips again there, and a profile link to the shared id is refused.

## Before the first Play upload

* Push alerts with the app closed need Firebase (see [app/NEEDS_BIDUR.md](../app/NEEDS_BIDUR.md)). Until then Settings says "Alerts need the app open".
* The next native build (versionCode 6) drops `BIND_GET_INSTALL_REFERRER_SERVICE`, which a dependency added and the app never uses (blocked in app.json). Re-check [store/google/permissions.md](../store/google/permissions.md) against that build with aapt2.
* The Expo project is Android only. The App Store app is ios-native/; an iOS build of the Expo project is refused by app/app.config.js.
