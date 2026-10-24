// Complications and Smart Stack widgets for the Apple Watch app (targets/watch): rectangular "T1 4 min, Plat 2",
// a circular countdown, inline and corner. Embedded in the watch app. Shares the keychain group of the watch app,
// no App Group.
//
// apple-targets gives a watch-widget the main app's App Groups unless the entitlements name the key. The key is
// named here but not enumerable, so the plugin leaves the groups out and nothing writes the key: the complications
// App ID needs no App Group ticked on developer.apple.com.
const entitlements = { 'keychain-access-groups': ['$(AppIdentifierPrefix)com.maisysen.nswtransport.watch'] };
Object.defineProperty(entitlements, 'com.apple.security.application-groups', { value: [], enumerable: false });
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch-widget',
  name: 'TransportWatchWidget',
  displayName: 'Transport',
  bundleIdentifier: 'com.maisysen.nswtransport.watchkitapp.complications',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  entitlements,
  colors: {
    $accent: { color: '#0A84FF', darkColor: '#0A84FF' },
    $widgetBackground: { color: '#FFFFFF', darkColor: '#000000' },
  },
};
