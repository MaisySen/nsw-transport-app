import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { usePalette } from '@/lib/theme';
import { Icon, I } from './Icon';
import { T } from './ui';

/** Two or three choices in a row: an iOS segmented control, or Material 3 segmented buttons on Android. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { k: K; label: string }[]; onChange: (k: K) => void }) {
  const c = usePalette();
  const md = Platform.OS !== 'ios';
  return (
    <View accessibilityRole="tablist" style={[s.wrap, md ? { borderColor: c.text3, borderWidth: 1, borderRadius: 20, padding: 0 } : { backgroundColor: c.fill, borderRadius: 9, padding: 2 }]}>
      {options.map((o, i) => {
        const on = o.k === value;
        return (
          <Pressable key={o.k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { if (!on) { haptic.select(); onChange(o.k); } }}
            android_ripple={{ color: c.fill }}
            style={[s.btn, md ? { minHeight: 48, borderLeftWidth: i ? 1 : 0, borderColor: c.text3, backgroundColor: on ? (c.dark ? '#2F4A6E' : '#D6E3FF') : 'transparent', borderTopLeftRadius: i === 0 ? 20 : 0, borderBottomLeftRadius: i === 0 ? 20 : 0, borderTopRightRadius: i === options.length - 1 ? 20 : 0, borderBottomRightRadius: i === options.length - 1 ? 20 : 0 }
              : { minHeight: 32, borderRadius: 7, backgroundColor: on ? c.card : 'transparent' }]}>
            {md && on ? <Icon name={I.check} size={16} color={c.text} style={{ marginRight: 6 }} /> : null}
            <T kind="sub" style={{ fontWeight: '600' }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, overflow: 'hidden' },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
