// Bus route: every stop of a route in order, with the stop numbers, where the buses are now and the next times at
// a stop you tap. Opened from a route search (410, M90), a line on a stop's board, or a bus leg of a trip.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { goBack } from '@/lib/nav';
import { useSides } from '@/lib/layout';
import { api } from '@/lib/api';
import { useScreenPoll, useNow } from '@/lib/activity';
import { usePalette } from '@/lib/theme';
import { badgeLook } from '@/lib/lineStyle';
import { clock, countdown, ms, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { awayWords, busesOn, lineTimes, nextBusAt, pickDir, probeStops, routeDirs, type BoardItem, type RouteBus, type RouteDir } from '@/lib/busCore';
import TransitMap from '@/components/TransitMap';
import { Icon, I } from '@/components/Icon';
import { LineBadge } from '@/components/Transit';
import { T } from '@/components/ui';

export default function RouteScreen() {
  const p = useLocalSearchParams<{ line: string; mode: string; stop: string; towards: string; color: string }>();
  const line = String(p.line || '').toUpperCase();
  const mode = p.mode && p.mode !== 'other' ? String(p.mode) : 'bus';
  const c = usePalette();
  const now = useNow(15000);
  const insets = useSafeAreaInsets();
  const side = useSides();
  const { height } = useWindowDimensions();
  const color = badgeLook(line, mode, p.color).bg;
  const snaps = useMemo(() => ['40%', '65%', '92%'], []);
  const [dirs, setDirs] = useState<RouteDir[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [di, setDi] = useState(0);
  const [buses, setBuses] = useState<RouteBus[]>([]);
  const [busAt, setBusAt] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(p.stop ? String(p.stop) : null);
  const [times, setTimes] = useState<Record<string, BoardItem[] | null>>({});

  useEffect(() => {
    let live = true;
    setDirs(null); setErr(null);
    api.route(line, mode).then((raw) => {
      if (!live) return;
      const d = routeDirs(raw);
      if (!d.length) { setErr(`No stops found for route ${line}.`); return; }
      setDirs(d); setDi(pickDir(d, p.stop, p.towards));
    }).catch((e: any) => { if (live) setErr(e?.http === 404 ? `Route ${line} isn't in the timetable data.` : e?.message || `Can't load route ${line}.`); });
    return () => { live = false; };
  }, [line, mode, p.stop, p.towards]);

  const dir = dirs?.[di] || null;
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const openRef = useRef(open);
  openRef.current = open;

  // Live buses: the boards of three stops along the route; the times of the stop you opened. Every 30 seconds
  // while this screen is on view and the app is in front, never in the background.
  const load = useCallback(async () => {
    const d = dirRef.current;
    if (!d) return false;
    const probes = probeStops(d.stops.length);
    const boards = await Promise.all(probes.map(async (idx) => {
      try { return { idx, items: (await api.departures(d.stops[idx].id)).items as BoardItem[] }; } catch { return { idx, items: null }; }
    }));
    if (dirRef.current !== d) return true;
    setBuses(busesOn(line, boards));
    setBusAt(Date.now());
    const o = openRef.current;
    if (o && d.stops.some((s) => s.id === o)) {
      const hit = boards.find((b) => d.stops[b.idx].id === o);
      const items = hit ? hit.items : await api.departures(o).then((r) => r.items as BoardItem[]).catch(() => null);
      setTimes((t) => ({ ...t, [o]: items }));
    }
    return true;
  }, [line]);
  const runNow = useScreenPoll(load, 30000, { runAtStart: true, staleMs: 10000 });
  useEffect(() => { setBuses([]); setBusAt(null); if (dir) runNow(); }, [dir, runNow]);

  const tap = (id: string) => {
    haptic.select();
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!times[id]) api.departures(id).then((r) => setTimes((t) => ({ ...t, [id]: r.items as BoardItem[] }))).catch(() => setTimes((t) => ({ ...t, [id]: null })));
  };

  const mapStops = useMemo(() => (dir?.stops || []).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, mine: s.id === p.stop })), [dir, p.stop]);
  const markers = useMemo(() => [...mapStops, ...buses.map((b) => ({ id: 'bus-' + b.tripId, name: `Bus ${line}`, lat: b.lat, lon: b.lon, color: c.text }))], [mapStops, buses, line, c.text]);
  const path = useMemo(() => (dir?.stops || []).filter((s) => s.lat != null && s.lon != null).map((s) => [s.lat!, s.lon!] as [number, number]), [dir]);
  const swap = () => { if (dirs && dirs.length > 1) { haptic.select(); setDi((i) => (i + 1) % dirs.length); } };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TransitMap path={path} stops={markers} vehicle={null} color={color} mode={mode} dark={c.dark} bottomInset={height * 0.4} />
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack()} style={[sx.back, { top: insets.top + 8, left: insets.left + 16, backgroundColor: c.card }]} hitSlop={8}>
        <Icon name={I.back} size={20} color={c.text} />
      </Pressable>
      <BottomSheet index={1} snapPoints={snaps} enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: c.card, borderRadius: Platform.OS === 'ios' ? 14 : 28 }} handleIndicatorStyle={{ backgroundColor: c.text3, width: 36 }}>
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingLeft: side.left, paddingRight: side.right }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <LineBadge line={line} mode={mode} color={color} />
              <T kind="title3" numberOfLines={2} style={{ flex: 1 }} accessibilityRole="header">{dir ? `to ${shortName(dir.to)}` : `Route ${line}`}</T>
              {dirs && dirs.length > 1 ? (
                <Pressable onPress={swap} accessibilityRole="button" accessibilityLabel={`Other direction, to ${shortName(dirs[(di + 1) % dirs.length].to)}`} hitSlop={8}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: c.fill, opacity: pressed ? 0.7 : 1 })}>
                  <Icon name={I.swap} size={14} color={c.tint} />
                  <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Direction</T>
                </Pressable>
              ) : null}
            </View>
            {dir ? (
              <T kind="sub" tone="text2" style={{ marginTop: 6 }}>
                {dir.stops.length} stops{busAt ? ` \u00b7 ${buses.length ? `${buses.length} bus${buses.length === 1 ? '' : 'es'} on the way now` : 'No live buses on this direction now'}` : ''}
              </T>
            ) : null}
            {err ? <T kind="body" tone="text2" style={{ marginTop: 12 }}>{err}</T> : null}
            {!dir && !err ? <T kind="sub" tone="text2" style={{ marginTop: 12 }}>Loading route {line}</T> : null}
          </View>

          <View style={{ marginTop: 14, paddingHorizontal: 20 }}>
            {(dir?.stops || []).map((s, i) => {
              const nb = nextBusAt(i, buses);
              const here = buses.filter((b) => b.pos === i);
              const mine = s.id === p.stop;
              const isOpen = open === s.id;
              const list = isOpen ? lineTimes(times[s.id], line, now) : [];
              const last = i === dir!.stops.length - 1;
              return (
                <Pressable key={s.id + i} onPress={() => tap(s.id)} accessibilityRole="button"
                  accessibilityLabel={`${s.name}, stop ${s.id}${nb && !last ? `, next bus ${awayWords(nb.away)}` : ''}`} accessibilityHint={isOpen ? 'Hides the next times' : 'Shows the next times'}
                  style={({ pressed }) => ({ flexDirection: 'row', minHeight: 52, opacity: pressed ? 0.75 : 1 })}>
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <View style={{ position: 'absolute', top: i === 0 ? 22 : 0, bottom: last ? undefined : 0, height: last ? 22 : undefined, width: 4, backgroundColor: color }} />
                    <View style={{ marginTop: 16, width: mine ? 14 : 10, height: mine ? 14 : 10, borderRadius: 7, backgroundColor: mine ? color : c.card, borderWidth: 2.5, borderColor: color }} />
                    {here.length ? (
                      <View style={{ position: 'absolute', top: 30, width: 24, height: 24, borderRadius: 12, backgroundColor: color, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.card }}>
                        <Icon name={I.bus} size={12} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, paddingVertical: 10, paddingLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T kind={mine ? 'headline' : 'callout'} numberOfLines={2} style={{ flex: 1 }}>{s.name}</T>
                      <Icon name={isOpen ? I.up : I.down} size={12} color={c.text3} />
                    </View>
                    <T kind="foot" tone="text2" style={{ marginTop: 2 }}>
                      Stop {s.id}{here.length ? ` \u00b7 Bus at this stop${here[0].delayMin ? `, ${here[0].delayMin} min late` : ''}` : nb && !last ? ` \u00b7 Next bus ${awayWords(nb.away).toLowerCase()}` : ''}
                    </T>
                    {mine ? <T kind="caption" tone="tint" style={{ fontWeight: '700', marginTop: 2 }}>YOUR STOP</T> : null}
                    {isOpen ? (
                      <View style={{ marginTop: 8, gap: 6 }}>
                        {times[s.id] === undefined ? <T kind="sub" tone="text2">Loading times</T> : null}
                        {times[s.id] === null ? <T kind="sub" tone="text2">Can't load times for this stop.</T> : null}
                        {times[s.id] && !list.length ? <T kind="sub" tone="text2">No {line} due here in the next few hours.</T> : null}
                        {list.map((d) => {
                          const t = ms((d.realtime && d.estimated) || d.planned);
                          return (
                            <View key={(d.tripId || '') + d.planned} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <T kind="body" style={{ fontWeight: '600', color: d.realtime ? c.green : c.text, fontVariant: ['tabular-nums'], minWidth: 64 }}>{(() => { const k = countdown(t, now); return k.unit ? `${k.big} ${k.unit}` : k.big; })()}</T>
                              <T kind="sub" tone="text2" style={{ flex: 1 }} numberOfLines={2}>
                                {clock(t)}{d.realtime ? (d.delayMin ? ` \u00b7 ${d.delayMin} min late` : ' \u00b7 On time') : ' \u00b7 Scheduled'}{d.dest ? ` \u00b7 to ${shortName(d.dest)}` : ''}
                              </T>
                            </View>
                          );
                        })}
                        <Pressable onPress={() => router.push({ pathname: '/stop/[id]', params: { id: s.id, name: s.name } })} accessibilityRole="link" hitSlop={6}>
                          <T kind="sub" tone="tint" style={{ fontWeight: '600', marginTop: 2 }}>All departures from this stop</T>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const sx = StyleSheet.create({
  back: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
