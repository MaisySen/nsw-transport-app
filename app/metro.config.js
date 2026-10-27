// Metro with Sentry's serializer (build 209, docs/SENTRY.md): each bundle gets a debug ID, so the source maps
// uploaded by the build (and after an over the air update) match the stack traces Sentry receives. It changes no
// code that runs on the phone; builds without the Sentry native module never load the SDK (src/lib/sentry.native.ts).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
