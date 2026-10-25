// Apple Watch app (watchOS 10 and later): Home to Work by time of day, starred stops and the trip in progress.
// The iPhone app sends Home, Work, starred stops, the trip card and the server address through WatchConnectivity
// (modules/transport-ios/ios/WatchLink.swift); the watch loads live times itself.
// Signing: no App Group. The app and its complications share what they keep through a keychain group, which
// every App Store profile of the team allows (keychain-access-groups TEAM.*), so no portal change is needed.
// Bundle id com.maisysen.nswtransport.watchkitapp, its complications com.maisysen.nswtransport.watchkitapp.complications.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'TransportWatch',
  displayName: 'Transport',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  icon: '../../assets/images/icon.png',
  frameworks: ['SwiftUI', 'WatchConnectivity', 'WatchKit', 'WidgetKit'],
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.maisysen.nswtransport.watch'],
  },
  colors: {
    $accent: { color: '#0A84FF', darkColor: '#0A84FF' },
  },
};
