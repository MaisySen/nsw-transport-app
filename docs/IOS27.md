# iOS 27 and 27.1

What iOS 27, iOS 27.1 and watchOS 27 change for Transport, what the app does about each, and what is left. Checked 25 Oct 2026. Sources at the end; anything not read on an Apple or Expo page says so.

## Where the app stands

* **SDK.** Build 206 was built on the EAS image `macos-tahoe-26.6-xcode-27.1` (Xcode 27.1 RC 27A9275) with the iOS 27.1 SDK and the watchOS 27.0 SDK (read in the 206 build log). App Store Connect takes Xcode 27.1 RC builds since 5 Oct 2026. Apple requires the iOS 27 SDK for every upload from April 2027 (today: iOS 26 SDK), so 206 and later builds already meet that rule. No EAS image change is needed: with no `image` in eas.json the build uses `auto`, which picks `sdk-58` = Xcode 27.1 for Expo SDK 58.
* **Expo SDK.** The app is on Expo SDK 58 (expo 58.0.17, React Native 0.88), which Expo released on 15 Oct 2026 as "built for iOS 27". No SDK upgrade is needed. Newer patches exist (expo 58.0.19, expo-modules-core 58.0.26, expo-router 58.0.26) with memory fixes and new NativeTabs props, nothing iOS 27.1 needs; expo-router 58.0.26 has a breaking change to tab anchors. Not taken: the runtime stays 1.0.0 across builds, so a native package bump would also change the JavaScript that over the air updates send to builds 201 to 206.
* **Scene life cycle.** Apps built with the iOS 27 SDK must use the UIKit scene life cycle or they do not launch. SDK 58 prebuild writes `SceneDelegate.swift` and `UIApplicationSceneManifest` (both seen in the 206 build log and in a local prebuild). Our config plugins and `modules/transport-ios` do not touch the app delegate, `UIScreen.main` or `keyWindow`, so nothing of ours depends on the old life cycle.
* **Launch screen.** Required for iOS 27 SDK builds. `UILaunchStoryboardName` is `SplashScreen` (expo-splash-screen).
* **canOpenURL** is deprecated in iOS 27. Our code does not call it (a test checks).

## iOS 27.1 and iPhone Duo

iOS 27.1 is the release iPhone Duo (the foldable, on sale 23 Oct 2026) runs. Apps built with the iOS 27 SDK resize: open, the app fills the inner display; closed, the outer one. With the iOS 27.1 SDK (build 206) the app also fills the area by the status bar, and the bars can stand vertically on the right edge, so content has to keep clear of the left and right safe areas. The same goes for iPhone Mirroring and iPhone apps on iPad, which now resize freely, and orientation locks no longer stop resizing.

* Done by over the air update 25 Oct, 12:49 PM (group f71a36eb): every screen keeps clear of the left and right safe areas and stays at a readable width (672 pt, the UIKit readable width) in the middle of a wide window: `useSides()` in src/lib/layout.ts, used by `Screen`, the Ask list and bar, the new trip pickers, both sheets, the live trip and service map buttons and the Home snackbar. The board already did. No screen size is read once at start (a test checks), so a fold or unfold lays out again.
* The tab bar and headers are the system ones (NativeTabs, native stack), so iOS moves them itself.
* Layout rule for the floating tab bar and the glass bars (iOS 26 and 27): every screen is laid out under the navigation bar and, in a tab, under the tab bar; UIKit then insets only the first scroll view (automatic content inset). So: a scrolling screen uses `Screen` (or a list with `contentInsetAdjustmentBehavior="automatic"`); anything pinned to the bottom of a tab screen goes inside `TabBarSafe` (the native screen's bottom safe area: tab bar plus home indicator); anything pinned under the header uses the measured header height (`useHeaderHeight`, as the station picker does); a field that must stay above the keyboard uses `useKeyboardPad` (overlap measured in window points, no fixed offsets); never subtract or add a guessed bar height such as 34, 49, 83 or 90. Done for the Ask field and the Home undo bar by over the air update 25 Oct, 3:26 PM (group 1f00d18f); not yet checked on an iPhone.
* Not verified on an iPhone Duo or in its simulator. Worth a look on the device: the outer display with the bars on the right, the inner display, and folding during a live trip.
* App Store: from April 2027 every submission needs iPhone Duo screenshots.

## Design

* **App icon (build 207).** `assets/transport.icon` is an Icon Composer file (the Transport glyph on the brand blue) set as `ios.icon`, so iOS draws the light, dark, clear and tinted icons with Liquid Glass instead of putting a frame round a flat picture. Android and the web keep `assets/images/icon.png`. Made without the Icon Composer app (the glyph from the Android foreground layer, background `#2E8BFF`); worth opening in Icon Composer on a Mac to check it in both design generations.
* **Widgets (build 207).** On tinted and clear Home Screens (accented mode) and on the Lock Screen and StandBy at night (vibrant mode) every colour is drawn as one tint, so the filled line badge hid its own white text. Outside full colour the badge is now outlined. Lock Screen widgets and watch complications use plain text and were fine.
* **Liquid Glass.** Tab bar and headers are system ones. expo-glass-effect reports Liquid Glass as available in iOS 27 SDK builds.

## Native menus (update 25 Oct, 9:20 PM)

React Native's ActionSheetIOS uses its anchor only on iPad, so on iPhone every menu that went through it was the centred iOS 26 panel with capsule buttons and Cancel (Bidur, 8:42 PM). No menu goes through it now except on a build that lacks the native views below. Every native view is looked up first (`src/lib/nativeViews.ts`, `globalThis.expo.getViewConfig`); a build without it keeps the old sheet. All of these are compiled into builds 201 to 208, so this is JavaScript only.

| Menu | iPhone | Module | Android |
| --- | --- | --- | --- |
| + on Home | System bar button with a UIMenu (8:56 PM) | expo-router 58.0.25 `Stack.Toolbar.Menu` (react-native-screens 4.30.0 header items) | Material 3 menu under the + |
| Hold on a Home trip (Home and Work, commute, saved, your trips, recent) | Context menu: the trip lifts as the preview, the menu under it | expo-router 58.0.25 `Link.Menu` and `Link.MenuAction` (UIContextMenuInteraction, native view `ExpoRouterNativeLinkPreview`), New Architecture | Material 3 menu under the trip |
| Hold on a starred stop's name on Home | Context menu | expo-router `Link.Menu` | Material 3 menu |
| Hold on a Recent trip or stop in Search | Context menu | expo-router `Link.Menu` | Material 3 menu |
| Save this trip (the star on the trip screen) | System bar button with a UIMenu: Save trip, Save as Home, Save as Work | expo-router `Stack.Toolbar.Menu` | Material 3 menu under the star |
| Hold on a departure (stop screen, full board list, Home stop cards) | Context menu: Watch or Stop watching, Show stops (10:00 PM update; was an instant watch toggle) | expo-router `Link.Menu` through `HoldMenu` | Material 3 menu under the row |
| Settings: Opal fare type, Privacy and data, a commute | The row is a SwiftUI Menu: tapping it drops the pull-down menu from the row, the note as the section title | @expo/ui 58.0.22 `Host`, `Menu`, `Button`, `Section` (native views `ExpoUI` HostView, MenuView, Button, SlotView) | Material 3 menu under the row |

How: menus are data (`src/lib/menuCore.ts`: no Cancel row, destructive rows red and last, an SF Symbol and an Android icon for each row). `components/HoldMenu.tsx` wraps a row's own Pressable: on iPhone in `Link` with `asChild` and `Link.Trigger` around a plain view (the view the system lifts; Link's own tap is cancelled, so the row's tap still opens the trip), `Link.Menu` with the rows; elsewhere the row's long press measures the row and opens `AnchoredMenu`. `Link.Preview` is not used: it would mount the whole trip screen as the preview, from a tab stack into the root stack, which is not checked on a device. `components/RowMenu.ios.tsx` draws the Settings row in SwiftUI (29 pt icon tile, body text, secondary value, up and down chevron). VoiceOver and TalkBack: every menu row is also an accessibility action on the row (`withMenuActions`), after the row's own actions. `globalThis.__legacyMenus = true` in a development build tries the older build path; it does nothing in a release build.

Confirmations stay native alerts (Delete trip, Clear All, Delete all my data). The time picker and the reminder editor stay sheets: attached to the bottom edge, the system grabber, 16 pt corners, and a drag down on the grabber or the title bar closes them.

## Build 209 (1 Nov)

Native work left from the 25 Oct comfort, voice and performance pass (the JavaScript shipped over the air; these need a build):
* Speak only with headphones: build 208 has no audio route API (`TransportIOS.startSpeechAudio` sets the spoken audio session with duck others, so ducking already works). Add an `AVAudioSession.currentRoute` read and a route change event, then a Voice setting "Only with headphones".
* Voice download prompt: iOS has no API to download a Premium voice; the Voice screen's tip sends people to Settings > Accessibility > Spoken Content. Check `AVSpeechSynthesisVoice.speechVoices()` quality on iOS 27 again on a device.
* Simple mode as the app's home on a Lock Screen widget (the Here stand), using the widget extension already in the build.
* A native list (FlashList or SwiftUI List) for the stop board was not needed: scroll held 60 fps with 0 slow frames on the web export after this pass. Check on a device first.

## Other iOS 27 changes checked

* **Live Activities (ActivityKit):** nothing in the iOS 27 release notes that changes our use. Expo SDK 58 adds `staleDate` for its own Live Activity API; ours is a native module.
* **WidgetKit:** one fix (widgets whose intent has a `@UnionValue` parameter); we have none.
* **App Intents, Siri, Control Center:** schema renames (`calendar.deleteEvents`) and fixes; none touch our intents (App Shortcuts, OpenURLIntent controls).
* **Watch Connectivity:** fix for `transferCurrentComplicationUserInfo` with WidgetKit complications; we use application context.
* **watchOS 27:** `WKExtension` deprecated (the watch app uses the SwiftUI `App` life cycle and `WKApplication`); `TabView.selection` timing change (no TabView in the watch app).
* **SwiftUI:** `@State` initial values are now evaluated once (only good for us); TabView must not select a hidden tab (no SwiftUI TabView in the app).
* **Notifications, Core Location, EventKit, AVSpeechSynthesizer:** nothing in the iOS 27 release notes that changes our use. Add to Calendar stays add only (write only access). Calendar leave by asks for full access from build 208, with its own text; reading needs it ([CALENDAR-LEAVE-BY.md](CALENDAR-LEAVE-BY.md)).
* **Privacy:** no new required reason API categories found in the iOS 27 notes; App Privacy is published.
* **Network security:** stricter TLS applies to system processes (MDM, app installs), not apps; our hosts use HTTPS.

## App Review Guidelines (updated 16 Oct 2026)

* **2.5.19 (new):** no hidden, dormant or undocumented features. With **2.3.1(a)** (new features described in Notes for Review): the features that switch on when api.transportsydney.app answers (Plan B, weekend trackwork, line status, last train home and the rest) should be listed in Notes for Review at submission, saying they turn on when the server has data.
* **2.3.14 (new):** creative assets (product page header, search result art) must be about the app and carry no prices or unverifiable claims.

## Build 207 native list (branch native-207)

1. Liquid Glass app icon (Icon Composer file).
2. Widget line badges readable in accented and vibrant modes.
3. Nothing else iOS 27 needs: SDK, scene life cycle, launch screen and deployment target (iOS 17) are already right in 206.

## Sources

* Apple, Upcoming Requirements (page read): https://developer.apple.com/news/upcoming-requirements/
* Apple, App Store submissions now open for the latest OS releases, 9 Sep 2026 (page read; April 2027 iOS 27 SDK rule): https://developer.apple.com/news/?id=k1mtkt1k
* Apple, App Store Connect release notes (page read; Xcode 27.1 RC uploads 5 Oct, Xcode 27.1 15 Oct, iPhone Duo screenshots from April 2027): https://developer.apple.com/help/app-store-connect/release-notes/
* Apple, iOS & iPadOS 27 release notes (read): https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes
* Apple, watchOS 27 release notes (read): https://developer.apple.com/documentation/watchos-release-notes/watchos-27-release-notes
* Apple, Xcode 27 and 27.1 release notes (read): https://developer.apple.com/documentation/xcode-release-notes/xcode-27_1-release-notes
* Apple, TN3187 scene life cycle (read): https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle
* Apple, Preparing your app for iPhone Duo and Three steps for iPhone Duo (read): https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo , https://developer.apple.com/iphone-duo/prepare/
* Apple, App Review Guidelines and the 16 Oct 2026 update note (read): https://developer.apple.com/app-store/review/guidelines/
* Expo, SDK 58 changelog (read): https://expo.dev/changelog/sdk-58 ; scene life cycle guide: https://expo.fyi/ios-scene-lifecycle ; EAS build images: https://docs.expo.dev/build-reference/infrastructure/
* Build 206 EAS logs (880dc0f9): image, SDKs, SceneDelegate.
