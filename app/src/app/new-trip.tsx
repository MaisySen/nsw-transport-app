import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, PanResponder, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { modeColor, radius, usePalette } from '@/lib/theme';
import { shortName } from '@/lib/format';
import { store } from '@/lib/store';
import type { Place, SearchItem } from '@/lib/types';
import { BusDir, MODES, ModeKey, Station, busRoute, busRoutes, geoDist, modeName, natCmp, stName, stationsFor, wireLegs } from '@/lib/trips';
import { Icon, I, modeIconName } from '@/components/Icon';
import { pullHome } from '@/components/Home';
import TransitMap from '@/components/TransitMap';
import { Button, Row, Screen, Section, Sep, T, font } from '@/components/ui';

type Leg = { mode: string; from: Place; to: Place; conn?: number; any?: boolean; walk?: number };
type Dest = { mode: string; to: Place; conn?: number; any?: boolean; walk?: number };
type Pick = Place & { ctx?: { route: string; dir: BusDir; at: number } };
type Step = { kind: 'mode'; ext?: boolean } | { kind: 'pick'; mode: ModeKey; which: 'from' | 'to'; from?: Pick; ext?: boolean } | { kind: 'walk' } | { kind: 'confirm' };

const ROW_H = 50, HEAD_H = 30;

/** New trip: choose the mode, then where you get on and off, then confirm (name, legs, connection times). */
export default function NewTrip() {
  const c = usePalette();
  const pre = useLocalSearchParams<{ from?: string; fromName?: string; to?: string; toName?: string; mode?: string; legs?: string; name?: string }>();
  const preLegs: Leg[] | null = (() => {
    try { const v = pre.legs ? JSON.parse(String(pre.legs)) : null; if (Array.isArray(v) && v.length) return v; } catch {}
    return pre.from && pre.to ? [{ mode: String(pre.mode || ''), from: { id: String(pre.from), name: String(pre.fromName || pre.from) }, to: { id: String(pre.to), name: String(pre.toName || pre.to) } }] : null;
  })();
  const [step, setStep] = useState<Step>(preLegs ? { kind: 'confirm' } : { kind: 'mode' });
  // The start stop and each leg's end stop; every leg starts where the one before it ends.
  const [start, setStart] = useState<Place | null>(preLegs ? preLegs[0].from : null);
  const [dests, setDests] = useState<Dest[]>(preLegs ? preLegs.map((l, i) => ({ mode: l.mode || '', to: l.to, conn: i ? l.conn ?? 5 : undefined, any: !!l.any, walk: l.walk ?? 5 })) : []);
  const [name, setName] = useState<string | null>(pre.name ? String(pre.name) : null);
  const [saving, setSaving] = useState(false);

  const legs: Leg[] = start ? dests.map((d, i) => ({ ...d, from: i ? dests[i - 1].to : start, conn: i && d.mode !== 'walk' ? d.conn ?? 5 : undefined, walk: d.mode === 'walk' ? d.walk ?? 5 : undefined })) : [];
  const a = legs[0], last = legs[legs.length - 1];
  const defName = a ? `${stName(shortName(a.from.name))} to ${stName(shortName(last.to.name))}` : '';
  const bad = legs.some((l) => l.from.id === l.to.id);
  const fixConn = (ds: Dest[]) => ds.map((d, i) => ({ ...d, conn: i ? d.conn ?? (ds[i - 1].mode === 'walk' ? 2 : 5) : undefined }));

  const choseMode = (m: ModeKey | 'walk') => {
    Haptics.selectionAsync();
    const ext = step.kind === 'mode' && step.ext && last;
    if (m === 'walk') { if (ext) setStep({ kind: 'walk' }); return; }
    if (ext) setStep({ kind: 'pick', mode: m, which: 'to', from: last.to, ext: true });
    else setStep({ kind: 'pick', mode: m, which: 'from' });
  };
  const addDest = (d: Dest) => { setDests(fixConn([...dests, d])); setStep({ kind: 'confirm' }); };
  const picked = (p: Pick) => {
    Haptics.selectionAsync();
    if (step.kind !== 'pick') return;
    if (step.which === 'from') { setStep({ kind: 'pick', mode: step.mode, which: 'to', from: p }); return; }
    if (step.ext) { addDest({ mode: step.mode, to: { id: p.id, name: p.name }, any: false }); return; }
    setStart({ id: step.from!.id, name: step.from!.name });
    setDests([{ mode: step.mode, to: { id: p.id, name: p.name } }]);
    setStep({ kind: 'confirm' });
  };
  const back = () => {
    if (step.kind === 'pick') {
      if (step.which === 'to' && !step.ext) setStep({ kind: 'pick', mode: step.mode, which: 'from' });
      else if (legs.length) setStep({ kind: 'confirm' });
      else setStep({ kind: 'mode' });
    } else if (step.kind === 'walk') setStep({ kind: 'mode', ext: true });
    else if (step.kind === 'mode' && step.ext) setStep({ kind: 'confirm' });
    else router.back();
  };
  const move = (i: number, d: -1 | 1) => {
    Haptics.selectionAsync();
    const ds = [...dests];
    [ds[i], ds[i + d]] = [ds[i + d], ds[i]];
    setDests(fixConn(ds));
  };
  const remove = (i: number) => {
    Haptics.selectionAsync();
    if (i === 0) setStart(dests[0].to);
    setDests(fixConn(dests.filter((_, k) => k !== i)));
  };
  const patch = (i: number, p: Partial<Dest>) => setDests(dests.map((d, k) => (k === i ? { ...d, ...p } : d)));

  const save = async () => {
    if (!a) return;
    if (bad) { Alert.alert('Check the legs', 'A leg starts and ends at the same stop. Remove it or move it.'); return; }
    setSaving(true);
    const n = (name ?? defName).trim() || defName;
    const multi = legs.length > 1;
    const t: any = { name: n, from: a.from, to: last.to, modes: legs.map((l) => l.mode) };
    if (multi) t.legs = legs.map((l) => ({ mode: l.mode, from: l.from, to: l.to, ...(l.conn != null ? { conn: l.conn } : {}), ...(l.any ? { any: true } : {}), ...(l.walk != null ? { walk: l.walk } : {}) }));
    if (legs.length === 2 && legs[1].mode !== 'walk') { t.via = a.to; t.conn = legs[1].conn; }
    store.saveMyTrip(t);
    if (multi) api.saveTripLegs(n, wireLegs(t)).catch(() => {});
    else api.saveTrip(n, a.from, a.to).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    pullHome();
    setSaving(false);
    router.back();
  };

  const title = step.kind === 'mode' ? (step.ext ? 'Add a leg' : 'New trip') : step.kind === 'walk' ? 'Walk to' : step.kind === 'pick' ? (step.which === 'from' ? 'From' : 'To') : 'Confirm trip';
  const first = step.kind === 'mode' && !step.ext;
  const stepper = (val: number, lbl: string, set: (v: number) => void, min: number, max: number) => (
    <View style={[s.stepper, { backgroundColor: c.fill, borderRadius: Platform.OS === 'android' ? 20 : 9 }]}>
      <Pressable onPress={() => { Haptics.selectionAsync(); set(Math.max(min, val - 1)); }} style={s.stepBtn} accessibilityLabel={`Less ${lbl}`} hitSlop={4}><Icon name={I.minus} size={16} color={c.text} /></Pressable>
      <T kind="headline" style={[s.stepVal, { borderColor: c.sep }]}>{val} min</T>
      <Pressable onPress={() => { Haptics.selectionAsync(); set(Math.min(max, val + 1)); }} style={s.stepBtn} accessibilityLabel={`More ${lbl}`} hitSlop={4}><Icon name={I.plus} size={16} color={c.text} /></Pressable>
    </View>
  );
  const n = legs.length;
  return (
    <>
      <Stack.Screen options={{
        title,
        headerLeft: () => (
          <Pressable hitSlop={10} onPress={back} accessibilityRole="button" accessibilityLabel={first ? 'Cancel' : 'Back'}>
            {Platform.OS === 'ios' ? <T kind="body" tone="tint">{first ? 'Cancel' : 'Back'}</T> : <Icon name={first ? I.close : I.back} size={22} color={c.text} />}
          </Pressable>
        ),
        headerRight: step.kind === 'confirm' ? () => (
          <Pressable hitSlop={10} disabled={saving} onPress={save} accessibilityRole="button" accessibilityLabel="Save trip">
            {saving ? <ActivityIndicator color={c.tint} /> : <T kind="headline" tone="tint">Save</T>}
          </Pressable>
        ) : () => null,
      }} />
      {step.kind === 'mode' ? <ModeList ext={step.ext ? last?.to : undefined} onPick={choseMode} /> : null}
      {step.kind === 'walk' && last ? <WalkPicker from={last.to} onPick={(p) => addDest({ mode: 'walk', to: p, walk: 5 })} /> : null}
      {step.kind === 'pick' ? <StationPicker key={step.mode + step.which} mode={step.mode} which={step.which} from={step.from} onPick={picked} /> : null}
      {step.kind === 'confirm' && a ? (
        <Screen>
          {legs.map((l, i) => {
            const walk = l.mode === 'walk';
            return (
              <Section key={i} title={n > 1 ? `Leg ${i + 1}` : undefined}>
                <Row icon={walk ? I.walk : modeIconName(l.mode || 'train')} iconBg={walk ? c.text3 : l.mode ? modeColor[l.mode] : c.text3} title={`${stName(shortName(l.from.name))} to ${stName(shortName(l.to.name))}`}
                  subtitle={walk ? 'Walk' : modeName(l.mode)}
                  right={n > 1 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <Pressable hitSlop={8} disabled={!i} onPress={() => move(i, -1)} accessibilityLabel={`Move leg ${i + 1} up`} style={{ opacity: i ? 1 : 0.3 }}><Icon name={I.up} size={18} color={c.tint} /></Pressable>
                      <Pressable hitSlop={8} disabled={i === n - 1} onPress={() => move(i, 1)} accessibilityLabel={`Move leg ${i + 1} down`} style={{ opacity: i < n - 1 ? 1 : 0.3 }}><Icon name={I.down} size={18} color={c.tint} /></Pressable>
                      <Pressable hitSlop={8} onPress={() => remove(i)} accessibilityLabel={`Remove leg ${i + 1}`}><Icon name={I.trash} size={18} color={c.red} /></Pressable>
                    </View>
                  ) : undefined} />
                {walk ? (
                  <><Sep inset={16} /><View style={s.connRow}>
                    <View style={{ flex: 1 }}><T kind="body">Walk time</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>From {stName(shortName(l.from.name))}</T></View>
                    {stepper(l.walk ?? 5, 'walking time', (v) => patch(i, { walk: v }), 1, 60)}
                  </View></>
                ) : (
                  <>
                    {i ? <><Sep inset={16} /><View style={s.connRow}>
                      <View style={{ flex: 1 }}><T kind="body">Connection time</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>Change at {stName(shortName(l.from.name))}</T></View>
                      {stepper(l.conn ?? 5, 'connection time', (v) => patch(i, { conn: v }), 0, 30)}
                    </View></> : null}
                    <Sep inset={16} />
                    <View style={s.connRow}>
                      <View style={{ flex: 1 }}><T kind="body">Direct services only</T><T kind="foot" tone="text2" style={{ marginTop: 2 }}>{l.any ? 'Services with a change are used too' : 'One service for this leg'}</T></View>
                      <Switch value={!l.any} onValueChange={(v) => { Haptics.selectionAsync(); patch(i, { any: !v }); }} accessibilityLabel={`Direct services only, leg ${i + 1}`} />
                    </View>
                  </>
                )}
              </Section>
            );
          })}
          {bad ? <T kind="foot" style={{ color: c.red, marginHorizontal: 32, marginTop: 8 }}>A leg starts and ends at the same stop. Remove it or move it.</T> : null}
          <Section>
            <Row icon={I.plus} iconBg={c.tint} title={n > 1 ? 'Add another leg' : 'Extend trip'} subtitle={`Add a leg from ${stName(shortName(last.to.name))}`} onPress={() => setStep({ kind: 'mode', ext: true })} />
          </Section>
          <Section title="Name" footer={n > 1 ? 'Each service on the first leg is paired with the first connection you can make on every next leg, after your connection time. Late services that break a change are flagged.' : 'Only services that stop at both ends are shown, with a switch for all services on the trip screen.'}>
            <TextInput value={name ?? defName} onChangeText={setName} maxLength={24} placeholder={defName} placeholderTextColor={c.text3} returnKeyType="done"
              accessibilityLabel="Trip name" style={[font.body, { color: c.text, paddingHorizontal: 16, paddingVertical: 12 }]} />
          </Section>
          <View style={{ marginHorizontal: 16, marginTop: 24 }}>
            <Button title="Save trip" icon={I.check} onPress={save} disabled={saving} />
          </View>
        </Screen>
      ) : null}
    </>
  );
}

/** Walk leg: search for the stop you walk to. */
function WalkPicker({ from, onPick }: { from: Place; onPick: (p: Place) => void }) {
  const c = usePalette();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) { setItems(null); return; }
    const t = setTimeout(() => {
      api.search(v).then((d) => { setErr(''); setItems((d.items || []).filter((x) => String(x.id) !== String(from.id)).slice(0, 8)); }).catch((e) => setErr(String(e?.message || e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, from.id]);
  return (
    <Screen>
      <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }}>From {stName(shortName(from.name))}, which stop do you walk to?</T>
      <View style={[s.search, { backgroundColor: c.fill, borderRadius: Platform.OS === 'android' ? 24 : 10, marginTop: 12, height: Platform.OS === 'android' ? 48 : 38 }]}>
        <Icon name={I.search} size={16} color={c.text2} />
        <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Stop or station name" placeholderTextColor={c.text3} accessibilityLabel="Stop or station name"
          style={[font.body, { flex: 1, color: c.text, marginLeft: 8, paddingVertical: 0 }]} returnKeyType="search" />
      </View>
      {err ? <T kind="foot" style={{ color: c.red, marginHorizontal: 32, marginTop: 12 }}>{err}</T> : null}
      {items && !items.length ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 12 }}>No stops found</T> : null}
      {items && items.length ? (
        <Section>
          {items.map((it, i) => (
            <View key={it.id}>
              {i ? <Sep inset={57} /> : null}
              <Row icon={I.location} iconBg={c.text3} title={shortName(it.name)} onPress={() => onPick({ id: String(it.id), name: it.name })} />
            </View>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function ModeList({ ext, onPick }: { ext?: Place; onPick: (m: ModeKey | 'walk') => void }) {
  const c = usePalette();
  return (
    <Screen>
      {ext ? <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }}>From {stName(shortName(ext.name))}, how do you travel on?</T> : null}
      <Section>
        {MODES.map((m, i) => (
          <View key={m.k}>
            {i ? <Sep inset={57} /> : null}
            <Row icon={modeIconName(m.k)} iconBg={modeColor[m.k]} title={m.name} subtitle={m.sub} onPress={() => onPick(m.k)} />
          </View>
        ))}
      </Section>
      {ext ? (
        <Section>
          <Row icon={I.walk} iconBg={c.text3} title="Walk" subtitle="To a stop nearby, then carry on" onPress={() => onPick('walk')} />
        </Section>
      ) : null}
      {ext ? null : (
        <Section>
          <Row icon={I.search} iconBg={c.text3} title="Search any stop" subtitle="Mixed modes or a change" onPress={() => router.replace('/add-trip')} />
        </Section>
      )}
    </Screen>
  );
}

function Segments({ value, items, onChange }: { value: string; items: [string, string][]; onChange: (k: string) => void }) {
  const c = usePalette();
  const android = Platform.OS === 'android';
  return (
    <View style={[s.seg, android ? { borderWidth: 1, borderColor: c.sep, borderRadius: 20, padding: 0, backgroundColor: 'transparent' } : { backgroundColor: c.fill }]} accessibilityRole="tablist">
      {items.map(([k, label], i) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => { Haptics.selectionAsync(); onChange(k); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[s.segBtn, android ? { borderRadius: 0, borderLeftWidth: i ? 1 : 0, borderColor: c.sep, backgroundColor: on ? c.card2 : 'transparent', paddingVertical: 8 } : on ? { backgroundColor: c.dark ? '#636366' : '#fff', ...s.segOn } : null,
              android && i === 0 ? { borderTopLeftRadius: 20, borderBottomLeftRadius: 20 } : null, android && i === items.length - 1 ? { borderTopRightRadius: 20, borderBottomRightRadius: 20 } : null]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {android && on ? <Icon name={I.check} size={14} color={c.text} /> : null}
              <T kind="foot" style={{ fontWeight: on ? '600' : '500' }}>{label}</T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function StationPicker({ mode, which, from, onPick }: { mode: ModeKey; which: 'from' | 'to'; from?: Pick; onPick: (p: Pick) => void }) {
  const c = usePalette();
  const [tab, setTab] = useState<'az' | 'dist' | 'map'>('az');
  const [q, setQ] = useState('');
  const [all, setAll] = useState<Station[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [mapSel, setMapSel] = useState<Station | null>(null);
  const listRef = useRef<FlatList<any>>(null);
  const isBus = mode === 'bus';
  const color = modeColor[mode];

  useEffect(() => {
    if (isBus) return;
    stationsFor(mode).then((l) => setAll(l.filter((x) => !from || x[0] !== from.id).sort((x, y) => stName(x[1]).localeCompare(stName(y[1]))))).catch((e) => setErr(String(e.message || e)));
  }, [mode, isBus, from]);

  useEffect(() => {
    if (tab !== 'dist' || coords) return;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { setLocErr('Allow location to sort by distance, or use A to Z or the map.'); return; }
        const pos = (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null)) || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch (e: any) { setLocErr('Location is not available right now.'); }
    })();
  }, [tab, coords]);

  const ql = q.trim().toLowerCase();
  const list = useMemo(() => (all || []).filter((x) => !ql || x[1].toLowerCase().split(/[\s,()]+/).some((w) => w.startsWith(ql)) || x[1].toLowerCase().includes(ql)), [all, ql]);
  const rows = useMemo(() => {
    const out: ({ t: 'h'; k: string } | { t: 's'; s: Station })[] = [];
    let last = '';
    for (const x of list) { const L = stName(x[1]).charAt(0).toUpperCase(); if (L !== last) { out.push({ t: 'h', k: L }); last = L; } out.push({ t: 's', s: x }); }
    return out;
  }, [list]);
  const offsets = useMemo(() => { let y = 0; return rows.map((r) => { const o = y; y += r.t === 'h' ? HEAD_H : ROW_H; return o; }); }, [rows]);
  const letters = useMemo(() => rows.map((r, i) => (r.t === 'h' ? { k: r.k, i } : null)).filter(Boolean) as { k: string; i: number }[], [rows]);
  const headerIdx = useMemo(() => letters.map((l) => l.i), [letters]);

  // Index bar: drag along the letters to jump.
  const barH = useRef(0);
  const lastL = useRef('');
  const jump = (y: number) => {
    if (!letters.length || !barH.current) return;
    const i = Math.max(0, Math.min(letters.length - 1, Math.floor((y / barH.current) * letters.length)));
    const L = letters[i];
    if (L.k !== lastL.current) { lastL.current = L.k; Haptics.selectionAsync(); listRef.current?.scrollToOffset({ offset: offsets[L.i], animated: false }); }
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => jump(e.nativeEvent.locationY),
    onPanResponderMove: (e) => jump(e.nativeEvent.locationY),
    onPanResponderRelease: () => { lastL.current = ''; },
  }), [letters, offsets]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (x: Station) => onPick({ id: x[0], name: x[1] });
  const prompt = which === 'from' ? `Where do you get on the ${modeName(mode).toLowerCase()}?` : `From ${stName(shortName(from?.name))}. Where do you get off?`;

  const head = (
    <View style={{ backgroundColor: c.bg, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 10, marginBottom: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Icon name={modeIconName(mode)} size={15} color="#fff" /></View>
        <T kind="sub" tone="text2" style={{ flex: 1 }}>{prompt}</T>
      </View>
      {isBus ? null : <Segments value={tab} items={[['az', 'A to Z'], ['dist', 'By distance'], ['map', 'By map']]} onChange={(k) => setTab(k as any)} />}
      {tab === 'map' && !isBus ? null : (
        <View style={[s.search, { backgroundColor: c.fill, borderRadius: Platform.OS === 'android' ? 24 : 10 }]}>
          <Icon name={I.search} size={16} color={c.text2} />
          <TextInput value={q} onChangeText={setQ} placeholder={isBus ? 'Route number or stop name' : `Filter ${modeName(mode).toLowerCase()} stations`} placeholderTextColor={c.text2}
            autoCorrect={false} autoCapitalize={isBus ? 'characters' : 'none'} clearButtonMode="while-editing" accessibilityLabel="Filter"
            style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 8 : 7, marginLeft: 6 }, Platform.OS === 'web' ? ({ outlineWidth: 0 } as any) : null]} />
        </View>
      )}
    </View>
  );

  if (isBus) return <View style={{ flex: 1, backgroundColor: c.bg }}>{head}<BusPicker q={q} from={from} onPick={onPick} /></View>;
  if (err) return <View style={{ flex: 1, backgroundColor: c.bg }}>{head}<T kind="sub" tone="text2" style={s.note}>{err}</T></View>;
  if (!all) return <View style={{ flex: 1, backgroundColor: c.bg }}>{head}<ActivityIndicator style={{ marginTop: 30 }} color={c.tint} /></View>;

  const stationRow = (x: Station, sub?: string) => (
    <Pressable onPress={() => choose(x)} android_ripple={{ color: c.fill }} accessibilityRole="button"
      style={({ pressed }) => [s.stRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card, borderBottomColor: c.sep }]}>
      <T kind="body" numberOfLines={1} style={{ flex: 1 }}>{stName(x[1])}</T>
      {sub ? <T kind="foot" tone="text2">{sub}</T> : null}
    </Pressable>
  );

  if (tab === 'dist') {
    const near = coords ? list.map((x) => ({ x, d: geoDist(coords.lat, coords.lon, x[2], x[3]) })).sort((p, r) => p.d - r.d).slice(0, 40) : [];
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {head}
        {!coords ? <T kind="sub" tone="text2" style={s.note}>{locErr || 'Finding where you are'}</T> : (
          <FlatList data={near} keyExtractor={(o) => o.x[0]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => <View style={{ marginHorizontal: 16 }}>{stationRow(item.x, item.d < 1000 ? `${Math.round(item.d / 10) * 10} m` : `${(item.d / 1000).toFixed(1)} km`)}</View>} />
        )}
      </View>
    );
  }
  if (tab === 'map') {
    const syd = list.filter((x) => x[2] > -34.3 && x[2] < -33.4 && x[3] > 150.5 && x[3] < 151.45);
    const pts = (syd.length ? syd : list).map((x) => ({ id: x[0], name: x[1], lat: x[2], lon: x[3], mine: mapSel?.[0] === x[0] }));
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {head}
        <View style={{ flex: 1, marginHorizontal: 16, borderRadius: radius, overflow: 'hidden', marginBottom: 12 }}>
          <TransitMap stops={pts} color={color} mode={mode} dark={c.dark} onStopPress={(id) => { Haptics.selectionAsync(); setMapSel(list.find((x) => x[0] === id) || null); }} />
        </View>
        <View style={[s.mapBar, { backgroundColor: c.card, borderRadius: radius }]}>
          <T kind="body" numberOfLines={1} style={{ flex: 1 }}>{mapSel ? stName(mapSel[1]) : 'Tap a station on the map'}</T>
          {mapSel ? <Button title="Choose" onPress={() => choose(mapSel)} /> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {head}
      <View style={{ flex: 1 }}>
        <FlatList ref={listRef} data={rows} keyExtractor={(r, i) => (r.t === 'h' ? 'h' + r.k : r.s[0]) + i} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          stickyHeaderIndices={headerIdx} initialNumToRender={30} contentContainerStyle={{ paddingBottom: 40 }}
          getItemLayout={(_, i) => ({ length: rows[i]?.t === 'h' ? HEAD_H : ROW_H, offset: offsets[i] || 0, index: i })}
          ListEmptyComponent={<T kind="sub" tone="text2" style={s.note}>No {modeName(mode).toLowerCase()} stations match that</T>}
          renderItem={({ item }) => item.t === 'h'
            ? <View style={{ height: HEAD_H, justifyContent: 'center', paddingHorizontal: 32, backgroundColor: c.bg }}><T kind="foot" tone="text2" style={{ fontWeight: '600' }}>{item.k}</T></View>
            : <View style={{ marginLeft: 16, marginRight: 30 }}>{stationRow(item.s)}</View>} />
        {letters.length > 1 ? (
          <View style={s.idx} onLayout={(e) => { barH.current = e.nativeEvent.layout.height; }} {...pan.panHandlers} accessible={false}>
            {letters.map((l) => <T key={l.k} kind="caption" style={{ color: c.tint, fontWeight: '600', fontSize: 11, lineHeight: 14 }}>{l.k}</T>)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function BusPicker({ q, from, onPick }: { q: string; from?: Pick; onPick: (p: Pick) => void }) {
  const c = usePalette();
  const [routes, setRoutes] = useState<Record<string, string> | null>(null);
  const [route, setRoute] = useState<{ r: string; dirs: BusDir[] } | null>(null);
  const [dir, setDir] = useState<{ r: string; d: BusDir; start: number } | null>(from?.ctx ? { r: from.ctx.route, d: from.ctx.dir, start: from.ctx.at } : null);
  const [stops, setStops] = useState<SearchItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const color = modeColor.bus;
  useEffect(() => { busRoutes().then(setRoutes).catch((e) => setErr(String(e.message || e))); }, []);
  useEffect(() => { if (q) { setRoute(null); setDir(null); } }, [q]);
  useEffect(() => {
    if (q.trim().length < 2 || !/[a-z]/i.test(q)) { setStops([]); return; }
    let live = true;
    const t = setTimeout(() => api.search(q.trim()).then((r) => live && setStops((r.items || []).slice(0, 8))).catch(() => {}), 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const openRoute = async (r: string) => {
    Haptics.selectionAsync();
    try {
      const dirs = await busRoute(r);
      if (dirs.length === 1) setDir({ r, d: dirs[0], start: -1 }); else setRoute({ r, dirs });
    } catch (e: any) { Alert.alert("Couldn't load that route", String(e?.message || e)); }
  };
  const badge = (r: string) => <View style={[s.badge, { backgroundColor: color }]}><T kind="foot" style={{ color: '#fff', fontWeight: '700' }}>{r}</T></View>;

  if (err) return <T kind="sub" tone="text2" style={s.note}>{err}</T>;
  if (dir) {
    const st = dir.d.stops.slice(dir.start + 1);
    return (
      <FlatList data={st} keyExtractor={(x, i) => x[0] + i} contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={<T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginBottom: 7, textTransform: Platform.OS === 'ios' ? 'uppercase' : 'none' }}>{dir.start >= 0 ? `Stops after ${shortName(from?.name)} on route ${dir.r}` : `Route ${dir.r} to ${shortName(dir.d.to)}`}</T>}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => onPick({ id: item[0], name: item[1], ctx: { route: dir.r, dir: dir.d, at: dir.start + 1 + index } })} android_ripple={{ color: c.fill }}
            style={({ pressed }) => [s.lineRow, { backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card, borderTopLeftRadius: index === 0 ? radius : 0, borderTopRightRadius: index === 0 ? radius : 0, borderBottomLeftRadius: index === st.length - 1 ? radius : 0, borderBottomRightRadius: index === st.length - 1 ? radius : 0 }]}>
            <View style={{ width: 24, alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ position: 'absolute', top: index === 0 ? '50%' : 0, bottom: index === st.length - 1 ? '50%' : 0, width: 4, backgroundColor: color }} />
              <View style={{ marginTop: 'auto', marginBottom: 'auto', width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: color, backgroundColor: c.card }} />
            </View>
            <T kind="body" numberOfLines={1} style={{ flex: 1, marginLeft: 10 }}>{item[1]}</T>
          </Pressable>
        )} />
    );
  }
  if (route) {
    return (
      <Screen>
        <Section title={`Route ${route.r}, which way?`} style={{ marginTop: 6 }}>
          {route.dirs.map((d, i) => (
            <View key={i}>
              {i ? <Sep inset={16} /> : null}
              <Pressable onPress={() => { Haptics.selectionAsync(); setDir({ r: route.r, d, start: -1 }); }} android_ripple={{ color: c.fill }} style={s.routeRow}>
                {badge(route.r)}
                <View style={{ flex: 1 }}>
                  <T kind="body" numberOfLines={1}>To {shortName(d.to)}</T>
                  <T kind="foot" tone="text2" numberOfLines={1}>{d.stops.length} stops, from {shortName(d.stops[0]?.[1] || '')}</T>
                </View>
                <Icon name={I.chevron} size={14} color={c.text3} />
              </Pressable>
            </View>
          ))}
        </Section>
      </Screen>
    );
  }
  if (!routes) return <ActivityIndicator style={{ marginTop: 30 }} color={c.tint} />;
  const keys = Object.keys(routes).sort(natCmp);
  const up = q.trim().toUpperCase(), lo = q.trim().toLowerCase();
  const byNum = up ? keys.filter((r) => r.toUpperCase().startsWith(up)) : keys;
  const byName = up && /[a-z]{3}/i.test(q) ? keys.filter((r) => !byNum.includes(r) && routes[r].toLowerCase().includes(lo)).slice(0, 12) : [];
  const rk = [...byNum, ...byName].slice(0, up ? 40 : 400);
  const data: ({ t: 'r'; r: string } | { t: 's'; s: SearchItem } | { t: 'h'; k: string })[] = [
    ...(rk.length ? [{ t: 'h' as const, k: up ? 'Routes' : 'All routes' }] : []), ...rk.map((r) => ({ t: 'r' as const, r })),
    ...(stops.length ? [{ t: 'h' as const, k: 'Stops' }] : []), ...stops.map((x) => ({ t: 's' as const, s: x })),
  ];
  return (
    <FlatList data={data} keyExtractor={(x, i) => x.t + i} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }} initialNumToRender={24}
      ListEmptyComponent={<T kind="sub" tone="text2" style={s.note}>No routes or stops match that</T>}
      renderItem={({ item }) => item.t === 'h'
        ? <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 14, marginBottom: 7, textTransform: Platform.OS === 'ios' ? 'uppercase' : 'none' }}>{item.k}</T>
        : item.t === 'r'
          ? <Pressable onPress={() => openRoute(item.r)} android_ripple={{ color: c.fill }} style={[s.routeRow, { backgroundColor: c.card, marginHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
              {badge(item.r)}<T kind="sub" numberOfLines={1} style={{ flex: 1 }}>{routes[item.r]}</T><Icon name={I.chevron} size={14} color={c.text3} />
            </Pressable>
          : <Pressable onPress={() => onPick({ id: item.s.id, name: item.s.name })} android_ripple={{ color: c.fill }} style={[s.routeRow, { backgroundColor: c.card, marginHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.sep }]}>
              <Icon name={I.pin} size={20} color={c.tint} /><T kind="body" numberOfLines={1} style={{ flex: 1 }}>{shortName(item.s.name)}</T>
            </Pressable>} />
  );
}

const s = StyleSheet.create({
  note: { marginHorizontal: 32, marginTop: 20 },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 10, padding: 2, borderRadius: 9 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 7 },
  segOn: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 10 },
  stRow: { height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  idx: { position: 'absolute', right: 2, top: 8, bottom: 40, width: 24, alignItems: 'center', justifyContent: 'center' },
  mapBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 24, paddingHorizontal: 16, paddingVertical: 10, minHeight: 60 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, paddingVertical: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 50, marginHorizontal: 16 },
  badge: { minWidth: 44, paddingHorizontal: 7, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  connRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 34 },
  stepBtn: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 64, textAlign: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
});
