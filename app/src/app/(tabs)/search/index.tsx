import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { usePalette, radius } from '@/lib/theme';
import { MODE_BY_CODE, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import type { Place, SearchItem } from '@/lib/types';
import { Icon, I, modeIconName } from '@/components/Icon';
import { Row, Screen, Section, Sep, T, font } from '@/components/ui';

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
        style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 6 : 10 }]} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
      {Platform.OS === 'android' && value ? <Pressable onPress={onClear} hitSlop={10}><Icon name={I.close} size={18} color={c.text2} /></Pressable> : null}
    </View>
  );
}

export default function Search() {
  const c = usePalette();
  const st = useStore();
  const [mode, setMode] = useState<'stop' | 'trip'>('stop');
  const [field, setField] = useState<Field>('stop');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [nearby, setNearby] = useState<(SearchItem & { distance?: number })[] | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const toRef = useRef<any>(null);
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
  const findNearby = async () => {
    setLocBusy(true);
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) { Alert.alert('Location is off', 'Allow location for Transport in Settings to see stops near you.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r: any = await api.nearby(pos.coords.latitude, pos.coords.longitude);
      setNearby(r.stops || []);
    } catch (e: any) { Alert.alert("Couldn't find you", String(e?.message || e)); }
    finally { setLocBusy(false); }
  };

  const list = text.trim().length >= 2 ? items : [];
  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <Screen>
        <View style={[s.seg, { backgroundColor: c.fill }]}>
          {(['stop', 'trip'] as const).map((m) => (
            <Pressable key={m} onPress={() => { setMode(m); setField(m === 'stop' ? 'stop' : from ? 'to' : 'from'); }} style={[s.segBtn, mode === m && { backgroundColor: c.dark ? c.card2 : '#fff', shadowOpacity: 0.12 }]}>
              <T kind="sub" style={{ fontWeight: '600' }}>{m === 'stop' ? 'Stops' : 'Trip planner'}</T>
            </Pressable>
          ))}
        </View>

        <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
          {mode === 'stop' ? (
            <View style={[s.field, { borderColor: 'transparent' }]}>
              <Icon name={I.search} size={17} color={c.text2} style={{ marginRight: 8 }} />
              <TextInput value={q} onChangeText={setQ} placeholder="Stop, station or stop number" placeholderTextColor={c.text3} autoCorrect={false}
                style={[font.body, { flex: 1, color: c.text, paddingVertical: Platform.OS === 'android' ? 6 : 10 }]} clearButtonMode="while-editing" returnKeyType="search" />
              {loading ? <ActivityIndicator size="small" /> : null}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Field label="From" value={fromText} placeholder="Where from" active={field === 'from'} onFocus={() => setField('from')} onChange={(t: string) => { setFromText(t); setFrom(null); }} onClear={() => { setFromText(''); setFrom(null); }} />
                <Sep inset={60} />
                <Field label="To" value={toText} placeholder="Where to" inputRef={toRef} active={field === 'to'} onFocus={() => setField('to')} onChange={(t: string) => { setToText(t); setTo(null); }} onClear={() => { setToText(''); setTo(null); }} />
              </View>
              <Pressable hitSlop={8} style={{ padding: 14 }} onPress={() => { setFrom(to); setTo(from); setFromText(toText); setToText(fromText); if (from && to) go(to, from); }}>
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

        {!list.length ? (
          <>
            <Section>
              <Row icon={I.location} iconBg={c.tint} title="Stops near me" onPress={findNearby} right={locBusy ? <ActivityIndicator size="small" /> : undefined} />
            </Section>
            {nearby?.length ? (
              <Section title="Near you">
                {nearby.slice(0, 8).map((it, i) => (
                  <View key={it.id}>
                    {i ? <Sep inset={57} /> : null}
                    <Row icon={I.pin} iconBg={c.text2} title={shortName(it.name)} subtitle={it.distance != null ? `${Math.round(it.distance)} m` : undefined} onPress={() => pick(it)} />
                  </View>
                ))}
              </Section>
            ) : null}
            {st.starred.length ? (
              <Section title="Starred">
                {st.starred.map((it, i) => (
                  <View key={it.id}>
                    {i ? <Sep inset={57} /> : null}
                    <Row icon={I.star} iconBg={c.yellow} title={shortName(it.name)} onPress={() => pick(it)} />
                  </View>
                ))}
              </Section>
            ) : null}
            {st.recents.length ? (
              <Section title="Recent" right={<Pressable onPress={store.clearRecents}><T kind="foot" tone="tint">Clear</T></Pressable>}>
                {st.recents.map((it, i) => (
                  <View key={it.id}>
                    {i ? <Sep inset={57} /> : null}
                    <Row icon={I.clock} iconBg={c.text3} title={shortName(it.name)} onPress={() => pick(it)} />
                  </View>
                ))}
              </Section>
            ) : null}
            <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 16 }}>
              {mode === 'stop' ? 'Try Central, Strathfield, or a stop number like 213516.' : 'Pick where from and where to. Trips show live leave in times and every change.'}
            </T>
          </>
        ) : null}
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, borderRadius: 9, padding: 2 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 7, shadowColor: '#000', shadowOpacity: 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, borderLeftWidth: 0 },
});
