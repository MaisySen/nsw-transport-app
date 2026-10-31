// Journey simulator cases: S1 to S20 from docs/TRIP_FLOW_SPEC.md section 4.3, the owner's
// 31 October trip (S2), a bus leg and a trip with a change of trains.
// Most cases use one sample trip (Lidcombe to Clyde, timetable 7:50pm Platform 7, with the
// same minutes as the owner's trip) so the suites cover Sydney at large; three cases use the
// owner's own stations because the brief names them (S2, BUS, X). Sample stops, platforms and
// in-between times are assumptions for the simulation, not timetable facts.

// a run of the live train: vehicle positions at each stop (at / left), from the feed
export function vehicle(leg, stops) {
  const ev = [];
  for (const [name, arr, dep] of stops) {
    if (arr) ev.push({ at: arr, leg, vehicle: { stop: name, state: 'at' } });
    if (dep) ev.push({ at: dep, leg, vehicle: { stop: name, state: 'left' } });
  }
  return ev;
}

const SAMPLE = {
  mode: 'train', line: 'T1', platform: '7',
  stops: [{ name: 'Lidcombe', tt: '19:50' }, { name: 'Auburn', tt: '19:53' }, { name: 'Clyde', tt: '19:55' }],
};
const sample = (over = {}) => ({ ...SAMPLE, ...over, stops: (over.stops || SAMPLE.stops).map((s) => ({ ...s })) });

// The sample trip 4 min late (the minutes of the owner's trip): leaves 7:54:30, leaves Auburn 7:57, at Clyde 7:59.
const late4 = (extra = []) => [
  { at: '19:44', leg: 0, delay: 4 },
  ...vehicle(0, [['Lidcombe', '19:52', '19:54:30'], ['Auburn', '19:56:30', '19:57'], ['Clyde', '19:59', null]]),
  ...extra,
];
// On time: leaves 7:50:30, leaves Auburn 7:53, at Clyde 7:55.
const onTime = (extra = []) => [
  { at: '19:44', leg: 0, delay: 0 },
  ...vehicle(0, [['Lidcombe', '19:49', '19:50:30'], ['Auburn', '19:52:30', '19:53'], ['Clyde', '19:55', null]]),
  ...extra,
];
const lockedFrom = (start, lock, more = {}) => [{ at: start, app: 'open', ...more }, { at: lock, app: 'locked' }];

export const CASES = [
  {
    id: 'S1', title: 'On time', story: 'Sample trip, on time. Phone locked after Start trip.',
    legs: [sample()], start: '19:46', end: '19:58',
    feed: { events: onTime() }, phone: lockedFrom('19:46', '19:46:20', { location: true }),
    checks: [
      { at: '19:48', card: 'status', is: 'Leaves 7:50pm · Platform 7' }, { at: '19:48', card: 'warn', is: 'On time' },
      { at: '19:48', card: 'timer', is: '19:50' }, { at: '19:50:10', card: 'status', is: 'Due now · Platform 7' },
      { at: '19:51', card: 'status', is: 'Next: Auburn' }, { at: '19:56', card: 'status', is: 'Arrived Clyde 7:55pm' },
      { at: '19:57:30', ended: true },
    ],
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S2', owner: true, title: "Owner's trip: Strathfield to Croydon, 4 min late",
    story: 'The 31 Oct test from home: T1 timetable 7:50pm Platform 7, 4 min late from 7:44, leaves 7:54, leaves Burwood about 7:57, at Croydon 7:59. Location off. Locked from 7:47, opened 7:49 for 20 s. Burwood times are an assumption.',
    legs: [{ mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Strathfield', tt: '19:50' }, { name: 'Burwood', tt: '19:53', note: 'assumed' }, { name: 'Croydon', tt: '19:55' }] }],
    start: '19:46', end: '20:02',
    feed: { events: [{ at: '19:44', leg: 0, delay: 4 }, ...vehicle(0, [['Strathfield', '19:52', '19:54:20'], ['Burwood', '19:56:30', '19:57'], ['Croydon', '19:59', null]])] },
    phone: [{ at: '19:46', app: 'open', location: false }, { at: '19:47', app: 'locked' }, { at: '19:49', app: 'open' }, { at: '19:49:20', app: 'locked' }],
    checks: [
      { at: '19:48', card: 'status', is: 'Leaves 7:54pm · Platform 7' }, { at: '19:48', card: 'warn', is: '4 min late' },
      { at: '19:48', card: 'timer', is: '19:54' }, { at: '19:48', card: 'arrive', is: 'Arrive Croydon 7:59pm' },
      { at: '19:48', widget: 'has', is: '7:54pm' }, { at: '19:49:10', noVoice: true },
      { at: '19:50', card: 'timer', is: '19:54' }, { at: '19:54:10', card: 'status', is: 'Due now · Platform 7' },
      { at: '19:55', card: 'status', is: 'Next: Burwood' }, { at: '19:55', card: 'arrive', is: 'Croydon 7:59pm' },
      { at: '19:58', card: 'status', is: 'Croydon next' }, { at: '19:58:31', card: 'status', is: 'Get off now · Croydon' },
      { at: '19:59:20', card: 'status', is: 'Arrived Croydon 7:59pm' }, { at: '20:01:30', ended: true },
    ],
    ring: [{ kind: 'headsup', between: ['19:57', '19:57:31'] }, { kind: 'getoff', lands: '19:58:30' }, { kind: 'arrived', between: ['19:59', '19:59:16'] }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S2-open', owner: true, title: "Owner's trip with the app open from 7:56",
    story: 'Same trip, app open from 7:56: the three moments are spoken in the app with the station name; the server copies show without sound.',
    legs: [{ mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Strathfield', tt: '19:50' }, { name: 'Burwood', tt: '19:53', note: 'assumed' }, { name: 'Croydon', tt: '19:55' }] }],
    start: '19:46', end: '20:02',
    feed: { events: [{ at: '19:44', leg: 0, delay: 4 }, ...vehicle(0, [['Strathfield', '19:52', '19:54:20'], ['Burwood', '19:56:30', '19:57'], ['Croydon', '19:59', null]])] },
    phone: [{ at: '19:46', app: 'open' }, { at: '19:47', app: 'locked' }, { at: '19:56', app: 'open' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'], spoken: ['headsup', 'getoff', 'arrived'],
    ring: [{ kind: 'getoff', lands: '19:58:30' }],
  },
  {
    id: 'S3', title: 'Delay grows after the phone locks',
    story: 'On time at 7:47, 6 min late from 7:52. Phone locked from 7:47.',
    legs: [sample()], start: '19:46', end: '20:04',
    feed: { events: [{ at: '19:44', leg: 0, delay: 0 }, { at: '19:52', leg: 0, delay: 6 }, ...vehicle(0, [['Lidcombe', '19:55', '19:56:30'], ['Auburn', '19:58:30', '19:59'], ['Clyde', '20:01', null]])] },
    phone: lockedFrom('19:46', '19:47'),
    checks: [{ at: '19:49', card: 'timer', is: '19:50' }, { at: '19:51:50', card: 'status', is: 'Due now · Platform 7' }, { at: '19:52:30', card: 'status', is: 'Leaves 7:56pm · Platform 7' }, { at: '19:52:30', card: 'timer', is: '19:56' }, { at: '19:52:30', card: 'warn', is: '6 min late' }],
    pushWithin: { at: '19:52', secs: 30, status: 'Leaves 7:56pm · Platform 7' },
    ring: [{ kind: 'getoff', lands: '20:00:30' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S4', title: 'Running 2 min early',
    story: 'The live train is 2 min early from 7:44. Countdown to the earlier time; no delay alert (under 3 min).',
    legs: [sample()], start: '19:44', end: '19:56',
    feed: { events: [{ at: '19:44', leg: 0, delay: -2 }, ...vehicle(0, [['Lidcombe', '19:47', '19:48:30'], ['Auburn', '19:50:30', '19:51'], ['Clyde', '19:53', null]])] },
    phone: lockedFrom('19:44', '19:44:20'),
    checks: [{ at: '19:45', card: 'status', is: 'Leaves 7:48pm · Platform 7' }, { at: '19:45', card: 'warn', is: '2 min early' }, { at: '19:48:10', card: 'status', is: 'Due now · Platform 7' }],
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S5', title: 'Cancelled at 7:46',
    story: 'The 7:50pm is cancelled at 7:46; the feed finds the next T1 at 8:05pm on the same platform. The trip follows that one.',
    legs: [sample()],
    alts: [{ id: 'next', forLeg: 0, mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Lidcombe', tt: '20:05' }, { name: 'Auburn', tt: '20:08' }, { name: 'Clyde', tt: '20:10' }] }],
    start: '19:44', end: '20:14',
    feed: { events: [{ at: '19:44', leg: 0, delay: 0 }, { at: '19:44', leg: 1, delay: 0 }, { at: '19:46', leg: 0, cancelled: true, next: 'next' }, ...vehicle(1, [['Lidcombe', '20:04', '20:05:30'], ['Auburn', '20:07:30', '20:08'], ['Clyde', '20:10', null]])] },
    phone: lockedFrom('19:44', '19:45'),
    checks: [{ at: '19:47', card: 'status', is: 'Leaves 8:05pm · Platform 7' }, { at: '19:47', card: 'warn', is: '7:50pm cancelled' }, { at: '19:47', card: 'timer', is: '20:05' }, { at: '19:51', card: 'status', is: 'Leaves 8:05pm · Platform 7' }],
    order: ['cancelled', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S6', title: 'Platform 7 changes to 6 at 7:47, app open',
    story: 'The live data moves the train to Platform 6 at 7:47. App open the whole time.',
    legs: [sample()], start: '19:46', end: '19:58',
    feed: { events: onTime([{ at: '19:47', leg: 0, platform: '6' }]) },
    phone: [{ at: '19:46', app: 'open' }],
    checks: [{ at: '19:48', card: 'status', is: 'Leaves 7:50pm · Platform 6, was 7' }],
    spoken: ['platform', 'headsup', 'getoff', 'arrived'],
    order: ['platform', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S7', title: 'Change of trains missed: counts to the next one',
    story: 'Sample two-leg trip: T2 Lidcombe to Granville, change to a T1 for Parramatta. The first train runs 3 min late, so the 8:01pm connection is missed; the card moves to the 8:09pm.',
    legs: [
      { mode: 'train', line: 'T2', platform: '7', stops: [{ name: 'Lidcombe', tt: '19:50' }, { name: 'Auburn', tt: '19:53' }, { name: 'Granville', tt: '19:57' }] },
      { mode: 'train', line: 'T1', platform: '4', stops: [{ name: 'Granville', tt: '20:01' }, { name: 'Harris Park', tt: '20:03' }, { name: 'Parramatta', tt: '20:05' }] },
    ],
    alts: [{ id: 'next', forLeg: 1, mode: 'train', line: 'T1', platform: '4', stops: [{ name: 'Granville', tt: '20:09' }, { name: 'Harris Park', tt: '20:11' }, { name: 'Parramatta', tt: '20:13' }] }],
    start: '19:44', end: '20:17',
    feed: { events: [
      { at: '19:44', leg: 0, delay: 0 }, { at: '19:44', leg: 1, delay: 0 }, { at: '19:44', leg: 2, delay: 0 },
      { at: '19:45', leg: 0, delay: 3 },
      ...vehicle(0, [['Lidcombe', '19:52', '19:53:30'], ['Auburn', '19:55:30', '19:56'], ['Granville', '20:00', null]]),
      ...vehicle(2, [['Granville', '20:08', '20:09:30'], ['Harris Park', '20:11', '20:11:20'], ['Parramatta', '20:13', null]]),
    ] },
    phone: lockedFrom('19:44', '19:44:30'),
    checks: [{ at: '19:47', card: 'warn', is: '3 min late' }, { at: '20:01', card: 'status', is: 'Change: Leaves 8:09pm · Platform 4' }, { at: '20:14', card: 'status', is: 'Arrived Parramatta 8:13pm' }],
    order: ['missed', 'headsup', 'getoff', 'arrived', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S8', title: 'Live feed stops at 7:47',
    story: 'The train is 4 min late; the feed stops publishing after 7:47. Nothing moves on by the clock.',
    legs: [sample()], start: '19:46', end: '20:02',
    feed: { events: late4(), gaps: [['19:47:10', null]] },
    phone: lockedFrom('19:46', '19:46:30'),
    checks: [
      { at: '19:49', card: 'status', is: 'Leaves about 7:54pm · Platform 7' }, { at: '19:49', card: 'sub', is: 'Updated 7:47pm' }, { at: '19:49', card: 'warn', is: '4 min late at 7:47pm' },
      { at: '19:52', card: 'status', is: 'Timetable 7:50pm · Platform 7' }, { at: '19:52', card: 'sub', is: 'No live data since 7:47pm' },
      { at: '19:57', card: 'status', is: 'No live data. Open the app to refresh.' }, { at: '20:01', tripPhase: 'waiting' },
    ],
    order: ['delay'],
  },
  {
    id: 'S9', title: 'Location off', same: 'S1', story: 'S1 with location off: identical to location on.',
    legs: [sample()], start: '19:46', end: '19:58', feed: { events: onTime() }, phone: lockedFrom('19:46', '19:46:20', { location: false }),
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S10', title: 'Silent switch on',
    story: '4 min late, Silent on. Locked until 7:58, then open: no app speech, alert clips muted, one buzz per alert.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() },
    phone: [{ at: '19:46', app: 'open', silent: true }, { at: '19:46:20', app: 'locked' }, { at: '19:58', app: 'open' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'], spoken: [],
  },
  {
    id: 'S11', title: 'App killed at 7:51, reopened at 7:58',
    story: '4 min late. The app is killed at 7:51: the server keeps the card and alerts going. Reopened at 7:58: silent catch-up, then the live Get off now is spoken.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() },
    phone: [{ at: '19:46', app: 'open' }, { at: '19:51', app: 'killed' }, { at: '19:58', app: 'open' }],
    checks: [{ at: '19:58:05', noVoice: true }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S12', title: '24 hour phone',
    story: '4 min late on a phone set to 24 hour time: every time on every surface is 24 hour.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() },
    phone: lockedFrom('19:46', '19:46:20', { c24: true }),
    checks: [{ at: '19:48', card: 'status', is: 'Leaves 19:54 · Platform 7' }, { at: '19:55', card: 'arrive', is: 'Clyde 19:59' }, { at: '19:59:20', card: 'status', is: 'Arrived Clyde 19:59' }],
    no24: true, order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S13', title: 'Largest text, 12 min late, Platform 10',
    story: 'Largest Dynamic Type, Platform 10, 12 min late: every line stays on one line by shortening.',
    legs: [sample({ platform: '10' })], start: '19:46', end: '20:12',
    feed: { events: [{ at: '19:44', leg: 0, delay: 12 }, ...vehicle(0, [['Lidcombe', '20:00', '20:02:30'], ['Auburn', '20:04:30', '20:05'], ['Clyde', '20:07', null]])] },
    phone: lockedFrom('19:46', '19:46:20', { size: 'largest' }),
    checks: [{ at: '19:48', card: 'status', is: 'Leaves 8:02pm · Plat 10' }, { at: '19:48', card: 'warn', is: '12 min late' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S14', title: 'Testing from home with a live train',
    story: 'Started at home with location on, never boards: the trip runs through every phase with the live train. No "you missed it".',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() },
    phone: lockedFrom('19:46', '19:46:20', { location: true, at_home: true }),
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S15a', title: 'Boarding stop named differently in the feed: matched by name',
    story: 'The service answer names the stops "Lidcombe Station, Platform 7" etc. Matched by name; the trip runs normally.',
    legs: [sample()], start: '19:46', end: '19:58',
    feed: { events: [{ at: '19:44', leg: 0, est: { 'Lidcombe Station, Platform 7': '19:50', 'Auburn Station': '19:53', 'Clyde Station': '19:55' } }, ...vehicle(0, [['Lidcombe', '19:49', '19:50:30'], ['Auburn', '19:52:30', '19:53'], ['Clyde', '19:55', null]])] },
    phone: lockedFrom('19:46', '19:46:20'),
    checks: [{ at: '19:48', card: 'warn', is: 'On time' }],
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S15b', title: 'Boarding stop not found in the live data: timetable only',
    story: 'The live answer does not have this service. The card says timetable and no live data; no phase moves, nothing rings.',
    legs: [sample()], start: '19:46', end: '20:00',
    feed: { events: [{ at: '19:44', leg: 0, unmatched: true }] },
    phone: lockedFrom('19:46', '19:46:20'),
    checks: [{ at: '19:48', card: 'status', is: 'Timetable 7:50pm · Platform 7' }, { at: '19:48', card: 'sub', is: 'No live data for this service' }, { at: '19:59', tripPhase: 'waiting' }],
    order: [],
  },
  {
    id: 'S16', title: 'Get off now 30 s before, phone locked',
    story: 'On time, locked. The server reads every 15 s from 5 min out, sends Get off now 32 s before the live arrival so it lands 30 s before, expiring 30 s after.',
    legs: [sample()], start: '19:46', end: '19:58', feed: { events: onTime() }, phone: lockedFrom('19:46', '19:46:20'),
    ring: [{ kind: 'getoff', lands: '19:54:30', sentAt: '19:54:28', expires: '19:55:30' }],
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S16b', title: 'Get off now with direct alerts off',
    story: 'As S16 but direct alerts are not working: the Live Activity push carries the alert and its sound, so the phone still rings once.',
    legs: [sample()], start: '19:46', end: '19:58', feed: { events: onTime() }, phone: lockedFrom('19:46', '19:46:20'),
    server: { direct: false },
    ring: [{ kind: 'getoff', lands: '19:54:30', via: 'Live Activity push carrying the alert' }],
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S17a', title: 'Arrival jumps 2 min later at 7:58:20',
    story: '4 min late, then held: at 7:58:20 the live arrival moves from 7:59 to 8:01. Get off now moves to 8:00:30; no second heads-up.',
    legs: [sample()], start: '19:46', end: '20:05',
    feed: { events: [{ at: '19:44', leg: 0, delay: 4 }, ...vehicle(0, [['Lidcombe', '19:52', '19:54:30'], ['Auburn', '19:56:30', '19:57']]), { at: '19:58:20', leg: 0, est: { Clyde: '20:01' } }, { at: '20:01', leg: 0, vehicle: { stop: 'Clyde', state: 'at' } }] },
    phone: lockedFrom('19:46', '19:46:20'),
    ring: [{ kind: 'getoff', lands: '20:00:30' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S17b', title: 'Arrival jumps 40 s earlier inside the last minute',
    story: '4 min late; at 7:58:05 the live arrival moves from 7:59:00 to 7:58:20. The Get off moment (7:57:50) has passed and the train is not there yet: Get off now rings as soon as the server reads it (its next 15 s read).',
    legs: [sample()], start: '19:46', end: '20:03',
    feed: { events: [{ at: '19:44', leg: 0, delay: 4 }, ...vehicle(0, [['Lidcombe', '19:52', '19:54:30'], ['Auburn', '19:56:30', '19:57']]), { at: '19:58:05', leg: 0, est: { Clyde: '19:58:20' } }, { at: '19:58:20', leg: 0, vehicle: { stop: 'Clyde', state: 'at' } }] },
    phone: lockedFrom('19:46', '19:46:20'),
    ring: [{ kind: 'getoff', between: ['19:58:05', '19:58:16'] }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S17c', title: 'Train shown at the platform before Get off now',
    story: '4 min late; the vehicle is reported at Clyde at 7:58:10, before the 7:58:30 moment. One alert "Clyde now. Get off here." and no separate arrival sound.',
    legs: [sample()], start: '19:46', end: '20:03',
    feed: { events: [{ at: '19:44', leg: 0, delay: 4 }, ...vehicle(0, [['Lidcombe', '19:52', '19:54:30'], ['Auburn', '19:56:30', '19:57'], ['Clyde', '19:58:10', null]])] },
    phone: lockedFrom('19:46', '19:46:20'),
    order: ['delay', 'headsup', 'atstop'],
  },
  {
    id: 'S17d', title: 'Reading 3 min old at the Get off moment',
    story: '4 min late; the feed stops at 7:55:30, so at 7:58:28 the newest reading is 3 min old: a quiet note with no sound, never the words "get off".',
    legs: [sample()], start: '19:46', end: '20:03',
    feed: { events: late4(), gaps: [['19:55:30', null]] },
    phone: lockedFrom('19:46', '19:46:20'),
    order: ['delay', 'headsup', 'quiet'],
  },
  {
    id: 'S18a', title: 'Calm sequence, phone locked',
    story: '4 min late, locked: heads-up, Get off now, arrival, once each, Kylie clips, one buzz each.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() }, phone: lockedFrom('19:46', '19:46:20'),
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S18b', title: 'Calm sequence, app in the background',
    story: 'As S18a with the phone unlocked and the app in the background.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() }, phone: [{ at: '19:46', app: 'open' }, { at: '19:46:20', app: 'background' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S18c', title: 'Calm sequence, app open',
    story: 'As S18a with the app open the whole trip (the delay at Start trip is not spoken: the app had just opened): spoken in the app with the station name, one light tap for heads-up and Get off now; the server copies show without sound.',
    legs: [sample()], start: '19:46', end: '20:02', feed: { events: late4() }, phone: [{ at: '19:46', app: 'open' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'], spoken: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S19', title: 'Widget for the whole trip',
    story: '4 min late, locked. The widget follows the trip from Start trip to 2 min after arrival.',
    legs: [sample()], start: '19:46', end: '20:03', feed: { events: late4() }, phone: lockedFrom('19:46', '19:46:20'),
    checks: [
      { at: '19:48', widget: 'has', is: '7:54pm' }, { at: '19:50:30', widget: 'has', is: '7:54pm' }, { at: '19:56', widget: 'has', is: 'Next: Auburn' },
      { at: '19:58', widget: 'has', is: 'Clyde next' }, { at: '19:58:40', widget: 'has', is: 'Get off now' }, { at: '19:59:30', widget: 'has', is: 'Arrived Clyde' }, { at: '20:01:30', widget: 'is', is: null },
    ],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'S20', title: 'Live data lost 3 min before the stop',
    story: '4 min late; the feed stops at 7:56. The card holds with "about" and "Updated 7:55pm" (the last reading); no Get off now with sound, no arrival claim; a quiet note at 7:58:30 because the reading is under 5 min old.',
    legs: [sample()], start: '19:46', end: '20:06',
    feed: { events: late4(), gaps: [['19:56', null]] },
    phone: lockedFrom('19:46', '19:46:20'),
    checks: [{ at: '19:58', card: 'arrive', is: 'Clyde about 7:59pm' }, { at: '19:58', card: 'sub', is: 'Updated 7:55pm' }, { at: '20:05', tripPhase: 'nextStop' }],
    order: ['delay', 'headsup', 'quiet'],
  },
  {
    id: 'BUS', owner: true, title: 'Bus 415 from Stand G (stop 213516)',
    story: 'A 415 bus from Stand G, 3 min late by the bus position. Stops after Stand G and their times are assumptions. Phone locked.',
    legs: [{ mode: 'bus', line: '415', stand: 'Stand G', stops: [{ name: 'Strathfield Station, Stand G', tt: '20:10', id: '213516' }, { name: 'Albert Rd', tt: '20:13', note: 'assumed' }, { name: 'Burwood Station', tt: '20:17', note: 'assumed' }] }],
    start: '20:06', end: '20:24',
    feed: { events: [{ at: '20:05', leg: 0, delay: 3 }, ...vehicle(0, [['Strathfield Station, Stand G', '20:12:40', '20:13:20'], ['Albert Rd', '20:15:40', '20:16'], ['Burwood Station', '20:20', null]])] },
    phone: lockedFrom('20:06', '20:06:20'),
    checks: [{ at: '20:08', card: 'status', is: 'Leaves 8:13pm · Stand G' }, { at: '20:08', card: 'warn', is: '3 min late' }, { at: '20:13:10', card: 'status', is: 'Due now · Stand G' }, { at: '20:14', card: 'status', is: 'Next: Albert Rd' }],
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'X', owner: true, title: 'Change of trains: T1 to Redfern, then T4',
    story: 'T1 Strathfield to Redfern (non-stop, 2 min late), then T4 from Redfern Platform 10 to Kings Cross. Platforms and T4 times are assumptions. Heads-up on a non-stop leg comes 2 min before arrival.',
    legs: [
      { mode: 'train', line: 'T1', platform: '5', stops: [{ name: 'Strathfield', tt: '20:20' }, { name: 'Redfern', tt: '20:31' }] },
      { mode: 'train', line: 'T4', platform: '10', stops: [{ name: 'Redfern', tt: '20:36' }, { name: 'Central', tt: '20:38' }, { name: 'Town Hall', tt: '20:40' }, { name: 'Martin Place', tt: '20:42' }, { name: 'Kings Cross', tt: '20:44' }] },
    ],
    start: '20:16', end: '20:48',
    feed: { events: [
      { at: '20:15', leg: 0, delay: 2 }, { at: '20:15', leg: 1, delay: 0 },
      ...vehicle(0, [['Strathfield', '20:20', '20:22:20'], ['Redfern', '20:33', null]]),
      ...vehicle(1, [['Redfern', '20:35', '20:36:20'], ['Central', '20:37:40', '20:38'], ['Town Hall', '20:39:40', '20:40'], ['Martin Place', '20:41:40', '20:42'], ['Kings Cross', '20:44', null]]),
    ] },
    phone: lockedFrom('20:16', '20:16:20'),
    checks: [{ at: '20:25', card: 'status', is: 'Next: Redfern' }, { at: '20:25', card: 'warn', is: 'Then T4 8:36pm · Plat 10' }, { at: '20:33:20', card: 'status', is: 'Change: Leaves 8:36pm · Platform 10' }, { at: '20:45', card: 'status', is: 'Arrived Kings Cross 8:44pm' }],
    order: ['headsup', 'getoff', 'arrived', 'headsup', 'getoff', 'arrived'],
  },
];

export const byId = (id) => CASES.find((c) => c.id === id);
