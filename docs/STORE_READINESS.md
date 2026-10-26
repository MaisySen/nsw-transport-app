# Store readiness: App Store and Google Play

State on 25 Oct 2026, 8 AM Sydney. Legend: DONE, BIDUR (needs Bidur's own login, identity or decision), BUILD (needs a new native build; an over the air update cannot do it).

Listing texts: store/apple/listing.md, store/google/listing.md. Privacy answers: docs/STORE_PRIVACY.md. Screenshots: store/screenshots/.

## App Store (app 6826543653, com.maisysen.nswtransport, team Bidur Khatri, individual)

| Item | State | Note |
| --- | --- | --- |
| Version record 1.0.0 | DONE | Was 1.0; set to 1.0.0 to match the build |
| Build attached | DONE | Build 201 (Expo, 1.0.0). It replaced build 107, an old Swift build |
| Name, subtitle | DONE | Transport: Sydney Live; Trains, buses, metro, ferries |
| Description, keywords, promotional text | DONE | Rewritten for the Expo app: no Siri claim (the Expo build has no Siri shortcuts) |
| Support, marketing, privacy policy URLs | DONE | transportsydney.app /support/, /, /privacy/ |
| Copyright | DONE | 2026 Fintex Australia Pty Ltd |
| Category | DONE | Navigation, secondary Travel |
| Age rating | DONE | Every item None or No, 4+ |
| Content rights | DONE | Uses third party content (TfNSW Open Data, CC BY 4.0) |
| Price and availability | DONE | Free, Australia only |
| Export compliance | DONE | usesNonExemptEncryption false in app.json; build 201 reports false, so nothing to answer |
| App Review contact and notes | DONE | Bidur Khatri, contact@fintex.au, his mobile (on file in App Store Connect, App Review Information; not written here because the repo is public; change it there if another number should get Apple's calls). Notes rewritten for the Expo build |
| Screenshots 6.9 inch and 6.5 inch | DONE | 5 each, uploaded |
| App Privacy | BIDUR | No API for it. 5 minutes of clicks, steps in docs/STORE_PRIVACY.md |
| Test build 201 on a real iPhone | BIDUR | TestFlight: Home, Plan, Ask, Start trip (Live Activity), a widget, a watched service alert |
| App Group group.com.maisysen.nswtransport | BUILD | Registered and ticked on both App IDs on 25 Oct (commit 9f739d0): eas.json production now builds with IOS_APP_GROUP=1 and buildNumber 202, so widgets see saved trips and starred stops from build 202 |
| Unused location and motion purpose strings | BUILD | Build 201 carries Expo's default "Allow Transport to access your location" (Always), "...detect your current motion activity" and a full accuracy string. The app never asks for these, but vague strings can draw a guideline 5.1.1 question. app.json now removes them and gives the When In Use string a full reason. Next iPhone build |
| Privacy manifest data types | BUILD | Build 201 lists none; app.json now lists Device ID, Search History, Other User Content, Precise Location to match App Privacy. Next iPhone build |
| Submit for Review | BIDUR | Not submitted. Recommended order: App Privacy, then iPhone build 202 from a main that has commit "Store readiness" (purpose strings, manifest, App Group), Tab attaches 202 in place of 201, then Submit |

## Google Play (com.maisysen.nswtransport)

Android Publisher API, 25 Oct 2026 8 AM, edits.insert as tab-publisher@fintex-play.iam.gserviceaccount.com: HTTP 404 "Package not found: com.maisysen.nswtransport." The app does not exist in Play Console yet, or the service account has no access to it.

| Item | State | Note |
| --- | --- | --- |
| Signed App Bundle | DONE | versionCode 5, signed with the upload key, kept on the build box (docs/RELEASES.md) |
| Listing text | DONE | store/google/listing.md (title, short and full description, category Maps and Navigation, contact support@transportsydney.app, privacy URL) |
| Phone screenshots | DONE | 5 at 1080 x 2160, Android look |
| Feature graphic 1024 x 500, icon 512 | DONE | store/screenshots/play/ |
| Data safety answers | DONE (text) | docs/STORE_PRIVACY.md; entered in Console once the app exists |
| Content rating answers | DONE (text) | store/google/content-rating.md |
| Create the app in Play Console | BIDUR | All apps > Create app: Transport: Sydney Live, English (Australia), App, Free, accept the declarations |
| Give the service account access | BIDUR | Users and permissions > Invite new users > tab-publisher@fintex-play.iam.gserviceaccount.com, app Transport: Sydney Live, with Release and Store presence permissions. After that Tab fills the listing, graphics, tracks and uploads by API |
| First upload | BIDUR | Upload the versionCode 5 AAB once in Console (Testing > Internal testing), which also turns on Play App Signing. Tab sends the file |
| Closed test, 12 testers for 14 days | BIDUR | Only if the developer account is a personal account made after Nov 2023. An organisation account (Fintex) does not need it |
| App content forms | BIDUR (Tab can fill once access is given) | Privacy policy URL, ads No, app access (no login), target audience 18+, government app No, news No, data safety, content rating (IARC questionnaire) |
| Play App Signing SHA256 in assetlinks.json | BIDUR then Tab | Read from Console after the first upload; Tab adds it to site/.well-known/assetlinks.json |
| Push alerts with the app closed | BUILD | Needs Firebase (NEEDS_BIDUR.md) and versionCode 6 |
| Exact alarms, App Links intent filter | BUILD | versionCode 6 |

## Compliance checked in code (25 Oct 2026)

* No em or en dashes in app/src, app.json, the widget target, site/, store/ or docs/.
* Permissions: iPhone asks only for location when in use and notifications; Android declares coarse and fine location, notifications and vibrate, and blocks background location, foreground service, microphone, storage and overlay.
* No login, so account deletion is not required; More > Delete all my data deletes everything the server keeps for the install (scope all) and resets the phone.
* No ad, analytics, crash or attribution SDK in app/package.json. No tracking, NSPrivacyTracking false, so App Tracking Transparency is not needed.
* TfNSW attribution: More > About says "Data from Transport for NSW (CC BY 4.0) and OpenStreetMap contributors. Not made or endorsed by Transport for NSW."
* Every screen works without an account.
