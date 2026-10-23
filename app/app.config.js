// Expo Go runs updates built for its SDK, so the Expo Go publish drops the native runtime version.
// The installed Android and iPhone builds use runtime 1.0.0 and the "production" channel.
module.exports = ({ config }) => {
  if (process.env.EXPO_GO === '1') {
    const { runtimeVersion, ...rest } = config;
    return { ...rest, runtimeVersion: 'exposdk:58.0.0', updates: { ...config.updates, requestHeaders: undefined } };
  }
  return config;
};
