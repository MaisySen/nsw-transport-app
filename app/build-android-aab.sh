#!/bin/bash
# Signed release App Bundle (.aab) for Google Play, with the same upload key as the APK.
# Signing secrets come from ~/.nsw-secrets on the build machine (never in the repo):
#   android-keystore.json with store_password, and nsw-transport-release.jks (or set NSW_KEYSTORE).
# Output: android/app/build/outputs/bundle/release/app-release.aab
set -e
export ANDROID_HOME=${ANDROID_HOME:-/home/user/android-sdk} ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-/home/user/android-sdk} NODE_ENV=production
# Sentry (build 209): source maps upload only when SENTRY_AUTH_TOKEN is set; a local build without it skips the upload.
[ -n "$SENTRY_AUTH_TOKEN" ] || export SENTRY_DISABLE_AUTO_UPLOAD=true
cd "$(dirname "$0")"
SKIP_APK=1 ./build-android.sh --prebuild-only
cd android
if [ -z "$NSW_KEYSTORE_PASSWORD" ]; then
  export NSW_KEYSTORE_PASSWORD=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.nsw-secrets/android-keystore.json')))['store_password'])")
fi
./gradlew bundleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64 --no-daemon --console=plain
ls -la app/build/outputs/bundle/release/
echo AAB_DONE
