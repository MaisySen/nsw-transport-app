// Adds the Android home screen widgets (Next trip, Departure board), the long press app icon shortcuts
// and allowBackup=false to the native project on every prebuild.
// Sources live in plugins/widget so a clean prebuild keeps them.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withMainActivity } = require('expo/config-plugins');

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
    app.receiver = app.receiver.filter((r) => r.$['android:name'] !== '.widget.BoardWidgetProvider');
    app.receiver.push({
      $: { 'android:name': '.widget.BoardWidgetProvider', 'android:exported': 'true', 'android:label': '@string/widget_board_label' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/board_widget_info' } }],
    });
    const configs = [
      ['.widget.TripWidgetConfigActivity', 'Choose a trip'],
      ['.widget.BoardWidgetConfigActivity', 'Choose a stop'],
    ];
    app.activity = (app.activity || []).filter((a) => !configs.some(([n]) => a.$['android:name'] === n));
    for (const [name, label] of configs) {
      app.activity.push({
        $: {
          'android:name': name,
          'android:exported': 'true',
          'android:label': label,
          'android:theme': '@style/Theme.AppCompat.DayNight.NoActionBar',
          'android:windowSoftInputMode': 'adjustResize',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_CONFIGURE' } }] }],
      });
    }
    // Security: no cloud or adb backup of the app's data (the profile id is the key to saved trips).
    cfg.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    app.$['android:allowBackup'] = 'false';
    delete app.$['android:fullBackupContent'];
    delete app.$['android:dataExtractionRules'];
    const rep = new Set(String(app.$['tools:replace'] || '').split(',').filter(Boolean));
    rep.add('android:allowBackup');
    app.$['tools:replace'] = [...rep].join(',');
    return cfg;
  });

// Shortcuts and widgets follow the app: rebuilt when it opens and when you leave it.
const HOOK = `
  override fun onResume() {
    super.onResume()
    com.maisysen.nswtransport.widget.ShortcutSync.sync(this)
  }

  override fun onPause() {
    super.onPause()
    com.maisysen.nswtransport.widget.ShortcutSync.onLeave(this)
  }
`;
const withShortcutHook = (config) =>
  withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('ShortcutSync')) {
      src = src.replace(/override fun getMainComponentName\(\)/, HOOK.trimStart() + '\n  override fun getMainComponentName()');
    }
    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) => withShortcutHook(withWidgetManifest(withWidgetFiles(config)));
