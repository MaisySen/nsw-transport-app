#!/bin/bash
# One real-time trip in the iOS Simulator against the local server (sim-server.mjs), with the phone "locked" the ways a
# simulator allows: the app sent to the background (another app in front: JavaScript suspended), the Simulator's own
# Lock (Device > Lock, by keystroke), and the app killed. Pictures every 20 s of whatever the phone shows (the Dynamic
# Island and banners while another app is in front; the Lock Screen and its Live Activity while locked), then the words
# on them (ocr.swift) and the checks (sim-check.mjs).
# Usage: run-sim.sh APP_PATH OUT_DIR SIMULATOR_ID SCENARIO      (scenarios: see the case statement below)
set -u
APP="$1"; OUT="$2"; DEV="$3"; SCN="$4"; BID=com.maisysen.nswtransport
HERE="$(cd "$(dirname "$0")" && pwd)"; RTH="$(cd "$HERE/.." && pwd)"; REPO="$(cd "$RTH/../.." && pwd)"
SRV="${RT_SERVER:-$REPO/srv}"
mkdir -p "$OUT/shots" "$OUT/server"
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$OUT/timeline.txt"; }

# scenario: case, minutes "locked" (background or Lock), what else happens, failures for the server (minutes from Start trip)
FAULTS='[]'; KILL_AT=""; LOCK_KIND=background; CASE=S1
case "$SCN" in
  clean-train) CASE=RT-T2 ;;                        # delay grows 1 to 5 min after the phone locks: the card must follow
  clean-bus) CASE=RT-BUS530 ;;
  lock-train) CASE=RT-T2; LOCK_KIND=lock ;;         # the Simulator's own Lock (Lock Screen card)
  feed-down) CASE=RT-T2; FAULTS='[{"from":"+3","to":"+15","nsw":"down"}]' ;;   # 2, 5, 10 min stale words while locked
  server-down) CASE=S1; FAULTS='[{"from":"+4","to":"+7","server":"down"}]' ;;
  killed) CASE=RT-T2; KILL_AT=150 ;;                # app killed 150 s after Start trip
  *) echo "unknown scenario $SCN"; exit 2 ;;
esac
log "scenario $SCN: case $CASE, lock $LOCK_KIND, faults $FAULTS, kill ${KILL_AT:-no}"

# 1. a certificate authority for this run and a certificate for api.transportsydney.app, trusted by the simulator
cd "$OUT/server"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=RT Harness CA" -keyout ca.key -out ca.pem \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=api.transportsydney.app" -keyout srv.key -out srv.csr 2>/dev/null
printf "subjectAltName=DNS:api.transportsydney.app,DNS:transportsydney.app\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 -sha256 -extfile ext.cnf -out srv.pem 2>/dev/null
cd - >/dev/null
xcrun simctl keychain "$DEV" add-root-cert "$OUT/server/ca.pem" && log "CA trusted in the simulator" || log "add-root-cert FAILED"

# 2. the server: real worker.js on 443, Start trip 150 s from now
LEAD=150
node --no-warnings "$RTH/sim-server.mjs" --server "$SRV" --case "$CASE" --out "$OUT/server" --port 443 --cert "$OUT/server/srv.pem" --key "$OUT/server/srv.key" \
  --lead $LEAD --sim "$DEV" --bundle "$BID" --faults "$FAULTS" > "$OUT/server/server.log" 2>&1 &
SPID=$!
sleep 8
cat "$OUT/server/server.log"
curl -s --cacert "$OUT/server/ca.pem" "https://api.transportsydney.app/api/trip?from=SIM_x&to=SIM_y" -o /dev/null -w "local server answers: %{http_code}\n" | tee -a "$OUT/timeline.txt"
LINK=$(cat "$OUT/server/start-link.txt")

DISPLAY_ARG=""
shot() {
  local name="$1" f
  f="$OUT/shots/$(date -u +%H%M%S)-$name.png"
  if ! xcrun simctl io "$DEV" screenshot --type=png $DISPLAY_ARG "$f" 2>/tmp/shot-err.txt; then
    D=$(grep -oE -- '--display=[0-9]+ +LCD \(primary\)' /tmp/shot-err.txt | grep -oE '[0-9]+' | head -1)
    [ -n "$D" ] && DISPLAY_ARG="--display=$D" && xcrun simctl io "$DEV" screenshot --type=png $DISPLAY_ARG "$f" >/dev/null 2>&1 || cat /tmp/shot-err.txt
  fi
}
lock_phone() {
  if [ "$LOCK_KIND" = lock ]; then
    osascript -e 'tell application "Simulator" to activate' -e 'delay 1' -e 'tell application "System Events" to keystroke "l" using {command down}' 2>&1 | tee -a "$OUT/timeline.txt"
    log "lock keystroke sent"
  else
    xcrun simctl launch "$DEV" com.apple.Preferences >/dev/null && log "Settings in front: the app is in the background (JavaScript suspended)"
  fi
}

# 3. the app: installed fresh, first open, then Start trip from the link the Next trip widget's Start button opens
xcrun simctl install "$DEV" "$APP" || { log "install failed"; exit 1; }
for s in location location-always calendar; do xcrun simctl privacy "$DEV" grant "$s" "$BID" 2>/dev/null || true; done
if command -v applesimutils >/dev/null; then applesimutils --byId "$DEV" --bundle "$BID" --setPermissions notifications=YES 2>&1 | tail -1 | tee -a "$OUT/timeline.txt"; fi
xcrun simctl launch "$DEV" "$BID" >/dev/null; sleep 20; shot first-open
# wait for Start trip time (the server's case clock)
sleep $((LEAD - 35))
log "Start trip: $LINK"
xcrun simctl openurl "$DEV" "$LINK"
for i in 1 2 3; do sleep 6; shot "in-app-$i"; done
lock_phone
T_LOCK=$(date +%s)
# 4. real time: a picture every 20 s until the case ends (+3 min)
END=$(node -e "const t=require('$OUT/server/truth.json'); console.log(Math.round((t.base + (t.end + 180) * 1000) / 1000))")
n=0
while [ "$(date +%s)" -lt "$END" ]; do
  now=$(date +%s)
  if [ -n "$KILL_AT" ] && [ $((now - T_LOCK)) -ge "$KILL_AT" ] && [ ! -f "$OUT/killed" ]; then
    xcrun simctl terminate "$DEV" "$BID"; touch "$OUT/killed"; log "app killed (simctl terminate)"
  fi
  shot "t$n"; n=$((n + 1))
  sleep 20
done
# 5. open the app again at the end: what does it show, and does it catch up silently
xcrun simctl launch "$DEV" "$BID" >/dev/null; sleep 10; shot reopened
kill $SPID 2>/dev/null
log "$(ls "$OUT/shots" | wc -l) pictures"
# 6. words on the pictures, and the checks
swift "$HERE/ocr.swift" "$OUT"/shots/*.png > "$OUT/ocr.jsonl" 2>"$OUT/ocr-err.txt" || log "ocr failed: $(tail -3 "$OUT/ocr-err.txt")"
node --no-warnings "$HERE/sim-check.mjs" "$OUT" | tee "$OUT/check.txt"
