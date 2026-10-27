// The "it just knows" pieces on screen: the leave time on the commute card with Remind me, the Wake me switch and
// the next option card on the live trip.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { api, tripForCalendar } from '@/lib/api';
import { clock, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { getLive, liveWatch, setLive, type LiveTrip } from '@/lib/live';
import { resetLiveCache, tickLive } from '@/lib/liveEngine';
import type { LiveState } from '@/lib/liveCalc';
import { boardTime, leavePlan, leaveWords, legsOf, reachFrom, missedConn, missedPlanLegs, pickNextOption, switchLegs, sydHHMM, wakeId, type LatLon, type Missed } from '@/lib/smart';
import { canNotify, cancelLeave, cancelWake, scheduleLeave } from '@/lib/smartNotify';
import { getOffId, readGetOffSay } from '@/lib/getOffCore';
import { cancelGetOff } from '@/lib/getOffNotify';
import { store, useStore } from '@/lib/store';
import { androidLook, radius, usePalette } from '@/lib/theme';
import type { Journey } from '@/lib/types';
import { Icon, I, type IconName } from './Icon';
import { LineBadge } from './Transit';
import { T } from './ui';
import { useFlag } from '@/lib/config';
import { hasSpeech, hasSpeechSession, speak } from '@/lib/nativeExtras';
import { checkSubtitle } from '@/lib/morning';
import { ymdSyd } from '@/lib/calendarLeaveByCore';
import { useScreenPoll } from '@/lib/activity';
import type { Place } from '@/lib/types';

const short = (n?: string | null) => shortName(n || '').replace(/ Station$/, '');
const plat = (p?: string | null) => (p ? p.replace(/^Platform\s*/i, 'Platform ').replace(/^Stand\s*/i, 'Stand ') : '');

type Pos = { phase: 'checking' | 'ask' | 'off' | 'on'; pos: LatLon | null; ask: () => void };

/**
 * Where you are, only when location is allowed. Never asks on its own: "ask" means it was never asked and a tap
 * can ask; "off" means it was refused, so nothing about walking shows.
 */
export function useMyPos(): Pos {
  const [phase, setPhase] = useState<Pos['phase']>('checking');
  const [pos, setPos] = useState<LatLon | null>(null);
  const read = useCallback(async () => {
    try {
      // A fix up to 2 minutes old is good enough for walking minutes, and costs no GPS at all.
      let p = await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null);
      if (!p) p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (p) setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
    } catch {}
    return true;
  }, []);
  const check = useCallback(async (ask: boolean) => {
    try {
      let p = await Location.getForegroundPermissionsAsync();
      if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
      if (p.granted) { setPhase('on'); read(); }
      else setPhase(p.canAskAgain && p.status !== 'denied' ? 'ask' : 'off');
    } catch { setPhase('off'); }
    return true;
  }, [read]);
  useEffect(() => { check(false); }, [check]);
  // Permission and position are read again every 2 minutes, and only while this screen is on view and the app is
  // in front (coming back from Settings after allowing location counts as stale, so it reads at once).
  useScreenPoll(() => check(false), 120000, { staleMs: 5000 });
  return { phase, pos, ask: () => check(true) };
}

/**
 * Under the commute card: "Leave in 6 min, 9 min walk to Burwood" for the first service you can still make on foot,
 * and Remind me, which sets one alert on this phone at the leave time.
 */
/**
 * When every service the card loaded leaves before you could walk there (reachFrom), one more trip ask for services
 * from the time you could reach the stop, so the leave time still shows. Asked again only when that time moves to
 * the next 5 minutes; no history or install id goes with it (tripForCalendar). Nothing is polled.
 */
function useReachable(js: Journey[], now: number, me: LatLon | null, ends?: { from: string; to: string }): Journey[] {
  const [got, setGot] = useState<{ key: string; js: Journey[] }>({ key: '', js: [] });
  const from = ends && me ? reachFrom(js, now, me) : null;
  const key = ends && from != null ? `${ends.from}|${ends.to}|${Math.floor(from / 300000)}` : '';
  useEffect(() => {
    if (!key || !ends || from == null) return;
    let on = true;
    const day = ymdSyd(from);
    tripForCalendar(ends.from, ends.to, { time: sydHHMM(from), arriveBy: false, ...(day !== ymdSyd(Date.now()) ? { date: day } : {}) })
      .then((r) => { if (on) setGot({ key, js: r.journeys || [] }); })
      .catch(() => { if (on) setGot({ key, js: [] }); });
    return () => { on = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return key && got.key === key ? got.js : [];
}

/** compact: on the commute card, a small "When to leave" button, or one line with a bell button (Home, 25 Oct 7 PM). */
export function LeaveLine({ js, now, me, compact, ends }: { js: Journey[]; now: number; me: Pos; compact?: boolean; ends?: { from: string; to: string } }) {
  const c = usePalette();
  const st = useStore();
  const rem = st.leaveReminder;
  useEffect(() => { if (rem && rem.at < now - 60000) store.setLeaveReminder(null); }, [rem, now]);
  const later = useReachable(js, now, me.phase === 'on' ? me.pos : null, ends);
  if (me.phase === 'off' || me.phase === 'checking') return null;
  if (me.phase === 'ask' && compact) return <MiniAction icon={I.walk} title="When to leave" label="Show when to leave. Uses your location on this phone." onPress={me.ask} />;
  if (me.phase === 'ask') {
    return (
      <Pressable onPress={me.ask} accessibilityRole="button" accessibilityLabel="Show when to leave. Uses your location on this phone." android_ripple={{ color: c.fill }}
        style={({ pressed }) => [s.leave, { opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
        <Icon name={I.walk} size={16} color={c.tint} />
        <T kind="sub" tone="tint" style={{ marginLeft: 8, fontWeight: '600' }}>Show when to leave</T>
      </Pressable>
    );
  }
  const p = leavePlan(later.length ? [...js, ...later] : js, now, me.pos);
  if (!p) return null;
  const station = short(p.leg.from);
  const label = `${clock(p.dep)} ${p.leg.line || ''}`.trim();
  const set = !!rem && rem.dep === p.dep && rem.at > now;
  const remind = async () => {
    if (set) { await cancelLeave(); store.setLeaveReminder(null); haptic.select(); return; }
    const ok = await canNotify(true);
    if (!ok) { Alert.alert('Notifications are off', 'Turn on notifications for Transport in your phone settings to get a leave alert.'); return; }
    const done = await scheduleLeave(p.leaveAt, `Leave now for the ${label}`, `${p.walk} min walk to ${station}${p.leg.fromPlatform ? ', ' + plat(p.leg.fromPlatform) : ''}. It leaves at ${clock(p.dep)}.`);
    if (!done) { Alert.alert("Couldn't set the reminder", 'Try again in a moment.'); return; }
    store.setLeaveReminder({ at: p.leaveAt, dep: p.dep, label });
    haptic.success();
  };
  const words = leaveWords(p);
  const urgent = p.inMin <= 2;
  if (compact) {
    const fg = set ? c.tint : androidLook && c.dark ? '#062E6F' : '#fff';
    return (
      <View style={s.leaveMini} accessibilityLiveRegion="polite">
        <Icon name={I.walk} size={16} color={urgent ? c.red : c.tint} />
        <View style={{ flex: 1, marginLeft: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' }} accessible accessibilityLabel={`${words}, ${p.walk} minute walk to ${station}, for the ${label}${set ? `. Reminder at ${clock(rem!.at)}` : ''}`}>
          <T kind="sub" style={{ fontWeight: '600', color: urgent ? c.redText : c.text }}>{words}</T>
          <T kind="sub" tone="text2">{` \u00b7 ${p.walk} min walk${set ? ` \u00b7 reminder ${clock(rem!.at)}` : ''}`}</T>
        </View>
        {p.inMin > 0 ? (
          <Pressable onPress={remind} accessibilityRole="button" accessibilityLabel={set ? `Cancel the reminder at ${clock(rem!.at)}` : `Remind me at ${clock(p.leaveAt)}`}
            android_ripple={{ color: c.fill, borderless: true, radius: 22 }} hitSlop={4}
            style={({ pressed }) => [s.bell, { backgroundColor: set ? c.fill : c.tint, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
            <Icon name={set ? I.bellOff : I.bellPlus} size={16} color={fg} />
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={s.leave} accessibilityLiveRegion="polite">
      <Icon name={I.walk} size={18} color={urgent ? c.red : c.tint} />
      <View style={{ flex: 1, marginLeft: 10 }} accessible accessibilityLabel={`${words}, ${p.walk} minute walk to ${station}, for the ${label}`}>
        <T kind="headline" style={{ color: urgent ? c.redText : c.text }}>{words}</T>
        <T kind="foot" tone="text2" numberOfLines={2}>{p.walk} min walk to {station}, for the {label}{set ? `. Reminder at ${clock(rem!.at)}` : ''}</T>
      </View>
      {p.inMin > 0 ? (
        <Pressable onPress={remind} accessibilityRole="button" accessibilityLabel={set ? `Cancel the reminder at ${clock(rem!.at)}` : `Remind me at ${clock(p.leaveAt)}`}
          android_ripple={{ color: c.fill, borderless: false }} hitSlop={4}
          style={({ pressed }) => [s.pill, { backgroundColor: set ? c.fill : c.tint, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
          <Icon name={set ? I.bellOff : I.bellPlus} size={15} color={set ? c.tint : androidLook && c.dark ? '#062E6F' : '#fff'} />
          <T kind="sub" style={{ marginLeft: 6, fontWeight: '600', color: set ? c.tint : androidLook && c.dark ? '#062E6F' : '#fff' }}>{set ? 'Cancel' : 'Remind me'}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Under the commute card: the way into Check my trip before I go, or the check already set for this direction. */
export function MorningLink({ from, to, dir, compact }: { from: Place; to: Place; dir: 'toWork' | 'toHome'; compact?: boolean }) {
  const c = usePalette();
  const st = useStore();
  const on = useFlag('morningCheck');
  if (!on) return null;
  const m = (st.morning || []).find((x) => x.from.id === from.id && x.to.id === to.id);
  const words = m ? `Checked before you go: ${checkSubtitle(m).split('. ')[0]}` : 'Check my trip before I go';
  if (compact) {
    return <MiniAction icon={I.clock} title={m ? `Checked ${checkSubtitle(m).split('. ')[0]}` : 'Check before I go'} label={m ? `${words}. Opens your checks` : `${words}. One alert before your usual trip, only if something is wrong`}
      onPress={() => { haptic.select(); router.push({ pathname: '/morning', params: { dir } }); }} />;
  }
  return (
    <Pressable onPress={() => { haptic.select(); router.push({ pathname: '/morning', params: { dir } }); }} accessibilityRole="button"
      accessibilityLabel={m ? `${words}. Opens your checks` : `${words}. One alert before your usual trip, only if something is wrong`}
      android_ripple={{ color: c.fill }} style={({ pressed }) => [s.leave, { minHeight: 48, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
      <Icon name={I.clock} size={16} color={c.tint} />
      <T kind="sub" tone="tint" numberOfLines={2} style={{ marginLeft: 8, fontWeight: '600', flex: 1 }}>{words}</T>
      <Icon name={I.chevron} size={13} color={c.text3} />
    </Pressable>
  );
}

/** A small rounded button on the commute card (When to leave, Check before I go). */
function MiniAction({ icon, title, label, onPress }: { icon: IconName; title: string; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} android_ripple={{ color: c.fill }} hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [s.mini, { backgroundColor: c.tint + (c.dark ? '2E' : '1A'), opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
      <Icon name={icon} size={14} color={c.tint} />
      <T kind="foot" tone="tint" numberOfLines={2} style={{ marginLeft: 6, fontWeight: '600', flexShrink: 1 }}>{title}</T>
    </Pressable>
  );
}

/** Live trip: Wake me before my stop. A strong buzz one stop before you get off, even with the app closed. */
export function WakeRow({ g, st }: { g: LiveTrip; st: LiveState | null }) {
  const c = usePalette();
  const [busy, setBusy] = useState(false);
  const legs = g.legs;
  const k = st && !st.done ? st.cur : legs.length - 1;
  const stop = short(legs[k]?.to);
  const toggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (on && !(await canNotify(true))) {
        Alert.alert('Notifications are off', 'Wake me needs notifications. Turn them on for Transport in your phone settings.');
        return;
      }
      const cur = getLive();
      if (!cur || cur.id !== g.id) return;
      setLive({ ...cur, wake: on });
      haptic.select();
      await tickLive();
    } finally { setBusy(false); }
  };
  const done = !!st?.done;
  return (
    <View style={[s.wake, { backgroundColor: c.card }]}>
      <View style={[s.wakeIcon, { backgroundColor: g.wake ? c.tint : c.fill }]}>
        <Icon name={I.bell} size={16} color={g.wake ? (androidLook && c.dark ? '#062E6F' : '#fff') : c.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <T kind="body">Wake me before my stop</T>
        <T kind="foot" tone="text2" numberOfLines={2}>{done ? 'Trip finished' : g.wake ? `A strong buzz one stop before ${stop}` : `Buzz one stop before ${stop}, so you can doze`}</T>
      </View>
      <Switch value={!!g.wake} onValueChange={toggle} disabled={busy || done} accessibilityLabel="Wake me before my stop"
        trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined}
        thumbColor={Platform.OS === 'android' ? (g.wake ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
    </View>
  );
}

/** Say trip alerts out loud, in headphones when they are in. Only on builds with the speech module (206 and later). */
export function SpeakRow({ g }: { g: LiveTrip }) {
  const c = usePalette();
  const sayNow = readGetOffSay(useStore().getOffSay);
  if (!hasSpeech()) return null;
  const toggle = (on: boolean) => {
    const cur = getLive();
    if (!cur || cur.id !== g.id) return;
    setLive({ ...cur, speak: on });
    store.setSpeak(on);
    haptic.select();
    if (on) { speak('Trip alerts will be spoken.'); tickLive(); }
  };
  const silentNote = !hasSpeechSession();
  return (
    <View style={[s.wake, { backgroundColor: c.card }]}>
      <View style={[s.wakeIcon, { backgroundColor: g.speak ? c.tint : c.fill }]}>
        <Icon name={I.bell} size={16} color={g.speak ? (androidLook && c.dark ? '#062E6F' : '#fff') : c.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <T kind="body">Speak alerts</T>
        <T kind="foot" tone="text2" numberOfLines={4}>{g.speak ? `Read out while the app is open: leaving soon, delays, stand changes and your stop.${silentNote ? ' Silent mode mutes the speaker; headphones still work.' : ''}` : sayNow ? 'Get off now is already spoken. Turn on to hear every trip alert too.' : 'Hear next stop and get off alerts in your headphones'}</T>
      </View>
      <Switch value={!!g.speak} onValueChange={toggle} accessibilityLabel="Speak alerts"
        trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined}
        thumbColor={Platform.OS === 'android' ? (g.speak ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
    </View>
  );
}

type Opt = { key: string; loading: boolean; j: Journey | null; err: string | null; at: number };

/**
 * Live trip: when the live times say you will miss your change, the next way on from the change stop, found at
 * once from /api/plan, with Switch to this.
 */
export function NextOption({ g, st }: { g: LiveTrip; st: LiveState | null }) {
  const c = usePalette();
  const m = st && !st.done ? missedConn(g.legs, st, g.to) : null;
  const key = m ? `${g.id}:${m.i}:${m.missing.tripId || m.missing.planned}` : '';
  const [opt, setOpt] = useState<Opt | null>(null);
  const mRef = useRef<Missed | null>(m);
  mRef.current = m;
  const keyRef = useRef(key);
  keyRef.current = key;
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async (k: string) => {
    const mm = mRef.current;
    if (!mm) return;
    setOpt((o) => ({ key: k, loading: true, j: o && o.key === k ? o.j : null, err: null, at: Date.now() }));
    try {
      const r = await api.plan(missedPlanLegs(mm), { count: 5, time: sydHHMM(mm.readyAt - 60000) });
      // The miss changed while this was on its way: this answer is for the old one.
      if (keyRef.current !== k) return;
      const j = pickNextOption(r.journeys || [], mm);
      setOpt({ key: k, loading: false, j, err: j ? null : 'No later service found from here.', at: Date.now() });
    } catch {
      if (keyRef.current !== k) return;
      // A failed or slow answer is tried again in 15 seconds rather than waiting for the minute refresh.
      setOpt((o) => (o && o.key === k && o.j ? { ...o, loading: false } : { key: k, loading: false, j: null, err: "Couldn't reach the trip planner. Trying again.", at: Date.now() }));
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => { retry.current = null; const now = mRef.current; if (now && `${now.i}` === k.split(':')[1] && AppState.currentState === 'active') load(k); }, 15000);
    }
  }, []);
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);
  // Found the moment the miss shows, then refreshed every minute while it stays missed.
  useEffect(() => { if (key && (!opt || opt.key !== key)) load(key); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useScreenPoll(() => { if (keyRef.current) load(keyRef.current); }, 60000, { enabled: !!key });
  if (!m) return null;
  const o = opt && opt.key === key ? opt : null;
  const j = o?.j || null;
  const l = j?.legs.find((x) => x.kind === 'transit');
  const tl = j ? j.legs.filter((x) => x.kind === 'transit') : [];
  const arr = j && tl.length ? new Date(tl[tl.length - 1].arrEstimated || tl[tl.length - 1].arrPlanned || j.arrive).getTime() : NaN;
  const missLine = `You'll miss the ${clock(new Date(m.missing.planned).getTime())} ${m.missing.line} at ${short(m.at)}`;
  const doSwitch = async () => {
    if (!j) return;
    const cur = getLive();
    if (!cur || cur.id !== g.id) return;
    const next = legsOf(j, short);
    if (!next.length) return;
    for (const [k2, at] of Object.entries(cur.wakeSet || {})) if (Number(k2) > m.i && at > Date.now()) cancelWake(wakeId(cur.id, Number(k2))).catch(() => {});
    for (const [k2, at] of Object.entries(cur.offSet || {})) if (Number(/(\d+)$/.exec(k2)?.[1] ?? -1) > m.i && at > Date.now()) cancelGetOff(getOffId(cur.id, k2)).catch(() => {});
    const n = switchLegs(cur, m, next);
    const oldWatch = n.watchId;
    setLive({ ...n, watchId: null });
    if (oldWatch) api.stopWatch(oldWatch).catch(() => {});
    resetLiveCache();
    haptic.success();
    await tickLive();
    liveWatch().catch(() => {});
  };
  return (
    <View style={[s.opt, { backgroundColor: c.card, borderColor: c.red }]} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Icon name={I.warn} size={16} color={c.red} style={{ marginTop: 2 }} />
        <T kind="headline" style={{ color: c.redText, marginLeft: 8, flex: 1 }} accessibilityRole="header">{missLine}</T>
      </View>
      {!o || (o.loading && !j) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
          <ActivityIndicator size="small" color={c.tint} />
          <T kind="sub" tone="text2" style={{ marginLeft: 8 }}>Finding the next option</T>
        </View>
      ) : j && l ? (
        <>
          <T kind="foot" tone="text2" style={{ marginTop: 10 }}>NEXT OPTION</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }} accessible
            accessibilityLabel={`Next option: ${tl.map((x) => x.line).join(' then ')} at ${clock(boardTime(j))}${l.fromPlatform ? ', ' + plat(l.fromPlatform) : ''}. Arrive ${short(m.toName)} at ${clock(arr)}.`}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {tl.slice(0, 3).map((x, i) => <LineBadge key={i} line={x.line || ''} mode={x.mode} color={x.color} />)}
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <T kind="body" style={{ fontWeight: '600' }}>{clock(boardTime(j))} from {short(l.from || m.fromName)}{l.fromPlatform ? `, ${plat(l.fromPlatform)}` : ''}</T>
              <T kind="foot" tone="text2">Arrive {short(m.toName)} {clock(arr)}{tl.length > 1 ? `, ${tl.length - 1} more change${tl.length > 2 ? 's' : ''}` : ''}</T>
            </View>
          </View>
          <Pressable onPress={doSwitch} accessibilityRole="button" accessibilityLabel="Switch my trip to this option" android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            style={({ pressed }) => [s.btn, { backgroundColor: c.tint, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
            <T kind="headline" style={{ color: androidLook && c.dark ? '#062E6F' : '#fff' }}>Switch to this</T>
          </Pressable>
        </>
      ) : (
        <View style={{ marginTop: 10 }}>
          <T kind="sub" tone="text2">{o.err || 'No later service found from here.'}</T>
          <Pressable onPress={() => router.push({ pathname: '/trip', params: { from: m.fromId, fromName: m.fromName, to: m.toId, toName: m.toName } })} accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>See all trips from {short(m.fromName)}</T>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  leave: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  pill: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 14, borderRadius: 24, marginLeft: 8 },
  leaveMini: { flexDirection: 'row', alignItems: 'center', minHeight: 44, flexBasis: '100%' },
  bell: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  mini: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  wake: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 64, borderRadius: radius, marginHorizontal: 16, marginTop: 12 },
  wakeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  opt: { marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: radius, borderWidth: 1.5 },
  btn: { marginTop: 14, height: 48, borderRadius: androidLook ? 24 : 12, alignItems: 'center', justifyContent: 'center' },
});
