// "3 stops away · 4 min late" under a trip on Home and in trip rows: where the vehicle is now, from its live position
// (lib/whereNowCore.ts). Draws nothing without live data.
import { View, type ViewStyle } from 'react-native';
import { Icon, I } from './Icon';
import { T } from './ui';
import { usePalette } from '@/lib/theme';
import type { WhereNow as W } from '@/lib/whereNowCore';

export function WhereNow({ w, style }: { w: W | null; style?: ViewStyle }) {
  const c = usePalette();
  if (!w) return null;
  const late = w.late != null && w.late >= 2;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5 }, style]} accessible accessibilityLabel={w.a11y}>
      <Icon name={I.location} size={11} color={late ? c.orange : c.green} />
      <T kind="foot" numberOfLines={1} style={{ color: late ? c.lateText : c.liveText, fontWeight: '600', flexShrink: 1 }}>{w.text}</T>
    </View>
  );
}
