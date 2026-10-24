import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PanResponder, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
// Buttons revealed by a swipe use the gesture handler's Pressable: on Android a React Native Pressable there
// can lose its press to the swipe gesture.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { haptic } from '@/lib/haptic';
import { gripStep, type GripEvent, type GripState } from '@/lib/gesture';
import { router, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { store, tripKeyOf, useStore } from '@/lib/store';
import { shortName } from '@/lib/format';
import type { Place } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { watchLine } from '@/components/Cards';
import { ActionRow, AlertBanner, deleteTrip, HomeSection, LiveTag, PlaceBar, pullHome, StopBoard, TripBoard, TripItem, useNearby } from '@/components/Home';
import { LineBadge } from '@/components/Transit';
import { useLiveTrip } from '@/lib/live';
import { modeColor, radius } from '@/lib/theme';
import { Button, Empty, Row, Section, Screen, Sep, T } from '@/components/ui';
import { LeaveLine, MorningLink, useMyPos } from '@/components/Smart';
import { commuteDir, halfDayKey } from '@/lib/smart';
import { useLoaded } from '@/lib/store';

export default function Home() {
  const c = usePalette();
  const now = useNow(1000);
  const st = useStore();
  const near = useNearby();
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [scrollOn, setScrollOn] = useState(true);
  const live = useLive(async () => {
    const [commutes, saved, watches] = await Promise.all([
      api.commutes().catch(() => ({ items: [], suggestion: null })),
      api.saved().catch(() => ({ items: [] })),
      api.watches().catch(() => ({ items: [], notes: [] })),
    ]);
    return { commutes, saved, watches };
  }, 15000);
  const d = live.data;
  const activeWatches = (d?.watches.items || []).filter((w: any) => w.active);
  const sugg: any = d?.commutes.suggestion;

  // Trips: Home to Work and Work to Home first (the one for this time of day on top), then commutes, saved trips and up to 2 recent A to B trips.
  const trips: TripItem[] = [];
  const places = st.places || {};
  const seen = new Set<string>();
  const add = (t: TripItem) => {
    const k = tripKeyOf(t);
    if (seen.has(k) || trips.length >= 8) return;
    seen.add(k);
    trips.push({ ...t, key: k, okey: t.kind === 'place' ? 'places' : k });
  };
  // Your commute: one card on top, Home to Work before 12pm and Work to Home after, unless you swapped it for now.
  const half = halfDayKey(now);
  const flipped = st.commuteFlip === half;
  let commute: TripItem | null = null;
  if (places.home && places.work && places.home.id !== places.work.id) {
    const dir = commuteDir(now, flipped);
    commute = dir === 'toWork'
      ? { key: '', from: places.home, to: places.work, kind: 'place', tag: 'To work', name: 'To work' }
      : { key: '', from: places.work, to: places.home, kind: 'place', tag: 'To home', name: 'To home' };
    commute.key = tripKeyOf(commute);
    seen.add(commute.key);
    seen.add(tripKeyOf({ from: commute.to, to: commute.from }));
  }
  const me = useMyPos();
  // First launch: two questions, home and work. Skippable, and asked once.
  const loaded = useLoaded();
  const asked = useRef(false);
  useEffect(() => {
    if (!loaded || asked.current || st.onboarded || (places.home && places.work)) return;
    asked.current = true;
    const t = setTimeout(() => router.push('/welcome'), 300);
    return () => clearTimeout(t);
  }, [loaded, st.onboarded, places.home, places.work]);
  (d?.commutes.items || []).filter((x) => x.active).forEach((cm) => add({ key: '', from: cm.from, to: cm.to, kind: 'commute', name: cm.name, id: cm.id }));
  (st.myTrips || []).forEach((m) => add({ key: '', from: m.from, to: m.to, via: m.via, conn: m.conn, legs: m.legs, modes: m.modes, kind: 'mine', name: m.name }));
  (d?.saved.items || []).forEach((s) => add({ key: '', from: s.from, to: s.to, kind: 'saved', name: s.name }));

  // Your own order from dragging wins; home and work move together and keep their morning and evening order.
  const order = st.tripOrder || [];
  const sorted = trips.map((t, i) => ({ t, p: order.indexOf(t.okey!) < 0 ? 1000 + i : order.indexOf(t.okey!), i })).sort((x, y) => x.p - y.p || x.i - y.i).map((o) => o.t);

  // Starred stops. Recent stops and trips live in Plan, so Home shows each thing once.
  const starred = st.starred || [];
  // Nearby leaves out stops already on Home as starred, and shows at most 3.
  const nearStops = (near.stops || []).filter((p: Place) => !starred.some((s) => s.id === p.id)).slice(0, 3);
  const g = useLiveTrip();
  const [snack, setSnack] = useState<{ text: string; undo: () => void; id: number } | null>(null);
  useEffect(() => { if (!snack) return; const t = setTimeout(() => setSnack(null), 5000); return () => clearTimeout(t); }, [snack]);
  const stopMenu = (p: Place, isStarred: boolean) => {
    haptic.tap();
    Alert.alert(shortName(p.name), undefined, isStarred ? [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unstar stop', style: 'destructive', onPress: () => store.toggleStar(p) },
    ] : [
      { text: 'Star stop', onPress: () => store.toggleStar(p) },
      { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecent(p.id) },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  };

  const acceptSuggestion = async () => {
    setBusy(true);
    try {
      await api.saveCommute({ name: sugg.name || 'Morning trip', from: sugg.from, to: sugg.to, tod: sugg.tod, days: '12345', active: true } as any);
      live.refresh();
    } catch (e: any) { Alert.alert("Couldn't save it", e.message); }
    setBusy(false);
  };

  const onPull = async () => {
    setPulling(true);
    pullHome();
    await live.refresh();
    setPulling(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Home', headerRight: () => <LiveTag /> }} />
      <Screen scrollEnabled={scrollOn} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} enabled={scrollOn} />}>
        {g ? <LiveBar title={g.title} line={g.legs[0]?.line} mode={g.legs[0]?.mode} color={g.legs[0]?.color} /> : null}
        <AlertBanner />

        {activeWatches.length ? (
          <Section title="Watching now">
            {activeWatches.map((w: any, i: number) => (
              <View key={w.id}>
                {i ? <Sep inset={57} /> : null}
                <Row icon={I.bell} iconBg={c.indigo} title={w.title} subtitle={watchLine(w, now)} onPress={() => router.push({ pathname: '/watch/[id]', params: { id: w.id } })} />
              </View>
            ))}
          </Section>
        ) : null}

        {sugg ? (
          <Section>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={I.clock} size={18} color={c.tint} />
                <T kind="headline" style={{ flex: 1 }}>Make this your {(sugg.name || 'regular trip').toLowerCase()}?</T>
              </View>
              <T kind="sub" tone="text2" style={{ marginTop: 6 }}>
                {shortName(sugg.from?.name)} to {shortName(sugg.to?.name)}{sugg.todText ? ` around ${sugg.todText}` : ''}, searched on {sugg.days} days. You'll get a leave now alert, and a heads up only when something is wrong.
              </T>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}><Button title="Make it my commute" onPress={acceptSuggestion} disabled={busy} /></View>
                <Button title="Not now" kind="tinted" onPress={() => api.dismissSuggestion(sugg.key).then(live.refresh)} />
              </View>
            </View>
          </Section>
        ) : null}

        {commute ? (
          <HomeSection title="Your commute">
            <TripBoard trip={commute} now={now} aside={<SwapButton to={commute.tag === 'To work' ? 'To home' : 'To work'} onPress={() => { store.setCommuteFlip(flipped ? null : half); haptic.select(); }} />}
              below={(js) => <><LeaveLine js={js} now={now} me={me} /><MorningLink from={commute.from} to={commute.to} dir={commute.tag === 'To work' ? 'toWork' : 'toHome'} /></>} />
          </HomeSection>
        ) : null}

        <HomeSection title="Your trips" action={{ title: 'Add', label: 'Add a trip', onPress: () => router.push('/new-trip') }}>
          <DragTrips trips={sorted} now={now} all={st.allServices || {}} onScroll={setScrollOn} />
          {d && !trips.length ? <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>Save the trips you take. They show here with live times.</T> : null}
          <PlaceBar places={places} />
        </HomeSection>

        {starred.length ? (
          <HomeSection title="Starred stops">
            {starred.map((p) => <StopBoard key={p.id} stop={p} starred now={now} onLongPress={() => stopMenu(p, true)} />)}
          </HomeSection>
        ) : null}

        {near.phase !== 'checking' ? (
          <HomeSection title="Nearby">
            {near.phase === 'on' && nearStops.length ? nearStops.map((p) => <StopBoard key={p.id} stop={p} distance={p.distance} now={now} />) : null}
            {near.phase === 'on' && !nearStops.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>No stops within walking distance</T> : null}
            {near.phase === 'off' || near.phase === 'loading' || near.phase === 'error' ? (
              <ActionRow icon={I.location} title="Show stops near me" onPress={near.ask} busy={near.phase === 'loading'} />
            ) : null}
            {near.phase === 'error' ? <T kind="foot" tone="text2" style={{ marginHorizontal: 20, marginTop: 6 }}>{near.error}</T> : null}
          </HomeSection>
        ) : null}

        {!d && !live.error ? <T kind="sub" tone="text2" style={{ textAlign: 'center', marginTop: 40 }}>Loading</T> : null}
        {!d && live.error ? <Empty icon={I.warn} title="Can't reach the live feed" body={live.error} action={<Button title="Try again" onPress={live.refresh} />} /> : null}
      </Screen>
      {snack ? (
        <View style={[hs.snack, { backgroundColor: c.dark ? '#E6E1E5' : '#313033' }]} accessibilityLiveRegion="polite">
          <Text style={{ color: c.dark ? '#313033' : '#F4EFF4', fontSize: 14, flex: 1 }}>{snack.text}</Text>
          <Pressable onPress={() => { snack.undo(); setSnack(null); haptic.select(); }} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: c.dark ? '#1F6FEB' : '#8AB4F8', fontSize: 14, fontWeight: '700' }}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

/** "Trip in progress" bar at the top of Home while a live trip is running. */
function LiveBar({ title, line, mode, color }: { title: string; line?: string; mode?: string; color?: string | null }) {
  const c = usePalette();
  return (
    <Pressable onPress={() => router.push('/go')} accessibilityRole="button" accessibilityLabel={`Trip in progress, ${title}`} android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      style={({ pressed }) => [hs.live, { backgroundColor: c.liveBg, opacity: pressed ? 0.85 : 1 }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Trip in progress</Text>
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }} numberOfLines={1}>{title}</Text>
      </View>
      {line ? <LineBadge small line={line} mode={mode} color={color || modeColor[mode || 'train']} /> : null}
      <Icon name={I.chevron} size={14} color="#fff" style={{ marginLeft: 8 }} />
    </Pressable>
  );
}

/** Swaps the commute card's direction until the next 12 (noon or midnight). */
function SwapButton({ to, onPress }: { to: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Swap direction, show ${to.toLowerCase()}`} android_ripple={{ color: c.fill, borderless: true, radius: 24 }}
      style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 })}>
      <Icon name={I.swap} size={20} color={c.tint} />
    </Pressable>
  );
}

/** Swipe left to show a red Remove or Delete action. */
function SwipeRemove({ children, label, onRemove }: { children: React.ReactNode; label: string; onRemove: () => void }) {
  const c = usePalette();
  const sw = useRef<any>(null);
  return (
    <ReanimatedSwipeable ref={sw} friction={2} rightThreshold={40} overshootRight={false} onSwipeableWillOpen={() => haptic.select()}
      renderRightActions={() => (
        <GHPressable onPress={() => { sw.current?.close(); onRemove(); }} accessibilityRole="button" accessibilityLabel={label}
          style={{ backgroundColor: c.red, width: 88, alignItems: 'center', justifyContent: 'center', marginTop: 0 }}>
          <Icon name={I.trash} size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 3 }}>{label}</Text>
        </GHPressable>
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

/** Trip cards that reorder by dragging the handle on each card. */
function DragTrips({ trips, now, all, onScroll }: { trips: TripItem[]; now: number; all: Record<string, boolean>; onScroll: (on: boolean) => void }) {
  const lay = useRef<{ y: number; h: number }[]>([]);
  const [drag, setDrag] = useState<{ i: number; dy: number; target: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const start = (i: number) => { onScroll(false); haptic.tap(); setDrag({ i, dy: 0, target: i }); };
  const move = (dy: number) => {
    const d = dragRef.current; const L = lay.current;
    if (!d || !L[d.i]) return;
    const mid = L[d.i].y + L[d.i].h / 2 + dy;
    let target = d.i;
    L.forEach((r, j) => { if (!r) return; if (j < d.i && mid < r.y + r.h / 2) target = Math.min(target, j); if (j > d.i && mid > r.y + r.h / 2) target = Math.max(target, j); });
    if (target !== d.target) haptic.select();
    setDrag({ ...d, dy, target });
  };
  const end = () => {
    const d = dragRef.current;
    onScroll(true); setDrag(null);
    if (!d || d.target === d.i) return;
    const arr = trips.slice(); const [m] = arr.splice(d.i, 1); arr.splice(d.target, 0, m);
    store.setTripOrder([...new Set(arr.filter((t) => t === m || t.okey !== m.okey).map((t) => t.okey!))]);
  };
  return (
    <View>
      {trips.map((t, i) => {
        let ty = 0;
        if (drag) {
          const sh = lay.current[drag.i]?.h || 0;
          if (i === drag.i) ty = drag.dy;
          else if (drag.i < drag.target && i > drag.i && i <= drag.target) ty = -sh;
          else if (drag.i > drag.target && i < drag.i && i >= drag.target) ty = sh;
        }
        const lifted = drag?.i === i;
        return (
          <View key={t.key} onLayout={(e) => { lay.current[i] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}
            style={{ transform: [{ translateY: ty }, { scale: lifted ? 1.02 : 1 }], zIndex: lifted ? 10 : 0, elevation: lifted ? 8 : 0, shadowColor: '#000', shadowOpacity: lifted ? 0.18 : 0, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
            {t.kind === 'mine' || t.kind === 'saved' ? (
              <SwipeRemove label="Delete" onRemove={() => Alert.alert(t.name || 'Delete trip', 'Delete this saved trip? It is removed from this phone and the server.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete trip', style: 'destructive', onPress: () => deleteTrip(t) },
              ])}>
                <TripBoard trip={t} now={now} allServices={!!all[t.key]} handle={trips.length > 1 ? (open: () => void) => <Grip onStart={() => start(i)} onMove={move} onEnd={end} onTap={open} /> : undefined} />
              </SwipeRemove>
            ) : (
              <TripBoard trip={t} now={now} allServices={!!all[t.key]} handle={trips.length > 1 ? (open: () => void) => <Grip onStart={() => start(i)} onMove={move} onEnd={end} onTap={open} /> : undefined} />
            )}
          </View>
        );
      })}
    </View>
  );
}

function Grip({ onStart, onMove, onEnd, onTap }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void; onTap: () => void }) {
  const c = usePalette();
  const cb = useRef({ onStart, onMove, onEnd, onTap });
  cb.current = { onStart, onMove, onEnd, onTap };
  // The handle sits inside the card header. A tap on it opens the trip like the rest of the header; only a
  // move or a hold starts the reorder (and its buzz). Before, every touch here started a drag, so a tap near
  // the chevron buzzed and did nothing.
  const pan = useMemo(() => {
    let st: GripState = { phase: 'idle', t0: 0 };
    let hold: ReturnType<typeof setTimeout> | null = null;
    const run = (e: GripEvent, dy = 0) => {
      const [n, out] = gripStep(st, e);
      st = n;
      if (out === 'startDrag') { if (hold) clearTimeout(hold); cb.current.onStart(); if (dy) cb.current.onMove(dy); }
      else if (out === 'move') cb.current.onMove(dy);
      else if (out === 'endDrag') cb.current.onEnd();
      else if (out === 'tap') cb.current.onTap();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => st.phase !== 'drag',
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { run({ type: 'down', t: Date.now() }); hold = setTimeout(() => run({ type: 'hold', t: Date.now() }), 260); },
      onPanResponderMove: (_, g) => run({ type: 'move', t: Date.now(), dy: g.dy }, g.dy),
      onPanResponderRelease: () => { if (hold) clearTimeout(hold); run({ type: 'up', t: Date.now() }); },
      onPanResponderTerminate: () => { if (hold) clearTimeout(hold); run({ type: 'cancel' }); },
    });
  }, []);
  return (
    <View {...pan.panHandlers} hitSlop={8} accessible accessibilityRole="button" accessibilityLabel="Reorder trip" accessibilityHint="Drag up or down to move this trip. Tap to open it."
      onAccessibilityTap={onTap}
      style={{ width: 40, height: 48, marginLeft: 4, marginRight: -8, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={I.grip} size={20} color={c.text3} />
    </View>
  );
}

const hs = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius },
  snack: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 8, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
