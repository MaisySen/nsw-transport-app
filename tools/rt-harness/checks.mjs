// The checks every real-time run is held to. Each is a rule from docs/TRIP_FLOW_SPEC.md (R-A to R-E, 2.4 to 2.6,
// I1 to I10 in the simulator, R1 to R6 in instantPaintCore.ts) applied to what the phone really received and showed.
// A failed check is a bug candidate: run.mjs groups them across runs into the bug list.
import { PHASES } from '../../app/sim/journeySim.mjs';

const PI = Object.fromEntries(PHASES.map((p, i) => [p, i]));
const STALE_WORDS = /Updated|about|No live|Timetable|Open the app|not live/i;

export function evaluate(rec, S, { P }) {
  const out = [];
  const add = (id, ok, sev, detail, data) => out.push({ id, ok: !!ok, sev, detail, ...(data ? { data } : {}) });
  const hms = (t) => { const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = Math.round(t % 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
  const toS = (s) => { const [h, m, x = 0] = String(s).split(':').map(Number); return h * 3600 + m * 60 + x; };
  const win = (S.faults || []).map((f) => ({ ...f, a: toS(f.from), b: f.to ? toS(f.to) : Infinity }));
  const faultNear = (t, kinds, before = 150) => win.some((w) => kinds.some((k) => w[k]) && t >= w.a && t < w.b + before);
  const devOff = []; // phone offline windows
  { let off = null; for (const d of S.device || []) if ('net' in d) { const t = toS(d.at); if (!d.net && off == null) off = t; if (d.net && off != null) { devOff.push([off, t]); off = null; } } if (off != null) devOff.push([off, Infinity]); }
  const offlineNear = (t, before = 150) => devOff.some(([a, b]) => t >= a && t < b + before);
  const laOff = (S.device || []).some((d) => d.la === false);
  const lockedAt = (rec.device.find((d) => /app (locked|background|killed)/.test(d.what)) || {}).t;
  const arrs = rec.truthArr.filter((x) => x != null);
  const lastArr = arrs.length ? Math.max(...arrs) : null;
  const tripLive = (t) => t >= P.start && (lastArr == null || t < lastArr);
  const clean = (t) => !faultNear(t, ['nsw', 'server', 'apns', 'phone']) && !offlineNear(t);

  // 1. no crash in the server (cron passes, routes) and no unhandled rejection
  add('server-no-crash', rec.errors.length === 0, 'critical', rec.errors.length ? `${rec.errors.length} errors, first at ${hms(rec.errors[0].t)}: ${rec.errors[0].where}: ${rec.errors[0].msg.split('\n')[0]}` : 'none', rec.errors.slice(0, 5));

  // 2. Start trip registrations answered (outside injected failures)
  const regs = rec.calls.filter((x) => x.method === 'POST');
  const badReg = regs.filter((x) => x.status !== 200 && x.status !== 'offline' && x.status !== 503 && !faultNear(x.t, ['server', 'phone'], 0));
  add('registration-ok', badReg.length === 0, 'high', badReg.length ? badReg.map((x) => `${x.p} ${x.status} at ${hms(x.t)}`).join('; ') : `${regs.length} posts`, badReg);

  // 3. the server holds the trip card's push token (else nothing updates the Lock Screen card while locked)
  const lockedLong = rec.samples.filter((x) => x.app !== 'open' && tripLive(x.t)).length * 5;
  if (!laOff) add('card-token-on-server', rec.laTokenSent || lockedLong < 60, 'critical',
    rec.laTokenSent ? 'sent' : `the card's push token never reached the server; the phone was locked ${Math.round(lockedLong / 60)} min of the trip with no server updates to the Lock Screen card`, { calls: rec.calls.filter((x) => x.p === '/api/live-activity') });

  // 4. card push cadence while locked: at least every 60 s while the trip is live (spec 2.5), outside failures
  const la = rec.apns.filter((p) => p.topic && p.topic.endsWith('liveactivity') && p.status === 200);
  if (rec.laTokenSent && lockedAt != null) {
    const from = Math.max(lockedAt, (rec.calls.find((x) => x.p === '/api/live-activity' && x.status === 200) || {}).t || 0);
    const ts = la.map((p) => p.at).filter((t) => t >= from);
    let worst = 0, worstAt = null, prev = from;
    // the window ends at the train's arrival, or at the card's own end (1 Nov: S5 follows the next train, whose arrival
    // is not in truthArr, so the window ran to the scenario's end, 105 s past the card's end push)
    const endPush = la.find((p) => p.body && p.body.aps && p.body.aps.event === 'end' && p.at >= from);
    const until = Math.min(lastArr != null ? lastArr : P.end, endPush ? endPush.at : Infinity);
    for (const t of [...ts.filter((x) => x <= until), until]) { if (t - prev > worst && clean(prev) && clean(t)) { worst = t - prev; worstAt = prev; } prev = t; }
    add('card-push-cadence', worst <= 80, 'high', `longest gap between card pushes while locked ${Math.round(worst)} s${worstAt != null ? ' from ' + hms(worstAt) : ''} (rule: at least every 60 s); ${ts.length} card pushes`, { worst, worstAt, count: ts.length });
  }

  // 5. locked card stays live: the time behind what the Lock Screen card shows is under 2.5 min when nothing failed
  {
    let worst = 0, worstAt = null, n = 0, bad = 0;
    for (const x of rec.samples) {
      if (x.app === 'open' || !x.card || x.card.ended || !tripLive(x.t) || !clean(x.t) || x.t < (lockedAt || 0) + 60) continue;
      n++;
      const age = x.card.updatedS != null ? x.t - x.card.updatedS : Infinity;
      if (age > 150) bad++;
      if (age > worst) { worst = age; worstAt = x.t; }
    }
    if (!laOff && n) add('locked-card-live', bad === 0, 'critical', bad ? `Lock Screen card showed data up to ${Number.isFinite(worst) ? Math.round(worst / 60 * 10) / 10 + ' min' : 'of unknown age'} old (at ${hms(worstAt)}) while the feed, server and phone were fine; ${Math.round(bad * 5 / 60 * 10) / 10} min of the locked trip over 2.5 min old` : `oldest ${Math.round(worst)} s`, { worst, worstAt, badS: bad * 5 });
  }

  // 6. no fake live: data over 2 min old with no stale words while iOS still treats the card as fresh (stale date ahead)
  {
    const fakes = rec.samples.filter((x) => x.app !== 'open' && x.card && !x.card.ended && x.card.src === 'push' && x.card.updatedS != null && x.t - x.card.updatedS > 135 && (x.card.staleS == null || x.card.staleS > x.t) && !STALE_WORDS.test(x.card.warning || '') && x.card.phase !== 'arrived' && tripLive(x.t));
    if (!laOff) add('no-fake-live', fakes.length === 0, 'high', fakes.length ? `${fakes.length * 5} s of a card with data over 2 min old, no stale words and a stale date still ahead (first ${hms(fakes[0].t)}: updated ${hms(fakes[0].card.updatedS)}, stale date ${fakes[0].card.staleS != null ? hms(fakes[0].card.staleS) : 'none'})` : 'none', fakes.slice(0, 3));
  }

  // 7. stale words at 2, 5 and 10 min when the server's own feed is old (spec 2.4), pushed while locked
  if (S.expect && S.expect.staleFrom) {
    const t0 = toS(S.expect.staleFrom);
    const steps = [[120 + 90, /about|Updated/i, '2 min'], [300 + 90, /No live data|Timetable/i, '5 min'], [600 + 90, /Open the app|No live data/i, '10 min']];
    for (const [age, re, name] of steps) {
      const x = rec.samples.find((s) => s.t >= t0 + age && s.app !== 'open');
      if (!x || !tripLive(x.t) || (S.expect.staleTo && x.t > toS(S.expect.staleTo))) continue;
      const words = x.card && (x.card.warning || '');
      const iosStale = x.card && x.card.staleS != null && x.card.staleS <= x.t;
      add('stale-words-' + name.replace(' ', ''), re.test(words), iosStale ? 'medium' : 'high', `at ${hms(x.t)} (feed ${name}+ old) the card says "${words || '(nothing)'}"${iosStale ? ' (iOS stale date passed, so the card dims on its own)' : ' and its stale date is still ahead'}`);
    }
  }

  // 8. Get off now lands 3 to 45 s before the train is really at the stop off (38 s rule, cap 40, 2 s send lead)
  const notes = rec.notes.slice().sort((a, b) => a.shownAt - b.shownAt);
  const getoffs = notes.filter((n) => n.kind === 'getoff');
  if (S.expect?.getoff !== false) {
    rec.truthArr.forEach((arr, li) => {
      if (arr == null) return;
      const prevArr = li > 0 ? rec.truthArr[li - 1] || P.start : P.start;
      const g = getoffs.find((n) => n.shownAt > prevArr && n.shownAt <= arr + 60);
      if (!g) { add(`getoff-leg${li}`, false, 'high', `no Get off now reached the phone for leg ${li + 1} (train at the stop ${hms(arr)})`); return; }
      const lead = arr - g.shownAt;
      add(`getoff-leg${li}`, lead >= 3 && lead <= (S.expect?.getoffMaxLead || 45), lead > 45 ? 'critical' : 'high', `Get off now shown ${Math.round(lead)} s before the train was at the stop (${hms(g.shownAt)} vs ${hms(arr)}; rule 3 to 45 s, via ${g.via})`, { lead });
    });
  }
  // 9. one alert per moment: nothing rings twice
  {
    const seen = new Map(); const dups = [];
    for (const n of notes) { const k = n.kind + '|' + (n.title || '') + '|' + (n.body || ''); if (seen.has(k) && n.shownAt - seen.get(k) < 900) dups.push(n); seen.set(k, n.shownAt); }
    const want = {}; for (const k of rec.caseOrder || []) want[k] = (want[k] || 0) + 1;
    const got = {}; for (const n of notes) got[n.kind] = (got[n.kind] || 0) + 1;
    const extra = Object.keys(got).filter((k) => want[k] != null && got[k] > want[k]);
    add('no-double-alerts', dups.length === 0 && extra.length === 0, 'high', dups.length || extra.length ? `rang twice: ${[...dups.map((d) => `"${d.title}" at ${hms(d.shownAt)} via ${d.via}`), ...extra.map((k) => `${k} ${got[k]}x (want ${want[k]})`)].join('; ')}` : 'none', { dups: dups.slice(0, 5), got, want });
  }
  // 10. the alerts in the order the spec says (clean runs)
  if (S.strict && rec.caseOrder) {
    const kinds = notes.map((n) => n.kind).filter((k) => rec.caseOrder.includes(k));
    add('alert-order', JSON.stringify(kinds) === JSON.stringify(rec.caseOrder), 'medium', `got [${kinds.join(', ')}], want [${rec.caseOrder.join(', ')}]`);
  }
  // 11/12. the "Your trip" widget and the Watch trip screen stay live while locked (Bidur 1 Nov: locked screens)
  for (const [k, name, sev] of [['widget', '"Your trip" widget', 'critical'], ['watch', 'Watch trip screen', 'high']]) {
    let worst = 0, worstAt = null, n = 0, bad = 0;
    for (const x of rec.samples) {
      if (x.app === 'open' || !tripLive(x.t) || !clean(x.t) || x.t < (lockedAt || 0) + 60) continue;
      const tp = PI[x.truth.phase];
      if (tp == null || tp >= PI.arrived) continue;
      n++;
      const age = x[k] ? x.t - x[k].asOfS : Infinity;
      if (age > 360) bad++;
      if (age > worst) { worst = age; worstAt = x.t; }
    }
    if (n) add(`${k}-locked-live`, bad === 0, sev, bad ? `${name} drew data up to ${Number.isFinite(worst) ? Math.round(worst / 60 * 10) / 10 + ' min' : '(never written)'} old at ${hms(worstAt)} while locked; nothing refreshes it until the app opens (rule: the widget reads the trip state itself about every 5 min, spec 2.5)` : `oldest ${Math.round(worst)} s`, { worst, worstAt, badS: bad * 5 });
  }
  // 13. the locked card shows the phase the train is really in (R-E), outside failures
  if (!laOff) {
    let run = 0, worst = 0, worstAt = null, ex = null;
    for (const x of rec.samples) {
      if (x.app === 'open' || !x.card || x.card.ended || !tripLive(x.t) || !clean(x.t)) { run = 0; continue; }
      const a = PI[x.card.phase], b = PI[x.truth.phase];
      if (a == null || b == null || Math.abs(a - b) <= 1) { run = 0; continue; }
      run += 5; if (run > worst) { worst = run; worstAt = x.t; ex = `${x.card.phase} vs ${x.truth.phase}`; }
    }
    add('card-phase-matches-train', worst <= 60, 'high', worst > 60 ? `card phase two or more steps off the train's for ${worst} s (to ${hms(worstAt)}: card ${ex})` : 'ok', { worst });
  }
  // 14. the card ends about 2 min after arriving (spec 2.2 step 8)
  if (!laOff && rec.laTokenSent && lastArr != null && P.end - lastArr > 200 && clean(lastArr)) {
    const e = rec.samples.find((x) => x.card && x.card.ended);
    add('card-ends', !!e && e.t <= lastArr + 120 + 120, 'medium', e ? `card ended at ${hms(e.t)} (arrived ${hms(lastArr)})` : `card never ended (arrived ${hms(lastArr)}, run to ${hms(P.end)})`);
  }
  // 15. the card never steps back within a leg
  {
    const back = []; let prev = null;
    for (const p of la) { const cs = p.body?.aps?.['content-state']; if (!cs) continue; const ph = { wait: 0, board: 0, ride: 1, next: 2, getoff: 3, arrived: 4 }[cs.phase]; const k = cs.getOffAt; if (prev && prev.k === k && ph != null && prev.ph != null && ph < prev.ph) back.push(`${prev.p}->${cs.phase} at ${hms(p.at)}`); prev = { k, ph, p: cs.phase }; }
    add('card-never-steps-back', back.length === 0, 'medium', back.length ? back.slice(0, 3).join('; ') : 'ok');
  }
  // 16. held train: a quiet "Held, stay on" when the train is held after Get off now (build 214)
  if (S.expect?.held) add('held-note', notes.some((n) => n.kind === 'held'), 'high', notes.some((n) => n.kind === 'held') ? 'sent' : 'no "Held, stay on" reached the phone');
  // 17. no Get off now, next stop or arrival from the timetable clock when live data is gone (R-A)
  if (S.expect?.noMovesAfter) {
    const t0 = toS(S.expect.noMovesAfter);
    const moves = notes.filter((n) => n.shownAt > t0 + 30 && ['getoff', 'arrived', 'headsup'].includes(n.kind));
    add('no-moves-without-live', moves.length === 0, 'critical', moves.length ? moves.map((n) => `"${n.title}" at ${hms(n.shownAt)}`).join('; ') + ' with no live data behind it' : 'none');
  }
  // 18. budget proxies (battery, the US$5 plan): Apple pushes per trip minute and Transport for NSW calls per minute
  {
    const mins = Math.max(1, (P.end - P.start) / 60);
    const perMin = la.length / mins;
    add('push-budget', perMin <= 2.5, 'low', `${la.length} card pushes in ${Math.round(mins)} min (${perMin.toFixed(2)} a minute), ${rec.apns.length - la.length} alert pushes, ${rec.expo.length} Expo`);
    const nswPerMin = rec.nsw.calls / mins;
    add('feed-budget', nswPerMin <= 12, 'low', `${rec.nsw.calls} feed and board reads for one trip (${nswPerMin.toFixed(1)} a minute)`);
  }
  // 19. overlapping cron passes still ring once (checked by 9), and no pass outlives two minutes
  {
    const long = rec.passes.filter((p) => p.virtS > 125);
    add('pass-length', long.length === 0, 'medium', long.length ? `${long.length} cron passes ran over 2 min (longest ${Math.max(...long.map((p) => p.virtS))} s)` : `longest ${Math.max(0, ...rec.passes.map((p) => p.virtS || 0))} s`);
  }
  return out;
}
