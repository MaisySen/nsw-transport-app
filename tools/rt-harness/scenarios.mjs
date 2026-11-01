// The real-time scenarios: every journey clean (locked phone), then the failures injected on the network, the
// server, Apple's push service and the phone itself. Times are the case's Sydney clock.
//   case: a journey from journeys.mjs; device: phone moments (app open/locked/background/killed, net on/off, low power,
//   notifications or Live Activities off, clock skew); faults: windows of nsw (500/503/429/timeout/slowN/staleN/
//   garbage/html/down), server (down), apns (500/429/410/403/timeout), expo (500), phone (requests fail).
//   expect: getoff (false: none expected), staleFrom/staleTo (stale words checked), held, noMovesAfter.
const J = (id, title, o = {}) => ({ id, title, case: id, strict: true, ...o });

export const SCENARIOS = [
  // ---- full journeys, nothing failing, phone locked after Start trip ----
  J('S1', 'Sample train on time, locked'),
  J('S2', "Owner's train 4 min late, locked"),
  J('BUS', "Owner's 415 bus from Stand G, locked"),
  J('X', "Owner's commute: train, change, second train (T1 then T4), locked"),
  J('RT-BUS530', '530 bus shape, 2 min late, locked'),
  J('RT-T2', 'T2 train, delay grows after locking', { strict: false }),
  J('RT-2BUS', 'Two buses with a change, locked'),
  J('S3', 'Delay grows after the phone locks', { strict: false }),
  J('S4', 'Running 2 min early'),
  J('S5', 'Cancelled at 7:46', { strict: false, expect: { getoff: false } }),
  J('RT-PLATLOCK', 'Platform change while locked', { strict: false }),
  J('S17a', 'Arrival jumps 2 min later just before the stop', { strict: false }),
  J('S17b', 'Arrival jumps 40 s earlier in the last minute', { strict: false }),
  J('RT-HELD-LOCK', 'Held outside the stop after Get off now, locked (Get off now early by design, then Held)', { strict: false, expect: { held: true, getoffMaxLead: 300 } }),
  J('RT-DIVERT', 'Run vanishes from the feed after leaving (diverted)', { strict: false, expect: { getoff: false, noMovesAfter: '19:51' } }),
  J('S2-open', "Owner's train with the app open from 7:56", { strict: false }),
  J('S11', 'App killed at 7:51, reopened at 7:58', { strict: false }),

  // ---- the live feed failing (server side) ----
  { id: 'F-NSW500', title: 'Feed answers 500 for 3 min mid-trip', case: 'S1', faults: [{ from: '19:46', to: '19:49', nsw: '500' }], expect: { staleFrom: '19:46', staleTo: '19:49' } },
  { id: 'F-NSW429', title: 'Feed rate limited (429) for 4 min mid-trip', case: 'S1', faults: [{ from: '19:46', to: '19:50', nsw: '429' }] },
  { id: 'F-NSWTIMEOUT', title: 'Feed requests hang (timeouts) for 4 min', case: 'S1', faults: [{ from: '19:46', to: '19:50', nsw: 'timeout' }] },
  { id: 'F-NSWSLOW', title: 'Feed answers in 12 s for 8 min (cron passes overlap)', case: 'S1', faults: [{ from: '19:43', to: '19:51', nsw: 'slow12' }] },
  { id: 'F-NSWSLOW50', title: 'Feed answers in 50 s around the stop (passes overlap, timers late)', case: 'S1', faults: [{ from: '19:51', to: '19:56', nsw: 'slow50' }] },
  { id: 'F-NSWSLOW-START', title: 'Feed answers in 14 s while Start trip registers the trip (the app gives a write 15 s)', case: 'S1', faults: [{ from: '19:45', to: '19:48', nsw: 'slow14' }] },
  { id: 'F-NSWHANG-START', title: 'Feed requests hang at Start trip', case: 'S1', faults: [{ from: '19:45', to: '19:48', nsw: 'timeout' }] },
  { id: 'F-NSWSTALE', title: 'Feed lags 150 s behind for the whole trip', case: 'S1', faults: [{ from: '19:40', to: '20:10', nsw: 'stale150' }] },
  { id: 'F-NSWGARBAGE', title: 'Feed sends broken bytes for 3 min', case: 'S1', faults: [{ from: '19:46', to: '19:49', nsw: 'garbage' }] },
  { id: 'F-NSWHTML', title: 'Feed sends an HTML maintenance page for 3 min', case: 'S1', faults: [{ from: '19:46', to: '19:49', nsw: 'html' }] },
  { id: 'F-NSWDOWN12', title: 'Feed unreachable for 12 min while locked: 2/5/10 min stale steps', case: 'RT-T2', faults: [{ from: '17:27', to: '17:39', nsw: 'down' }], expect: { staleFrom: '17:27', staleTo: '17:39', getoff: false } },
  { id: 'F-NSWDOWN-NEAR', title: 'Feed lost 3 min before the stop off (no Get off now from the clock)', case: 'S1', faults: [{ from: '19:52', to: '20:05', nsw: 'down' }], expect: { getoff: false, noMovesAfter: '19:52', staleFrom: '19:52' } },

  // ---- our server failing ----
  { id: 'F-SERVER-START', title: 'Server down at Start trip (503), phone locked 20 s later', case: 'S1', faults: [{ from: '19:45:50', to: '19:47', server: 'down' }] },
  { id: 'F-SERVER-MID', title: 'Server (worker and cron) down 3 min mid-trip', case: 'S1', faults: [{ from: '19:47', to: '19:50', server: 'down' }] },

  // ---- Apple's push service failing ----
  { id: 'F-APNS500', title: 'Apple answers 500 for 3 min', case: 'S1', faults: [{ from: '19:47', to: '19:50', apns: '500' }] },
  { id: 'F-APNS429', title: 'Apple rate limits pushes (429) for 3 min', case: 'S1', faults: [{ from: '19:47', to: '19:50', apns: '429' }] },
  { id: 'F-APNSTIMEOUT', title: 'Apple push requests hang for 3 min', case: 'S1', faults: [{ from: '19:47', to: '19:50', apns: 'timeout' }] },
  { id: 'F-APNS403', title: 'Apple says the provider token expired (403) for 2 min', case: 'S1', faults: [{ from: '19:47', to: '19:49', apns: '403' }] },
  { id: 'F-APNSGETOFF', title: 'Apple fails exactly at the Get off now moment', case: 'S1', faults: [{ from: '19:54:10', to: '19:54:40', apns: '500' }] },
  { id: 'F-EXPO500', title: 'Expo push service down for the whole trip (alerts must still arrive)', case: 'S1', faults: [{ from: '19:40', to: '20:10', expo: '500' }] },

  // ---- the phone ----
  { id: 'F-TOKEN-LATE', title: 'Card push token arrives 6 s after Start trip; phone locked at 4 s (JS suspended before it can send it)', case: 'S1', keepCasePhone: false, laTokenDelayS: 6, device: [{ at: '19:46', app: 'open' }, { at: '19:46:04', app: 'locked' }] },
  { id: 'F-OFFLINE-START', title: 'No signal at Start trip, locked at 20 s, signal back 2 min later', case: 'S1', device: [{ at: '19:45:50', net: false }, { at: '19:48:20', net: true }] },
  { id: 'F-OFFLINE-MID', title: 'No signal for 4 min mid-trip (tunnel)', case: 'S1', device: [{ at: '19:48', net: false }, { at: '19:52', net: true }] },
  { id: 'F-FLAKY', title: 'Signal drops 20 s in every minute for 10 min', case: 'S1', device: Array.from({ length: 10 }, (_, i) => [{ at: `19:${String(45 + i).padStart(2, '0')}:10`, net: false }, { at: `19:${String(45 + i).padStart(2, '0')}:30`, net: true }]).flat() },
  { id: 'F-KILLED', title: 'App killed 1 min after locking, never reopened', case: 'S1', device: [{ at: '19:47:30', app: 'killed' }] },
  { id: 'F-BACKGROUND', title: 'App in the background (not locked) for the trip', case: 'S1', keepCasePhone: false, device: [{ at: '19:46', app: 'open' }, { at: '19:46:20', app: 'background' }] },
  { id: 'F-NOTIF-OFF', title: 'Notifications not allowed (Live Activities allowed)', case: 'S1', device: [{ at: '19:40', notif: false }] },
  { id: 'F-LA-OFF', title: 'Live Activities turned off (widget and Watch only)', case: 'S1', device: [{ at: '19:40', la: false }] },
  { id: 'F-APNSLATE', title: 'Apple delivers every push 20 s late', case: 'S1', apnsLatencyS: 20 },
];
