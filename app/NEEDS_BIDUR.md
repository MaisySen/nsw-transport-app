# What needs Bidur personally

Everything else is built and ready. These steps need your own identity or payment, so Tab cannot do them for you.

## iPhone: TestFlight and the App Store

1. Join the Apple Developer Program in your own name: https://developer.apple.com/programs/enroll/ (US$99 a year, paid in AUD by Apple). You need your Apple ID with two factor authentication on, your legal name and address, and payment. Individual enrolment is usually approved within a day or two. An organisation account needs a D-U-N-S number and takes longer.
2. Tell Tab when it is approved. Then Tab needs one of these from you, entered by you on a secure page, never in chat:
   * an App Store Connect API key (Users and Access, Integrations, App Store Connect API, Generate, role App Manager), which lets Tab build and upload without your password, or
   * you sign in once on Tab's secure login page so the build tool can create the certificates.
3. Tab then runs one build and one upload. The app appears in TestFlight for you within about 30 minutes of Apple processing it. Internal TestFlight testers (up to 100 people on your team) need no review.
4. App Store: Tab fills in the listing (text in store/apple/listing.md, privacy policy at https://nsw-transport-bot.sites.tab.bot/privacy/), screenshots and the privacy answers. You press Submit for Review, or approve Tab doing it. Review usually takes one to three days.

## Android: Google Play

1. Create a Google Play developer account in your own name: https://play.google.com/console/signup (US$25 once). Google checks your ID and a phone number, and may ask for proof of address.
2. New personal accounts must run a closed test with at least 12 testers for 14 days in a row before the app can go public. Tab can set up the test track and the invite link; you need 12 people with Android phones to opt in.
3. Tab uploads the app bundle signed with the app's own upload key (already made and kept safe) and fills in the listing and the data safety form.

## Android push alerts when the app is closed

Today Android alerts (leave now, get off, lift outages, car park nearly full) only show while the app is open. Settings > Alerts says "Alerts need the app open" until this is done. Alerts with the app closed need Google's Firebase Cloud Messaging. Tab has not created any account for this.

What Bidur provides:

1. **A Firebase project** made with your own Google account: open https://console.firebase.google.com, Add project, name it Transport. Google Analytics is not needed; turn it off.
2. **google-services.json**: in the project, Add app, Android, package name `com.maisysen.nswtransport`, app nickname Transport, no SHA-1 needed. Download google-services.json at the end.
3. **The FCM V1 service account key**: Project settings, Service accounts, Firebase Admin SDK, Generate new private key. This downloads a JSON file. It is a secret: email it to your Tab's own mailbox (the address is in the private fintex-runbook repo), never in WhatsApp, a chat or this repo.
4. Email google-services.json to the same mailbox too (it is not a secret, but keep it with the key).

What Tab then does:

1. Uploads the service account key to the Expo project credentials (Android, FCM V1) and deletes the emailed copy.
2. Adds google-services.json to the app (`android.googleServicesFile` in app.json). This is a native change, so it ships as a new APK, versionCode 6, signed with the same key, installed over the current app with your data kept.
3. Checks a real alert on your phone with the app closed (Settings > Send a test alert), then updates the Play Data safety notes.

## Nothing to do

* The Android app already installs from https://nsw-transport-bot.sites.tab.bot/download/ and updates itself.
* The iPhone preview already runs in Expo Go.
