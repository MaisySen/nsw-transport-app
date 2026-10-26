// Placeholder rows while a page of trips loads (the trip list's endless scroll): the shape of a trip row (time block,
// two lines of text) in the palette's fill colour, so the list keeps its rhythm instead of showing a spinner. A slow
// fade runs on the native driver (no JS work per frame) and only while a page is loading (the rows are gone after); with Reduce Motion
// (iOS) or Remove animations (Android) they stay still.
import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { radius, usePalette } from '@/lib/theme';
import { useReduceMotion } from '@/lib/motion';
import { Sep } from './ui';

export function SkeletonRows({ count, label }: { count: number; label: string }) {
  const c = usePalette();
  const still = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (still) { fade.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(fade, { toValue: 0.45, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, fade]);
  const bar = { backgroundColor: c.fill, borderRadius: 6 };
  return (
    <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" accessibilityRole="progressbar"
      style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
      <Animated.View style={{ opacity: fade }}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i}>
            {i > 0 ? <Sep inset={0} /> : null}
            <View style={s.row}>
              <View style={[s.block, { backgroundColor: c.fill }]} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={[bar, { height: 18, width: i % 2 ? '46%' : '58%' }]} />
                <View style={[bar, { height: 12, width: i % 2 ? '72%' : '64%', marginTop: 10 }]} />
              </View>
              <View style={[bar, { height: 18, width: 44, marginLeft: 12 }]} />
            </View>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

// The same size as a trip row (LeftRow, ServiceRow), so nothing jumps when the trips come in.
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 88 },
  block: { width: 56, alignSelf: 'stretch', minHeight: 52, borderRadius: 12 },
});
