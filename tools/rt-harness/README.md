# Real-time harness (tools/rt-harness)

Built 1 Nov 2026 for "stress test, fail check, error check, every test and check in app like real time" and
"App still doesn't pull live data on locked screens". It tests the real code paths a locked phone depends on, on a
real-time clock. It does not change the app or the server.

## 1. Node harness: the real server + the phone, with failures (minutes, on any Linux box)

    npm i --prefix /tmp/ts typescript            # the app's tripState.ts is compiled on the fly
    RT_TYPESCRIPT=/tmp/ts/node_modules/typescript node tools/rt-harness/run.mjs --server <checkout with backend/> --speed 20 --jobs 8 --out /tmp/rt

* `scenario.mjs`: one scenario per process. The real `backend/src/worker.js` (loaded as a module, D1 on node:sqlite)
  with its minute Cron Trigger called and NOT awaited, as Cloudflare does; a phone model (the card from Apple pushes
  only while locked, alerts held while offline, widget and Watch written only while the app is open, the app's 15 s
  refresh while open, the app's write timeouts); the Transport for NSW feed and boards replayed from the journey
  (`feed.mjs`), with failures injected on the feed, the server, Apple, Expo and the phone. Truth comes from
  `app/sim/journeySim.mjs` running the app's real `tripState.ts`.
* `journeys.mjs` all journey shapes (the app's sim CASES plus RT-* cases on sample stops), `scenarios.mjs` journeys +
  F-* failures, `checks.mjs` the 19 checks (rules from docs/TRIP_FLOW_SPEC.md), `run.mjs` parallel runner and bug list
  (`summary.json`; exit 0 only known bugs, 1 a new failure, 2 harness broken).
* Local stress: `RT_STRESS=150 node scenario.mjs S1 --server ... --speed 10 --out s.json` adds 150 phones (own
  address, Expo route, trip watch, card token) to the same trip; each cron pass records outbound requests, Apple
  pushes and CPU.

## 2. iOS Simulator, real time (GitHub macOS runner, `.github/workflows/rt-sim.yml`)

The whole app (Release simulator build, JavaScript inside, updates off) against `sim-server.mjs`: the real worker.js
served as api.transportsydney.app over HTTPS on the runner (its own CA, trusted in the simulator with
`simctl keychain add-root-cert`), replaying a journey on the wall clock. Every Apple push the server makes is handed to
the simulator with `xcrun simctl push`. `sim/run-sim.sh` starts the trip from the widget's Start link, sends the app to
the background / Lock / kills it, takes a picture every 20 s, reads the words on them (`sim/ocr.swift`, Vision) and
checks them against the truth (`sim/sim-check.mjs`). Start: push a change to `sim/config.json` on a branch named
`rt-harness-*` (`app_run_id` reuses an earlier run's app and skips the 40 min build).

## 3. Android emulator, real time (GitHub ubuntu runner with KVM, `.github/workflows/rt-android.yml`)

The Android app (Release, x86_64, debug-signed) on an API 33 emulator with a writable system image (hosts file and the
run's CA in the system store) against the same local server. `android/run-emu.sh`: Start link, home, screen off,
the app's notifications read every 30 s (`dumpsys notification`), Lock Screen pictures every 60 s, `android-check.mjs`.
Start: push a change to `android/config.json` on `rt-harness-*`.

## Rules kept

No production server, no Transport for NSW call (the feeds are replayed), no signing, no upload, no secrets.
