// Notifications on Home (25 Oct, 7 PM): alerts, weekend trackwork, line problems and extra watched trips as one row of
// small chips under the commute card, closed until tapped. A tap opens that chip's full text in place; a second tap
// closes it. Replaces the alert banner, "N alerts on your trips", the trackwork card and the line chips above the card.
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { usePalette, radius } from '@/lib/theme';
import { haptic } from '@/lib/haptic';
import { safeUrl } from '@/lib/access';
import { useTripLines } from '@/lib/myLines';
import { useTrackwork, useTrackworkHeadsUp } from '@/lib/trackwork';
import { trackworkRows } from '@/lib/trackworkCore';
import { noticeChips, type Notice, type NoticeItem } from '@/lib/noticesCore';
import { useHighAlerts, useTripAlerts } from './Home';
import { useLineRows } from './LineStatus';
import { LineBadge } from './Transit';
import { Icon, I } from './Icon';
import { Sep, T } from './ui';

const web = Platform.OS === 'web';

export function Notices({ now, watches }: { now: number; watches: { id: string; title: string; sub: string }[] }) {
  const c = usePalette();
  const high = useHighAlerts();
  const tripAlerts = useTripAlerts();
  const trips = useTripLines();
  const tw = useTrackwork(trips, now);
  useTrackworkHeadsUp(trips, now);
  const lines = useLineRows(now, 8);
  const chips = noticeChips({ high, tripAlerts, trackwork: trackworkRows(tw, trips), lines, watches });
  const [open, setOpen] = useState<string | null>(null);
  if (!chips.length) return null;
  const cur = chips.find((x) => x.key === open) || null;
  const tone = (n: Notice) => (n.tone === 'red' ? c.redText : n.tone === 'orange' ? c.lateText : c.text);
  const act = (n: Notice, it: NoticeItem, i: number) => {
    const u = safeUrl(it.url || undefined);
    if (u) return () => { Linking.openURL(u).catch(() => {}); };
    if (it.watch) return () => router.push({ pathname: '/watch/[id]', params: { id: it.watch! } });
    if (n.key === 'high' && it.trip && high[i]) return () => high[i].open();
    return undefined;
  };
  return (
    <View style={{ marginTop: 14 }}>
      <T kind="foot" tone="text2" accessibilityRole="header" style={{ marginHorizontal: 20, marginBottom: 6, fontWeight: '600' }}>Notifications</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {chips.map((n) => {
          const on = open === n.key;
          const fg = tone(n);
          return (
            <Pressable key={n.key} onPress={() => { haptic.select(); setOpen(on ? null : n.key); }}
              accessibilityRole="button" accessibilityLabel={n.a11y} accessibilityState={{ expanded: on }} accessibilityHint={on ? 'Hides the details' : 'Shows the details'}
              android_ripple={{ color: c.fill }} hitSlop={{ top: 4, bottom: 4 }} {...(web ? ({ dataSet: { chip: '1' } } as any) : {})}
              style={({ pressed }) => [st.chip, { backgroundColor: on ? c.tint + (c.dark ? '3D' : '24') : c.card, borderColor: on ? c.tint : c.sep, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
              {n.line ? <LineBadge line={n.line.line} mode={n.line.mode} color={n.line.color} />
                : <Icon name={n.key === 'watching' ? I.bell : I.warn} size={13} color={n.key === 'watching' ? c.indigo : n.key === 'trackwork' || n.key === 'alerts' ? c.orange : n.tone === 'plain' ? c.text2 : fg} />}
              <T kind="foot" numberOfLines={1} style={{ marginLeft: 6, fontWeight: '600', color: fg, maxWidth: 230 }}>{n.label}</T>
              {n.count > 1 && (n.key === 'high' || n.key === 'trackwork') ? (
                <View style={[st.count, { backgroundColor: c.fill }]}><T kind="foot" style={{ fontSize: 12, fontWeight: '700', color: c.text2 }}>{n.count}</T></View>
              ) : null}
              <Icon name={I.chevron} size={10} color={c.text3} style={{ marginLeft: 6, transform: [{ rotate: on ? '-90deg' : '90deg' }] }} />
            </Pressable>
          );
        })}
      </ScrollView>
      {cur ? (
        <View style={[st.panel, { backgroundColor: c.card }]} accessibilityLiveRegion="polite">
          {cur.items.map((it, i) => {
            const go = act(cur, it, i);
            const label = `${it.title}${it.text ? '. ' + it.text : ''}${it.extra ? '. ' + it.extra : ''}`;
            return (
              <View key={it.key}>
                {i ? <Sep inset={16} /> : null}
                <Pressable disabled={!go} onPress={go} accessibilityRole={go ? (it.watch || it.trip ? 'button' : 'link') : 'text'} accessibilityLabel={label}
                  android_ripple={go ? { color: c.fill } : undefined}
                  style={({ pressed }) => [st.item, { opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
                  <View style={{ flex: 1 }}>
                    <T kind="sub" style={{ fontWeight: it.text ? '600' : '400' }}>{it.title}</T>
                    {it.text ? <T kind="sub" tone="text2" style={{ marginTop: 2 }}>{it.text}</T> : null}
                    {it.extra ? <T kind="sub" style={{ marginTop: 2, color: c.lateText }}>{it.extra}</T> : null}
                  </View>
                  {go ? <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  count: { marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  panel: { marginHorizontal: 16, marginTop: 8, borderRadius: radius, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 },
});
