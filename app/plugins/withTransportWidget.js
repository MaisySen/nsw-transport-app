// Adds the Android home screen widget (Next trip) to the native project on every prebuild.
// Sources live in plugins/widget so a clean prebuild keeps them.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const PKG = 'com.maisysen.nswtransport';

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const withWidgetFiles = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const main = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main');
      copyDir(path.join(root, 'plugins', 'widget', 'res'), path.join(main, 'res'));
      copyDir(path.join(root, 'plugins', 'widget', 'kotlin'), path.join(main, 'java', ...PKG.split('.'), 'widget'));
      return cfg;
    },
  ]);

const withWidgetManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.receiver = (app.receiver || []).filter((r) => r.$['android:name'] !== '.widget.TripWidgetProvider');
    app.receiver.push({
      $: { 'android:name': '.widget.TripWidgetProvider', 'android:exported': 'true', 'android:label': '@string/widget_trip_label' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/trip_widget_info' } }],
    });
    app.activity = (app.activity || []).filter((a) => a.$['android:name'] !== '.widget.TripWidgetConfigActivity');
    app.activity.push({
      $: {
        'android:name': '.widget.TripWidgetConfigActivity',
        'android:exported': 'true',
        'android:label': 'Choose a trip',
        'android:theme': '@style/Theme.AppCompat.DayNight.NoActionBar',
        'android:windowSoftInputMode': 'adjustResize',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_CONFIGURE' } }] }],
    });
    return cfg;
  });

module.exports = (config) => withWidgetManifest(withWidgetFiles(config));
