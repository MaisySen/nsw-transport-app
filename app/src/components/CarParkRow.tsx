// The one car park row on a train station's screen ("Car park: 192 free of 213", updated time), when a Park and
// Ride car park belongs to the station. Nothing when it has none. Tap opens the car park (app/carpark.tsx).
import { memo, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { radius, usePalette } from '@/lib/theme';
import { parkRow, type ParkLike } from '@/lib/carparkCore';
import { Icon, I } from './Icon';
import { T } from './ui';

function CarParkRowView({ list, stop, station }: { list?: ParkLike[] | null; stop: string; station?: string | null }) {
  const c = usePalette();
  // Read once per answer: the time beside the count is when Transport for NSW read it, not a ticking clock.
  const row = useMemo(() => parkRow(list, Date.now()), [list]);
  if (!row) return null;
  const tone = row.tone === 'red' ? c.redText : row.tone === 'orange' ? c.lateText : c.text;
  return (
    <View style={[s.card, { backgroundColor: c.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={row.a11y} accessibilityHint="Opens the car park with directions"
        onPress={() => router.push({ pathname: '/carpark', params: row.single ? { id: row.single, station: station || '' } : { stop, station: station || '' } })}
        android_ripple={{ color: c.fill }} style={({ pressed }) => [s.row, pressed && Platform.OS === 'ios' ? { backgroundColor: c.fill } : null]}>
        <View style={s.sym}><Icon name={I.car} size={17} color="#fff" /></View>
        <View style={{ flex: 1 }}>
          <T kind="body" numberOfLines={2}>{row.title}: <T kind="body" style={{ color: tone, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{row.value}</T></T>
          {row.updated ? <T kind="foot" tone="text2" style={{ marginTop: 2, fontVariant: ['tabular-nums'] }}>{row.updated}</T> : null}
        </View>
        <Icon name={I.chevron} size={14} color={c.text3} />
      </Pressable>
    </View>
  );
}

export const CarParkRow = memo(CarParkRowView);

const s = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 10, borderRadius: radius, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 52 },
  sym: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A84FF' },
});
