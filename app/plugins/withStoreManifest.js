// Store build: removes manifest entries the app does not use, so Play does not ask for
// foreground service declarations. Background location is not used; nearby stops only read
// the location while the app is open.
const { withAndroidManifest } = require('expo/config-plugins');

const REMOVE_SERVICES = [
  'expo.modules.location.services.LocationTaskService',
  'expo.modules.location.next.locationForegroundService.LocationForegroundService',
];

module.exports = function withStoreManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app.service = app.service || [];
    for (const name of REMOVE_SERVICES) {
      app.service = app.service.filter((s) => s.$['android:name'] !== name);
      app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return cfg;
  });
};
