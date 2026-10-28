#!/bin/bash
# Local release build (native libs stored compressed and extracted on install, arm64 plus x86_64) of the Android app. Signing secrets come from ~/.nsw-secrets (never in the repo).
set -e
export ANDROID_HOME=/home/user/android-sdk ANDROID_SDK_ROOT=/home/user/android-sdk NODE_ENV=production
# Sentry (build 209): source maps upload only when SENTRY_AUTH_TOKEN is set; a local build without it skips the upload.
[ -n "$SENTRY_AUTH_TOKEN" ] || export SENTRY_DISABLE_AUTO_UPLOAD=true
cd /home/user/nsw-app
CI=1 npx expo prebuild --platform android --no-install
cd android
echo "sdk.dir=/home/user/android-sdk" > local.properties
python3 - <<'PY'
import json,re
k=json.load(open('/home/user/.nsw-secrets/android-keystore.json'))
p='app/build.gradle'; s=open(p).read()
if 'signingConfigs.release' not in s.split('buildTypes')[1]:
    s=s.replace("""    signingConfigs {
        debug {""","""    signingConfigs {
        release {
            storeFile file(System.getenv('NSW_KEYSTORE') ?: '/home/user/.nsw-secrets/nsw-transport-release.jks')
            storePassword System.getenv('NSW_KEYSTORE_PASSWORD')
            keyAlias 'nswtransport'
            keyPassword System.getenv('NSW_KEYSTORE_PASSWORD')
        }
        debug {""",1)
    head,tail=s.split('buildTypes',1)
    tail=re.sub(r"(release \{[^}]*?)signingConfig signingConfigs\.debug",r"\1signingConfig signingConfigs.release",tail,count=1,flags=re.S)
    s=head+'buildTypes'+tail
    open(p,'w').write(s)
g='gradle.properties'; t=open(g).read()
t=re.sub(r'android.enableMinifyInReleaseBuilds=true','android.enableMinifyInReleaseBuilds=false',t)
t=re.sub(r'expo.useLegacyPackaging=.*','expo.useLegacyPackaging=true',t)
t=re.sub(r'org.gradle.jvmargs=.*','org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g',t)
if 'org.gradle.workers.max' not in t: t+='\norg.gradle.workers.max=6\nkotlin.daemon.jvmargs=-Xmx2g\n'
open(g,'w').write(t)
PY
if [ "$1" = "--prebuild-only" ]; then exit 0; fi
export NSW_KEYSTORE_PASSWORD=$(python3 -c "import json;print(json.load(open('/home/user/.nsw-secrets/android-keystore.json'))['store_password'])")
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon --console=plain
ls -la app/build/outputs/apk/release/
echo BUILD_DONE
