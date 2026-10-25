#!/bin/bash
# Screenshots of the iPhone widgets (Home Screen, a bus stop board with its stop number, Lock Screen, StandBy) and of
# the Apple Watch complications, for the EAS simulator check (.eas/build/watch-shots.yml). Never fails the build.
#
# A simulator cannot add a widget to its Home Screen or a complication to a watch face from a script, so this
# compiles the widget extension's own Swift files (and the complications' own files) together with a small drawing
# tool in tools/widget-shots, runs it on an iPhone simulator (and a watch simulator), and the tool draws the shipping
# views with live data into PNG files. Output: $HOME/shots/widgets and $HOME/shots/complications.
set +e
ROOT="$HOME/shots"
mkdir -p "$ROOT/widgets" "$ROOT/complications"
exec > >(tee "$ROOT/widgets/log.txt") 2>&1
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] || ARCH=arm64

# limit SECONDS command...: run a command, kill it after SECONDS (macOS has no timeout command).
limit() {
  local s=$1; shift
  "$@" &
  local p=$!
  # The watcher writes nothing and kills its own sleep when stopped, so no stray sleep keeps the step's output open
  # (build 70dd1762 waited out a 900 s sleep after the work was done).
  ( trap 'kill $! 2>/dev/null; exit 0' TERM; sleep "$s" & wait $!; kill -9 "$p" 2>/dev/null ) >/dev/null 2>&1 &
  local w=$!
  wait "$p"; local rc=$?
  kill "$w" 2>/dev/null
  return $rc
}

runtime() { # newest available runtime id for iOS or watchOS
  xcrun simctl list runtimes | grep "^$1 " | grep -v unavailable | tail -1 | sed -E 's/.* - (com\.apple\.CoreSimulator\.SimRuntime\.[A-Za-z0-9.-]+).*/\1/'
}
ids() { xcrun simctl list devicetypes | grep -E "$1" | sed -E 's/.*\((com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9.-]+)\).*/\1/'; }
newdevice() { # name, device type pattern, runtime: prints a device id; a new device of the newest model the runtime
  # takes, else any available device whose name matches the pattern (build 70dd1762 found no iPhone to create)
  local DT UDID
  for DT in $(ids "$2"); do
    UDID=$(xcrun simctl create "$1" "$DT" "$3" 2>>"$ROOT/widgets/simctl.txt") && [ -n "$UDID" ] && { echo "$UDID"; return 0; }
  done
  UDID=$(xcrun simctl list devices available | grep -E "$4" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
  [ -n "$UDID" ] && { echo "$UDID"; return 0; }
  return 1
}

# iPhone widgets
W=$(mktemp -d)
cp targets/widget/*.swift "$W/"
cp targets/widget/_shared/*.swift "$W/" 2>/dev/null
# The widget bundle's @main is the extension's entry point; the drawing tool has its own.
sed -i '' -E 's/^@main[[:space:]]*$//' "$W"/*.swift
cp tools/widget-shots/WidgetShots.swift "$W/"
echo "compiling the iPhone widget views"
if limit 900 xcrun --sdk iphonesimulator swiftc -target "$ARCH-apple-ios17.0-simulator" -parse-as-library \
    -module-name WidgetShots -Onone "$W"/*.swift -o "$W/widget-shots"; then
  RT=$(runtime iOS)
  echo "iOS runtime: $RT"
  xcrun simctl list devicetypes | grep -i iphone
  UDID=$(newdevice shots-iphone "iPhone [0-9]+( Pro Max| Pro)? \(" "$RT" "iPhone")
  echo "iPhone simulator: $UDID"
  if [ -n "$UDID" ]; then
    xcrun simctl boot "$UDID"
    limit 300 xcrun simctl bootstatus "$UDID" -b
    limit 300 xcrun simctl spawn "$UDID" "$W/widget-shots" "$ROOT/widgets"
    xcrun simctl shutdown "$UDID"
    xcrun simctl list devices | grep "$UDID" | grep -q "shots-" && xcrun simctl delete "$UDID"
  fi
else
  echo "the iPhone widget drawing tool did not compile"
fi

# Apple Watch complications
C=$(mktemp -d)
cp targets/watch-widget/Complications.swift targets/watch-widget/WatchCore.swift "$C/"
sed -i '' -E 's/^@main[[:space:]]*$//' "$C/Complications.swift"
cp tools/widget-shots/ComplicationShots.swift "$C/"
echo "compiling the complication views"
if limit 900 xcrun --sdk watchsimulator swiftc -target "$ARCH-apple-watchos10.0-simulator" -parse-as-library \
    -module-name ComplicationShots -Onone "$C"/*.swift -o "$C/complication-shots"; then
  RT=$(runtime watchOS)
  echo "watchOS runtime: $RT"
  UDID=$(newdevice shots-watch "Apple Watch (Series [0-9]+ \(46mm\)|Ultra [0-9]+ \(49mm\))" "$RT" "Apple Watch")
  echo "watch simulator: $UDID"
  if [ -n "$UDID" ]; then
    xcrun simctl boot "$UDID"
    limit 300 xcrun simctl bootstatus "$UDID" -b
    limit 300 xcrun simctl spawn "$UDID" "$C/complication-shots" "$ROOT/complications"
    xcrun simctl shutdown "$UDID"
    xcrun simctl list devices | grep "$UDID" | grep -q "shots-" && xcrun simctl delete "$UDID"
  fi
else
  echo "the complication drawing tool did not compile"
fi

ls -la "$ROOT/widgets" "$ROOT/complications"
exit 0
