# Getting the app on your iPhone

## Today, with a free Apple ID (about 15 minutes, once)

You need: your iPhone, a USB cable, and a Windows PC or a Mac. Your Apple ID and password only ever go into Sideloadly or AltStore on your own computer, straight to Apple.

**Sideloadly (Windows or Mac, simplest)**

1. On the computer, install iTunes and iCloud from apple.com (Windows only, not the Microsoft Store versions), then Sideloadly from https://sideloadly.io.
2. Download `Transport-unsigned.ipa` from the newest release in the GitHub repo (Releases, "iPhone app build").
3. Plug in the iPhone, tap Trust on the phone.
4. Open Sideloadly, drag the .ipa in, type your Apple ID, press Start. Enter the code Apple sends you.
5. On the iPhone: Settings, General, VPN and Device Management, tap your Apple ID, Trust.
6. Turn on Developer Mode if iPhone asks: Settings, Privacy and Security, Developer Mode, then restart.
7. Open Transport. Allow notifications when you watch your first trip.

Every 7 days the app stops opening until it is signed again: plug in and press Start in Sideloadly again (your data stays). Sideloadly can also refresh over Wi-Fi.

**AltStore (refreshes itself every week)**

1. Install AltServer on the computer from https://altstore.io and install AltStore onto the iPhone from it (same Trust and Developer Mode steps as above).
2. Send the .ipa to the iPhone (AirDrop, Files, or download it on the phone), open AltStore, My Apps, the plus button, pick the .ipa.
3. Leave AltServer running on the computer on the same Wi-Fi. AltStore refreshes the app in the background before the 7 days run out.

**xtool on a Mac or Linux PC** (for building from source): see README.md. `xtool dev` builds, signs with your Apple ID and installs over USB in one step.

## What a free Apple ID cannot do

* Push notifications from the server (Apple keeps the push entitlement for paid accounts). The app posts local notifications while it runs and on background refreshes instead, and the Live Activity countdown keeps ticking on the Lock Screen by itself.
* More than 3 sideloaded apps at once, or living longer than 7 days without a refresh.
* TestFlight and the App Store.

## TestFlight, once you have a paid Apple Developer account

1. Enrol in the Apple Developer Program in your own name at https://developer.apple.com/programs/enroll (US$99 a year, A$149 in Australia, needs your Apple ID with two factor auth and your ID; takes from minutes to a couple of days).
2. In App Store Connect, Users and Access, Integrations, create a Team API key with the App Manager role. Download the .p8 file once.
3. Give Tab the key id, issuer id and the .p8 file (Tab never needs your password). With those, the build signs with a distribution certificate and uploads to TestFlight from GitHub Actions (or `xtool setup` with the API key option).
4. In App Store Connect create the app record "Transport" with bundle id `bot.tab.nswtransport` (and the widget `bot.tab.nswtransport.widget`), add yourself as an internal tester, then install TestFlight on the iPhone. Builds arrive there and last 90 days, no 7 day re-signing.
5. Push notifications then work too: the same key lets the server send APNs alerts, which also lights up the Live Activity updates from the server.

## App Store (last step)

Everything for the listing is ready in `AppStore/` (name, subtitle, description, keywords, privacy answers). It needs screenshots from the CI run, a support URL, and App Review.
