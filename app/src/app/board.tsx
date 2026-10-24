import { useEffect } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useLive, useNow } from '@/lib/hooks';
import { cacheKey, offlineText } from '@/lib/offlineCore';
import { boardRows, rowsThatFit } from '@/lib/boardCore';
import { modeColor, onColor, usePalette } from '@/lib/theme';
import { clock, shortName } from '@/lib/format';
import { haptic } from '@/lib/haptic';
import { Icon, I } from '@/components/Icon';

const TAG = 'departure-board';

/** Keeps the screen on while the board is open. Builds without the keep awake module just skip it. */
function useStayAwake() {
  useEffect(() => {
    let mod: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-keep-awake');
      mod.activateKeepAwakeAsync(TAG).catch(() => {});
    } catch { mod = null; }
    return () => { try { mod?.deactivateKeepAwake(TAG); } catch {} };
  }, []);
}

export default function Board() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const c = usePalette();
  const now = useNow(1000);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  useStayAwake();
  const { data, error, offlineAt } = useLive((r) => api.departures(String(id), r), 15000, [id], { cacheKey: cacheKey('dep', String(id)) });
  const big = wide ? Math.min(64, Math.max(40, height / 7)) : Math.min(56, Math.max(36, width / 8));
  const rowH = big * 1.75;
  const rows = boardRows(data?.items || [], now, rowsThatFit(height - insets.top - insets.bottom, rowH, big * 2.4));
  const title = shortName(data?.stop?.name || (name ? String(name) : 'Departures')).replace(/ Station$/, '');
  const close = () => { haptic.tap(); router.back(); };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden />
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close departure board"
          style={({ pressed }) => [s.close, { backgroundColor: c.fill, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={I.close} size={18} color={c.text} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flex: 1, marginLeft: 14, color: c.text, fontSize: big * 0.6, fontWeight: '700' }}>{title}</Text>
        <Text maxFontSizeMultiplier={1.2} style={{ color: c.text2, fontSize: big * 0.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{clock(now)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: offlineAt || (error && !data) ? c.orange : c.green, marginRight: 6 }} />
        <Text maxFontSizeMultiplier={1.3} style={{ color: c.text2, fontSize: 15 }}>
          {offlineAt ? offlineText(offlineAt, now) : !data ? (error ? 'Live times unavailable right now, trying again' : 'Loading live times') : 'Live times, updated every 15 seconds'}
        </Text>
      </View>
      {data && !rows.length ? <Text style={{ color: c.text2, fontSize: big * 0.5, marginTop: big }}>{offlineAt ? 'No kept times left' : 'No more services right now'}</Text> : null}
      {rows.map((r, i) => {
        const bg = r.color || modeColor[r.mode || 'bus'] || '#888888';
        const fg = onColor(bg);
        return (
          <View key={r.key + i} accessible accessibilityLabel={r.a11y} style={[s.row, { height: rowH, borderTopColor: c.sep, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
            <View style={[s.badge, { backgroundColor: bg, minWidth: big * 1.6, height: big * 1.1, borderRadius: big * 0.22 }]}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1} style={{ color: fg, fontSize: big * 0.55, fontWeight: '800' }}>{r.line}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: big * 0.35 }}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1} style={{ color: r.cancelled ? c.text3 : c.text, fontSize: big * 0.62, fontWeight: '600', textDecorationLine: r.cancelled ? 'line-through' : 'none' }}>{r.dest}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                {r.platform ? <Text maxFontSizeMultiplier={1} style={{ color: c.text2, fontSize: big * 0.36, fontWeight: '600', marginRight: 12 }}>{r.platform}</Text> : null}
                {r.cancelled ? <Text maxFontSizeMultiplier={1} style={{ color: c.redText, fontSize: big * 0.36, fontWeight: '600' }}>Cancelled</Text>
                  : r.live ? <><View style={{ width: big * 0.16, height: big * 0.16, borderRadius: big, backgroundColor: c.green, marginRight: 5 }} /><Text maxFontSizeMultiplier={1} style={{ color: c.liveText, fontSize: big * 0.36, fontWeight: '600' }}>Live</Text></>
                  : <><Icon name={I.clock} size={big * 0.32} color={c.text2} /><Text maxFontSizeMultiplier={1} style={{ color: c.text2, fontSize: big * 0.36, marginLeft: 4 }}>Timetable</Text></>}
              </View>
            </View>
            <Text maxFontSizeMultiplier={1} style={{ color: r.cancelled ? c.text3 : r.live ? c.liveText : c.text, fontSize: big, fontWeight: '700', fontVariant: ['tabular-nums'], marginLeft: 12 }}>
              {r.when}{r.unit ? <Text style={{ fontSize: big * 0.42, fontWeight: '600' }}> {r.unit}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});
