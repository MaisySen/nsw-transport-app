// One line saying why a service is late, from its own linked Transport for NSW alert (whyLateCore.ts).
// Tapping it opens the full alert. Hidden when there is no linked reason.
import { Linking, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { usePalette } from '@/lib/theme';
import { safeUrl } from '@/lib/access';
import { haptic } from '@/lib/haptic';
import { forJourney, whyA11y, type Why } from '@/lib/whyLateCore';
import { useMemo } from 'react';
import { useWhyLate } from '@/lib/whyLate';
import type { Journey } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { T } from '@/components/ui';

export function WhyLate({ why, style, big }: { why: Why | null | undefined; style?: StyleProp<ViewStyle>; big?: boolean }) {
  const c = usePalette();
  if (!why) return null;
  const url = safeUrl(why.alert.url);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={whyA11y(why)} accessibilityHint={url ? undefined : 'No alert page for this one'}
      disabled={!url} hitSlop={{ top: 8, bottom: 8 }}
      onPress={() => { if (url) { haptic.tap(); Linking.openURL(url).catch(() => {}); } }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: big ? 28 : 22, opacity: pressed ? 0.6 : 1 }, style]}>
      <Icon name={I.warn} size={big ? 15 : 12} color={c.orange} />
      <View style={{ flex: 1, marginLeft: 5 }}>
        <T kind={big ? 'sub' : 'foot'} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.6} style={{ color: c.lateText, fontWeight: '600' }}>{why.text}</T>
      </View>
      {url ? <Icon name={I.chevron} size={11} color={c.text3} style={{ marginLeft: 4 }} /> : null}
    </Pressable>
  );
}

/**
 * A row that already is one button (Home cards, departure rows, trip legs) keeps its own label; VoiceOver and
 * TalkBack get "Why it's late" as an extra action on it, which opens the same alert as the line.
 */
export function withWhyAction<P extends { accessibilityActions?: { name: string; label: string }[]; onAccessibilityAction?: (e: any) => void }>(base: P, why?: Why | null): P {
  const url = why ? safeUrl(why.alert.url) : null;
  if (!url) return base;
  return {
    ...base,
    accessibilityActions: [...(base.accessibilityActions || []), { name: 'whyLate', label: "Why it's late" }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === 'whyLate') Linking.openURL(url).catch(() => {});
      else base.onAccessibilityAction?.(e);
    },
  };
}

/** The reason for a journey: its first transit leg that has one (a trip card shows one line, not one per leg). */
export function useJourneyWhy(j: Journey | null | undefined): Why | null {
  const legs = useMemo(() => (j ? j.legs.filter((l) => l.kind === 'transit') : []), [j]);
  const of = useWhyLate(legs);
  for (const l of legs) { const w = of(l); if (w) return forJourney(w, l.line, legs.length); }
  return null;
}

/** One reason line under a journey row on the trip screen; nothing when no leg has a linked reason. */
export function JourneyWhy({ j, style }: { j: Journey; style?: StyleProp<ViewStyle> }) {
  const why = useJourneyWhy(j);
  if (!why) return null;
  return <WhyLate why={why} style={[{ paddingLeft: 86, paddingRight: 16, paddingBottom: 10, marginTop: -4 }, style]} />;
}
