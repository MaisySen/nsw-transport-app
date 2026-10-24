# SUBMIT: what is left once the keys arrive

Everything that does not need a developer account login is done: code, privacy manifests, signed Android App Bundle,
store copy, screenshots and the support and privacy pages. What remains is below, in order. Each step is one action.

Identifiers: iPhone `com.maisysen.nswtransport` (widget `com.maisysen.nswtransport.widget`, app group
`group.com.maisysen.nswtransport`); Android `com.maisysen.nswtransport`. Nothing has been registered yet.

## What only Bidur can provide

1. App Store Connect API key with Admin access: the .p8 file, Key ID and Issuer ID, emailed to bidur@mail.tab.bot.
2. The Apple Team ID (developer.apple.com, Account, Membership details).
3. The seller or legal name for the copyright line, and a phone number for App Review contact.
4. Google Play Console invite to bidur@mail.tab.bot with Admin permission. Play invites need a Google account on that
   address; Tab creates one at accounts.google.com ("Use my current email address instead") and reads the code from that mailbox.
5. Play Console for a personal account: Google asks new personal developer accounts to run a closed test with at
   least 12 testers for 14 days before production access. Plan for that (friends with Android phones, opted in by email).

## iPhone: App Store

1. Create the app record (one time, web page; the API cannot create apps):
   App Store Connect, Apps, plus, New App. Platform iOS, name "Transport: Sydney Live" (fallback in store/apple/listing.md),
   language English (Australia), bundle ID com.maisysen.nswtransport (it appears in the list after step 2 runs once;
   if it is not there yet, run step 2 first, it registers the IDs), SKU nswtransport-ios-1, full access.
2. Add four repository secrets (GitHub, MaisySen/nsw-transport-app, Settings, Secrets and variables, Actions):
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the whole .p8 text), `APPLE_TEAM_ID`.
   From this box: `gh secret set ASC_KEY_P8 < AuthKey_XXXX.p8` and so on, or the GitHub API with the repo's public key.
3. Sign and upload to TestFlight: one CI run.
   Actions, "iOS TestFlight upload", Run workflow (or `gh workflow run ios-testflight.yml`).
   It archives with automatic signing through the API key (which creates the App IDs, the app group and the distribution
   certificate on first run), then uploads. Build numbers start at 101.
4. TestFlight: the build appears after processing (about 10 to 30 minutes). Add Bidur as an internal tester; the
   export compliance question is already answered in the app (ITSAppUsesNonExemptEncryption false).
5. Fill the version page from store/apple/: listing.md (name, subtitle, promo text, description, keywords, URLs,
   category), app-privacy.md (App Privacy), age-rating.md, review-notes.md. Upload screenshots from
   store/screenshots/apple-6.9/ and apple-6.5/. Pricing Free, availability Australia.
6. Select the TestFlight build on the version page and press Add for Review, then Submit.

## Android: Google Play

The signed bundle is built: `app/android/app/build/outputs/bundle/release/app-release.aab` on the build box
(copy: store pack out/transport-1.0.0-vc4.aab). versionCode 4, versionName 1.0.0, target API 36, signed with the same upload key
as the APK (certificate SHA-256 A3:BF:0D:9A:AB:AF:2C:51:22:17:32:12:94:61:4A:24:52:37:33:ED:16:39:B3:A4:11:B6:1A:13:87:E7:7E:EE).
To rebuild: `cd app && ./build-android-aab.sh` (needs ~/.nsw-secrets on the build machine; bump versionCode in app.json first).

1. Create the app (one time, web page): Play Console, Create app. Name "Transport: Sydney Live", default language
   English (Australia), App, Free. Accept the declarations.
2. Play App Signing: on the first upload choose "Use Google-generated key" (recommended). Our key then stays the
   upload key. Keep ~/.nsw-secrets/nsw-transport-release.jks and its password backed up; losing it means a key reset request.
3. Internal testing track: Testing, Internal testing, Create new release, upload the AAB, release name 1.0.0 (4),
   notes "First release.", Save, Review, Start rollout. The first upload of a new app must be done on this web page.
4. Later uploads are one command (needs a service account invited in Play Console, Users and permissions):
   `PLAY_SERVICE_ACCOUNT=key.json node store/play-upload.mjs app/android/app/build/outputs/bundle/release/app-release.aab internal`
5. App content (Policy, App content), from store/google/: privacy policy URL, Ads (no), App access (all
   functionality available without special access), Content rating (content-rating.md), Target audience (13 and
   over, not for children), Data safety (data-safety.md), Government apps (no), Financial features (none), Health (none).
6. Main store listing from store/google/listing.md, with icon-512.png, feature-graphic.png and the phone screenshots
   from store/screenshots/play/.
7. Closed test with 12 testers for 14 days if the account needs it, then Production, Create release, promote the same AAB, Submit.

## After launch

* Every iPhone update: bump MARKETING_VERSION in ios-native/project.yml when the version changes, push, then run
  "iOS TestFlight upload" (it picks a new build number on its own).
* Every Android update: bump versionCode in app/app.json, `./build-android-aab.sh`, then play-upload.mjs.
* JavaScript only changes on Android can still go out as an EAS Update on the production channel.

## Bidur's own phone

The iPhone App Store build is a new bundle ID, so it starts with an empty profile. To bring back the saved trips
from testing, open this link on the phone once after installing: `nswtransport://profile/bidur`, then close and reopen Transport.
The Android store build keeps the same package and upload key, so an existing install keeps its data.
