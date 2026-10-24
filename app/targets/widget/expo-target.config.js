// Home screen widgets (small, medium, large), Lock Screen widgets (inline, rectangular, circular)
// and the trip Live Activity. Ported from ios-native/Sources/TransportWidget and TransportKit.
// App group: with IOS_APP_GROUP=1 (eas.json production) the widget is signed with the same group as the app
// (see app.config.js). apple-targets only syncs the app's groups when `entitlements` is set here, so it is set
// explicitly; build 202 shipped without it on the widget.
const APP_GROUP = 'group.com.maisysen.nswtransport';
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  entitlements:
    process.env.IOS_APP_GROUP === '1' ? { 'com.apple.security.application-groups': [APP_GROUP] } : undefined,
  type: 'widget',
  name: 'TransportWidget',
  displayName: 'Transport',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
  colors: {
    $accent: { color: '#0A84FF', darkColor: '#0A84FF' },
  },
};
