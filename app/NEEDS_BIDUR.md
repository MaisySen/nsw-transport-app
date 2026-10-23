# What needs Bidur personally

Everything else is built and ready. These steps need your own identity or payment, so Tab cannot do them for you.

## iPhone: TestFlight and the App Store

1. Join the Apple Developer Program in your own name: https://developer.apple.com/programs/enroll/ (US$99 a year, paid in AUD by Apple). You need your Apple ID with two factor authentication on, your legal name and address, and payment. Individual enrolment is usually approved within a day or two. An organisation account needs a D-U-N-S number and takes longer.
2. Tell Tab when it is approved. Then Tab needs one of these from you, entered by you on a secure page, never in chat:
   * an App Store Connect API key (Users and Access, Integrations, App Store Connect API, Generate, role App Manager), which lets Tab build and upload without your password, or
   * you sign in once on Tab's secure login page so the build tool can create the certificates.
3. Tab then runs one build and one upload. The app appears in TestFlight for you within about 30 minutes of Apple processing it. Internal TestFlight testers (up to 100 people on your team) need no review.
4. App Store: Tab fills in the listing (text in store/listing.md, privacy policy at https://nsw-transport-bot.sites.tab.bot/privacy/), screenshots and the privacy answers. You press Submit for Review, or approve Tab doing it. Review usually takes one to three days.

## Android: Google Play

1. Create a Google Play developer account in your own name: https://play.google.com/console/signup (US$25 once). Google checks your ID and a phone number, and may ask for proof of address.
2. New personal accounts must run a closed test with at least 12 testers for 14 days in a row before the app can go public. Tab can set up the test track and the invite link; you need 12 people with Android phones to opt in.
3. Tab uploads the app bundle signed with the app's own upload key (already made and kept safe) and fills in the listing and the data safety form.

## Android push alerts when the app is closed

Needs a free Firebase project. Easiest is one made with your Google account: open https://console.firebase.google.com, Add project, name it Transport, then Add app, Android, package `com.maisysen.nswtransport`, and download google-services.json. Send it to Tab, or let Tab make the project if you would rather share a Google login through the secure page. Tab then uploads the key to Expo and ships the update.

## Nothing to do

* The Android app already installs from https://nsw-transport-bot.sites.tab.bot/download/ and updates itself.
* The iPhone preview already runs in Expo Go.
