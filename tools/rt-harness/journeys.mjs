// The journeys the real-time harness plays: every simulator case (app/sim/cases.mjs, the spec's scenario matrix and
// the owner's own trips S2, BUS and X), plus journeys added for the harness on sample stops (no owner stations: the
// owner's 530 bus, T2 and two-bus trips are played with the same shape on sample stops). Times are Sydney clock times.
import { CASES, vehicle } from '../../app/sim/cases.mjs';

const lockedFrom = (start, lock) => [{ at: start, app: 'open' }, { at: lock, app: 'locked' }];

export const RT_CASES = [
  {
    id: 'RT-BUS530', title: 'Bus route 530 shape on sample stops, 2 min late, phone locked',
    legs: [{ mode: 'bus', line: '530', stand: 'Stand C', stops: [{ name: 'Abbotsford Wharf, Stand C', tt: '08:10' }, { name: 'Wareemba Shops', tt: '08:14' }, { name: 'Rodd Point', tt: '08:17' }, { name: 'Drummoyne Shops', tt: '08:21' }] }],
    start: '08:06', end: '08:28',
    feed: { events: [{ at: '08:05', leg: 0, delay: 2 }, ...vehicle(0, [['Abbotsford Wharf, Stand C', '08:11:40', '08:12:20'], ['Wareemba Shops', '08:15:40', '08:16:10'], ['Rodd Point', '08:18:50', '08:19:20'], ['Drummoyne Shops', '08:23', null]])] },
    phone: lockedFrom('08:06', '08:06:20'),
    order: ['headsup', 'getoff', 'arrived'],
  },
  {
    id: 'RT-T2', title: 'T2 train shape on sample stations, delay grows 1 to 5 min after lock',
    legs: [{ mode: 'train', line: 'T2', platform: '3', stops: [{ name: 'Granville', tt: '17:30' }, { name: 'Harris Park', tt: '17:33' }, { name: 'Parramatta', tt: '17:35' }, { name: 'Westmead', tt: '17:38' }] }],
    start: '17:25', end: '17:50',
    feed: { events: [{ at: '17:24', leg: 0, delay: 1 }, { at: '17:29', leg: 0, delay: 3 }, { at: '17:31', leg: 0, delay: 5 },
      ...vehicle(0, [['Granville', '17:34', '17:35:10'], ['Harris Park', '17:38', '17:38:30'], ['Parramatta', '17:40', '17:40:40'], ['Westmead', '17:43', null]])] },
    phone: lockedFrom('17:25', '17:25:20'),
    order: ['delay', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'RT-2BUS', title: 'Two buses with a change on sample stops (owner two-bus trip shape), phone locked',
    legs: [
      { mode: 'bus', line: '400', stand: 'Stand A', stops: [{ name: 'Homebush West Shops, Stand A', tt: '09:00' }, { name: 'Lidcombe Rd', tt: '09:04' }, { name: 'Berala Shops', tt: '09:08' }] },
      { mode: 'bus', line: '415', stand: 'Stand B', stops: [{ name: 'Berala Shops, Stand B', tt: '09:13' }, { name: 'Regents Park Shops', tt: '09:17' }, { name: 'Birrong Shops', tt: '09:21' }] },
    ],
    start: '08:56', end: '09:28',
    feed: { events: [{ at: '08:55', leg: 0, delay: 1 }, { at: '08:55', leg: 1, delay: 0 },
      ...vehicle(0, [['Homebush West Shops, Stand A', '09:00:40', '09:01:10'], ['Lidcombe Rd', '09:05', '09:05:20'], ['Berala Shops', '09:09', null]]),
      ...vehicle(1, [['Berala Shops, Stand B', '09:12:40', '09:13:10'], ['Regents Park Shops', '09:17', '09:17:20'], ['Birrong Shops', '09:21', null]])] },
    phone: lockedFrom('08:56', '08:56:20'),
    order: ['headsup', 'getoff', 'arrived', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'RT-PLATLOCK', title: 'Platform 7 changes to 6 at 7:47 with the phone locked',
    legs: [{ mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Lidcombe', tt: '19:50' }, { name: 'Auburn', tt: '19:53' }, { name: 'Clyde', tt: '19:55' }] }],
    start: '19:42', end: '20:00',
    feed: { events: [{ at: '19:41', leg: 0, delay: 0 }, { at: '19:47', leg: 0, platform: '6' }, ...vehicle(0, [['Lidcombe', '19:49', '19:50:30'], ['Auburn', '19:52:30', '19:53'], ['Clyde', '19:55', null]])] },
    phone: lockedFrom('19:42', '19:42:20'),
    order: ['platform', 'headsup', 'getoff', 'arrived'],
  },
  {
    id: 'RT-DIVERT', title: 'Run disappears from the feed after leaving (diverted or replaced), phone locked',
    legs: [{ mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Lidcombe', tt: '19:50' }, { name: 'Auburn', tt: '19:53' }, { name: 'Clyde', tt: '19:55' }] }],
    start: '19:44', end: '20:10',
    feed: { events: [{ at: '19:43', leg: 0, delay: 0 }, ...vehicle(0, [['Lidcombe', '19:49', '19:50:30']]), { at: '19:51', leg: 0, unmatched: true }] },
    phone: lockedFrom('19:44', '19:44:20'),
    order: [],
  },
  {
    id: 'RT-HELD-LOCK', title: 'Held 4 min outside the stop off after Get off now, phone locked',
    legs: [{ mode: 'train', line: 'T1', platform: '7', stops: [{ name: 'Lidcombe', tt: '19:50' }, { name: 'Auburn', tt: '19:53' }, { name: 'Clyde', tt: '19:55' }] }],
    start: '19:44', end: '20:08',
    feed: { events: [{ at: '19:43', leg: 0, delay: 0 }, ...vehicle(0, [['Lidcombe', '19:49', '19:50:30'], ['Auburn', '19:52:30', '19:53']]),
      { at: '19:54:20', leg: 0, est: { Clyde: '19:55' } }, { at: '19:55:00', leg: 0, est: { Clyde: '19:59' } }, ...vehicle(0, [['Clyde', '19:59', null]])] },
    phone: lockedFrom('19:44', '19:44:20'),
    order: ['headsup', 'getoff', 'held', 'arrived'],
  },
];

export const ALL_CASES = [...CASES, ...RT_CASES];
export const caseOf = (id) => { const c = ALL_CASES.find((x) => x.id === id); if (!c) throw new Error('no case ' + id); return c; };
