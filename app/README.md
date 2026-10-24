# Transport app (Android and iPhone)

Transport: Sydney Live, by Fintex Australia Pty Ltd. One Expo (React Native, TypeScript, expo-router) codebase that talks to the live backend. The server address is written once, in `src/lib/server.ts`, and remote config can move it (see docs/API.md, Remote config). Privacy and support: https://transportsydney.app/privacy and https://transportsydney.app/support.

Get it: the download page on the server (`/download/`), until the store listings are live.

* Android: a signed APK, installed straight from the download page. It updates its own JavaScript over the air from the `production` channel each time it opens.
* iPhone today: a preview in the free Expo Go app (EAS Update, `expo-go` channel).
* iPhone for real: TestFlight, then the App Store, once there is an Apple Developer account. See NEEDS_BIDUR.md.

## What it does

* Home: your commutes, saved trips and starred stops as live cards, plus what you are watching.
* Stop boards with a ticking countdown, Live or Scheduled on every row, platform changes, crowding and alerts. Refresh every 15 seconds while open, pull to refresh.
* Trip planner: live leave in countdown, every leg with platform and delay, change times, tight changes flagged. Save a trip as Home or Work.
* Service view: the vehicle on a live map (Apple Maps on iPhone, MapLibre with OpenStreetMap data on Android) with the stop list in a pull up sheet.
* Watch anything: swipe left on a departure, or tap Watch this trip. Alerts for leave now, delays, platform changes, cancellations, connection rescue and arriving at your stop.
* Native tab bar (UITabBar on iPhone, Material bottom navigation on Android), large titles, haptics, swipe actions, light and dark mode, Dynamic Type.

## Notifications

The backend sends each alert to every place a device is registered: Web Push for the web app, and Expo push (APNs for iPhone, FCM for Android) for the native app.

* `POST /api/push/expo` `{device, profile, token, platform, welcome}` saves an Expo push token.
* `POST /api/push/expo/unregister` `{device, token}` removes it.
* While the app is open it also polls `/api/watches` and shows any alert that push did not deliver as a local notification.

Android builds need a Firebase project (google-services.json and an FCM key uploaded to Expo) before closed app push works. Until then Android alerts arrive while the app is open or in the background. Expo Go on iPhone gets real push through Expo.

## Build

```bash
npm install
npx tsc --noEmit
npx expo start                      # dev server, open in Expo Go
./build-android.sh                  # local signed release APK (keystore and password come from ~/.nsw-secrets, never this repo)
npx eas-cli update --branch production --environment production --platform android   # over the air update for installed APKs
EXPO_GO=1 npx eas-cli update --branch expo-go --environment production --platform ios  # Expo Go preview (move the android folder aside first)
npx eas-cli build -p ios --profile production   # TestFlight build, once an Apple Developer account exists
npx eas-cli submit -p ios --profile production
```

Bundle id and package: `com.maisysen.nswtransport`. Expo project: `@bidurtab/nsw-transport`.

## Layout

* `src/app` routes: `(tabs)/home`, `(tabs)/search`, `(tabs)/watching`, `(tabs)/settings`, `stop/[id]`, `trip`, `service`, `watch/[id]`
* `src/components` UI kit, transit rows, cards, platform maps (`TransitMap.ios.tsx`, `TransitMap.android.tsx`, web preview in `TransitMap.tsx`)
* `src/lib` API client, live refresh hook, local store, push, watch helpers
* `store/` store listing and privacy policy text
