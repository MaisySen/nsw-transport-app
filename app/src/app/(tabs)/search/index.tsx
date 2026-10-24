import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import { api } from '@/lib/api';
import { usePalette, radius } from '@/lib/theme';
import { MODE_BY_CODE, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import type { Place, SearchItem } from '@/lib/types';
import { Icon, I, modeIconName } from '@/components/Icon';
import { Row, Screen, Section, Sep, T, font } from '@/components/ui';

// Plan: the one place to search. Plan a trip from A to B, or look up a stop for its departures.
// Recent trips and recent stops live here (and only here), each with Clear.

type Field = 'stop' | 'from' | 'to';

function useStopSearch(q: string) {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q.trim()).then((r) => { if (live) setItems(r.items || []); }).catch(() => {}).finally(() => live && setLoading(false));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return { items, loading };
}

function Field({ label, value, placeholder, active, onFocus, onChange, inputRef, onClear }: any) {
  const c = usePalette();
  return (
    <View style={[s.field, { borderColor: active ? c.tint : 'transparent' }]}>
      <T kind="sub" tone="text2" style={{ width: 44 }}>{label}</T>
      <TextInput ref={inputRef} value={value} placeholder={placeholder} placeholderTextColor={c.text3} onFocus={onFocus} onChangeText={onChange}
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
  const { items, loading } = useStopSearch(text);

  const pick = (p: Place) => {
    store.addRecent(p);
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
  const go = (a: Place, b: Place) => {
    Keyboard.dismiss();
    router.push({ pathname: '/trip', params: { from: a.id, fromName: a.name, to: b.id, toName: b.name } });
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

  const list = text.trim().length >= 2 ? items : [];
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
              <TextInput ref={stopRef} value={q} onChangeText={setQ} placeholder="Stop, station or stop number" placeholderTextColor={c.text3} autoCorrect={false}
                accessibilityLabel="Stop, station or stop number"
                style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 6 : 10, minHeight: 48 }]} clearButtonMode="while-editing" returnKeyType="search" />
              {loading ? <ActivityIndicator size="small" /> : null}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Field label="From" value={fromText} placeholder="Where from" active={field === 'from'} onFocus={() => setField('from')} onChange={(t: string) => { setFromText(t); setFrom(null); }} onClear={() => { setFromText(''); setFrom(null); setField('from'); }} />
                <Sep inset={60} />
                <Field label="To" value={toText} placeholder="Where to" inputRef={toRef} active={field === 'to'} onFocus={() => setField('to')} onChange={(t: string) => { setToText(t); setTo(null); }} onClear={() => { setToText(''); setTo(null); setField('to'); }} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Swap From and To" hitSlop={8} style={{ padding: 14 }} onPress={() => { setFrom(to); setTo(from); setFromText(toText); setToText(fromText); if (from && to) go(to, from); }}>
                <Icon name={I.swap} size={20} color={c.tint} />
              </Pressable>
            </View>
          )}
        </View>

        {list.length ? (
          <Section>
            {list.map((it, i) => {
              const modes = (it.modes || []).map((m) => MODE_BY_CODE[m]).filter(Boolean);
              return (
                <View key={it.id}>
                  {i ? <Sep inset={57} /> : null}
                  <Row icon={modeIconName(modes[0])} iconBg={c.text2} title={shortName(it.name)} subtitle={it.name !== shortName(it.name) ? it.name : undefined} onPress={() => pick(it)} />
                </View>
              );
            })}
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
