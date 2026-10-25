import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, ScrollViewProps, StyleSheet, Text, TextProps, View, ViewStyle } from 'react-native';
import { androidLook, radius, usePalette } from '@/lib/theme';
import { Icon, I, IconName } from './Icon';
import { useSides } from '@/lib/layout';

export const font = {
  // System font everywhere: SF Pro on iPhone, Roboto Flex on Android.
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.35 },
  title3: { fontSize: 20, fontWeight: '600' as const, letterSpacing: 0.38 },
  headline: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.41 },
  body: { fontSize: 17, fontWeight: '400' as const, letterSpacing: -0.41 },
  callout: { fontSize: 16, fontWeight: '400' as const, letterSpacing: -0.32 },
  sub: { fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.24 },
  foot: { fontSize: 13, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption: { fontSize: 12, fontWeight: '400' as const, letterSpacing: 0 },
};

export function T({ style, kind = 'body', tone = 'text', ...p }: TextProps & { kind?: keyof typeof font; tone?: 'text' | 'text2' | 'text3' | 'tint' | 'liveText' | 'lateText' | 'red' }) {
  const c = usePalette();
  return <Text maxFontSizeMultiplier={1.6} {...p} style={[font[kind], { color: (c as any)[tone] }, style]} />;
}

export function Screen({ children, ...p }: ScrollViewProps & { children: ReactNode }) {
  const c = usePalette();
  // Clear of the side safe areas and at a readable width on a wide window (iPhone Duo, resized windows).
  const side = useSides();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // iPhone: the keyboard insets the scroll view, so results under a search field and the last rows stay reachable.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...p}
      style={[{ flex: 1, backgroundColor: c.bg }, p.style]}
      contentContainerStyle={[{ paddingBottom: 40, paddingTop: androidLook ? 8 : 0, paddingLeft: side.left, paddingRight: side.right }, p.contentContainerStyle]}
    >
      {children}
    </ScrollView>
  );
}

export function Section({ title, footer, children, right, style }: { title?: string; footer?: string; children: ReactNode; right?: ReactNode; style?: ViewStyle }) {
  const c = usePalette();
  return (
    <View style={[{ marginTop: 22, marginHorizontal: 16 }, style]}>
      {title ? (
        <View style={s.secHead}>
          <Text maxFontSizeMultiplier={1.4} style={[!androidLook ? { ...font.foot, textTransform: 'uppercase' } : { ...font.sub, fontWeight: '600' }, { color: !androidLook ? c.text2 : c.tint, flex: 1 }]}>
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      <View style={{ backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>{children}</View>
      {footer ? <T kind="foot" tone="text2" style={{ marginTop: 7, marginHorizontal: 16 }}>{footer}</T> : null}
    </View>
  );
}

export function Sep({ inset = 16 }: { inset?: number }) {
  const c = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.sep, marginLeft: inset }} />;
}

export function Row({ title, subtitle, icon, iconBg, right, onPress, chevron = !!onPress, destructive, onLongPress, accessibilityHint, accessibilityActions, onAccessibilityAction, ref }: {
  title: string; subtitle?: string; icon?: IconName; iconBg?: string; right?: ReactNode; onPress?: () => void; chevron?: boolean; destructive?: boolean; onLongPress?: () => void; accessibilityHint?: string;
  /** Passed through for a hold menu (components/HoldMenu.tsx): its rows as VoiceOver actions, and the row to drop the menu from. */
  accessibilityActions?: { name: string; label: string }[]; onAccessibilityAction?: (e: any) => void; ref?: any;
}) {
  const c = usePalette();
  return (
    <Pressable ref={ref} onPress={onPress} onLongPress={onLongPress} accessibilityActions={accessibilityActions} onAccessibilityAction={onAccessibilityAction} android_ripple={onPress ? { color: c.fill } : undefined}
      accessibilityRole={onPress ? 'button' : undefined} accessibilityHint={accessibilityHint} style={({ pressed }) => [s.row, pressed && Platform.OS === 'ios' && onPress ? { backgroundColor: c.fill } : null]}>
      {icon ? (
        <View style={[s.iconBox, { backgroundColor: iconBg || c.tint }]}>
          <Icon name={icon} size={17} color="#fff" />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T kind="body" style={destructive ? { color: c.redText } : undefined} numberOfLines={2}>{title}</T>
        {subtitle ? <T kind="foot" tone="text2" numberOfLines={2} style={{ marginTop: 2 }}>{subtitle}</T> : null}
      </View>
      {right}
      {chevron ? <Icon name={I.chevron} size={14} color={c.text3} style={{ marginLeft: 6 }} /> : null}
    </Pressable>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 36, paddingVertical: 40 }}>
      <Icon name={icon} size={44} color={c.text3} />
      <T kind="title3" style={{ marginTop: 14, textAlign: 'center' }}>{title}</T>
      {body ? <T kind="sub" tone="text2" style={{ marginTop: 6, textAlign: 'center' }}>{body}</T> : null}
      {action ? <View style={{ marginTop: 18 }}>{action}</View> : null}
    </View>
  );
}

/**
 * A filled, tinted or plain button. When onPress returns a promise, the button shows a spinner and ignores taps
 * until it settles, so a slow request can never be sent twice.
 */
export function Button({ title, onPress, kind = 'filled', icon, disabled, loading }: { title: string; onPress: () => void | Promise<unknown>; kind?: 'filled' | 'tinted' | 'plain'; icon?: IconName; disabled?: boolean; loading?: boolean }) {
  const c = usePalette();
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const busy = pending || !!loading;
  const off = !!disabled || busy;
  const bg = kind === 'filled' ? c.tint : kind === 'tinted' ? c.fill : 'transparent';
  const fg = kind === 'filled' ? (androidLook && c.dark ? '#062E6F' : '#fff') : c.tint;
  const press = () => {
    if (off) return;
    const r = onPress();
    if (r && typeof (r as any).then === 'function') {
      setPending(true);
      (r as Promise<unknown>).catch(() => {}).finally(() => { if (alive.current) setPending(false); });
    }
  };
  return (
    <Pressable disabled={off} onPress={press} android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed && Platform.OS === 'ios' ? 0.7 : 1, borderRadius: androidLook ? 24 : 12 }]}>
      {busy ? <ActivityIndicator size="small" color={fg} style={{ marginRight: 8 }} /> : icon ? <Icon name={icon} size={17} color={fg} style={{ marginRight: 7 }} /> : null}
      <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={[font.headline, { color: fg, textAlign: 'center', flexShrink: 1 }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, a11y }: { label: string; on: boolean; onPress: () => void; a11y?: string }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} hitSlop={{ top: 7, bottom: 7 }} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: on }} style={({ pressed }) => [s.chip, { backgroundColor: on ? c.tint : c.card, borderColor: on ? c.tint : c.sep, opacity: pressed && Platform.OS === 'ios' ? 0.6 : 1 }]}>
      <Text maxFontSizeMultiplier={1.4} style={[font.sub, { color: on ? (androidLook && c.dark ? '#062E6F' : '#fff') : c.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  secHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 7 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 48, gap: 12 },
  iconBox: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 8, minHeight: 50 },
  chip: { paddingHorizontal: 14, minHeight: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
