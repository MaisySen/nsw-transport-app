// Home screen widgets (small, medium, large), Lock Screen widgets (inline, rectangular, circular)
// and the trip Live Activity. Ported from ios-native/Sources/TransportWidget and TransportKit.
// App groups follow the app: see IOS_APP_GROUP in app.config.js.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
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
