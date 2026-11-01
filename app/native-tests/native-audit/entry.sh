#!/bin/bash
# Back paths from outside the app (1 Nov 2026, Bidur on build 214: "Widget missing back button or app screen?").
# Opens every link the widgets, Lock Screen, StandBy, Live Activity, Dynamic Island, Control Center and Siri use, the
# way iOS does (simctl openurl), with the app closed (cold) and already open (warm), and keeps a picture of the screen
# that lands. The pictures show whether that screen has a way back to the app. No signing, no server: the app's API
# host is blocked on the runner, so no live data is fetched.
# Usage: entry.sh APP_PATH OUT_DIR SIMULATOR_ID
set -u
APP="$1"; OUT="$2"; DEV="$3"; BID=com.maisysen.nswtransport
mkdir -p "$OUT"
xcrun simctl install "$DEV" "$APP"
for s in location location-always photos contacts calendar; do xcrun simctl privacy "$DEV" grant "$s" "$BID" 2>/dev/null || true; done
shot() { xcrun simctl io "$DEV" screenshot "$OUT/$1.png" >/dev/null 2>&1 && echo "{\"name\":\"$1\",\"url\":\"$2\"}" >> "$OUT/manifest.jsonl"; }
stop() { xcrun simctl terminate "$DEV" "$BID" >/dev/null 2>&1 || true; sleep 2; }
# First open of the fresh install (Home, then its one-time set up questions).
xcrun simctl launch "$DEV" "$BID" >/dev/null; sleep 30; shot "00-first-open" ""
stop
# name|url|what opens it on a phone
CASES=(
  "next-trip-row|nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&at=1793530800|Next trip widget row, Lock Screen and StandBy (Home and Work trip)"
  "next-trip-start|nswtransport://trip?from=200060&fromName=Central&to=2150401&toName=Parramatta&start=1|Next trip widget Start button, Control Center Start my commute, Siri"
  "stop-board|nswtransport://stop/200060|Stop board widget, its rows and the Lock Screen board"
  "live-trip|nswtransport://go|Live Activity on the Lock Screen, Dynamic Island, Smart Stack"
  "app-home|nswtransport://|Your trip widget before the fix, widgets with no Home and Work"
  "plan|nswtransport://plan?from=200060&to=2150401|transportsydney.app/plan links"
  "shared|nswtransport://shared/abcdefghijklmnop|transportsydney.app/trip share links"
)
for c in "${CASES[@]}"; do
  IFS='|' read -r name url what <<< "$c"
  echo "== $name: $what"
  # Cold: the app is not running, as after an update from TestFlight or when iOS has closed it.
  stop
  xcrun simctl openurl "$DEV" "$url" || echo "openurl failed for $url"
  sleep 16; shot "cold-$name" "$url"
  # Warm: the app is open on Home and the link arrives.
  stop
  xcrun simctl launch "$DEV" "$BID" >/dev/null; sleep 14
  xcrun simctl openurl "$DEV" "$url" || echo "openurl failed for $url"
  sleep 9; shot "warm-$name" "$url"
done
stop
ls "$OUT" | wc -l
