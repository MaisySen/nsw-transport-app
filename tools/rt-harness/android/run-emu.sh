#!/bin/bash
# One real-time trip on the Android emulator against the local server (sim-server.mjs on this runner, port 443): the
# emulator's own hosts file sends api.transportsydney.app to the runner (10.0.2.2) and this run's certificate authority
# is put in the emulator's system store (writable system image, API 33). The trip is started from the Next trip
# widget's Start link, then the app goes to the background and the screen is turned off. Every 30 s the app's
# notifications are read (dumpsys notification), and every 60 s the screen is woken for a Lock Screen picture.
# Usage: run-emu.sh APK OUT SCENARIO
set -u
APK="$1"; OUT="$2"; SCN="$3"; PKG=com.maisysen.nswtransport
HERE="$(cd "$(dirname "$0")" && pwd)"; RTH="$(cd "$HERE/.." && pwd)"; REPO="$(cd "$RTH/../.." && pwd)"
SRV="${RT_SERVER:-$REPO/srv}"
mkdir -p "$OUT/shots" "$OUT/server"
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$OUT/timeline.txt"; }
FAULTS='[]'; KILL_AT=""; CASE=RT-T2
case "$SCN" in
  clean-train) CASE=RT-T2 ;;
  clean-bus) CASE=RT-BUS530 ;;
  feed-down) CASE=RT-T2; FAULTS='[{"from":"+3","to":"+15","nsw":"down"}]' ;;
  killed) CASE=RT-T2; KILL_AT=150 ;;
  *) echo "unknown scenario $SCN"; exit 2 ;;
esac
log "android scenario $SCN: case $CASE, faults $FAULTS, kill ${KILL_AT:-no}"
cd "$OUT/server"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=RT Harness CA" -keyout ca.key -out ca.pem -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=api.transportsydney.app" -keyout srv.key -out srv.csr 2>/dev/null
printf "subjectAltName=DNS:api.transportsydney.app\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 -sha256 -extfile ext.cnf -out srv.pem 2>/dev/null
HASH=$(openssl x509 -inform PEM -subject_hash_old -in ca.pem | head -1)
cd - >/dev/null
# the emulator: root, writable system, hosts and the certificate authority
adb root >/dev/null; sleep 3
if ! adb remount 2>&1 | tee -a "$OUT/timeline.txt" | grep -qi "remount succeeded\|remounted"; then
  adb disable-verity 2>&1 | tail -1; adb reboot; adb wait-for-device; sleep 30
  until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 3; done
  adb root >/dev/null; sleep 3; adb remount 2>&1 | tail -2 | tee -a "$OUT/timeline.txt"
fi
adb shell "echo '10.0.2.2 api.transportsydney.app' >> /system/etc/hosts; echo '0.0.0.0 u.expo.dev' >> /system/etc/hosts"
adb push "$OUT/server/ca.pem" "/system/etc/security/cacerts/$HASH.0" >/dev/null && adb shell chmod 644 "/system/etc/security/cacerts/$HASH.0"
adb shell cat /system/etc/hosts | tail -3 | tee -a "$OUT/timeline.txt"
adb shell setprop persist.sys.timezone Australia/Sydney
# the server
LEAD=150
sudo -E env "PATH=$PATH" node --no-warnings "$RTH/sim-server.mjs" --server "$SRV" --case "$CASE" --out "$OUT/server" --port 443 --cert "$OUT/server/srv.pem" --key "$OUT/server/srv.key" \
  --lead $LEAD --faults "$FAULTS" > "$OUT/server/server.log" 2>&1 &
sleep 8; cat "$OUT/server/server.log"
LINK=$(cat "$OUT/server/start-link.txt")
shot() { adb exec-out screencap -p > "$OUT/shots/$(date -u +%H%M%S)-$1.png" 2>/dev/null || true; }
notes() { adb shell dumpsys notification --noredact 2>/dev/null | awk -v P="$PKG" '/NotificationRecord/{on=index($0,P)>0} on&&/android.title=|android.text=|android.bigText=|android.subText=|flags=|when=/{print}' | sed "s/^/$(date -u +%H:%M:%S) $1 /" >> "$OUT/notifications.txt"; }
# the app
adb install -r -g "$APK" >/dev/null && log "installed" || { log "install failed"; exit 1; }
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 25; shot first-open
sleep $((LEAD - 40))
log "Start trip: $LINK"
adb shell am start -W -a android.intent.action.VIEW -d "'$LINK'" $PKG | tail -2 | tee -a "$OUT/timeline.txt"
for i in 1 2 3; do sleep 6; shot "in-app-$i"; done
notes in-app
adb shell input keyevent 3; sleep 2; log "home: the app is in the background"; shot home
adb shell input keyevent 223; log "screen off"
T_LOCK=$(date +%s)
END=$(node -e "const t=require('$OUT/server/truth.json'); console.log(Math.round((t.base + (t.end + 180) * 1000) / 1000))")
n=0
while [ "$(date +%s)" -lt "$END" ]; do
  now=$(date +%s)
  if [ -n "$KILL_AT" ] && [ $((now - T_LOCK)) -ge "$KILL_AT" ] && [ ! -f "$OUT/killed" ]; then adb shell am kill $PKG; adb shell am force-stop $PKG; touch "$OUT/killed"; log "app killed (force-stop)"; fi
  notes "t$n"
  if [ $((n % 2)) = 0 ]; then adb shell input keyevent 224; sleep 2; shot "lock$n"; adb shell input keyevent 223; fi
  n=$((n + 1)); sleep 30
done
adb shell input keyevent 224; adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 10; shot reopened
sudo pkill -f sim-server.mjs || true
log "$(ls "$OUT/shots" | wc -l) pictures, $(grep -c . "$OUT/notifications.txt" 2>/dev/null || echo 0) notification lines"
node --no-warnings "$HERE/android-check.mjs" "$OUT" | tee "$OUT/check.txt"
