# Sentry crash reporting (build 209)

Sentry catches crashes the app's own crash net cannot see: native crashes on iPhone and Android, and JavaScript errors with readable stacks. It needs the Sentry native module, so it starts working with native build 209 (1 Nov). Builds 201 to 208 run the same JavaScript over the air and keep the crash net's reports to the server's feedback inbox (see "Old builds" below).

Code: `app/src/lib/sentry.native.ts` (phones), `app/src/lib/sentry.ts` (web and type checks; does nothing), `app/src/lib/sentryCore.ts` (the cleaning, options and checks), `app/src/lib/crash.ts` and `app/src/app/_layout.tsx` (the hooks). Branch `sentry-build209`. Tests: `app/test/sentry209.test.mjs`.

## Where to look

* Sign in at https://fintex-australia-bk.sentry.io as dev@transportsydney.app (the password is in the credentials email; on the build box the DSN and tokens are in `/home/user/.nsw-secrets/sentry.json`, never in the repo). Organisation `fintex-australia-bk`, project `transport-sydney-live`, US region.
* Issues lists each distinct crash with how many phones and how many times. Filter by release (`com.maisysen.nswtransport@1.0.0+209`), by `dist` (the build number), by the `update` tag (first 8 characters of the over the air update id) or by `where` (`screen` for a screen the recovery screen caught; global errors and native crashes carry no `where`).
* Plan: a 14 day trial until 10 Nov 2026, then the free Developer plan on its own (5,000 errors a month, one person). No card, so nothing can be charged.
* A crash from build 209 shows: the error and its stack (symbolicated once source maps are uploaded, below), the release and build, the update id, OS and version, phone model. Nothing else.

## What is sent and what is not

Sent: the error type and its message (cleaned), the stack, release, dist, environment (the update channel), OS, phone model, app version, and for a native crash the native stack.

Never sent (`sentryCore.ts`, checked by `test/sentry209.test.mjs`):

* Stop, station, route or place names, positions, search text, query values, screen paths with an ID. `beforeSend` cleans every message, exception value, extra, tag and context: query values go (`?from=` stays, the value does not), coordinate pairs become `<pos>`, numbers of 4 or more digits (stop and trip IDs) become `<id>`, `/stop/2000338` becomes `/stop/<id>`, quoted names become `<text>`, and keys such as stop, place, location, name, install, profile and token are dropped.
* The phone's name (`contexts.device.name`), the time zone and locale (`contexts.culture`), the user, the request, the server name and the IP address. `sendDefaultPii` is false, and IP storage is off in the Sentry project's settings.
* Install or profile IDs: Sentry events carry none, so they cannot be tied to a phone's trips. (The feedback inbox report keeps the install ID, as before.)
* Screenshots, the view tree, session replay, profiling, traces, sessions, app hang reports, failed request capture, touches, screen changes, network requests and console lines. All are off in `sentryOptions` and the breadcrumbs that remain are cleaned or dropped.

Battery: tracesSampleRate 0, no profiling, no replay, no session pings, no frame or stall tracking, no timers. At most 10 events leave one run of the app, and offline or cancelled requests are ignored (`ignoreErrors`). Sentry sends an event only when an error happens.

Native crashes are sent by the native layer on the next launch and do not pass through the JavaScript `beforeSend`. They carry the native stack and an exception reason; with `sendDefaultPii` false the native layer does not add the phone's name or IP. A native exception reason that quotes a stop name would reach Sentry as written: not seen so far, check the first native crashes on build 209.

## Old builds (201 to 208)

They have no `RNSentry` native module. `sentry.native.ts` looks it up with `TurboModuleRegistry.get` (and `NativeModules`), never with `getEnforcing`, which throws on a build without it. Only when the module is found is `@sentry/react-native` loaded (a `require` inside `initSentry`), so its files never run on an old build. Without the module, `initSentry` returns false, `withSentry` returns the root layout unchanged and `captureToSentry` does nothing; the crash net sends to the feedback inbox exactly as before (`SELECT at, message, page FROM feedback WHERE page LIKE 'crash:%'`). No top level import of the SDK exists anywhere in `app/src` (a test fails if one appears).

Build 209 keeps the feedback inbox reports too, so both can be compared until Sentry has been seen working on a phone.

## How it hooks in

* `_layout.tsx` calls `initSentry()` first, then `installCrashReporter()`, and exports `withSentry(RootLayout)` (Sentry's `wrap`, with touches not recorded).
* A screen that throws: the existing error boundary calls `reportCrash`, which sends to Sentry (`captureToSentry`, tag `where`) and to the feedback inbox.
* A fatal JavaScript error outside a screen: the crash net's handler sends to the feedback inbox, then Sentry's own handler captures it and closes the app as before. `reportCrash(..., fatal = true)` does not also send to Sentry, so it is not counted twice.
* A native crash: Sentry's native layer only.

## Switch it off without an update

Set the app config flag `sentry` to false (or `kill.sentry`) on `/api/app/config?platform=android` (the app reads that platform on both iPhone and Android). The procedure is in [RUNBOOK.md](RUNBOOK.md), Remote config: a POST replaces the stored set, so post the full set. `beforeSend` then drops every JavaScript event; native crash reports would still be sent until the next build. The feedback inbox reports carry on.

## Source maps

* Native builds: the config plugin `@sentry/react-native/expo` (in `app/app.json`, organisation, project and URL only) adds an upload step to the Xcode and Gradle builds that EAS runs. It needs the EAS secret `SENTRY_AUTH_TOKEN` (the value is `auth_token` in the secrets file; only the name is written here):
  `cd app && npx eas-cli env:create --name SENTRY_AUTH_TOKEN --value "$SENTRY_AUTH_TOKEN" --environment production --visibility secret --non-interactive` (token passed through the environment from a mode 600 copy, deleted after).
* `eas.json`: the production profile sets `SENTRY_ALLOW_FAILURE=true`, so a missing or wrong token cannot fail a build (iOS builds are limited each month); read the build log for the Sentry upload lines instead. Preview and compilecheck set `SENTRY_DISABLE_AUTO_UPLOAD=true`. The local Android scripts skip the upload unless `SENTRY_AUTH_TOKEN` is set. The Gradle step has no allow failure switch: an Android EAS build needs the secret, or `SENTRY_DISABLE_AUTO_UPLOAD=true` for that build.
* Over the air updates: each update is a new bundle, so its maps are uploaded after `eas update` from the export folder: `SENTRY_ORG=fintex-australia-bk SENTRY_PROJECT=transport-sydney-live SENTRY_URL=https://sentry.io/ SENTRY_AUTH_TOKEN=... npx sentry-expo-upload-sourcemaps dist` (in `app/`). `metro.config.js` uses `getSentryExpoConfig`, which puts a debug ID in every bundle so these maps match. Without the upload the stack still arrives, in bundle positions.
* Release and dist are read on the phone (`expo-application`): `com.maisysen.nswtransport@<version>+<build>` and the build number. Nothing is hard coded.

## Privacy answers

App Store and Play now list crash data: [STORE_PRIVACY.md](STORE_PRIVACY.md). The privacy manifest in `app/app.json` lists Crash Data (not linked, no tracking, App Functionality). The published privacy policy also needs a crash reports line before build 209 is submitted (see STORE_PRIVACY.md).
