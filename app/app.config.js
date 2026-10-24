// The iPhone app in the stores is the native SwiftUI app in ios-native/. This Expo project is
// Android only, plus the iPhone preview in Expo Go, so an iOS native build of it is refused here.
// Expo Go runs updates built for its SDK, so the Expo Go publish drops the native runtime version.
// The installed Android builds use runtime 1.0.0 and the "production" channel.
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PLATFORM === 'ios' || process.env.EXPO_IOS_NATIVE_BUILD === '1') {
    throw new Error('This Expo project is not the iPhone app. Build the iPhone app from ios-native/.');
  }
  if (process.env.EXPO_GO === '1') {
    const { runtimeVersion, ...rest } = config;
    return { ...rest, runtimeVersion: 'exposdk:58.0.0', updates: { ...config.updates, requestHeaders: undefined } };
  }
  return config;
};
