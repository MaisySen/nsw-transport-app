#!/bin/bash
# Finds an Apple Watch simulator that xcodebuild itself can run tests on, for the native audit (CI only).
# Why (30 Oct 2026): on some runners `simctl` listed and booted a watchOS 27 simulator while xcodebuild saw the same
# device with "watchOS Simulator (null)" (no runtime, no architecture) and refused to test on it, 4 of the last 8
# runs. The device is therefore chosen from `xcodebuild -showdestinations` (xcodebuild's own view), not from simctl,
# and when none is usable it climbs a short ladder, checking xcodebuild's view after each rung:
#   1. as the runner is;  2. simulator service restarted (it must be the selected Xcode's), a fresh device on an
#   available watchOS runtime, with a device type that runtime supports;  3. Xcode asked to install the watchOS
#   runtime for this Xcode, then the same wait, service restart and fresh device.
# Prints the device id on stdout (log lines on stderr) and exits 0, or exits 1 when no rung gave a usable device.
# Run 41018791876 (30 Oct, 07:15 UTC): the runtime came and went within the job: listed, then gone, then back after a
# download, then "Malformed bundle does not contain an identifier at .../cryptexd/mnt/watchOS_24R362/...simruntime" a
# minute later and no watch device for xcodebuild. So a device counts only once it is booted and xcodebuild still lists
# it. Run 41019491136: the runner had the same watchOS runtime registered twice, one copy still "Copying" and the
# other "Ready" but not mounted; deleting it is refused for minutes. So every rung first waits for the runtime image
# to settle (no copy or delete in progress, one ready) before it looks for a device.
# Usage: bash watchsim.sh <project> <scheme>
set -u
PROJ="$1"; SCHEME="$2"
log() { echo "watchsim: $*" >&2; }
# A bound on each wait where the runner has one (GNU timeout or Homebrew's gtimeout); without, the job's own limit.
tmo() { local s="$1"; shift; if command -v timeout >/dev/null; then timeout "$s" "$@"; elif command -v gtimeout >/dev/null; then gtimeout "$s" "$@"; else "$@"; fi; }

usable() {
  # xcodebuild's own list of destinations for the scheme; an eligible watch simulator with a real OS version.
  tmo 300 xcodebuild -showdestinations -project "$PROJ" -scheme "$SCHEME" > /tmp/watch-dests.txt 2>/dev/null || true
  python3 - /tmp/watch-dests.txt <<'PY'
import re, sys
text = open(sys.argv[1]).read()
avail = text.split('Ineligible destinations')[0]
best = []
for m in re.finditer(r'\{ ([^}]*) \}', avail):
    kv = dict(p.split(':', 1) for p in m.group(1).split(', ') if ':' in p)
    if kv.get('platform') != 'watchOS Simulator': continue
    if not re.fullmatch(r'[0-9A-F-]{36}', kv.get('id', '')): continue
    if not re.match(r'\d', kv.get('OS', '')): continue
    os_v = [int(x) for x in re.findall(r'\d+', kv['OS'])]
    best.append((os_v, kv.get('name', ''), kv['id']))
if best:
    best.sort()
    top = [b for b in best if b[0] == best[-1][0]]
    # The smallest watch first: the audit draws every size itself, and a small screen is the strictest host.
    for b in sorted(top, key=lambda b: ('40mm' not in b[1], '41mm' not in b[1], '42mm' not in b[1], b[1])):
        sys.stderr.write('watchsim: xcodebuild lists %s, watchOS %s (%s)\n' % (b[1], '.'.join(map(str, b[0])), b[2]))
        print(b[2])
PY
}

restart_service() {
  xcrun simctl shutdown all >/dev/null 2>&1 || true
  killall -9 com.apple.CoreSimulator.CoreSimulatorService >/dev/null 2>&1 || true
  sleep 5
  xcrun simctl list runtimes >/dev/null 2>&1 || true
}

fresh_device() {
  # A new device on the newest available watchOS runtime, with a device type that runtime says it supports.
  xcrun simctl list runtimes -j > /tmp/watch-rts.json 2>/dev/null || return 1
  python3 - /tmp/watch-rts.json > /tmp/watch-pairs.txt <<'PY'
import json, sys
rts = [r for r in json.load(open(sys.argv[1])).get('runtimes', [])
       if r.get('platform') == 'watchOS' and r.get('isAvailable')]
rts.sort(key=lambda r: [int(x) for x in r.get('version', '0').split('.') if x.isdigit()])
for r in reversed(rts[-1:]):
    types = [t for t in r.get('supportedDeviceTypes', []) if t.get('productFamily') == 'Apple Watch' or 'Watch' in t.get('name', '')]
    types.sort(key=lambda t: ('40mm' not in t['name'], '41mm' not in t['name'], '42mm' not in t['name'], t['name']))
    for t in types: print(r['identifier'], t['identifier'])
PY
  while read -r RT DT; do
    if NEW=$(xcrun simctl create "Audit Watch $RANDOM" "$DT" "$RT" 2>/tmp/watch-create.err </dev/null); then
      log "created $NEW ($DT on $RT)"
      xcrun simctl boot "$NEW" >/dev/null 2>&1 </dev/null || true
      tmo 300 xcrun simctl bootstatus "$NEW" -b >/dev/null 2>&1 </dev/null || true
      return 0
    fi
    log "create $DT on $RT failed: $(head -c 300 /tmp/watch-create.err)"
  done < /tmp/watch-pairs.txt
  return 1
}


diag() {
  log "diagnostics ($1):"
  { xcrun simctl runtime list -v 2>&1 | grep -i -B1 -A8 watch | head -60
    mount | grep -i -E "cryptex|simruntime|CoreSimulator" | head -20
    xcrun simctl list runtimes 2>&1 | grep -i -E "watch|malformed" | head -10; } >&2 || true
}

confirm() {
  # Boot the device and keep it booted (a booted device keeps its runtime mounted); it counts only if xcodebuild
  # still lists it afterwards.
  local DEV="$1"
  xcrun simctl boot "$DEV" >/dev/null 2>&1 </dev/null || true
  tmo 300 xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1 </dev/null || true
  sleep 5
  usable | grep -qx "$DEV" && xcrun simctl list devices 2>/dev/null | grep "$DEV" | grep -q Booted
}

try_rung() {
  local DEV
  for DEV in $(usable | head -3); do
    if confirm "$DEV"; then log "booted and listed by xcodebuild: $DEV"; echo "$DEV"; return 0; fi
    log "$DEV did not stay usable after booting"
  done
  return 1
}

wait_ready() {
  # The watchOS runtime is a disk image the simulator service copies and mounts by itself. Run 41019491136 showed two
  # registrations of the same runtime on the runner, one "Copying" and one "Ready" but not mounted, and xcodebuild
  # with no watch device. Wait (up to $1 s) until no watchOS image is still copying or deleting and one is ready.
  local limit="$1" waited=0 st
  while :; do
    st=$(xcrun simctl runtime list -j 2>/dev/null | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: d = {}
w = [v for v in d.values() if "watch" in json.dumps(v).lower()]
states = sorted(str(v.get("state", "?")) for v in w)
busy = [s for s in states if s.lower() not in ("ready", "unusable")]
print(("busy " if busy or "Ready" not in states else "ok ") + ",".join(states or ["none"]))')
    case "$st" in ok*) log "watchOS runtime: ${st#ok } after ${waited}s"; return 0;; esac
    if [ "$waited" -ge "$limit" ]; then log "watchOS runtime still ${st#busy } after ${waited}s"; return 1; fi
    [ $((waited % 60)) -eq 0 ] && log "waiting for the watchOS runtime: ${st#busy }"
    sleep 15; waited=$((waited + 15))
  done
}

diag start
wait_ready 900 || true
try_rung && exit 0

log "rung 2: simulator service restarted, fresh device"
restart_service; wait_ready 300 || true; fresh_device || true
try_rung && exit 0
diag "after rung 2"

log "rung 3: Xcode asked to install the watchOS runtime"
tmo 1500 sudo xcodebuild -downloadPlatform watchOS 2>&1 | tail -3 >&2 || true
wait_ready 900 || true; restart_service; fresh_device || true
try_rung && exit 0

diag "no usable watch simulator"
log "xcodebuild's list was:"; cat /tmp/watch-dests.txt >&2
exit 1
