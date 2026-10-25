#!/bin/bash
# Screenshots of the Apple Watch app from an EAS simulator build (.eas/build/watch-shots.yml). Never fails the build.
#
# The watch app is installed on a watch simulator on its own (no paired iPhone). Instead of the phone, this writes a
# context like the one the phone sends (three trips between real stops, no Home or Work) where the watch app reads
# it when it starts, so the watch then loads real live times from the server itself. -shotRoute opens the trip
# screen or a service screen once the times are in. Screens go to watch-shots/<device>-<n>-<screen>.png.
set +e
OUT="$PWD/watch-shots"
mkdir -p "$OUT"
exec > >(tee "$OUT/log.txt") 2>&1
BUNDLE=com.maisysen.nswtransport.watchkitapp

APP=$(find ios/build -type d -name "TransportWatch.app" -path "*watchsimulator*" 2>/dev/null | head -1)
[ -z "$APP" ] && APP=$(find "$HOME/Library/Developer/Xcode/DerivedData" -type d -name "TransportWatch.app" -path "*watchsimulator*" 2>/dev/null | head -1)
[ -z "$APP" ] && APP=$(find ios/build -type d -name "TransportWatch.app" 2>/dev/null | head -1)
echo "watch app: $APP"
[ -z "$APP" ] && { echo "no watch app found"; exit 0; }

xcrun simctl list runtimes
if ! xcrun simctl list runtimes | grep -q "watchOS.*com.apple"; then
  echo "no watchOS simulator runtime, downloading"
  timeout 1500 xcodebuild -downloadPlatform watchOS
  xcrun simctl list runtimes
fi
RT=$(xcrun simctl list runtimes | grep "watchOS" | grep -v unavailable | tail -1 | sed -E 's/.* - (com\.apple\.CoreSimulator\.SimRuntime\.[A-Za-z0-9.-]+).*/\1/')
echo "runtime: $RT"
[ -z "$RT" ] && exit 0
xcrun simctl list devicetypes | grep -i watch

CTX='{"v":2,"base":"https://api.transportsydney.app","profile":null,"home":null,"work":null,"flip":null,"starred":[],"live":null,"trips":[{"key":"201110>213510","name":"","kind":"mine","from":{"id":"201110","name":"Kings Cross Station, Potts Point"},"to":{"id":"213510","name":"Strathfield Station"},"plan":null},{"key":"213510>201110","name":"","kind":"mine","from":{"id":"213510","name":"Strathfield Station"},"to":{"id":"201110","name":"Kings Cross Station, Potts Point"},"plan":null},{"key":"200060>215020","name":"","kind":"mine","from":{"id":"200060","name":"Central Station"},"to":{"id":"215020","name":"Parramatta Station"},"plan":null}],"times":{}}'
HEX=$(printf '%s' "$CTX" | xxd -p | tr -d '\n')

shoot() { # device type id, short name
  local DT="$1" NAME="$2"
  local UDID
  UDID=$(xcrun simctl create "shots-$NAME" "$DT" "$RT")
  echo "$NAME: $DT -> $UDID"
  [ -z "$UDID" ] && return
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b
  xcrun simctl install "$UDID" "$APP" || { echo "install failed"; return; }
  xcrun simctl spawn "$UDID" defaults write "$BUNDLE" watch.context -data "$HEX"
  local i=1
  for R in list trip service; do
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1
    xcrun simctl launch "$UDID" "$BUNDLE" -shotRoute "$R"
    sleep 25
    xcrun simctl io "$UDID" screenshot "$OUT/$NAME-$i-$R.png"
    i=$((i + 1))
  done
  xcrun simctl shutdown "$UDID"
}

pick() { xcrun simctl list devicetypes | grep -E "$1" | tail -1 | sed -E 's/.*\((com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9.-]+)\).*/\1/'; }
S46=$(pick "Apple Watch Series 1[0-9].*46mm")
ULT=$(pick "Apple Watch Ultra")
[ -n "$S46" ] && shoot "$S46" series-46mm
[ -n "$ULT" ] && shoot "$ULT" ultra
ls -la "$OUT"
exit 0
