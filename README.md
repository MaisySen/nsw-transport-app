# NSW Transport app

Private source for Bidur's NSW Transport apps. Both talk to the live backend at https://nsw-transport-bot.sites.tab.bot

- ios-native: the native iPhone app in SwiftUI (xtool and Xcode project). Built on GitHub's macOS runners by .github/workflows/ios-native.yml, which makes an unsigned .ipa and attaches it to a release. Install steps: ios-native/INSTALL.md
- app: the Expo app (React Native) used for the Android build
