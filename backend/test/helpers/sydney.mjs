// Sydney midnight for tests, the same on any machine (5 Nov 2026). The tests used to read the Sydney date as midnight
// in the machine's own time zone, which is Sydney midnight only when TZ=Australia/Sydney. CI runs in UTC, so from
// Sydney midnight until the two dates matched again (about 13:00 to 19:00 UTC) the test timetable sat hours away from
// now and 45 tests failed, on main as well.

const fmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Seconds since Sydney midnight on the Sydney wall clock at this instant (ms). */
function wallSeconds(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
}

/**
 * The instant (seconds since 1970) of the last Sydney midnight at `now` (ms). On the two daylight saving days the
 * wall clock and the real time since midnight differ by an hour; the second step moves to the real midnight.
 */
export function sydneyMidnightS(now = Date.now()) {
  const nowS = Math.floor(now / 1000);
  let m = nowS - wallSeconds(nowS * 1000);
  const w = wallSeconds(m * 1000);
  if (w !== 0) m -= w > 43200 ? w - 86400 : w;
  return m;
}
