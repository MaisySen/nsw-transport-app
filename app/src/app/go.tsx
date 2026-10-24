// Live trip: the trip you are on now. Full screen map, then a sheet with your arrival, the next stop,
// stops left, change warnings, Share trip and End trip. Refreshes every 15 seconds from /api/service.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import { radius, usePalette } from '@/lib/theme';
import { clock } from '@/lib/format';
import { endLive, getLive, liveWatch, setLive, useLiveTrip } from '@/lib/live';
import { legColor, plat, progOf, setEnginePos, short, tickLive, useLiveEngineState } from '@/lib/liveEngine';
import { cutPath, LiveState, minsWords, timed, tOf } from '@/lib/liveCalc';
import { fareWords, money } from '@/lib/fare';
import { enablePush, getPushState } from '@/lib/push';
import type { WatchLeg } from '@/lib/types';
import TransitMap from '@/components/TransitMap';
import { Icon, I } from '@/components/Icon';
import { LineBadge } from '@/components/Transit';
import { Button, Sep, T } from '@/components/ui';

const noun = (m?: string) => (m === 'bus' || m === 'coach' ? 'bus' : m === 'ferry' ? 'ferry' : m === 'lightrail' ? 'tram' : m === 'metro' ? 'metro' : 'train');

export default function LiveTripScreen() {
  const c = usePalette();
  const g = useLiveTrip();
  const params = useLocalSearchParams<{ share?: string }>();
  const now = useNow(1000);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const eng = useLiveEngineState();
  const live = eng.gid === g?.id ? eng : null;
  const svc = live?.svc || [];
  const st = live?.st || null;
  const offline = live?.offline || null;
  const updated = live?.updated || 0;
  const [me, setMe] = useState<{ lat: number; lon: number; acc?: number } | null>(null);
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
      geo.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (l) => setMe({ lat: l.coords.latitude, lon: l.coords.longitude, acc: l.coords.accuracy ?? undefined }));
    } catch {}
  }, []);
  useEffect(() => {
    if (g?.loc) startGeo(false);
    return () => { geo.current?.remove(); geo.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id]);

  // Opening the screen refreshes at once; the engine keeps refreshing every 15 seconds on any screen.
  useEffect(() => { tickLive(); }, [g?.id]);

  const askLocation = () => Alert.alert('Show where you are?', "Your location stays on this phone. It's only sent if you share your trip with your location on.", [
    { text: 'Not now', style: 'cancel' },
    { text: 'Continue', onPress: () => startGeo(true) },
  ]);

  const share = useCallback(async () => {
    const cur = getLive();
    if (!cur) return;
    if (cur.share) {
      Alert.alert('Sharing this trip', 'Anyone with the link can follow it until the trip ends.', [
        { text: 'Stop sharing', style: 'destructive', onPress: () => { api.shareEnd(cur.share!.id, cur.share!.key).catch(() => {}); setLive({ ...cur, share: null }); } },
        { text: 'Send link again', onPress: () => Share.share({ message: `Follow my trip live: ${cur.title} ${cur.share!.url}` }).catch(() => {}) },
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
        setLive({ ...c2, share: { id: r.id, key: r.key, url: r.url, pos: withPos } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await Share.share({ message: `Follow my trip live: ${cur.title} ${r.url}` });
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
    { text: 'End trip', style: 'destructive', onPress: async () => { await endLive(); Haptics.selectionAsync(); router.canGoBack() ? router.back() : router.replace('/'); } },
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
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={[sx.fab, { top: insets.top + 8, left: 12, backgroundColor: c.card }]} hitSlop={8} accessibilityLabel="Back">
        <Icon name={I.back} size={20} color={c.text} />
      </Pressable>
      {!me ? (
        <Pressable onPress={askLocation} style={[sx.fab, { top: insets.top + 8, right: 12, backgroundColor: c.card }]} hitSlop={8} accessibilityLabel="Show where I am">
          <Icon name={I.location} size={19} color={c.tint} />
        </Pressable>
      ) : null}
      <BottomSheet index={1} snapPoints={snaps} enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: c.card, borderRadius: Platform.OS === 'ios' ? 14 : 28 }} handleIndicatorStyle={{ backgroundColor: c.text3, width: 36 }}>
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
          {!st ? <T kind="sub" tone="text2" style={{ padding: 20 }}>Getting live times</T> : st.done ? (
            <View style={{ padding: 20 }}>
              <T kind="foot" tone="text2">You've arrived</T>
              <T kind="title2" style={{ marginTop: 2 }}>{short(legs[last].to)}</T>
              <T kind="sub" tone="text2" style={{ marginTop: 4 }}>{clock(st.eta)} {'\u00b7'} trip ended</T>
              <View style={{ marginTop: 18 }}><Button title="Done" onPress={async () => { await endLive(); router.canGoBack() ? router.back() : router.replace('/'); }} /></View>
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
  const late = Math.round(x.delay / 60000);
  const badge = x.live ? (late >= 2 ? { t: `${late} min late`, bg: c.orange } : { t: 'Live', bg: c.green }) : { t: 'Scheduled', bg: c.text3 };
  let now1 = '', now2 = '';
  if (st.phase === 'wait') {
    const dm = Math.round((x.dep - now) / 60000);
    now1 = `${st.cur > 0 ? 'Change to' : 'Board'} the ${l.line} to ${short(l.towards || l.to)}`;
    now2 = `${dm <= 0 ? 'Due now' : `Leaves in ${dm} min, ${clock(x.dep)}`}${l.fromPlatform ? ' \u00b7 ' + plat(l.fromPlatform) : ''}${d && d.stopsAway != null && d.vehicle ? ` \u00b7 ${d.stopsAway === 0 ? 'arriving' : `${d.stopsAway} stop${d.stopsAway > 1 ? 's' : ''} away`}` : ''}`;
  } else {
    const ns = d && st.nextIdx >= 0 ? d.stops[st.nextIdx] : null;
    const yours = !!d && st.nextIdx === d.alightIndex;
    now1 = yours ? 'Get off at the next stop' : ns ? `Next stop: ${short(ns.name)}` : `On the ${l.line} to ${short(l.towards || l.to)}`;
    now2 = `${st.stopsLeft != null ? `${st.stopsLeft} stop${st.stopsLeft === 1 ? '' : 's'} to ${short(l.to)}` : `To ${short(l.to)}`} \u00b7 ${st.cur < last ? 'change' : 'arrive'} ${clock(x.arr)}`;
  }
  // Remaining stops on this leg, from the next one to yours. Long lists fold in the middle.
  const list = d && st.phase === 'ride' && (d.alightIndex ?? -1) >= 0
    ? d.stops.slice(Math.max(d.mineIndex ?? 0, Math.min(st.nextIdx, d.alightIndex!)), d.alightIndex! + 1).filter(timed) : [];
  const show: (typeof list[number] | null)[] = list.length > 7 ? [...list.slice(0, 5), null, list[list.length - 1]] : list;
  const ago = updated ? Math.round((now - updated) / 1000) : null;
  return (
    <View>
      <View style={{ paddingHorizontal: 20, paddingTop: 2, flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <T kind="foot" tone="text2">Arrive at {short(legs[last].to)}</T>
          <Text style={{ fontSize: 34, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }} maxFontSizeMultiplier={1.3}>{clock(st.eta)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: c.tint, fontVariant: ['tabular-nums'] }} maxFontSizeMultiplier={1.3} accessibilityLabel={`in ${minsWords(m)}`}>{minsWords(m)}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            <View style={[sx.badge, { backgroundColor: badge.bg }]}><Text style={sx.badgeT}>{badge.t}</Text></View>
            {g.share ? <View style={[sx.badge, { backgroundColor: c.indigo }]}><Text style={sx.badgeT}>Sharing</Text></View> : null}
          </View>
        </View>
      </View>

      <View style={[sx.card, { backgroundColor: c.card2, borderLeftColor: legColor(l) }]}>
        <LineBadge line={l.line} mode={l.mode} color={legColor(l)} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <T kind="headline">{now1}</T>
          <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{now2}</T>
        </View>
      </View>

      {offline ? <Warn tone="grey" title={offline} body={ago != null ? `Last update ${ago < 90 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago. Trying again.` : 'Trying again.'} /> : null}
      {!x.live && !offline ? <Warn tone="grey" title="No live data for this service" body="Times are from the timetable." /> : null}
      {st.conns.filter((cn) => cn.risk !== 'ok').map((cn) => cn.risk === 'miss' ? (
        <Warn key={cn.i} tone="bad" title={`You'll likely miss the ${clock(new Date(cn.next.planned).getTime())} ${cn.next.line} at ${short(cn.at)}`}
          body={`Live times leave ${Math.abs(cn.spare)} min too little.`} link="Find the next connection"
          onLink={() => router.push({ pathname: '/trip', params: { from: legs[cn.i].toStopId || '', fromName: legs[cn.i].to || '', to: g.to?.id || legs[last].toStopId || '', toName: g.to?.name || legs[last].to || '' } })} />
      ) : (
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
              <T kind={s?.alight ? 'headline' : 'body'} tone={s ? 'text' : 'text2'} style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>{s ? short(s.name) : `${list.length - 6} more stops`}</T>
              {s ? <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{clock(tOf(s))}</T> : null}
            </View>
          ))}
        </View>
      ) : null}

      {!me || push !== 'on' ? (
        <View style={[sx.group, { backgroundColor: c.card2 }]}>
          {!me ? (
            <SetupRow icon={I.location} title="Show where I am" sub={locDenied ? "Location is off for Transport. Turn it on in your phone's settings." : 'Your location stays on this phone.'}
              action={locDenied ? 'Settings' : 'Allow'} onPress={locDenied ? () => Linking.openSettings() : onLoc} />
          ) : null}
          {!me && push !== 'on' ? <Sep inset={52} /> : null}
          {push !== 'on' ? (
            <SetupRow icon={I.bell} title="Get off alerts" sub={push === 'local' ? 'Alerts show while the app is running.' : push === 'denied' ? 'Notifications are off. Alerts show here while the app is open.' : 'One stop before yours, and at each change.'}
              action={push === 'local' ? undefined : 'Turn on'} onPress={onPush} />
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
                  {cn ? <T kind="foot" style={{ color: cn.risk === 'ok' ? c.text2 : cn.risk === 'tight' ? c.lateText : c.red, fontWeight: cn.risk === 'ok' ? '400' : '600' }}>{'\u00b7'} {Math.max(0, cn.spare)} min spare</T> : null}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, opacity: state === 'done' ? 0.5 : 1 }}>
                <LineBadge small line={ll.line} mode={ll.mode} color={legColor(ll)} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <T kind="body" numberOfLines={1}>{short(ll.from)} to {short(ll.to)}</T>
                  <T kind="foot" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>{clock(y2.dep)} to {clock(y2.arr)}{state === 'done' ? ' \u00b7 done' : ''}</T>
                </View>
                {state === 'now' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.green }} /> : null}
              </View>
            </View>
          );
        })}
        {g.fare && g.fare.total != null ? (
          <>
            <Sep inset={16} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
              <View style={{ flex: 1 }}>
                <T kind="body">Opal fare estimate</T>
                <T kind="foot" tone="text2">{fareWords(g.fare)}</T>
              </View>
              <T kind="headline" style={{ fontVariant: ['tabular-nums'] }}>{money(g.fare.total)}</T>
            </View>
          </>
        ) : null}
      </View>
      <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>
        Live positions and times from Transport for NSW. Your location is used on this phone only{g.share?.pos ? ', and sent to your share link while sharing' : ''}. Share links stop working when the trip ends.
      </T>
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
        <T kind="headline" style={{ color: tone === 'grey' ? c.text : col }}>{title}</T>
        <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{body}</T>
        {link ? <Pressable onPress={onLink} hitSlop={6}><T kind="foot" tone="tint" style={{ marginTop: 4, fontWeight: '600' }}>{link}</T></Pressable> : null}
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
