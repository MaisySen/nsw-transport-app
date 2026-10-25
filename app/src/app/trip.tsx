import { useEffect, useState } from 'react';
import { plural } from '@/lib/homeCore';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, StyleSheet, Switch, useColorScheme, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { whenFromParams, whenLabel, whenQuery } from '@/lib/planCore';
import { haptic } from '@/lib/haptic';
import { withTimeout } from '@/lib/gesture';
import { api, isLongPair } from '@/lib/api';
import { LONG_TRIP_KEEP_MS, STILL_SEARCHING_MS } from '@/lib/longTripCore';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette, radius, modeColor } from '@/lib/theme';
import { bestTime, clock, durText, ms, plainText, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import { safeUrl, stShort } from '@/lib/access';
import { LegAccessChips, ParkGroup } from '@/components/Access';
import { fareOf, fareWords, money, offPeakText } from '@/lib/fare';
import { getLive, startLive } from '@/lib/live';
import { directFilter, isChain, planTrip, stName, tLegs, tripKey, viaText } from '@/lib/trips';
import type { TripLeg } from '@/lib/trips';
import type { Journey, Leg, Place, TripResp } from '@/lib/types';
import { useFlag } from '@/lib/config';
import { journeyAccess, liftAwareNote } from '@/lib/stepFree';
import { tripSpec } from '@/lib/watch';
import { Icon, I, modeIconName } from '@/components/Icon';
import { openService } from '@/components/Cards';
import { LineBadge, OccupancyChip } from '@/components/Transit';
import { arrOf, ServiceRow, tripCacheId, tripPkey, WarnLine } from '@/components/Home';
import { cacheKey, offlineText } from '@/lib/offlineCore';
import { planB, problemOf } from '@/lib/planBCore';
import { busLegStatus } from '@/lib/busLiveCore';
import { RemindLastButton } from '@/components/LastHome';
import { canRemind, lastTonightIndex, modeOfLegs } from '@/lib/lastHomeCore';
import { Button, Empty, Screen, Sep, T } from '@/components/ui';

/** "0745" for the trip API's time parameter, Sydney time. */
function hhmm(t: number) {
  try {
    return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }).replace(':', '').slice(0, 4);
  } catch {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** "8:00:30", Sydney time. */
function hms(t: number) {
  try { return new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, ''); }
  catch { return new Date(t).toLocaleTimeString(); }
}

function LegView({ l, next, now }: { l: Leg; next?: Leg; now: number }) {
  const c = usePalette();
  if (l.kind === 'walk') {
    return (
      <View style={st.walk}>
        <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.walk} size={18} color={c.text2} /></View>
        <T kind="sub" tone="text2">Walk {l.durationMin} min{l.distanceM ? ` (${Math.round(l.distanceM)} m)` : ''}{l.to ? ` to ${shortName(l.to)}` : ''}</T>
      </View>
    );
  }
  const color = l.color || modeColor[l.mode || 'bus'];
  const dep = bestTime(l.planned, l.realtime ? l.estimated : null);
  const arr = bestTime(l.arrPlanned, l.realtime ? l.arrEstimated : null);
  const bus = busLegStatus(l);
  return (
    <Pressable accessibilityRole="button" onPress={() => openService({ tripId: l.tripId, feed: l.feed, line: l.line, stopId: l.stopId, planned: l.planned, mode: l.mode, destId: l.destId, color: l.color, dest: l.towards, realtime: l.realtime, estimated: l.estimated, delayMin: l.delayMin })}
      style={({ pressed }) => [st.leg, pressed ? { opacity: 0.7 } : null]}>
      <View style={{ width: 36, alignItems: 'center' }}>
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
        <View style={{ flex: 1, width: 5, backgroundColor: color, marginVertical: 2, borderRadius: 3 }} />
        <View style={[st.dotBig, { borderColor: color, backgroundColor: c.card }]} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T kind="headline" numberOfLines={2}>{shortName(l.from)}</T>
            <T kind="foot" tone="text2">{[l.fromPlatform, `${clock(dep)}`].filter(Boolean).join(' \u00b7 ')}</T>
          </View>
        </View>
        {l.platformChangedFrom ? <T kind="foot" style={{ color: c.lateText, fontWeight: '600', marginTop: 2 }}>Platform changed from {l.platformChangedFrom}</T> : null}
        <View style={[st.ride, { backgroundColor: c.bg }]}>
          <LineBadge small line={l.line} mode={l.mode} color={l.color} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T kind="sub" numberOfLines={1}>Towards {shortName(l.towards)}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <T kind="foot" tone="text2">{durText(l.durationMin)}{l.stops ? `, ${plural(l.stops, 'stop')}` : ''}</T>
              <OccupancyChip o={l.occupancy} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Track</T>
            <Icon name={I.chevron} size={12} color={c.tint} />
          </View>
        </View>
        {bus ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }} accessibilityLabel={bus.text}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: bus.tone === 'ok' ? c.green : bus.tone === 'red' ? c.red : c.orange }} />
            <T kind="foot" style={{ color: bus.tone === 'ok' ? c.liveText : bus.tone === 'red' ? c.redText : c.lateText, fontWeight: '600' }}>{bus.text}</T>
          </View>
        ) : null}
        {l.alerts?.length ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            <Icon name={I.warn} size={13} color={c.orange} />
            <T kind="foot" style={{ color: c.lateText, flex: 1 }} numberOfLines={3}>{plainText(l.alerts[0].title)}</T>
          </View>
        ) : null}
        <LegAccessChips access={l.access} from={l.from} to={l.to} />
        <View style={{ marginTop: 10 }}>
          <T kind="headline" numberOfLines={2}>{shortName(l.to)}</T>
          <T kind="foot" tone="text2">{[l.toPlatform, `Arrive ${clock(arr)}`].filter(Boolean).join(' \u00b7 ')}</T>
        </View>
      </View>
    </Pressable>
  );
}

function Transfer({ a, b }: { a: Leg; b: Leg }) {
  const c = usePalette();
  const tf: any = (b as any).transfer;
  if (tf && tf.chain) {
    const bad = tf.risk === 'miss', tight = tf.risk === 'tight';
    const text = tf.missed ? `Delays: you miss the ${clock(ms(tf.missed.planned))} ${tf.missed.line} at ${shortName(tf.at)}. Next connection: ${Math.max(0, tf.minutes)} min to change`
      : `${Math.max(0, tf.minutes)} min to change at ${shortName(tf.at)}${tight ? ', tight' : `, you allow ${tf.conn}`}`;
    return (
      <View style={[st.walk, { paddingVertical: 6 }]}>
        <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.clock} size={15} color={bad ? c.red : tight ? c.orange : c.text3} /></View>
        <T kind="foot" style={{ flex: 1, color: bad ? c.redText : tight ? c.lateText : c.text2, fontWeight: bad || tight ? '600' : '400' }}>{text}</T>
      </View>
    );
  }
  const gap = Math.round((bestTime(b.planned, b.estimated) - bestTime(a.arrPlanned, a.arrEstimated)) / 60000);
  if (!Number.isFinite(gap)) return null;
  const tight = gap < 3;
  return (
    <View style={[st.walk, { paddingVertical: 6 }]}>
      <View style={{ width: 36, alignItems: 'center' }}><Icon name={I.clock} size={15} color={tight ? c.orange : c.text3} /></View>
      <T kind="foot" style={{ color: tight ? c.lateText : c.text2, fontWeight: tight ? '600' : '400' }}>{gap <= 0 ? 'Change now, very tight' : `${gap} min to change${tight ? ', tight' : ''}`}</T>
    </View>
  );
}

/** Opal fare estimate for one journey: total, each leg, transfer discount, airport fee, daily cap, off peak nudge. */
function FareCard({ j }: { j: Journey }) {
  const c = usePalette();
  const f = fareOf(j);
  if (!f) return null;
  const sub = (label: string, val: string, tone?: string) => (
    <View style={{ flexDirection: 'row', paddingLeft: 34, paddingRight: 14, paddingVertical: 3 }}>
      <T kind="foot" tone="text2" style={{ flex: 1 }}>{label}</T>
      <T kind="foot" style={{ color: tone || c.text2, fontVariant: ['tabular-nums'] }}>{val}</T>
    </View>
  );
  const op = offPeakText(f);
  const [more, setMore] = useState(false);
  return (
    <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: c.card2, borderRadius: radius, paddingVertical: 4 }}>
      <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityHint={`An estimate, ${fareWords(f)}. ${more ? 'Hides' : 'Shows'} the fare for each leg.`}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, minHeight: 48 }}>
        <Icon name={I.fare} size={16} color={c.text2} />
        <T kind="body" style={{ flex: 1, marginLeft: 8 }}>Opal fare</T>
        <T kind="foot" tone="text2" style={{ marginRight: 8 }}>{f.typeName}{f.peak ? ', peak' : ''}</T>
        <T kind="headline" style={{ fontVariant: ['tabular-nums'] }}>{money(f.total)}</T>
        <Icon name={I.chevron} size={12} color={c.text3} style={{ marginLeft: 8, transform: [{ rotate: more ? '90deg' : '0deg' }] }} />
      </Pressable>
      {more ? <View style={{ marginTop: 2, paddingBottom: 8 }}>
        {(f.legs || []).map((fl, k) => (
          <View key={k}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4 }}>
              <View style={{ width: 20 }}><Icon name={modeIconName(fl.mode)} size={14} color={modeColor[fl.mode || 'train'] || c.text2} /></View>
              <T kind="sub" style={{ flex: 1 }} numberOfLines={1}>{fl.line || 'Leg'}{fl.km != null ? `, ${Number(fl.km).toFixed(1)} km` : ''}{fl.amount == null ? '' : fl.peak ? ', Peak' : ', Off peak'}</T>
              <T kind="sub" tone={fl.amount == null || fl.joined ? 'text2' : 'text'} style={{ fontVariant: ['tabular-nums'] }}>
                {fl.amount == null ? 'Not an Opal fare' : fl.joined ? 'Same journey' : money(fl.fare ?? fl.amount)}
              </T>
            </View>
            {fl.joined && fl.amount != null ? sub('Same journey, no extra fare', fl.amount ? `+${money(fl.amount)}` : '') : null}
            {fl.transferOff ? sub('Transfer discount', `-${money(fl.transferOff)}`, c.liveText) : null}
            {fl.airportFee ? sub('Airport station access fee', money(fl.airportFee)) : null}
          </View>
        ))}
        {f.capped ? sub('Daily cap reached', '') : null}
        {op ? <T kind="foot" style={{ color: c.liveText, fontWeight: '600', paddingHorizontal: 14, marginTop: 6 }}>{op}</T> : null}
        <T kind="foot" tone="text2" style={{ paddingHorizontal: 14, marginTop: 6 }}>An estimate from the Opal fare tables, not your card's charge. Fare type is in More.</T>
      </View> : null}
    </View>
  );
}

function JourneyDetail({ j, now, from, to }: { j: Journey; now: number; from: Place; to: Place }) {
  const c = usePalette();
  const st2 = useStore();
  const spec = tripSpec(j, from, to);
  const [busy, setBusy] = useState(false);
  const legs = j.legs;
  return (
    <View style={{ paddingBottom: 14 }}>
      <Sep />
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        {legs.map((l, i) => {
          const prevT = legs.slice(0, i).reverse().find((x) => x.kind === 'transit');
          return (
            <View key={i}>
              {l.kind === 'transit' && prevT && (legs[i - 1]?.kind === 'transit' || (l as any).transfer?.chain) ? <Transfer a={prevT} b={l} /> : null}
              <LegView l={l} now={now} />
            </View>
          );
        })}
      </View>
      <FareCard j={j} />
      <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
        <Button title={busy ? 'Starting' : 'Start trip'} icon={I.nav} kind="filled" disabled={busy || !spec.legs.length}
          onPress={() => {
            const go = async () => {
              setBusy(true);
              try { await withTimeout(startLive(spec, j.fare), 5000, null); router.push('/go'); haptic.success(); }
              catch (e: any) { Alert.alert("Couldn't start it", e.message); }
              finally { setBusy(false); }
            };
            const cur = getLive();
            if (cur) Alert.alert('End your current trip?', `${cur.title} is in progress. Starting this one ends it.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Start this trip', onPress: go }]);
            else go();
          }} />
      </View>
    </View>
  );
}

export default function TripScreen() {
  const p = useLocalSearchParams<{ from: string; fromName: string; to: string; toName: string; pick?: string; via?: string; viaName?: string; conn?: string; name?: string; legs?: string; time?: string; arriveBy?: string }>();
  // Leave at or Arrive by from Plan (a Sydney clock time); without it the trip is from now.
  const when = whenFromParams(p.time, p.arriveBy);
  const whenQ = whenQuery(when);
  const whenKey = whenQ.time ? `${whenQ.time}${whenQ.arriveBy ? 'a' : 'l'}` : '';
  const from = { id: String(p.from), name: String(p.fromName || '') };
  const to = { id: String(p.to), name: String(p.toName || '') };
  const via = p.via ? { id: String(p.via), name: String(p.viaName || p.via) } : null;
  const conn = p.conn != null ? Number(p.conn) : 5;
  const legsP: TripLeg[] | null = (() => { try { const v = p.legs ? JSON.parse(String(p.legs)) : null; return Array.isArray(v) && v.length > 1 ? v : null; } catch { return null; } })();
  const plan = legsP ? { from, to, legs: legsP } : { from, to, via, conn };
  const chain = isChain(plan);
  const tkey = tripKey(plan);
  const stNow = useStore();
  const stAll = stNow.allServices || {};
  const accOn = !!stNow.acc;
  const liftOn = useFlag('liftAwareRouting');
  const allOn = !!stAll[tkey];
  const c = usePalette();
  const now = useNow();
  const [open, setOpen] = useState<number | null>(p.pick != null ? Number(p.pick) : 0);
  const { data, error, updatedAt, offlineAt, refreshing, refresh } = useLive((r) => planTrip(plan, { refresh: r, count: 6, all: chain && allOn, ...whenQ }), !chain && !via && isLongPair(from.id, to.id) ? LONG_TRIP_KEEP_MS : 20000, [from.id, to.id, via?.id, conn, String(p.legs || ''), chain && allOn, accOn, whenKey],
    { cacheKey: cacheKey('trip', tripCacheId(tripPkey(plan), chain && allOn) + (whenKey ? `|${whenKey}` : '')) });
  const [extra, setExtra] = useState<Journey[]>([]);
  // Step free on or off asks again; earlier and later trips loaded before would be the other kind.
  useEffect(() => { setExtra([]); }, [accOn]);
  const [more, setMore] = useState<number>(0);
  const [showTravel, setShowTravel] = useState(false);
  const dark = useColorScheme() === 'dark';
  const firstT = (j: Journey) => j.legs.find((l) => l.kind === 'transit');
  const jKey = (j: Journey) => { const l = firstT(j); return l ? l.tripId || `${l.line}|${l.planned}` : String(j.leave); };
  const depMs = (j: Journey) => { const l = firstT(j); return l ? bestTime(l.planned, l.realtime ? l.estimated : null) : ms(j.leave); };
  // Main results drop services gone over 2 min ago; ones loaded with Earlier services stay up to 30 min back.
  const jsAll = (() => {
    const seen = new Set<string>();
    const out: Journey[] = [];
    for (const j of [...(data?.journeys || []).filter((x) => ms(x.leave) > now - 120000), ...extra.filter((x) => ms(x.leave) > now - 30 * 60000)]) {
      const k = jKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(j);
    }
    // A walk only option would open first with nothing to start; it is left out when there is a service.
    const withT = out.filter((j) => !!firstT(j));
    return (withT.length ? withT : out).sort((a, b) => depMs(a) - depMs(b));
  })();
  const df = directFilter(jsAll, plan, allOn, (j) => j);
  const js = df.list;
  // Last way home: the last service tonight, only when the list shows the night gap after it.
  const lastIdx = lastTonightIndex(js.map(depMs));
  const loadMore = async (dir: -1 | 1) => {
    if (!js.length || more) return;
    haptic.select();
    const t = dir < 0 ? Math.max(now - 25 * 60000, depMs(js[0]) - 40 * 60000) : depMs(js[js.length - 1]) + 60000;
    setMore(dir);
    try {
      const r = await planTrip(plan, { time: hhmm(t), count: 5, refresh: true, all: chain && allOn });
      setExtra((e) => [...e, ...(r.journeys || [])]);
      if (dir < 0) setOpen(null);
    } catch (e: any) {
      Alert.alert("Couldn't load more services", String(e?.message || e));
    } finally {
      setMore(0);
    }
  };
  // Plan B: the chosen trip (the open one, else the first) has a cancelled service, a suspended line or a missed change.
  const chosen = js.length ? js[open != null && open < js.length ? open : 0] : null;
  const prob = problemOf(chosen);
  const pbShown = prob ? planB(js, chosen, now) : null;
  const pbAll = prob && !pbShown ? planB(jsAll, chosen, now) : null;
  const probKey = prob && chosen ? `${prob.kind}|${jKey(chosen)}` : '';
  const [pbAsked, setPbAsked] = useState('');
  useEffect(() => {
    // Nothing in the results avoids it: ask the planner once for the services leaving from now.
    if (!probKey || pbShown || pbAll || pbAsked === probKey || offlineAt) return;
    setPbAsked(probKey);
    planTrip(plan, { time: hhmm(now), count: 8, refresh: true, all: chain && allOn }).then((r) => setExtra((e) => [...e, ...(r.journeys || [])])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probKey, !!pbShown, !!pbAll, offlineAt]);
  const [showAlerts, setShowAlerts] = useState(false);
  const arrs = js.map(arrOf);
  const alertList: { title: string; url?: string }[] = [];
  js.forEach((j) => j.legs.forEach((l) => (l.alerts || []).forEach((a: any) => {
    const title = typeof a === 'string' ? a : a?.title;
    if (title && !alertList.some((x) => x.title === title)) alertList.push({ title, url: typeof a === 'string' ? undefined : a.url });
  })));
  const fromName = data?.from?.name || from.name;
  const toName = data?.to?.name || to.name;
  // Remember opened A to B trips for Home's Your trips.
  useEffect(() => { if (fromName && toName && !via) store.addRecentTrip({ id: from.id, name: fromName }, { id: to.id, name: toName }); }, [from.id, to.id, fromName, toName, via]);
  useEffect(() => { setExtra([]); }, [chain && allOn]);

  const save = () => {
    // Saving goes through New trip's Confirm step: name, extend with a connection, change time.
    if (chain) { router.push({ pathname: '/new-trip', params: { legs: JSON.stringify(tLegs(plan)), ...(p.name ? { name: String(p.name) } : {}) } }); return; }
    if (!via) { router.push({ pathname: '/new-trip', params: { from: from.id, fromName, to: to.id, toName, mode: firstT(js[0] || ({ legs: [] } as any))?.mode || '' } }); return; }
    const doSave = async (name: string) => {
      try { await api.saveTrip(name, from, to); haptic.success(); Alert.alert('Saved', `It's on your Home screen as "${name}". You can also text "${name}" to Tab.`); }
      catch (e: any) { Alert.alert("Couldn't save it", e.message); }
    };
    Alert.alert('Save this trip', 'Saved trips show live on Home.', [
      { text: 'Home', onPress: () => doSave('home') },
      { text: 'Work', onPress: () => doSave('work') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{
        title: `${shortName(fromName).replace(/ Station$/, '')} to ${shortName(toName).replace(/ Station$/, '')}`,
        headerBackTitle: chain ? 'Back' : undefined,
        headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Save trip" hitSlop={13} onPress={save}><Icon name={I.starOpen} size={22} color={c.tint} /></Pressable>,
      }} />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {alertList.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAlerts }} onPress={() => setShowAlerts(!showAlerts)} android_ripple={{ color: c.fill }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
              <Icon name={I.warn} size={16} color={c.orange} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <T kind="headline">Service information</T>
                <T kind="foot" tone="text2">{alertList.length} {alertList.length === 1 ? 'alert' : 'alerts'}. Tap for details.</T>
              </View>
              <Icon name={I.chevron} size={13} color={c.text3} style={{ transform: [{ rotate: showAlerts ? '90deg' : '0deg' }] }} />
            </Pressable>
            {showAlerts ? alertList.map((a, k) => (
              <View key={k}>
                <Sep inset={16} />
                <Pressable accessibilityRole="link" disabled={!safeUrl(a.url)} onPress={() => { const u = safeUrl(a.url); if (u) Linking.openURL(u); }} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                  <T kind="sub" style={{ color: a.url ? c.tint : c.text }}>{plainText(a.title)}</T>
                </Pressable>
              </View>
            )) : null}
          </View>
        ) : null}
        {data?.parking?.carparks?.length ? (
          <View style={{ marginTop: -10 }}>
            <ParkGroup list={data.parking.carparks} title={`Park and Ride at ${stShort(data.parking.station?.name)}`} station={data.parking.station?.name} watch />
          </View>
        ) : null}
        {whenQ.time ? (
          <View style={{ marginHorizontal: 20, marginTop: 12, flexDirection: 'row', alignItems: 'center' }} accessibilityRole="text">
            <Icon name={I.clock} size={14} color={c.text2} />
            <T kind="sub" tone="text2" style={{ marginLeft: 6 }}>{whenLabel(when, now)}</T>
          </View>
        ) : null}
        <StepFreeBar on={accOn} data={data} empty={!!data && !js.length} liftOn={liftOn} />
        {chain ? <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 12 }}>{(() => { const L = tLegs(plan); return L.length === 2 && L[1].mode !== 'walk' ? `Via ${stName(shortName(L[0].to.name))}, ${L[1].conn ?? 5} min to change` : `${L.length} legs via ${viaText(plan)}`; })()}</T> : null}
        {jsAll.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
            <View style={{ flex: 1 }}>
              <T kind="body">Include trips with a change</T>
              {!allOn && (df.none || (chain && (data?.fallback || []).some(Boolean))) ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{df.none ? 'No direct service, so all are shown' : 'One leg has no direct service, so all are used there'}</T> : null}
            </View>
            <Switch value={allOn} onValueChange={(v) => { haptic.select(); store.setAllServices(tkey, v); }} accessibilityLabel="Include trips with a change" />
          </View>
        ) : null}
        {prob ? (
          <View accessibilityRole="summary" style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, padding: 16, borderLeftWidth: 4, borderLeftColor: c.red }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={I.warn} size={16} color={c.red} />
              <T kind="headline" style={{ marginLeft: 8 }}>Plan B</T>
            </View>
            <T kind="sub" numberOfLines={3} style={{ color: c.redText, marginTop: 6 }}>{prob.text}</T>
            {pbShown || pbAll ? (
              <>
                <T kind="body" style={{ marginTop: 10 }}>{(pbShown || pbAll)!.label}</T>
                <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{(pbShown || pbAll)!.why}{pbAll ? ', with a change' : ''}</T>
                <Pressable accessibilityRole="button" onPress={() => {
                  haptic.select();
                  if (pbShown) { const i = js.indexOf(pbShown.j); if (i >= 0) setOpen(i); }
                  else store.setAllServices(tkey, true);
                }} style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 16, minHeight: 44, borderRadius: 22, justifyContent: 'center', backgroundColor: c.tint, opacity: pressed ? 0.8 : 1 })}>
                  <T kind="sub" style={{ color: '#FFFFFF', fontWeight: '600' }}>{pbShown ? 'Show this trip' : 'Show trips with a change'}</T>
                </Pressable>
              </>
            ) : (
              <T kind="foot" tone="text2" style={{ marginTop: 8 }}>{pbAsked === probKey || offlineAt ? 'No other way found in the next services. Pull down to check again.' : 'Looking for another way'}</T>
            )}
          </View>
        ) : null}
        {js.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
            <MoreButton title="Earlier services" busy={more === -1} onPress={() => loadMore(-1)} />
            {js.map((j, i) => (
              <View key={jKey(j) + i}>
                <Sep inset={0} />
                <ServiceRow j={j} now={now} showTravel={showTravel} arrive={arrs[i]} beaten={!!(j as any).beaten || arrs.slice(i + 1).some((a) => a < arrs[i])} onPress={() => { haptic.select(); setOpen(open === i ? null : i); }} />
                <WarnLine j={j} />
                {!chain && i === lastIdx && canRemind(depMs(j), now) ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><T kind="foot" tone="text2">Last service tonight</T><RemindLastButton hint={{ from, to, mode: modeOfLegs(j.legs) }} acc={accOn} /></View> : null}
                {data?.accessible ? <JourneyAccessLine j={j} liftOn={liftOn} /> : null}
                {open === i ? <View><Sep inset={16} /><JourneyDetail j={j} now={now} from={from} to={to} /></View> : null}
              </View>
            ))}
            <Sep inset={0} />
            <MoreButton title="Later services" busy={more === 1} onPress={() => loadMore(1)} />
          </View>
        ) : null}
        {offlineAt ? (
          <T kind="foot" tone="lateText" style={{ textAlign: 'center', marginTop: 14, fontVariant: ['tabular-nums'] }}>{offlineText(offlineAt, now)}</T>
        ) : updatedAt ? (
          <T kind="foot" tone={error ? 'lateText' : 'text2'} style={{ textAlign: 'center', marginTop: 14, fontVariant: ['tabular-nums'] }}>
            {error ? `Offline. Live data updated ${hms(updatedAt)}` : `Live data updated ${hms(updatedAt)}`}
          </T>
        ) : null}
        {data && !js.length ? <Empty icon={I.route} title="No trips found" body={data.error || 'Try a different time or nearby stop.'} /> : null}
        {!data && error ? <Empty icon={I.warn} title="Can't plan this trip" body={error} /> : null}
        {!data && !error ? <Searching key={`${from.id}>${to.id}|${whenKey}`} long={!chain && !via && isLongPair(from.id, to.id)} /> : null}
        {data?.tomorrow ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>No more trips tonight. These are the first ones tomorrow.</T> : null}
      </Screen>
    </>
  );
}

/** Step free trips only, switchable right here (the same setting as More > Accessible trips), with the lift aware note. */
/** Shown while the first answer is on its way. Long trips can take the planner up to about 30 seconds. */
function Searching({ long }: { long: boolean }) {
  const [still, setStill] = useState(false);
  useEffect(() => { const t = setTimeout(() => setStill(true), STILL_SEARCHING_MS); return () => clearTimeout(t); }, []);
  return (
    <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }} accessibilityLiveRegion="polite">
      <ActivityIndicator />
      <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 12 }}>{still ? 'Still searching' : 'Finding live trips'}</T>
      {still ? <T kind="foot" tone="text2" style={{ textAlign: 'center', marginTop: 6 }}>{long ? 'Long distance trips can take up to 30 seconds.' : 'This is taking longer than usual.'}</T> : null}
    </View>
  );
}

function StepFreeBar({ on, data, empty, liftOn }: { on: boolean; data: TripResp | null | undefined; empty: boolean; liftOn: boolean }) {
  const c = usePalette();
  const note = liftAwareNote(data, liftOn);
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
        <Icon name={I.access} size={18} color={c.tint} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <T kind="body">Step free</T>
          <T kind="foot" tone="text2">{on ? (empty ? 'No step free trips found for this trip.' : 'Only trips with lifts or level access.') : 'Show only trips with lifts or level access.'}</T>
        </View>
        <Switch value={on} onValueChange={(v) => { haptic.select(); store.setAcc(v); }} accessibilityLabel="Step free trips only"
          trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined}
              thumbColor={Platform.OS === 'android' ? (on ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
      </View>
      {on && note ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 6 }} accessible accessibilityLabel={note.text}>
          <Icon name={note.tone === 'warn' ? I.warn : I.info} size={14} color={note.tone === 'warn' ? c.orange : c.text2} />
          <T kind="foot" style={{ flex: 1, color: note.tone === 'warn' ? c.lateText : c.text2 }}>{note.text}</T>
        </View>
      ) : null}
    </View>
  );
}

/** Under each step free result: Step free when every station is, and each station with a lift out right now. */
function JourneyAccessLine({ j, liftOn }: { j: Journey; liftOn: boolean }) {
  const c = usePalette();
  const a = journeyAccess(j, liftOn);
  if (!a.stepFree && !a.outages.length) return null;
  const words = [a.stepFree ? 'Step free at every station' : '', ...a.outages.map((o) => `Lift out of service at ${o}`)].filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 10 }} accessible accessibilityLabel={words.join('. ')}>
      {a.stepFree ? (
        <View style={[st.pill, { backgroundColor: c.fill }]}>
          <Icon name={I.access} size={12} color={c.liveText} />
          <T kind="caption" style={{ color: c.liveText, fontWeight: '600', marginLeft: 4 }}>Step free</T>
        </View>
      ) : null}
      {a.outages.map((o) => (
        <View key={o} style={[st.pill, { backgroundColor: c.fill }]}>
          <Icon name={I.warn} size={12} color={c.orange} />
          <T kind="caption" style={{ color: c.lateText, fontWeight: '600', marginLeft: 4 }}>Lift out at {o}</T>
        </View>
      ))}
    </View>
  );
}

function MoreButton({ title, busy, onPress }: { title: string; busy: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" android_ripple={{ color: c.fill }}
      style={({ pressed }) => [st.more, pressed && Platform.OS !== 'android' ? { backgroundColor: c.card2 } : null]}>
      {busy ? <ActivityIndicator size="small" color={c.tint} /> : <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>{title}</T>}
    </Pressable>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, borderRadius: 9, padding: 2 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 7 },
  more: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 48 },
  walk: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  leg: { flexDirection: 'row', paddingVertical: 8 },
  dotBig: { width: 14, height: 14, borderRadius: 7, borderWidth: 3.5 },
  ride: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, marginTop: 10 },
});
