#!/bin/bash
# Boots an iPhone simulator, installs the simulator build and takes screenshots of each screen
# in light and dark mode, using the app's own nswtransport:// links to move between screens.
set -u
APP="$1"; OUT="$2"
mkdir -p "$OUT"
DEV=$(xcrun simctl list devices available | grep -E "iPhone (1[5-9]|2[0-9])( Pro)? \(" | grep -v Max | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
if [ -z "$DEV" ]; then DEV=$(xcrun simctl list devices available | grep iPhone | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'); fi
echo "simulator $DEV"
xcrun simctl boot "$DEV" || true
xcrun simctl bootstatus "$DEV" -b
xcrun simctl status_bar "$DEV" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 || true
xcrun simctl install "$DEV" "$APP"
BID=bot.tab.nswtransport
shot() { sleep "$2"; xcrun simctl io "$DEV" screenshot "$OUT/$1.png"; echo "shot $1"; }
for MODE in light dark; do
  xcrun simctl ui "$DEV" appearance $MODE
  xcrun simctl terminate "$DEV" $BID 2>/dev/null || true
  xcrun simctl launch "$DEV" $BID
  shot "${MODE}-1-home" 6
  xcrun simctl openurl "$DEV" "nswtransport://stop/213516"; shot "${MODE}-2-stop-strathfield" 8
  xcrun simctl terminate "$DEV" $BID; xcrun simctl launch "$DEV" $BID; sleep 3
  xcrun simctl openurl "$DEV" "nswtransport://stop/200060"; shot "${MODE}-3-stop-central" 8
  xcrun simctl terminate "$DEV" $BID; xcrun simctl launch "$DEV" $BID; sleep 3
  xcrun simctl openurl "$DEV" "nswtransport://track/213516"; shot "${MODE}-4-live-map" 12
  xcrun simctl terminate "$DEV" $BID; xcrun simctl launch "$DEV" $BID; sleep 3
  xcrun simctl openurl "$DEV" "nswtransport://trip/213410/10101100"; shot "${MODE}-5-trip-burwood-central" 10
  xcrun simctl openurl "$DEV" "nswtransport://tab/search"; shot "${MODE}-6-search" 3
  xcrun simctl openurl "$DEV" "nswtransport://tab/watching"; shot "${MODE}-7-watching" 4
  xcrun simctl openurl "$DEV" "nswtransport://tab/settings"; shot "${MODE}-8-settings" 3
done
xcrun simctl spawn "$DEV" log show --last 3m --predicate 'process == "Transport"' --style compact > "$OUT/app-log.txt" 2>/dev/null || true
ls -la "$OUT"
