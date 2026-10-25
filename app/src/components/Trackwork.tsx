// Weekend trackwork card on Home: from Thursday 6pm to Sunday, only when planned work this weekend
// touches Home and Work or a saved trip. Each row opens Transport for NSW's page for that work. With the heads up
// switched on (More), the same check sets one notification for Thursday 6pm (docs/TRACKWORK.md).
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { usePalette, radius } from '@/lib/theme';
import { useTripLines } from '@/lib/myLines';
import { useTrackwork, useTrackworkHeadsUp } from '@/lib/trackwork';
import { trackworkRows } from '@/lib/trackworkCore';
import { safeUrl } from '@/lib/access';
import { Icon, I } from './Icon';
import { T } from './ui';

export function TrackworkCard({ now }: { now: number }) {
  const c = usePalette();
  const trips = useTripLines();
  const resp = useTrackwork(trips, now);
  useTrackworkHeadsUp(trips, now);
  const rows = trackworkRows(resp, trips);
  if (!rows.length) return null;
  return (
    <View style={[st.card, { backgroundColor: c.card, borderLeftColor: c.orange }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityRole="header">
        <Icon name={I.warn} size={15} color={c.orange} />
        <T kind="body" style={{ marginLeft: 8, fontWeight: '600', flex: 1 }}>Trackwork this weekend</T>
      </View>
      {rows.map((r) => {
        const url = safeUrl(r.url);
        const label = `${r.name}. ${r.text}${r.extra ? '. ' + r.extra : ''}`;
        return (
          <Pressable key={r.key} disabled={!url} onPress={() => { if (url) Linking.openURL(url).catch(() => {}); }}
            accessibilityRole={url ? 'link' : 'text'} accessibilityLabel={label} accessibilityHint={url ? 'Opens the details from Transport for NSW' : undefined}
            android_ripple={url ? { color: c.fill } : undefined}
            style={({ pressed }) => [st.row, { opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
            <View style={{ flex: 1 }}>
              <T kind="sub" style={{ fontWeight: '600' }} numberOfLines={1}>{r.name}</T>
              <T kind="sub" tone="text2" style={{ marginTop: 2 }}>{r.text}</T>
              {r.extra ? <T kind="sub" style={{ marginTop: 2, color: c.lateText }}>{r.extra}</T> : null}
            </View>
            {url ? <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: radius, padding: 14, paddingBottom: 6, borderLeftWidth: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, minHeight: 44 },
});
