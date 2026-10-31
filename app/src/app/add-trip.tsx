import { useEffect, useRef, useState } from 'react';
import { goBack } from '@/lib/nav';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { searchFieldProps } from '@/lib/pickerCore';
import { Stack, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/lib/haptic';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useStopSearch } from '@/lib/stopSearch';
import { usePalette, radius } from '@/lib/theme';
import { MODE_BY_CODE, shortName } from '@/lib/format';
import { store, useStore } from '@/lib/store';
import type { Place } from '@/lib/types';
import { Icon, I, modeIconName } from '@/components/Icon';
import { nearbyStops, pullHome } from '@/components/Home';
import { Button, Row, Screen, Section, Sep, T, font } from '@/components/ui';
import { friendlyErr } from '@/lib/netErrCore';

type Field = 'from' | 'to';

function useNearbyIfAllowed() {
  const [items, setItems] = useState<(Place & { distance?: number })[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await Location.getForegroundPermissionsAsync();
        if (!p.granted) return;
        let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
        if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const s = await nearbyStops(pos.coords.latitude, pos.coords.longitude);
        if (alive) setItems(s);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);
  return items;
}

export default function AddTrip() {
  const c = usePalette();
  const st = useStore();
  // "Add home" and "Add work" on Home reuse this screen as a one field stop picker.
  const { place } = useLocalSearchParams<{ place?: string }>();
  const placeKind = place === 'home' || place === 'work' ? place : null;
  const [field, setField] = useState<Field>('from');
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const fromRef = useRef<any>(null);
  const toRef = useRef<any>(null);
  const text = field === 'from' ? fromText : toText;
  const { items, loading } = useStopSearch(from && to ? '' : text);
  const near = useNearbyIfAllowed();
  const ready = !!(from && to && from.id !== to.id);

  useEffect(() => { const t = setTimeout(() => fromRef.current?.focus(), 350); return () => clearTimeout(t); }, []);

  const pick = (p: Place) => {
    haptic.select();
    if (placeKind) {
      store.setPlace(placeKind, { id: p.id, name: p.name });
      Keyboard.dismiss();
      goBack();
      return;
    }
    if (field === 'from') {
      setFrom(p); setFromText(shortName(p.name));
      if (!to) { setField('to'); setTimeout(() => toRef.current?.focus(), 50); } else Keyboard.dismiss();
    } else {
      setTo(p); setToText(shortName(p.name));
      if (!from) { setField('from'); setTimeout(() => fromRef.current?.focus(), 50); } else Keyboard.dismiss();
    }
  };

  const save = async () => {
    if (!from || !to) return;
    setSaving(true);
    try {
      const n = name.trim() || `${shortName(from.name)} to ${shortName(to.name)}`;
      await api.saveTrip(n, from, to);
      haptic.success();
      pullHome();
      goBack();
    } catch (e: any) {
      Alert.alert("Couldn't save it", friendlyErr(e));
    } finally {
      setSaving(false);
    }
  };

  const list: (Place & { distance?: number; modes?: number[] })[] = text.trim().length >= 2 ? items : [];
  const showHelp = !ready && text.trim().length < 2;
  const recents = st.recents.filter((r) => r.id !== from?.id && r.id !== to?.id).slice(0, 5);

  const resultRow = (it: Place & { distance?: number; modes?: number[] }, i: number) => (
    <View key={it.id + i}>
      {i ? <Sep inset={57} /> : null}
      <Row icon={modeIconName(MODE_BY_CODE[it.modes?.[0] || 0] || 'bus')} iconBg={c.tint} title={shortName(it.name)}
        subtitle={it.distance != null ? `${it.distance < 1000 ? Math.round(it.distance / 10) * 10 + ' m' : (it.distance / 1000).toFixed(1) + ' km'}` : undefined}
        onPress={() => pick(it)} chevron={false} />
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        title: placeKind === 'home' ? 'Add home' : placeKind === 'work' ? 'Add work' : 'Add a trip',
        headerLeft: Platform.OS === 'ios' ? () => <Pressable hitSlop={13} accessibilityRole="button" onPress={() => goBack()}><T kind="body" tone="tint">Cancel</T></Pressable> : undefined,
        headerRight: placeKind ? () => null : () => (
          <Pressable hitSlop={13} accessibilityRole="button" disabled={!ready || saving} onPress={save} accessibilityLabel="Save trip">
            {saving ? <ActivityIndicator color={c.tint} /> : <T kind="headline" style={{ color: ready ? c.tint : c.text3 }}>Save</T>}
          </Pressable>
        ),
      }} />
      <Screen>
        <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
          <View style={s.fields}>
            {placeKind ? <Icon name={placeKind === 'home' ? I.home : I.briefcase} size={16} color={c.tint} style={{ marginRight: 10 }} /> : <View style={s.rail}>
              <View style={[s.dot, { borderColor: c.tint }]} />
              <View style={[s.line, { backgroundColor: c.tint }]} />
              <View style={[s.dot, { backgroundColor: c.tint, borderColor: c.tint }]} />
            </View>}
            <View style={{ flex: 1 }}>
              <TextInput {...searchFieldProps} ref={fromRef} value={fromText} placeholder={placeKind === 'home' ? 'Your home stop or station' : placeKind === 'work' ? 'Your work stop or station' : 'From'} placeholderTextColor={c.text3} onFocus={() => setField('from')}
                onChangeText={(t) => { setFromText(t); setFrom(null); }} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"
                style={[font.body, s.input, noOutline, { color: c.text, fontWeight: field === 'from' ? '600' : '400' }]} />
              {placeKind ? null : <Sep inset={0} />}
              {placeKind ? null : <TextInput {...searchFieldProps} ref={toRef} value={toText} placeholder="To" placeholderTextColor={c.text3} onFocus={() => setField('to')}
                onChangeText={(t) => { setToText(t); setTo(null); }} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"
                style={[font.body, s.input, noOutline, { color: c.text, fontWeight: field === 'to' ? '600' : '400' }]} />}
            </View>
            {placeKind ? null : <Pressable accessibilityRole="button" hitSlop={13} accessibilityLabel="Swap from and to" onPress={() => { setFrom(to); setTo(from); setFromText(toText); setToText(fromText); }} style={{ paddingLeft: 10 }}>
              <Icon name={I.swap} size={18} color={c.tint} />
            </Pressable>}
          </View>
        </View>

        {ready ? (
          <>
            <Section title="Name (optional)">
              <TextInput value={name} onChangeText={setName} placeholder={`${shortName(from!.name)} to ${shortName(to!.name)}`} placeholderTextColor={c.text3}
                style={[font.body, { color: c.text, paddingHorizontal: 16, paddingVertical: Platform.OS === 'android' ? 10 : 12 }]} returnKeyType="done" onSubmitEditing={save} />
            </Section>
            <View style={{ marginHorizontal: 16, marginTop: 20 }}>
              <Button title="Save trip" icon={I.check} onPress={save} disabled={saving} />
            </View>
            <T kind="foot" tone="text2" style={{ marginHorizontal: 32, marginTop: 10, textAlign: 'center' }}>It shows on Home with the next 3 services, live.</T>
          </>
        ) : null}

        {list.length ? <Section>{list.map(resultRow)}</Section> : null}
        {!ready && text.trim().length >= 2 && !loading && !list.length ? <T kind="sub" tone="text2" style={{ marginHorizontal: 32, marginTop: 20 }}>No stops match that</T> : null}
        {showHelp && near.length ? <Section title="Nearby">{near.map(resultRow)}</Section> : null}
        {showHelp && recents.length ? <Section title="Recent">{recents.map(resultRow)}</Section> : null}
      </Screen>
    </>
  );
}

// The browser focus ring has no place in the web preview; native fields have none.
const noOutline: any = Platform.OS === 'web' ? { outlineWidth: 0 } : null;

const s = StyleSheet.create({
  fields: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 14 },
  rail: { width: 14, alignItems: 'center', marginRight: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  line: { width: 2, height: 30 },
  input: { paddingVertical: Platform.OS === 'android' ? 12 : 13 },
});
