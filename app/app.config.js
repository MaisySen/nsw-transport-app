// One Expo project for Android and iPhone. Updates ship over the air on both (docs/RELEASES.md).
//
// Channels: an EAS build gets its channel from its eas.json profile (preview or production), and EAS writes it
// into the binary. A local build (build-android-aab.sh, expo prebuild) has no profile, so it gets
// APP_CHANNEL, or production when that is not set. That is how Android versionCode 5 was built.
//
// Runtime: policy appVersion, so the runtime is the "version" field (1.0.0). Android versionCode 5 was built
// with runtime 1.0.0, so it keeps getting updates. Change "version" only together with a new native build.
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
  const updates = { ...config.updates };
  if (!easBuild) updates.requestHeaders = { 'expo-channel-name': process.env.APP_CHANNEL || 'production' };
  const ios = { ...config.ios };
  if (process.env.IOS_APP_GROUP === '1') {
    ios.entitlements = { ...(ios.entitlements || {}), 'com.apple.security.application-groups': [APP_GROUP] };
  }
  return { ...config, ios, updates };
};
