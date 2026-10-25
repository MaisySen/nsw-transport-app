import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { once } from '@/lib/gesture';
import { haptic } from '@/lib/haptic';
import { IOS_MENU, M3_MENU, placeMenu, type Rect } from '@/lib/menuPlace';
import { useSolidLook } from '@/lib/cardSkin';
import { usePalette } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { T } from './ui';

export type MenuItem = { text: string; icon: IconName; onPress: () => void; destructive?: boolean };
export type { Rect };

/**
 * A menu that drops from the button that opened it. Android: a Material 3 menu (surface container, 4 dp corners,
 * elevation 3, 48 dp rows, leading icons). The web preview: the iPhone menu's shape (material blur, 13 pt corners,
 * rows with the icon on the right, separators, no Cancel). On iPhone itself the + uses the system menu (UIMenu) in
 * the navigation bar instead, see AddMenu in home/index.tsx. A tap outside closes it; the chosen action runs once
 * the menu has gone.
 */
export function AnchoredMenu({ visible, anchor, items, onClose, label, title }: { visible: boolean; anchor: Rect | null; items: MenuItem[]; onClose: () => void; label: string;
  /** The iPhone menu's small grey title (the web preview of a hold menu); Material 3 menus have none. */
  title?: string }) {
  const c = usePalette();
  const win = useWindowDimensions();
  const ins = useSafeAreaInsets();
  const solid = useSolidLook();
  const pending = useRef<(() => void) | null>(null);
  const ios = Platform.OS !== 'android';
  const spec = ios ? IOS_MENU : M3_MENU;
  const choose = (it: MenuItem) => {
    if (pending.current) return;
    const run = once(() => { pending.current = null; it.onPress(); }, 450);
    pending.current = run;
    onClose();
    haptic.select();
  };
  if (!anchor) return null;
  const head = ios && !!title;
  // The title takes about one row.
  const pos = placeMenu(anchor, { w: win.width, h: win.height }, items.length + (head ? 1 : 0), spec, { top: ins.top, bottom: ins.bottom });
  const surface = ios
    ? [m.ios, {
        backgroundColor: solid ? (c.dark ? '#2C2C2E' : '#FFFFFF') : c.dark ? 'rgba(44,44,46,0.72)' : 'rgba(255,255,255,0.72)',
        borderColor: solid ? c.sep : c.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
      }, !solid && Platform.OS === 'web' ? ({ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)' } as any) : null]
    : [m.m3, { backgroundColor: c.dark ? '#22262E' : '#F3F5FA' }];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={() => pending.current?.()} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal accessibilityLabel={label} style={[{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }, surface]}>
        {head ? <T kind="foot" tone="text2" numberOfLines={1} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, fontSize: 13 }}>{title}</T> : null}
        {items.map((it, i) => (
          <View key={it.text}>
            {ios && (i || head) ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.sep, marginLeft: 16 }} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={it.text} onPress={() => choose(it)} android_ripple={{ color: c.fill }}
              style={({ pressed }) => [ios ? m.iosRow : m.m3Row, pressed && ios ? { backgroundColor: c.fill } : null]}>
              {!ios ? <Icon name={it.icon} size={24} color={it.destructive ? c.red : c.text2} style={{ marginRight: 12 }} /> : null}
              <T kind={ios ? 'body' : 'callout'} numberOfLines={1} style={[{ flex: 1 }, !ios ? { fontSize: 14, fontWeight: '500', letterSpacing: 0.1 } : null, it.destructive ? { color: c.redText } : null]}>{it.text}</T>
              {ios ? <Icon name={it.icon} size={19} color={it.destructive ? c.red : c.text} style={{ marginLeft: 12, width: 24, alignItems: 'center' }} /> : null}
            </Pressable>
          </View>
        ))}
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  ios: { borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  iosRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 16, paddingRight: 14 },
  m3: { borderRadius: 4, paddingVertical: 8, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  m3Row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12 },
});
