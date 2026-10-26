// Live trip: the trip you are on now. Full screen map, then a sheet with your arrival, the next stop,
// stops left, change warnings, Share trip and End trip. Refreshes every 15 seconds from /api/service.
import { plural } from '@/lib/homeCore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { haptic } from '@/lib/haptic';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import { appActive } from '@/lib/activity';
import { onColor, radius, usePalette } from '@/lib/theme';
import { clock } from '@/lib/format';
import { endLive, getLive, liveWatch, setLive, useLiveTrip } from '@/lib/live';
import { legColor, markHere, plat, progOf, setEnginePos, short, tickLive, useLiveEngineState } from '@/lib/liveEngine';
import { cutPath, LiveState, minsWords, timed, tOf } from '@/lib/liveCalc';
import { enablePush, getPushState } from '@/lib/push';
import type { WatchLeg } from '@/lib/types';
import TransitMap from '@/components/LazyTransitMap';
import { Icon, I } from '@/components/Icon';
import { LineBadge } from '@/components/Transit';
import { WhyLate } from '@/components/WhyLate';
import { useWhyLate } from '@/lib/whyLate';
import { Button, Sep, T } from '@/components/ui';
import { NextOption, SpeakRow, WakeRow } from '@/components/Smart';
import { boardWords, stopNumber } from '@/lib/busCore';
import { ageText, liveState, liveWords, STALE_DATA_MS, STALE_GPS_S, type LiveState as LabelState } from '@/lib/liveLabelCore';

/** The live trip's label for the current leg. Waiting: the departure time's state. Riding: Not tracking when the GPS or our copy is stale. */
function liveKind(phase: 'wait' | 'ride', l: WatchLeg, x: { live: boolean; dep: number }, d: any, updated: number, now: number): LabelState {
  const vehicleAgeS = d?.vehicle?.ageS ?? null;
  if (phase === 'wait') {
    return liveState({ planned: l.planned, estimated: x.live && Number.isFinite(x.dep) ? new Date(x.dep).toISOString() : null, realtime: x.live, seenAt: updated || null, vehicleAgeS }, now);
  }
  const base = liveState({ planned: l.planned, estimated: null, realtime: false }, now);
  if (!x.live) return base;
  const dataAge = updated ? Math.max(0, now - updated) : 0;
  const stale = (vehicleAgeS != null && vehicleAgeS + dataAge / 1000 > STALE_GPS_S) || dataAge > STALE_DATA_MS;
  return { ...base, kind: stale ? 'stale' : 'live', label: stale ? 'Not tracking' : 'Live', age: updated ? ageText(dataAge + (vehicleAgeS ?? 0) * 1000) : null };
}
import { shareLink } from '@/lib/server';

const noun = (m?: string) => (m === 'bus' || m === 'coach' ? 'bus' : m === 'ferry' ? 'ferry' : m === 'lightrail' ? 'tram' : m === 'metro' ? 'metro' : 'train');

export default function LiveTripScreen() {
  const c = usePalette();
  const g = useLiveTrip();
  const params = useLocalSearchParams<{ share?: string }>();
  const now = useNow();
  const insets = useSafeAreaInsets();
  const side = useSides();
  const { height } = useWindowDimensions();
  const eng = useLiveEngineState();
  const live = eng.gid === g?.id ? eng : null;
  const svc = live?.svc || [];
  const st = live?.st || null;
  const offline = live?.offline || null;
  const updated = live?.updated || 0;
  const [me, setMe] = useState<{ lat: number; lon: number; acc?: number; at?: number } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [push, setPush] = useState<string>('on');
  const snaps = useMemo(() => ['34%', '60%', '92%'], []);
  const meRef = useRef(me);
  meRef.current = me;
  useEffect(() => { setEnginePos(me); }, [me]);
  const geo = useRef<Location.LocationSubscription | null>(null);

  const legs = g?.legs || [];
  const last = legs.length - 1;

  useEffect(() => { getPushState().then((p) => setPush(p.status)); }, []);

  // Location only with permission, and only after you ask for it on this screen.
  const startGeo = useCallback(async (ask: boolean) => {
    try {
      let p = await Location.getForegroundPermissionsAsync();
      if (!p.granted && ask && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) { if (ask) setLocDenied(true); return; }
      const cur = getLive();
      if (cur && !cur.loc) setLive({ ...cur, loc: true });
      geo.current?.remove();
      // The map dot and a shared position need about 100 m, not GPS precision: Balanced lets the phone use wifi and
      // cell towers, and a fix only every 10 s or 30 m. The watch runs only while this screen is on view with the
      // app in front (below); in the background nothing reads location.
      const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 30 },
        (l) => setMe({ lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy ?? undefined, at: l.timestamp || Date.now() }));
      if (!geoWanted.current) { sub.remove(); return; }
      geo.current?.remove();
      geo.current = sub;
    } catch {}
  }, []);
  const stopGeo = useCallback(() => { geo.current?.remove(); geo.current = null; }, []);
  const geoWanted = useRef(false);
  const locOn = !!g?.loc;
  useFocusEffect(useCallback(() => {
    if (!locOn) return;
    geoWanted.current = true;
    if (appActive()) startGeo(false);
    const sub = AppState.addEventListener('change', (s) => { if (appActive(s)) startGeo(false); else stopGeo(); });
    return () => { geoWanted.current = false; sub.remove(); stopGeo(); };
  }, [locOn, startGeo, stopGeo]));

  // Opening the screen refreshes at once; the engine keeps refreshing every 15 seconds on any screen.
  useEffect(() => { tickLive(); }, [g?.id]);

  const askLocation = () => Alert.alert('Show where you are?', "Your location stays on this phone. It's only sent if you share your trip with your location on.", [
    { text: 'Not now', style: 'cancel' },
    { text: 'Continue', onPress: () => { geoWanted.current = true; startGeo(true); } },
  ]);

  const share = useCallback(async () => {
    const cur = getLive();
    if (!cur) return;
    if (cur.share) {
      Alert.alert('Sharing this trip', 'Anyone with the link can follow it until the trip ends.', [
        { text: 'Stop sharing', style: 'destructive', onPress: () => { api.shareEnd(cur.share!.id, cur.share!.key).catch(() => {}); setLive({ ...cur, share: null }); } },
        { text: 'Send link again', onPress: () => Share.share({ message: `Follow my trip live: ${cur.title} ${shareLink(cur.share!.id)}` }).catch(() => {}) },
        { text: 'Done', style: 'cancel' },
      ]);
      return;
    }
    const create = async (withPos: boolean) => {
      try {
        const pos = withPos && meRef.current ? meRef.current : null;
        const r = await api.shareStart({ title: cur.title, from: cur.origin, to: cur.to, legs: cur.legs, pos, prog: progOf(st) });
        const c2 = getLive();
        if (!c2) return;
        const link = shareLink(r.id);
        setLive({ ...c2, share: { id: r.id, key: r.key, url: link, pos: withPos } });
        haptic.success();
        await Share.share({ message: `Follow my trip live: ${cur.title} ${link}` });
      } catch (e: any) { Alert.alert("Couldn't make a link", String(e?.message || e)); }
    };
    const body = `Anyone with the link can see your trip, the live position of your ${noun(cur.legs[0]?.mode)}, the next stop and your arrival time. No account needed. The link stops working when the trip ends, and everything it showed is deleted.`;
    const opts: any[] = [{ text: 'Cancel', style: 'cancel' }];
    if (meRef.current) opts.push({ text: 'Include my location', onPress: () => create(true) });
    opts.push({ text: 'Create link', onPress: () => create(false) });
    Alert.alert('Share live trip', body, opts);
  }, [st]);

  // The Share button on the ongoing notification opens this screen with share=1.
  const shareRef = useRef(share);
  shareRef.current = share;
  useEffect(() => { if (params.share === '1' && g) setTimeout(() => shareRef.current(), 400); }, [params.share, g?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const end = () => Alert.alert('End trip?', g?.share ? 'Your share link stops working.' : 'Live alerts for this trip stop.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'End trip', style: 'destructive', onPress: () => { endLive().catch(() => {}); router.canGoBack() ? router.back() : router.replace('/'); haptic.select(); } },
  ]);

  if (!g) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Stack.Screen options={{ title: 'Trip', headerShown: true }} />
        <Icon name={I.route} size={40} color={c.text3} />
        <T kind="title3" style={{ marginTop: 12 }}>No trip in progress</T>
        <T kind="sub" tone="text2" style={{ marginTop: 6, textAlign: 'center' }}>Open a trip, then tap Start trip on a service.</T>
        <View style={{ marginTop: 20 }}><Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /></View>
      </View>
    );
  }

  // The map shows the leg you are on: its route between your stops, the stops, the vehicle and you.
  const ci = st && !st.done ? st.cur : st?.done ? last : 0;
  const L = legs[ci], d = svc[ci] || null;
  const mi = d?.mineIndex ?? -1, ai = d?.alightIndex ?? -1;
  const mapStops = d ? d.stops.map((s, k) => ({ ...s, k })).filter((s) => s.k >= Math.max(0, mi) && (ai < 0 || s.k <= ai) && timed(s)).map((s) => ({ id: s.id + ':' + s.k, name: s.name, lat: s.lat, lon: s.lon, passed: s.passed, mine: s.mine || s.alight })) : [];
  const path = d ? cutPath(d.path, mi >= 0 ? d.stops[mi] : null, ai >= 0 ? d.stops[ai] : null) : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TransitMap key={g.id + ':' + ci} path={path} stops={mapStops} vehicle={d?.vehicle || null} me={me} color={legColor(L)} mode={L.mode} dark={c.dark} bottomInset={height * 0.34} />
      <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={[sx.fab, { top: insets.top + 8, left: insets.left + 12, backgroundColor: c.card }]} hitSlop={8} accessibilityLabel="Back">
        <Icon name={I.back} size={20} color={c.text} />
      </Pressable>
      {!me ? (
        <Pressable accessibilityRole="button" onPress={askLocation} style={[sx.fab, { top: insets.top + 8, right: insets.right + 12, backgroundColor: c.card }]} hitSlop={8} accessibilityLabel="Show where I am">
          <Icon name={I.location} size={19} color={c.tint} />
        </Pressable>
      ) : null}
      <BottomSheet index={1} snapPoints={snaps} enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: c.card, borderRadius: Platform.OS === 'ios' ? 14 : 28 }} handleIndicatorStyle={{ backgroundColor: c.text3, width: 36 }}>
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28, paddingLeft: side.left, paddingRight: side.right }}>
          {!st ? <T kind="sub" tone="text2" style={{ padding: 20 }}>Getting live times</T> : st.done ? (
            <View style={{ padding: 20 }}>
              <T kind="foot" tone="text2">You've arrived</T>
              <T kind="title2" style={{ marginTop: 2 }}>{short(legs[last].to)}</T>
              <T kind="sub" tone="text2" style={{ marginTop: 4 }}>{clock(st.eta)} {'\u00b7'} trip ended</T>
              <View style={{ marginTop: 18 }}><Button title="Done" onPress={() => { endLive().catch(() => {}); router.canGoBack() ? router.back() : router.replace('/'); }} /></View>
            </View>
          ) : (
            <Sheet st={st} now={now} legs={legs} g={g} me={!!me} locDenied={locDenied} push={push} offline={offline} updated={updated}
              onLoc={askLocation} onShare={share} onEnd={end}
              onPush={async () => { const r = await enablePush(false); setPush(r.status); if (r.status === 'on' || r.status === 'local') { liveWatch().catch(() => {}); } else Alert.alert('Notifications are off', 'Turn them on for Transport in your phone settings to get off alerts.', [{ text: 'Not now', style: 'cancel' }, { text: 'Settings', onPress: () => Linking.openSettings() }]); }} />
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

function Sheet({ st, now, legs, g, me, locDenied, push, offline, updated, onLoc, onShare, onEnd, onPush }: {
  st: Extract<LiveState, { done: false }>; now: number; legs: WatchLeg[]; g: NonNullable<ReturnType<typeof getLive>>; me: boolean; locDenied: boolean; push: string;
  offline: string | null; updated: number; onLoc: () => void; onShare: () => void; onEnd: () => void; onPush: () => void;
}) {
  const c = usePalette();
  const last = legs.length - 1;
  const l = legs[st.cur], x = st.L2[st.cur], d = x.d;
  const m = Math.max(0, Math.round((st.eta - now) / 60000));
  // How late now: at your stop off while riding, at your stop while waiting, from live data only.
  const late = st.delayMin ?? Math.round(x.delay / 60000);
  const notLive = st.track === 'timetable';
  // Honest label (liveLabelCore.ts): waiting, the leg's live departure time; riding, the vehicle's GPS age and our copy's age.
  const lk = liveKind(st.phase, l, x, d, updated, now);
  const badge = notLive ? { t: 'Timetable', bg: c.text3 } : lk.kind === 'stale' ? { t: 'Not tracking', bg: c.orange } : x.live || st.delayMin != null ? (late >= 2 ? { t: `${late} min late`, bg: c.orange } : { t: 'Live', bg: c.green }) : { t: 'Timetable', bg: c.text3 };
  // You can say you are there: always when the leg has no live data, and when its live arrival is 2 minutes past.
  const canMark = st.phase === 'ride' && !x.missed && (notLive || now > x.arr + 120000);
  let now1 = '', now2 = '', now3 = '';
  if (x.missed) {
    // The live times say this leg left before you got to the change: no countdown to a train you cannot catch.
    now1 = `Change at risk: the ${x.was ? clock(x.was) + ' ' : ''}${l.line} has likely left`;
    now2 = `From ${short(l.from)}. The next way on is below.`;
  } else if (st.phase === 'wait') {
    const dm = Math.round((x.dep - now) / 60000);
    now1 = `${st.cur > 0 ? 'Change to' : 'Board'} the ${l.line} to ${short(l.towards || l.to)}`;
    // A bus: which stop and stand to wait at, with the number on the sign (stands at one stop can be across the road).
    if (stopNumber(l.stopId, l.mode)) now3 = `From ${boardWords(short(l.from), l.fromPlatform, l.stopId, l.mode)}`;
    now2 = `${lk.kind === 'stale' ? `Not tracking, timetable ${clock(lk.t)}` : dm <= 0 ? (x.live ? 'Due now' : `Timetable ${clock(x.dep)}`) : `Leaves in ${dm} min, ${clock(x.dep)}${x.live ? '' : ', timetable'}`}${l.fromPlatform && !now3 ? ' \u00b7 ' + plat(l.fromPlatform) : ''}${d && d.stopsAway != null && d.vehicle ? ` \u00b7 ${d.stopsAway === 0 ? 'arriving' : `${d.stopsAway} stop${d.stopsAway > 1 ? 's' : ''} away`}` : ''}`;
  } else if (notLive) {
    // No live data: no next stop from the clock, the timetable time named as such, and the trip waits for you.
    now1 = `On the ${l.line} to ${short(l.towards || l.to)}`;
    now2 = `Not live, running to timetable \u00b7 due at ${short(l.to)} ${clock(x.arr)}`;
  } else {
    const ns = d && st.nextIdx >= 0 ? d.stops[st.nextIdx] : null;
    const yours = !!d && st.nextIdx === d.alightIndex;
    now1 = yours ? 'Get off at the next stop' : ns ? `Next stop: ${short(ns.name)}` : `On the ${l.line} to ${short(l.towards || l.to)}`;
    now2 = `${st.stopsLeft != null ? `${st.stopsLeft} stop${st.stopsLeft === 1 ? '' : 's'} to ${short(l.to)}` : `To ${short(l.to)}`} \u00b7 ${st.cur < last ? 'change' : 'arrive'} ${clock(x.arr)}${late >= 2 ? ` \u00b7 ${late} min late` : ''}`;
  }
  // Remaining stops on this leg, from the next one to yours. Long lists fold in the middle.
  const list = d && st.phase === 'ride' && (d.alightIndex ?? -1) >= 0
    ? d.stops.slice(Math.max(d.mineIndex ?? 0, notLive ? (d.mineIndex ?? 0) + 1 : Math.min(st.nextIdx, d.alightIndex!)), d.alightIndex! + 1).filter(timed) : [];
  const show: (typeof list[number] | null)[] = list.length > 7 ? [...list.slice(0, 5), null, list[list.length - 1]] : list;
  const ago = updated ? Math.round((now - updated) / 1000) : null;
  // Why it's late: the reason from this service's own linked alert (the live service answer, else the planned leg).
  const whyRow = useMemo(() => [{ line: l.line, delayMin: late, realtime: !!x.live && lk.kind !== 'stale', cancelled: !!d?.cancelled, alerts: d?.alerts?.length ? d.alerts : (l as any).alerts }], [l, late, x.live, lk.kind, d]);
  const why = useWhyLate(whyRow)(whyRow[0]);
  return (
    <View>
      <View style={{ paddingHorizontal: 20, paddingTop: 2, flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <T kind="foot" tone="text2">{st.etaLate || x.missed ? `Arrive at ${short(legs[last].to)}, about` : `Arrive at ${short(legs[last].to)}`}</T>
          <Text style={{ fontSize: 34, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }} maxFontSizeMultiplier={1.3}>{clock(st.eta)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: c.tint, fontVariant: ['tabular-nums'] }} maxFontSizeMultiplier={1.3} accessibilityLabel={`in ${minsWords(m)}`}>{minsWords(m)}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            <View style={[sx.badge, { backgroundColor: badge.bg }]}><Text style={[sx.badgeT, { color: onColor(badge.bg) }]}>{badge.t}</Text></View>
            {g.share ? <View style={[sx.badge, { backgroundColor: c.indigo }]}><Text style={[sx.badgeT, { color: onColor(c.indigo) }]}>Sharing</Text></View> : null}
          </View>
        </View>
      </View>

      <View style={[sx.card, { backgroundColor: c.card2, borderLeftColor: legColor(l) }]}>
        <LineBadge line={l.line} mode={l.mode} color={legColor(l)} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T kind="headline">{now1}</T>
          <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{now2}</T>
          {now3 ? <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{now3}</T> : null}
          <WhyLate why={why} style={{ marginTop: 4 }} />
        </View>
      </View>

      <WakeRow g={g} st={st} />
      <SpeakRow g={g} />

      {!offline && lk.kind === 'live' && lk.age ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{liveWords(lk)}</T> : null}
      {offline ? <Warn tone="grey" title={offline} body={ago != null ? `Last update ${ago < 90 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago. Trying again.` : 'Trying again.'} /> : null}
      {(notLive || !x.live) && !offline && !(x.arrLive && st.phase === 'ride') ? <Warn tone="grey" title="No live data for this service" body={st.phase === 'ride' ? `Running to timetable, not live. The trip moves on when ${me ? 'your location shows you at' : 'you tap that you are at'} ${short(l.to)}.` : 'Times are from the timetable.'} /> : null}
      {canMark ? (
        <View style={{ marginHorizontal: 20, marginTop: 10 }}>
          <Button kind="tinted" title={st.cur < last ? `I'm at ${short(l.to)}` : `I've arrived at ${short(l.to)}`} onPress={() => { haptic.select(); markHere(st.cur).catch(() => {}); }} />
        </View>
      ) : null}
      {/* A change the live times say you will miss: the next way on, found at once, with Switch to this. */}
      <NextOption g={g} st={st} />
      {st.conns.filter((cn) => cn.risk === 'tight').map((cn) => (
        <Warn key={cn.i} tone="tight" title={`Tight change at ${short(cn.at)}`} body={`${Math.max(0, cn.spare)} min to catch the ${cn.next.line}${cn.next.fromPlatform ? ' from ' + plat(cn.next.fromPlatform) : ''}.`} />
      ))}

      {show.length ? (
        <View style={{ marginHorizontal: 20, marginTop: 14 }}>
          {show.map((s, k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 30 }}>
              <View style={{ width: 22, alignItems: 'center', alignSelf: 'stretch' }}>
                <View style={{ position: 'absolute', top: k === 0 ? 15 : 0, bottom: k === show.length - 1 ? 15 : 0, width: 4, backgroundColor: legColor(l), opacity: 0.35 }} />
                <View style={{ marginTop: 9, width: s?.alight ? 14 : 10, height: s?.alight ? 14 : 10, borderRadius: 7, backgroundColor: s ? '#fff' : 'transparent', borderWidth: s ? (s.alight ? 3.5 : 2.5) : 0, borderColor: legColor(l) }} />
              </View>
              <T kind={s?.alight ? 'headline' : 'body'} tone={s ? 'text' : 'text2'} style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>{s ? short(s.name) : `${plural(list.length - 6, 'more stop', 'more stops')}`}</T>
              {s ? <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{clock(tOf(s))}</T> : null}
            </View>
          ))}
        </View>
      ) : null}

      {locDenied || push === 'off' || push === 'denied' ? (
        <View style={[sx.group, { backgroundColor: c.card2 }]}>
          {locDenied ? (
            <SetupRow icon={I.location} title="Location is off" sub="Turn it on for Transport in your phone's settings to see where you are." action="Settings" onPress={() => Linking.openSettings()} />
          ) : null}
          {locDenied && (push === 'off' || push === 'denied') ? <Sep inset={52} /> : null}
          {push === 'off' || push === 'denied' ? (
            <SetupRow icon={I.bell} title="Trip alerts are off" sub={push === 'denied' ? 'Turn on notifications for Transport in your phone settings.' : 'Get a heads up one stop before yours.'}
              action={push === 'denied' ? 'Settings' : 'Turn on'} onPress={push === 'denied' ? () => Linking.openSettings() : onPush} />
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
        <View style={{ flex: 1 }}><Button title={g.share ? 'Sharing' : 'Share trip'} icon={I.share} kind="tinted" onPress={onShare} /></View>
        <View style={{ flex: 1 }}><Button title="End trip" icon={I.stop} kind="filled" onPress={onEnd} /></View>
      </View>

      <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 22, marginBottom: 6, fontWeight: '600' }}>YOUR TRIP</T>
      <View style={[sx.group, { backgroundColor: c.card2, marginTop: 0 }]}>
        {legs.map((ll, i) => {
          const y2 = st.L2[i], state = i < st.cur ? 'done' : i === st.cur ? 'now' : 'next';
          const cn = st.conns.find((k) => k.i === i - 1);
          return (
            <View key={i}>
              {i > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, gap: 6 }}>
                  {ll.walkBefore ? <Icon name={I.walk} size={13} color={c.text2} /> : null}
                  <T kind="foot" tone="text2">{ll.walkBefore ? `${ll.walkBefore} min walk, ` : ''}change at {short(legs[i - 1].to)}</T>
                  {cn ? <T kind="foot" style={{ color: cn.risk === 'ok' ? c.text2 : cn.risk === 'tight' ? c.lateText : c.redText, fontWeight: cn.risk === 'ok' ? '400' : '600' }}>{'\u00b7'} {Math.max(0, cn.spare)} min spare</T> : null}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, opacity: state === 'done' ? 0.5 : 1 }}>
                <LineBadge line={ll.line} mode={ll.mode} color={legColor(ll)} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <T kind="body" numberOfLines={1}>{short(ll.from)} to {short(ll.to)}</T>
                  <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{clock(y2.dep)} to {clock(y2.arr)}{state === 'done' ? ' \u00b7 done' : ''}</T>
                </View>
                {state === 'now' ? <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Now</T> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Warn({ tone, title, body, link, onLink }: { tone: 'bad' | 'tight' | 'grey'; title: string; body: string; link?: string; onLink?: () => void }) {
  const c = usePalette();
  const col = tone === 'bad' ? c.red : tone === 'tight' ? c.orange : c.text2;
  return (
    <View style={[sx.warn, { backgroundColor: tone === 'grey' ? c.card2 : tone === 'bad' ? 'rgba(255,59,48,0.12)' : 'rgba(255,149,0,0.14)' }]} accessibilityRole="alert">
      <Icon name={I.warn} size={16} color={col} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <T kind="headline" style={{ color: tone === 'grey' ? c.text : tone === 'bad' ? c.redText : c.lateText }}>{title}</T>
        <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{body}</T>
        {link ? <Pressable onPress={onLink} hitSlop={12} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}><T kind="foot" tone="tint" style={{ marginTop: 4, fontWeight: '600' }}>{link}</T></Pressable> : null}
      </View>
    </View>
  );
}

function SetupRow({ icon, title, sub, action, onPress }: { icon: any; title: string; sub: string; action?: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={15} color={c.tint} /></View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <T kind="body">{title}</T>
        <T kind="foot" tone="text2">{sub}</T>
      </View>
      {action ? (
        <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [{ backgroundColor: c.tint, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button">
          <Text style={{ color: Platform.OS === 'android' && c.dark ? '#062E6F' : '#fff', fontWeight: '600', fontSize: 14 }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const sx = StyleSheet.create({
  fab: { position: 'absolute', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeT: { color: '#fff', fontSize: 12, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: radius, borderLeftWidth: 4 },
  warn: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: radius },
  group: { marginHorizontal: 16, marginTop: 14, borderRadius: radius, overflow: 'hidden' },
});
