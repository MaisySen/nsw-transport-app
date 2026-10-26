// The small "Limited stops" tag on departure rows and trip legs (lib/limitedCore.ts). A plain label, not a button:
// iPhone gets a filled capsule in the secondary label colour (Apple HIG), Android an outlined Material 3 chip shape.
import { Platform, Text, View } from 'react-native';
import { usePalette } from '@/lib/theme';
import { isLimited, LIMITED_A11Y, LIMITED_TEXT } from '@/lib/limitedCore';
import { font } from './ui';

export function LimitedTag({ x, style }: { x: { limited?: boolean | null; description?: string | null } | null | undefined; style?: any }) {
  const c = usePalette();
  if (!isLimited(x)) return null;
  const android = Platform.OS === 'android';
  return (
    <View accessible accessibilityLabel={LIMITED_A11Y}
      style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: android ? 7 : 6, paddingVertical: android ? 1 : 2, borderRadius: android ? 8 : 6 },
        android ? { borderWidth: 1, borderColor: c.sep } : { backgroundColor: c.fill }, style]}>
      <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[font.caption, { color: c.text2, fontWeight: '600' }]}>{LIMITED_TEXT}</Text>
    </View>
  );
}
