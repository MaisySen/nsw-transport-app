# Build 209 checklist (Sunday 1 Nov 2026)

Every step for build 209, in order. Steps 2.1 to 2.8 were run on 30 Oct (branch `build-209`, readiness notes in CHANGELOG and TEST_PLAN); everything from step 3 on has not been run. Written 29 Oct from branch prep (task 9578965a); the reasons behind each item are in [IOS27.md](IOS27.md) "Build 209", [ROADMAP.md](ROADMAP.md) and [SENTRY.md](SENTRY.md) (on `sentry-build209`).

Hard rules for the day: main stays over the air safe for runtime 1.0.0 until build 209 is on TestFlight and checked; no App Store submit without Bidur's written yes; no secret in the repo, a log or a commit (the repo is public); the Expo free plan allows 15 iOS builds a month and resets on 1 Nov, so plan for 2 (one simulator compile check, one production build).

## 30 Oct: built early on a GitHub hosted Mac

The owner asked for 209 on 30 Oct (2:44 PM). The Expo Free plan had no iOS builds left for October (15 of 15; they come back at 1 Nov 00:00 UTC, 11 AM Sydney), so steps 4 and 5 run as one `eas build --local` on GitHub Actions instead: `.github/workflows/ios-209-local.yml` (manual trigger, build-209 only, runner `xcode-27` with Xcode 27.1). There is no separate simulator compile check: the production archive is the first compile. Signing uses the app profile "Expo Transport AppStore 209" (made 30 Oct through the App Store Connect API after Time Sensitive was ticked; the old app profile went invalid) plus the unchanged widget and Watch profiles, delivered as the Actions secret `IOS209_CREDENTIALS_TGZ`. Upload is to App Store Connect for TestFlight only; steps 6 and later are unchanged (Bidur's phone check and written yes before any App Store submit).

## Build 210 = runtime 1.2.0 (30 Oct)

Build 210 is built from `build-209` with `"runtimeVersion": "1.2.0"` in `app/app.json` (build number 210, App Store version still 1.0.0). Reason: from 30 Oct main's nightly update is published to runtime 1.0.0 (builds 201 to 208) and 1.1.0 (build 209), and `build-209` carries JavaScript main does not have yet (Live Activity stop track in `app/platform/tripCard.ts`, get off voice and server get off client, widget refresh). On 1.1.0, build 210 would download main's bundle at its first launch and lose all of that.

* **OTAs for 1.2.0 must come from `build-209` (or from main after `build-209` is merged).** Never publish main as it is today to 1.2.0.
* Main's runtime is unchanged (policy appVersion, 1.0.0). Main has no `OTA_RUNTIME` override (that lives in `app/app.config.js` on this branch only), so a 1.1.0 update from main needs the runtime set in a throwaway working copy (step 9) and the manifest read back.
* In the steps below, "1.1.0" describes build 209. For build 210 read 1.2.0 wherever the runtime is checked: step 2.7 prebuild (`Expo.plist` EXUpdatesRuntimeVersion 1.2.0, Android `expo_runtime_version` 1.2.0) and step 5.2 (IPA runtime 1.2.0). `.github/workflows/ios-209-local.yml` stops before the build when build 210 or later is on runtime 1.0.0 or 1.1.0, and fails the IPA check when the IPA's runtime is not `app/app.json`'s.
* Sentry release naming is `com.maisysen.nswtransport@1.0.0+210`, dist 210 (bundle id, version and build number; the runtime is not part of it), so nothing changes there.

## 0. What is ready (29 Oct)

| Branch | Head | What it carries | Checked |
|---|---|---|---|
| `sentry-build209` | f8479c2 | Sentry crash reports (native module, config plugin, metro serializer, privacy manifest Crash Data), guarded so builds 201 to 208 never load it | app tests, tsc on the branch (27 Oct) |
| `island-209` | 3e77300 | Short Dynamic Island: station with a colon on the left, self updating countdown on the right | Swift not compiled yet |
| `widget-209` | 310783d | Widgets drop Live after the app's rule (5 min, 2 min within 10 min of the service, by the feed's own time), iPhone and Android | app 887 pass, 0 fail; the pure rule compiled with swiftc and kotlinc on Linux; widget views not compiled for a phone |
| `raptor-status-fix` | d0b6264 | Server: `/api/raptor/status` names a sleeping planner copy's pack (not a build item; merged to main 600b5e5 and live as transport-api 2d6170e4 since 29 Oct, 9:51 AM) | backend 616 of 616 |
| `int-209` | 24baebd | Throwaway: main 4c9544b + the three app branches + runtime 1.1.0 + time sensitive entitlement, squashed. Never merge it into main; rebuild it on the day | app 897 pass, 3 skipped, 0 fail; tsc clean; `expo prebuild --no-install` ok |

## 1. Owner decisions before building (ask Bidur, one message)

1. Runtime 1.1.0 for build 209 (proposed; needed because 209 adds native modules). App Store version stays 1.0.0.
2. OK to use 2 of November's 15 iOS builds.
3. He saves the Crash Data answer in App Store Connect, App Privacy (not linked to the user, not used for tracking), before any App Store submit.

## 2. Make the build branch (`build-209`)

1. Fresh clone. `git checkout -b build-209 origin/main` (latest main, after the 31 Oct freeze night).
2. Merge in this order: `origin/sentry-build209`, `origin/island-209`, `origin/widget-209`. On 29 Oct the only conflicts were docs: `docs/FEATURES.md` (put the Sentry section before "Not in the app", keep main's "Not in the app", which already names Sentry) and `docs/IOS27.md` (keep both sides; the widget bullet from `widget-209`). No code conflicts.
3. Fix the `docs/STORE_PRIVACY.md` line that says "not changed on this branch".
4. Runtime and version in `app/app.json` (as on `int-209`): `"version": "1.0.0"` unchanged, `"runtimeVersion": "1.1.0"` (a fixed string instead of policy appVersion), `ios.buildNumber` `"209"` (main still says 206; 207 and 208 set it on their branch), and `app/app.config.js` from `int-209` (the `OTA_RUNTIME` override, see step 9). Also `app/eas.json` production `"autoIncrement": false` (as on `native-207`): main has it true, and with `appVersionSource` local EAS would turn 209 into 210 at build time. Done on `build-209` (30 Oct).
5. Time sensitive notifications: `"entitlements": { "com.apple.developer.usernotifications.time-sensitive": true }` under `ios` in `app/app.json`, and tick Time Sensitive Notifications on the App ID `com.maisysen.nswtransport` in the Apple Developer site (Bidur's account; the App Group stays ticked).
6. `cd app && npm ci`.
7. Tests, all must pass with 0 failures:
   * `cd app && OFFLINE=1 TZ=Australia/Sydney node --test test/*.test.mjs` (includes the battery test; on 29 Oct `int-209` gave 897 pass, 3 skipped with kotlinc on the PATH, 896 and 4 skipped without)
   * `cd app && npx tsc --noEmit`
   * `cd backend && TZ=Australia/Sydney node --test test/*.test.mjs`
   * `cd app && CI=1 IOS_APP_GROUP=1 npx expo prebuild --no-install`, then check: `ios/Transport/Supporting/Expo.plist` EXUpdatesRuntimeVersion 1.1.0, `ios/Transport/Info.plist` CFBundleShortVersionString 1.0.0, `ios/Transport/Transport.entitlements` has the time sensitive key, `android/app/src/main/res/values/strings.xml` expo_runtime_version 1.1.0, `android/.../widget/WidgetLive.kt` present. Then `rm -rf ios android` and delete `targets/watch/Assets.xcassets/AppIcon.appiconset` (prebuild writes it, and press.test fails while it is there). Rerun the app tests if prebuild ran before them.
8. Push `build-209` through the GitHub API with force false. Do not merge it into main yet.

## 3. Secrets (EAS, never in the repo)

1. `SENTRY_AUTH_TOKEN` as an EAS secret for production: `cd app && npx eas-cli env:create --name SENTRY_AUTH_TOKEN --value "$SENTRY_AUTH_TOKEN" --environment production --visibility secret --non-interactive`, the value read from `/home/user/.nsw-secrets/sentry.json` (`auth_token`) into the environment from a mode 600 copy, deleted after. Never echo it.
2. Check `eas.json` on the branch: production has `SENTRY_ALLOW_FAILURE=true` (a bad token cannot fail the iOS build); preview and compilecheck have `SENTRY_DISABLE_AUTO_UPLOAD=true`. An Android EAS build needs the secret or `SENTRY_DISABLE_AUTO_UPLOAD=true`.
3. Expo token for the CLI: read from `/home/user/.nsw-secrets/expo.json` into a mode 600 file, pass as `EXPO_TOKEN` in the subprocess only, delete after.

## 4. Compile check (iOS build 1 of 2)

1. `npx eas-cli build --platform ios --profile compilecheck --non-interactive` from `build-209`.
2. Read the log: ARCHIVE or BUILD SUCCEEDED; no errors and no new warnings under `app/targets` (first compile of `island-209` and `widget-209` Swift: `WidgetLive.swift`, `TransportWidgets.swift`, `LiveTripActivityWidget.swift`). Sentry pod installed.
3. If it fails: fix on `build-209`, rerun step 2.7 tests, and only then spend the next build.
4. Apple Watch screenshots from this simulator build, with no personal stations.

## 5. Production build and TestFlight (iOS build 2 of 2)

1. `npx eas-cli build --platform ios --profile production --non-interactive`. In the log: the Sentry source map and debug file upload lines (a failed upload only warns).
2. Check the IPA before submitting: 1.0.0 (209) on the app, widget, watch app and complications; runtime 1.1.0; channel production; app entitlements include `com.apple.developer.usernotifications.time-sensitive`, `aps-environment` production and the App Group; `get-task-allow` false on all targets; privacy manifest lists Crash Data; no `UIBackgroundModes`.
3. `npx eas-cli submit --platform ios --profile production --latest --non-interactive`. Wait for VALID in App Store Connect, answer export compliance (no non exempt encryption), set What to Test (en-AU, en-US).
4. Add to the Internal group. Public group `36f40c38` only after Bidur's phone check (step 6), then submit for Beta App Review.
5. Record in `docs/RELEASES.md` (build table row: EAS build id, commit, submission id, App Store Connect build id), `docs/STATE.md`, `CHANGELOG.md`.

## 6. Bidur's phone check (TestFlight Internal) and results to show him

Before any App Store submit, send Bidur one short message with the results below and ask for his yes.

1. Automated results from step 2.7: app tests (count, 0 fail), battery, tsc, backend, prebuild checks.
2. Compile check and production build ids, both green; Sentry upload line present or the warning.
3. His device check ([TEST_PLAN.md](TEST_PLAN.md) device checklists for 207 and 208 plus these):
   * Ten cold opens: no crash, times on the first screen.
   * Home, a trip, a stop board, a live trip.
   * Get off now with a Focus on: breaks through as Time Sensitive (Settings > Notifications > Transport shows Time Sensitive).
   * Dynamic Island while following a trip: station with a colon left, countdown right, system clock visible.
   * Widgets: leave a home screen widget for 6 minutes with the phone in Airplane mode: rows lose Live, show timetable times, "No live data" and "Updated N min ago". Same check on Android if a build is made.
   * A Live Activity goes stale 2 minutes after its live times with no network.
   * Watch app and complications.
   * A test Sentry event reaches the dashboard with release `com.maisysen.nswtransport@1.0.0+209`, dist 209, and no stop names, positions, IDs or the phone's name.
4. Anything that failed, with the fix plan.

## 7. Review notes recheck (before attaching 209)

1. Reread `docs/APP_REVIEW_NOTES.md` (in App Store Connect 1.0.0 as a draft since 28 Oct) against `build-209`: every server switched feature still listed, the 5 minute freshness rule, now also stated for widgets; add Time Sensitive notifications (used only for Get off now) and Sentry crash reports (errors only, cleaned on the phone).
2. Keep it under 4000 characters; save the draft and read it back so it matches the repo file exactly. `backend/test/review-notes.test.mjs` must still pass.
3. App Privacy: Crash Data saved by Bidur (step 1.3). Privacy policy lines from `docs/STORE_PRIVACY.md` published on transportsydney.app/privacy.

## 8. App Store submission (only with Bidur's written yes)

1. Attach build 209 to version 1.0.0 (208 is attached today).
2. Upload the Watch screenshots from step 4.4.
3. Bidur presses Submit, or tells Tab to in writing. Record it in RELEASES and STATE.

## 9. After 209: over the air updates to both runtimes

1. Merge `build-209` into main only after 209 is on TestFlight and checked. From then main carries native code, so every JavaScript change must feature detect what 209 adds (Sentry is already guarded).
2. Each night's update is published twice from the same commit: once as is (runtime 1.1.0, build 209) and once with `OTA_RUNTIME=1.0.0` (builds 201 to 208). Until `build-209` is merged, main has neither runtime 1.1.0 nor the `OTA_RUNTIME` override: a 1.1.0 update from main is published from a throwaway working copy with `"runtimeVersion": "1.1.0"` set in `app/app.json` (not committed), and the 1.1.0 manifest is read back before production. Build 210 is runtime 1.2.0: its updates come only from `build-209` (or main after the merge), published as is. Check both manifests (runtime and bundle hashes) before production, and record both group ids and both rollback targets.
3. After each update on 209, upload its source maps to Sentry (`npx sentry-expo-upload-sourcemaps dist`, SENTRY.md).
4. Done 29 Oct, 9:51 AM: `raptor-status-fix` merged (main 600b5e5) and deployed as transport-api 2d6170e4 with verify-deploy and a 13 min watch (server only).
