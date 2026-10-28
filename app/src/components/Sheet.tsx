import { useEffect, useRef } from 'react';
import { ActionSheetIOS, Alert, type AlertButton, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { once } from '@/lib/gesture';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import { haptic } from '@/lib/haptic';
import { usePalette } from '@/lib/theme';
import { Icon, IconName } from './Icon';
import { Sep, T } from './ui';

export type SheetAction = { text: string; icon?: IconName; destructive?: boolean; onPress: () => void };

/** The iPhone system action sheet for these actions, with Cancel last. onClose runs first, then the chosen action. */
export function showIosSheet({ title, message, actions, anchor, onClose }: { title?: string; message?: string; actions: SheetAction[]; anchor?: number | null; onClose?: () => void }) {
  const destructive = actions.map((a, i) => (a.destructive ? i : -1)).filter((i) => i >= 0);
  ActionSheetIOS.showActionSheetWithOptions({
    title, message,
    options: [...actions.map((a) => a.text), 'Cancel'],
    cancelButtonIndex: actions.length,
    ...(destructive.length ? { destructiveButtonIndex: destructive.length === 1 ? destructive[0] : destructive } : {}),
    ...(anchor ? { anchor } : {}),
  }, (i) => {
    onClose?.();
    if (i >= 0 && i < actions.length) actions[i].onPress();
  });
}

/**
 * A menu of choices (a long press on a row, Save as Home or Work): the system action sheet on iPhone, the system
 * dialog on Android and the web. Confirmations (Delete this?) stay Alert.alert.
 */
export function nativeMenu(title: string, message: string | undefined, buttons: AlertButton[], anchor?: number | null) {
  if (Platform.OS === 'ios') {
    const acts: SheetAction[] = buttons.filter((b) => b.style !== 'cancel').map((b) => ({ text: b.text || '', destructive: b.style === 'destructive', onPress: () => b.onPress?.() }));
    showIosSheet({ title, message, actions: acts, anchor });
    return;
  }
  const list = Platform.OS === 'android' && buttons.length > 3 ? buttons.filter((b) => b.style !== 'cancel') : buttons;
  Alert.alert(title, message, list, { cancelable: true });
}

/**
 * Bottom sheet with any number of actions. Android dialogs show at most 3 buttons,
 * so menus with more choices use this instead of Alert.
 */
export function ActionSheet({ visible, title, message, actions, onClose, anchor }: { visible: boolean; title?: string; message?: string; actions: SheetAction[]; onClose: () => void; anchor?: number | null }) {
  const c = usePalette();
  const ins = useSafeAreaInsets();
  const side = useSides();
  const ios = Platform.OS === 'ios';
  // iPhone and iPad: the system action sheet (Bidur, 25 Oct: the drawn sheet looked home made). With an anchor it
  // opens from that view (a popover on iPad and on iOS 26).
  useEffect(() => {
    if (!ios || !visible) return;
    showIosSheet({ title, message, actions, anchor, onClose });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // The chosen action runs once the sheet has gone (onDismiss, or 450 ms at the latest). An Android dialog
  // opened while the sheet's window is still closing can vanish with it, which felt like a dead button.
  // Above the iPhone return so every render calls the same hooks.
  const pending = useRef<(() => void) | null>(null);
  if (ios) return null;
  const choose = (a: SheetAction) => {
    if (pending.current) return;
    const run = once(() => { pending.current = null; a.onPress(); }, 450);
    pending.current = run;
    onClose();
    haptic.select();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={() => pending.current?.()} statusBarTranslucent navigationBarTranslucent>
      <View style={s.wrap}>
        <Pressable accessibilityRole="button" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { marginLeft: side.left, marginRight: side.right, backgroundColor: ios ? 'transparent' : c.dark ? '#22262E' : '#F3F5FA', paddingBottom: Math.max(ins.bottom, 12) }]}>
          {!ios ? <View style={[s.grab, { backgroundColor: c.text3 }]} /> : null}
          <View style={ios ? [s.group, { backgroundColor: c.card }] : null}>
            {title || message ? (
              <View style={{ paddingHorizontal: 20, paddingTop: ios ? 14 : 6, paddingBottom: 12, alignItems: ios ? 'center' : 'flex-start' }}>
                {title ? <T kind={ios ? 'foot' : 'headline'} tone={ios ? 'text2' : 'text'} style={ios ? { fontWeight: '600' } : null}>{title}</T> : null}
                {message ? <T kind="foot" tone="text2" style={{ marginTop: 4, textAlign: ios ? 'center' : 'left' }}>{message}</T> : null}
              </View>
            ) : null}
            {actions.map((a, i) => (
              <View key={a.text + i}>
                {ios || i ? <Sep inset={ios ? 0 : 56} /> : null}
                <Pressable accessibilityRole="button" android_ripple={{ color: c.fill }}
                  onPress={() => choose(a)}
                  style={({ pressed }) => [s.item, ios ? { justifyContent: 'center' } : null, pressed && ios ? { backgroundColor: c.fill } : null]}>
                  {a.icon && !ios ? <Icon name={a.icon} size={22} color={a.destructive ? c.red : c.text2} style={{ marginRight: 20 }} /> : null}
                  <T kind={ios ? 'body' : 'callout'} style={{ color: a.destructive ? c.redText : ios ? c.tint : c.text, fontSize: ios ? 20 : 16 }}>{a.text}</T>
                </Pressable>
              </View>
            ))}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} android_ripple={{ color: c.fill }}
            style={({ pressed }) => [s.item, ios ? [s.group, { backgroundColor: c.card, marginTop: 8, justifyContent: 'center' }] : { justifyContent: 'center', marginTop: 4 }, pressed && ios ? { opacity: 0.7 } : null]}>
            <T kind="headline" style={{ color: c.tint, fontSize: ios ? 20 : 16 }}>Cancel</T>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Platform.OS === 'ios' ? 8 : 0, paddingTop: 8 },
  grab: { width: 32, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, opacity: 0.6 },
  group: { borderRadius: 14, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 24 },
});
