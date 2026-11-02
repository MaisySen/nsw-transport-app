# Trip alerts spoken in headphones with the iPhone locked or on Silent (2 Nov 2026)

Bidur, 2 Nov 3:12 PM: "Silent mode. Airpod or headphone on. App talks only when app opened ?" and 3:18 PM: "Find a way to do this from in app". Branch `fix-voice-locked-2nov` (from `fix-island-2nov` b56560d, the next build's lineage). Native: needs the next build. Not built, not published.

## What the rider gets

* Start trip with Speak alerts on, AirPods or wired headphones in, lock the phone, ring switch on Silent: the app keeps following the live train and says each trip moment into the headphones at its moment, the same words as with the app open: the heads-up ("Cove is next"), Get off now (Kylie's clip, or the words), the arrival, delays and platform changes. Music is lowered and a podcast is paused while it talks.
* On the phone's speaker nothing is said from the lock (the Silent switch keeps its meaning, Bidur's choice of 1 Nov); the push's own sound rings as before.
* The push still shows every banner. While the app is speaking, the push's spoken sounds are silent copies, so with the ring switch on nothing is heard twice.
* More > Speak alerts in headphones (on by default; shown on builds that have it). Tapping the row explains it and names the iPhone's own Announce Notifications as well.
* The location indicator (blue pill) shows while the app runs for the trip, as for any guidance app.

## Options looked at

| Option | Plays on Silent, in headphones, locked? | Verdict |
| --- | --- | --- |
| a) Background location for the running trip (When In Use, UIBackgroundModes location) + speech in a playback audio session (UIBackgroundModes audio, voicePrompt mode) | Yes: a playback session is not muted by the Silent switch, and with the audio background mode it can start while the app runs in the background. The app runs because it is receiving location updates in the background, which When In Use allows when the updates were started in front with `allowsBackgroundLocationUpdates` (the indicator shows). | Chosen, only while a trip runs and headphones are in |
| b) Notification Service Extension making a spoken sound | No: a notification sound follows the ring switch (Bidur's own test on 2 Nov: Silent, AirPods in, nothing heard from the push). The Kylie clips already are the push sound. | Not used for speech. (An extension could also drop the sound per push, but that needs a new target, a provisioning profile and a server change; the silent copies below do the same with neither.) |
| c) Critical Alerts entitlement | Yes, but Apple grants it only for health, medical, public safety and security apps. A transit app does not qualify. | No |
| d) Siri Announce Notifications | Siri reads a notification in AirPods; the person chooses Time Sensitive (our Get off now is Time Sensitive) or All in Settings > Notifications > Announce Notifications. The app cannot switch it on. | Kept as the second way: named in the row's help |
| expo-location background updates (`startLocationUpdatesAsync`) | Needs Always permission on iOS in Expo (expo/expo#15066) and a task manager module | No: an Always prompt is a step back. The small native session below needs When In Use only. |
| Keep the app alive with a silent audio loop | Plays, but App Review 2.5.4 rejects audio background used for anything but audible content | No |

Evidence:
* App Review Guidelines 2.5.4: background services only for their intended purposes (location, audio playback): https://developer.apple.com/app-store/review/guidelines/
* `allowsBackgroundLocationUpdates` (needs UIBackgroundModes location): https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates
* `CLBackgroundActivitySession`: lets a When In Use app keep receiving location updates in the background: https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession-3mzv3
* `interruptSpokenAudioAndMixWithOthers` (pause spoken audio such as podcasts, mix with music; the option for voice prompts): https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/interruptspokenaudioandmixwithothers
* Speech from the background is silent without the audio background mode and a playback session: https://stackoverflow.com/questions/79765569/ios-app-not-playing-audio-from-background-despite-correct-permission-setup
* `UNNotificationSound`: iOS looks for a sound in the app container's Library/Sounds, then the App Group's Library/Sounds, then the bundle: https://developer.apple.com/documentation/usernotifications/unnotificationsound (also https://developer.netcore.ai/docs/custom-sound)
* Critical Alerts entitlement: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts
* Announce Notifications (Time Sensitive and Direct Messages, or All): https://support.apple.com/en-us/102536
* Expo background location needs Always on iOS: https://docs.expo.dev/versions/latest/sdk/location/ and https://github.com/expo/expo/issues/15066

## How it works

Native (modules/transport-ios/ios):
* `TripAwake.swift`: `CLLocationManager` with `allowsBackgroundLocationUpdates = true`, `showsBackgroundLocationIndicator = true`, `pausesLocationUpdatesAutomatically = false`, `kCLLocationAccuracyHundredMeters`, 100 m distance filter, `.otherNavigation`, and a `CLBackgroundActivitySession` on iOS 17+. Started only with the app in front (Start trip, or opening the app during a trip). A 15 s timer and each new position (at most every 5 s) send `onTripWake` to JavaScript. It stops itself at the deadline JavaScript gives (30 min after the trip's last arrival, at most 4 h), when location is turned off for the app, and when the app is closed. Never prompts; `tripAwakeStatus()` says "ok" only with When In Use (or Always) and both background modes in Info.plist (setting `allowsBackgroundLocationUpdates` without the mode would crash, so it is checked first). The position is not read or sent anywhere.
* `QuietClips.swift`: silent 16 bit WAV copies of `getoff_soon`, `getoff_now` and `arrival` in the app's Library/Sounds, which iOS takes before the bundle's clips. In place only while JavaScript renews a 45 s lease and the headphones are in; removed on headphones out (route change), on stop, on app close (`willTerminate`) and at every launch.
* `startVoiceAudio()`: `.playback`, `.voicePrompt`, `[.duckOthers, .interruptSpokenAudioAndMixWithOthers]`. `ClipPlayer` (Kylie's clips in headphones) uses the same options now.
* Info.plist: `UIBackgroundModes` audio and location. The When In Use text adds: "On a trip, it keeps spoken alerts going in your headphones while your iPhone is locked." No Always, no Critical Alerts.

JavaScript:
* `src/lib/lockedVoiceCore.ts` (pure, tested): when the session is wanted (iPhone, the build has it, the switch on, the trip speaks, location ok, a trip running until 1 min after the arrival; in the background only with headphones in or out under 5 min), the voice state for the trip flow's voice gate (V1 to V6 unchanged: the moment must be now, from a live reading under 60 s, never a catch-up from before the voice was there), the action filter, the push read-out and the quiet lease.
* `src/lib/lockedVoice.ts`: carries them out. `liveEngine.ts`: every refresh calls `lockedStep`; in the background the engine runs only while the app voices the locked trip, else nothing runs, as before. While voicing: no banner of the app's own when the server watches the trip (the server's push is the banner, as when locked before), speech through the playback session, and a heads-up, Get off now or arrival push from the server that the app had not said itself in the last 3 minutes is read out in the push's words (the server stays the source of truth; nothing is said twice either way).
* The trip state, the voice gate and the server are unchanged (no `tripState.ts` or `liveCalc.ts` change, so the server's copy is the same).

## One voice

| Situation | Before | Now |
| --- | --- | --- |
| Locked, headphones, Silent | push banner, no sound | banner, the app says it in the ears |
| Locked, headphones, ring on | the push's Kylie clip in the ears | banner, the push sound is the silent copy, the app says it once |
| Locked, speaker, Silent | banner, no sound | the same (the app does not run without headphones) |
| Locked, speaker, ring on | the push's clip | the same |
| App closed during a trip | push as before | push as before: the copies are removed on close. If iOS ends the app without notice (memory) or it crashes, the copies stay until the next launch: that trip's push clips are silent, banners and taps still come |
| App open | in-app voice, push soundless | unchanged |

## App Review

Review Notes text (the whole Notes field for the next build is in docs/APP_REVIEW_NOTES.md, 3992 of 4000 characters). The new paragraph:

```
BACKGROUND (2.5.4)
Audio and location run in the background only on a trip the user started, with headphones in: like turn by turn guidance, the app follows the live train and speaks Get off now in the headphones (When In Use, indicator shown). It stops at arrival, End trip or 5 min without headphones; More > Speak alerts in headphones turns it off.
```

and step 5 ends "With headphones in, lock the phone: alerts are still spoken (BACKGROUND)." If App Review asks for a video, record: Start trip, AirPods in, lock, Silent on, hear Get off now.

## Battery

* Location: about 100 m accuracy from cell and Wi-Fi, 100 m filter, only during a trip, only in the background while headphones are in. The trip refresh in the background is the same as with the app open: one live read every 15 s (a few hundred bytes with poll tags), no screen. Expect about the cost of a podcast app playing for the trip's length; measure on device (below).
* Nothing runs without a trip, after the arrival, or with the switch off.

## Android (not built)

The same needs a foreground service of type `location` (or `mediaPlayback`) with its ongoing notification while a trip runs, and TTS through `AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`; Android plays that on headphones regardless of the ringer mode. The existing ongoing trip notification could host it. Not part of this branch.

## Test on the phone (next build)

1. More: Speak alerts in headphones is on, location says ok (allow While Using if asked).
2. Start a trip with Speak alerts on, AirPods in, ring switch on Silent, lock the phone. The blue location pill shows.
3. Heads-up, Get off now and the arrival are heard in the AirPods at their moments; music lowers, a podcast pauses.
4. Ring switch on, same trip: each moment heard once (no Kylie clip from the push on top).
5. Take the AirPods out while locked: the next push rings on the speaker as before; after 5 minutes the pill goes.
6. Arrive: within a minute the pill goes. End trip early: the pill goes at once.
7. Close the app from the app switcher during a trip: the next push sounds with Kylie's clip (the silent copies are gone).
8. Battery: note the percentage over a 30 min trip with and without the switch.
9. Settings > Notifications > Announce Notifications > Transport: Siri also reads the banner. With both on, expect Siri and the app; one of the two is enough (iOS lets an app read whether Announce is on, `UNNotificationSettings.announcementSetting`, a possible follow up to skip the app's voice then).

## Risks

* iOS might cache a notification sound by name; the silent copy trick is documented order, but must be seen on the phone (step 4). If it does not work, the ring on double is the fallback (no loss: Silent is the main case).
* Background JavaScript timers: the native 15 s wake drives every background refresh, so the app does not rely on JavaScript timers while locked.
* App Review may ask about the location background mode; the notes and the indicator answer it.
