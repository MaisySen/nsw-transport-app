import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { searchFieldProps } from '@/lib/pickerCore';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { api, searchPlaces } from '@/lib/api';
import { usePalette, radius } from '@/lib/theme';
import { MODE_BY_CODE, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import { planResults } from '@/lib/homeCore';
import { isStopItem, noPlaceText, NOW, placeSubtitle, stopsAsPlaces, whenLabel, whenParams, type PlaceItem, type When } from '@/lib/planCore';
import { WhenPicker } from '@/components/WhenPicker';
import { useBusLookup } from '@/lib/busSearch';
import { badgeLook } from '@/lib/lineStyle';
import { useNow } from '@/lib/hooks';
import type { Place } from '@/lib/types';
import { Icon, I, modeIconName } from '@/components/Icon';
import { Row, Screen, Section, Sep, T, font } from '@/components/ui';

// Plan: the one place to search. Plan a trip from A to B, or look up a stop for its departures.
// Recent trips and recent stops live here (and only here), each with Clear.

type Field = 'stop' | 'from' | 'to';

// Trip ends can be any place (addresses, streets, landmarks, suburbs, stops); Departures needs a stop.
function useStopSearch(q: string, places: boolean) {
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); setFailed(false); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      const ask = places ? searchPlaces(q.trim()) : api.search(q.trim()).then((r) => ({ items: stopsAsPlaces(r.items || []), places: false }));
      ask.then((r) => { if (live) { setItems(r.items || []); setWide(r.places); setFailed(false); } })
        .catch(() => { if (live) { setItems([]); setFailed(true); } }).finally(() => live && setLoading(false));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q, places]);
  return { items, loading, failed, wide };
}

const KIND_ICON = { address: I.pin, place: I.pin, street: I.route, suburb: I.location } as const;

function Field({ label, value, placeholder, active, onFocus, onChange, inputRef, onClear }: any) {
  const c = usePalette();
  return (
    <View style={[s.field, { borderColor: active ? c.tint : 'transparent' }]}>
      <T kind="sub" tone="text2" style={{ width: 44 }}>{label}</T>
      <TextInput {...searchFieldProps} ref={inputRef} value={value} placeholder={placeholder} accessibilityLabel={label} placeholderTextColor={c.text3} onFocus={onFocus} onChangeText={onChange}
        style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 6 : 10, minHeight: 48 }]} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
      {Platform.OS === 'android' && value ? <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={onClear} hitSlop={10}><Icon name={I.close} size={18} color={c.text2} /></Pressable> : null}
    </View>
  );
}

export default function Search() {
  const c = usePalette();
  const st = useStore();
  const [mode, setMode] = useState<'trip' | 'stop'>('trip');
  const [field, setField] = useState<Field>('from');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const toRef = useRef<any>(null);
  const stopRef = useRef<any>(null);
  // Links can open this tab on stops with focus=<nonce>.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  useEffect(() => {
    if (!focus) return;
    setMode('stop'); setField('stop');
    const t = setTimeout(() => stopRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [focus]);
  const text = mode === 'stop' ? q : field === 'from' ? fromText : toText;
  const { items, loading, failed, wide } = useStopSearch(text, mode === 'trip');
  const bus = useBusLookup(text);
  // Leave now, Leave at or Arrive by, for trips planned from here.
  const [when, setWhen] = useState<When>(NOW);
  const [whenOpen, setWhenOpen] = useState(false);
  const now = useNow(30000);
  // A field that already holds a chosen stop shows no results (its text is that stop's name).
  const chosen = mode === 'trip' && (field === 'from' ? !!from : !!to);

  const pick = (it: PlaceItem) => {
    const p: Place = { id: it.id, name: it.name };
    if (isStopItem(it)) store.addRecent(p);
    if (mode === 'stop') {
      Keyboard.dismiss();
      router.push({ pathname: '/stop/[id]', params: { id: p.id, name: p.name } });
      return;
    }
    if (field === 'from') {
      setFrom(p); setFromText(shortName(p.name)); setField('to');
      if (to) go(p, to); else setTimeout(() => toRef.current?.focus(), 50);
    } else {
      setTo(p); setToText(shortName(p.name));
      if (from) go(from, p);
    }
  };
  const go = (a: Place, b: Place, w: When = when) => {
    Keyboard.dismiss();
    router.push({ pathname: '/trip', params: { from: a.id, fromName: a.name, to: b.id, toName: b.name, ...whenParams(w) } });
  };
  const clearTrips = () => { store.clearRecentTrips(); haptic.select(); };
  const removeTrip = (r: { from: Place; to: Place }, label: string) => Alert.alert(label, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecentTrip(r.from.id, r.to.id) },
  ]);
  const removeStop = (p: Place) => Alert.alert(shortName(p.name), undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove from Recent', style: 'destructive', onPress: () => store.removeRecent(p.id) },
  ]);

  const list = planResults(items, text, chosen);
  const noMatch = chosen ? null : noPlaceText(text, loading, items.length, failed, wide);
  const recentTrips = (st.recentTrips || []).slice(0, 6);
  const recentStops = (st.recents || []).slice(0, 6);
  const tripLabel = (r: { from: Place; to: Place }) => `${shortName(r.from.name).replace(/ Station$/, '')} to ${shortName(r.to.name).replace(/ Station$/, '')}`;
  return (
    <>
      <Stack.Screen options={{ title: 'Plan' }} />
      <Screen>
        <View style={[s.seg, { backgroundColor: c.fill }]} accessibilityRole="tablist">
          {(['trip', 'stop'] as const).map((m) => (
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}
              onPress={() => { setMode(m); setField(m === 'stop' ? 'stop' : from ? 'to' : 'from'); }}
              style={[s.segBtn, mode === m && { backgroundColor: c.card, shadowOpacity: 0.12 }]}>
              <T kind="sub" style={{ fontWeight: '600', color: mode === m ? c.text : c.text2 }}>{m === 'stop' ? 'Departures' : 'Trip'}</T>
            </Pressable>
          ))}
        </View>

        <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
          {mode === 'stop' ? (
            <View style={[s.field, { borderColor: 'transparent' }]}>
              <Icon name={I.search} size={17} color={c.text2} style={{ marginRight: 8 }} />
              <TextInput {...searchFieldProps} ref={stopRef} value={q} onChangeText={setQ} placeholder="Stop, station or stop number" placeholderTextColor={c.text3} autoCorrect={false}
                accessibilityLabel="Stop, station or stop number"
                style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 6 : 10, minHeight: 48 }]} clearButtonMode="while-editing" returnKeyType="search" />
              {loading ? <ActivityIndicator size="small" /> : null}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Field label="From" value={fromText} placeholder="Stop, address or place" active={field === 'from'} onFocus={() => setField('from')} onChange={(t: string) => { setFromText(t); setFrom(null); }} onClear={() => { setFromText(''); setFrom(null); setField('from'); }} />
                <Sep inset={60} />
                <Field label="To" value={toText} placeholder="Stop, address or place" inputRef={toRef} active={field === 'to'} onFocus={() => setField('to')} onChange={(t: string) => { setToText(t); setTo(null); }} onClear={() => { setToText(''); setTo(null); setField('to'); }} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Swap From and To" hitSlop={8} style={{ padding: 14 }} onPress={() => { setFrom(to); setTo(from); setFromText(toText); setToText(fromText); if (from && to) go(to, from); }}>
                <Icon name={I.swap} size={20} color={c.tint} />
              </Pressable>
            </View>
          )}
        </View>

        {mode === 'trip' ? (
          <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: c.card, borderRadius: radius, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', minHeight: 56 }}>
            <Icon name={I.access} size={18} color={c.tint} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <T kind="body">Step free</T>
              <T kind="foot" tone="text2">Only trips with lifts or level access</T>
            </View>
            <Switch value={!!st.acc} onValueChange={(v) => { store.setAcc(v); haptic.select(); }} accessibilityLabel="Step free trips only"
              trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined}
              thumbColor={Platform.OS === 'android' ? (!!st.acc ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
          </View>
        ) : null}

        {mode === 'trip' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${whenLabel(when, now)}. Change when`} onPress={() => { Keyboard.dismiss(); setWhenOpen(true); }} android_ripple={{ color: c.fill }}
            style={({ pressed }) => ({ marginHorizontal: 16, marginTop: 10, backgroundColor: pressed && Platform.OS === 'ios' ? c.fill : c.card, borderRadius: radius, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', minHeight: 52, overflow: 'hidden' })}>
            <Icon name={I.clock} size={18} color={c.tint} />
            <T kind="body" style={{ flex: 1, marginLeft: 10 }}>{whenLabel(when, now)}</T>
            {when.kind !== 'now' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Leave now instead" hitSlop={10} onPress={() => { setWhen(NOW); haptic.select(); }} style={{ marginRight: 12 }}>
                <T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Now</T>
              </Pressable>
            ) : null}
            <Icon name={I.chevron} size={13} color={c.text3} />
          </Pressable>
        ) : null}
        <WhenPicker visible={whenOpen} value={when} now={now} onClose={() => setWhenOpen(false)}
          onDone={(w) => { setWhenOpen(false); setWhen(w); if (from && to) go(from, to, w); }} />

        {!chosen && (bus.stop || bus.route) ? (
          <Section>
            {bus.stop ? (
              <Row icon={I.bus} iconBg={badgeLook(null, 'bus', null).bg} title={shortName(bus.stop.name)}
                subtitle={[`Stop ${bus.stop.id}`, bus.stop.stand].filter(Boolean).join(' \u00b7 ')}
                onPress={() => pick({ id: bus.stop!.id, name: bus.stop!.stand ? `${bus.stop!.name}, ${bus.stop!.stand}` : bus.stop!.name } as PlaceItem)} />
            ) : null}
            {bus.stop && bus.route ? <Sep inset={57} /> : null}
            {bus.route ? (
              <Row icon={I.route} iconBg={badgeLook(bus.route.line, 'bus', null).bg} title={`Route ${bus.route.line}`}
                subtitle={bus.route.ends.length ? `${bus.route.ends.map((e) => shortName(e)).join(' and ')}. Stops and live buses` : 'Stops and live buses'}
                onPress={() => { Keyboard.dismiss(); router.push({ pathname: '/route', params: { line: bus.route!.line, mode: 'bus' } }); }} />
            ) : null}
          </Section>
        ) : null}

        {list.length ? (
          <Section>
            {list.map((it, i) => {
              const modes = (it.modes || []).map((m) => MODE_BY_CODE[m]).filter(Boolean);
              const stop = isStopItem(it);
              return (
                <View key={`${it.kind || 'stop'}:${it.id}`}>
                  {i ? <Sep inset={57} /> : null}
                  <Row icon={stop ? modeIconName(modes[0]) : KIND_ICON[it.kind as keyof typeof KIND_ICON] || I.pin} iconBg={stop ? c.text2 : c.tint} title={shortName(it.name)}
                    subtitle={stop ? (it.name !== shortName(it.name) ? it.name : undefined) : placeSubtitle(it)} onPress={() => pick(it)} />
                </View>
              );
            })}
          </Section>
        ) : null}

        {noMatch ? <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }}>{noMatch}</T> : null}

        {!list.length && mode === 'trip' && from && to ? (
          <Section>
            <Row icon={I.route} iconBg={c.tint} title={`${shortName(from.name).replace(/ Station$/, '')} to ${shortName(to.name).replace(/ Station$/, '')}`} subtitle="Show this trip" onPress={() => go(from, to)} />
          </Section>
        ) : null}

        {!list.length && mode === 'trip' && recentTrips.length ? (
          <Section title="Recent trips" right={<Pressable onPress={clearTrips} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear recent trips"><T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Clear</T></Pressable>}>
            {recentTrips.map((r, i) => {
              const label = tripLabel(r);
              return (
                <View key={`${r.from.id}>${r.to.id}`}>
                  {i ? <Sep inset={57} /> : null}
                  <Row icon={I.history} iconBg={c.text3} title={label} onPress={() => go(r.from, r.to)} onLongPress={() => removeTrip(r, label)} />
                </View>
              );
            })}
          </Section>
        ) : null}

        {!list.length && mode === 'stop' && recentStops.length ? (
          <Section title="Recent stops" right={<Pressable onPress={() => { store.clearRecents(); haptic.select(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear recent stops"><T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Clear</T></Pressable>}>
            {recentStops.map((it, i) => (
              <View key={it.id}>
                {i ? <Sep inset={57} /> : null}
                <Row icon={I.clock} iconBg={c.text3} title={shortName(it.name)} onPress={() => pick(it)} onLongPress={() => removeStop(it)} />
              </View>
            ))}
          </Section>
        ) : null}

        {!list.length && ((mode === 'trip' && !recentTrips.length) || (mode === 'stop' && !recentStops.length)) ? (
          <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 18 }}>
            {mode === 'stop' ? 'Try Central, Strathfield, or a stop number like 213516.' : 'Pick where from and where to. Trips show live times and every change.'}
          </T>
        ) : null}
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 9, borderRadius: 9, shadowColor: '#000', shadowOpacity: 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52, borderLeftWidth: 0 },
});
