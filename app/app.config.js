// One Expo project for Android and iPhone. Updates ship over the air on both (docs/RELEASES.md).
//
// Channels: an EAS build gets its channel from its eas.json profile (preview or production), and EAS writes it
// into the binary. A local build (build-android-aab.sh, expo prebuild) has no profile, so it gets
// APP_CHANNEL, or production when that is not set. That is how Android versionCode 5 was built.
//
// Runtime: builds 201 to 208 (and Android versionCode 5) were built with policy appVersion, so their runtime is
// "1.0.0". Build 209 adds native modules, so it has its own fixed runtime "1.1.0" (app.json runtimeVersion) while the
// App Store version stays 1.0.0 (the version record build 209 is attached to). An update for the older builds is
// published from the same commit with OTA_RUNTIME=1.0.0 (docs/BUILD_209_CHECKLIST.md); its JavaScript must
// feature detect everything 209 adds.
//
// iPhone app group: the widgets read the app's profile id through group.com.maisysen.nswtransport. The group is
// registered and ticked on both App IDs since 25 Oct 2026; the production profile builds with it (IOS_APP_GROUP=1
// in eas.json, from build 202). Build 201 has no group: the native module then falls back to its own defaults.
//
// Expo Go: the iPhone preview in Expo Go needs the SDK runtime and no channel header.
const APP_GROUP = 'group.com.maisysen.nswtransport';

module.exports = ({ config }) => {
  if (process.env.EXPO_GO === '1') {
    const { runtimeVersion, ...rest } = config;
    return { ...rest, runtimeVersion: 'exposdk:58.0.0', updates: { ...config.updates, requestHeaders: undefined } };
  }
  const easBuild = !!(process.env.EAS_BUILD || process.env.EAS_BUILD_PROFILE);
  // Only for eas update: publish the same JavaScript to the builds before 209. Never set for a build.
  const runtime = !easBuild && /^\d+\.\d+\.\d+$/.test(process.env.OTA_RUNTIME || '') ? process.env.OTA_RUNTIME : config.runtimeVersion;
  const updates = { ...config.updates };
  if (!easBuild) updates.requestHeaders = { 'expo-channel-name': process.env.APP_CHANNEL || 'production' };
  const ios = { ...config.ios };
  if (process.env.IOS_APP_GROUP === '1') {
    ios.entitlements = { ...(ios.entitlements || {}), 'com.apple.security.application-groups': [APP_GROUP] };
  }
  return { ...config, runtimeVersion: runtime, ios, updates };
};
