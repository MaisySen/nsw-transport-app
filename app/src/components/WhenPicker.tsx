import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SHEET_RADIUS, SheetGrabber, useSheetDrag } from './EditorSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import { haptic } from '@/lib/haptic';
import { usePalette } from '@/lib/theme';
import { defaultClock, from12, isTomorrow, NOW, snapMinute, to12, wrapStep, type When } from '@/lib/planCore';
import { Segmented } from './Segmented';
import { T } from './ui';
import { useReduceMotion } from '@/lib/motion';
import { phone24h } from '@/lib/rowTime';

// Leave now, Leave at or Arrive by, with a time wheel. Built in JS (no native picker), so it works on every
// installed build: an iOS style wheel in a sheet with Cancel and Done, a Material 3 dialog style on Android.

export const ITEM = 44;
const ROWS = 5;
export const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
export const HALVES = [0, 1];
/** The hour wheel on a 24 hour phone. */
export const HOURS24 = Array.from({ length: 24 }, (_, i) => i);

export function Wheel({ values, value, onChange, text, label, width }: { values: number[]; value: number; onChange: (v: number) => void; text: (v: number) => string; label: string; width: number }) {
  const c = usePalette();
  const ref = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idx = Math.max(0, values.indexOf(value));
  // Reduce Motion: the wheel jumps to the value instead of scrolling to it.
  const still = useReduceMotion();
  const scrollTo = (i: number, animated: boolean) => ref.current?.scrollTo({ x: 0, y: i * ITEM, animated: animated && !still });
  useEffect(() => { scrollTo(idx, true); }, [idx]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const settle = (y: number) => {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(y / ITEM)));
    if (values[i] !== value) { haptic.select(); onChange(values[i]); }
    if (Math.abs(y - i * ITEM) > 1) scrollTo(i, true);
  };
  return (
    <View style={{ width, height: ITEM * ROWS }} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: text(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(wrapStep(value, values, e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
      <ScrollView ref={ref} showsVerticalScrollIndicator={false} snapToInterval={ITEM} decelerationRate="fast" scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: ITEM * Math.floor(ROWS / 2) }}
        onLayout={() => scrollTo(idx, false)}
        onScroll={(e) => { const y = e.nativeEvent.contentOffset.y; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => settle(y), 140); }}>
        {values.map((v) => (
          <Pressable accessibilityRole="button" key={v} onPress={() => { if (v !== value) { haptic.select(); onChange(v); } }} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no">
            <T kind="title3" style={{ fontSize: 22, fontVariant: ['tabular-nums'], color: v === value ? c.text : c.text3, fontWeight: v === value ? '600' : '400' }}>{text(v)}</T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const KINDS: { k: When['kind']; label: string }[] = [{ k: 'now', label: 'Now' }, { k: 'leave', label: 'Leave at' }, { k: 'arrive', label: 'Arrive by' }];

/** `days`: the trip screen's day row (Today, Tomorrow, then dates); without it the day follows from the time. */
/** `kinds` and `nowText`: the stop board uses Now and From (no Arrive by), with its own words for Now; `dayNote`
 * replaces the Today or Tomorrow line under the wheels (the board's times stay in the service day). */
export function WhenPicker({ visible, value, now, onDone, onClose, days, kinds = KINDS, nowText = 'Trips leaving from now, with live times.', dayNote }: { visible: boolean; value: When; now: number; onDone: (w: When) => void; onClose: () => void; days?: { day: string; label: string; a11y: string }[]; kinds?: { k: When['kind']; label: string }[]; nowText?: string; dayNote?: (w: When) => string }) {
  const c = usePalette();
  // Reduce Motion: the sheet fades in instead of sliding up.
  const still = useReduceMotion();
  const ins = useSafeAreaInsets();
  const side = useSides();
  const ios = Platform.OS === 'ios';
  // A drag down on the grabber or the title bar closes the sheet, as a native sheet does.
  const drag = useSheetDrag(onClose);
  const [kind, setKind] = useState<When['kind']>(value.kind);
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [day, setDay] = useState<string>('');
  // Each opening starts from the chosen time, or the next 5 minutes when leaving now.
  useEffect(() => {
    if (!visible) return;
    const start = value.kind === 'now' ? defaultClock(now) : { h: value.h, m: snapMinute(value.m) };
    setKind(value.kind); setH(start.h); setM(start.m);
    if (days?.length) setDay(value.kind !== 'now' && value.day ? value.day : value.kind !== 'now' && isTomorrow(value, now) && days[1] ? days[1].day : days[0].day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // Arrive by starts half an hour out, the soonest arrival most trips can make.
  const choose = (k: When['kind']) => {
    const d = defaultClock(now);
    if (k === 'arrive' && h === d.h && m === d.m) { const a = defaultClock(now + 30 * 60000); setH(a.h); setM(a.m); }
    setKind(k);
  };
  const { h12, pm } = to12(h);
  // The phone's 24-Hour Time setting: one 00 to 23 hour wheel and no am/pm wheel, as the system picker does (1 Nov).
  const h24 = phone24h();
  const pick: When = kind === 'now' ? NOW : { kind, h, m, ...(days?.length && day ? { day } : {}) };
  const dayText = kind === 'now' || days?.length ? '' : dayNote ? dayNote(pick) : isTomorrow(pick, now) ? 'Tomorrow' : 'Today';
  const done = () => { haptic.select(); onDone(pick); };
  const wheels = kind === 'now' ? (
    <T kind="sub" tone="text2" style={{ textAlign: 'center', marginVertical: 24 }}>{nowText}</T>
  ) : (
    <View style={{ alignItems: 'center', marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {/* The selection band sits behind the wheels, which are drawn on top and take the touches. */}
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={ios ? { height: ITEM, borderRadius: 10, backgroundColor: c.fill, marginHorizontal: 12 } : { height: ITEM, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.tint, marginHorizontal: 24 }} />
        </View>
        {h24 ? <Wheel label="Hour" width={72} values={HOURS24} value={h} text={(v) => String(v).padStart(2, '0')} onChange={setH} /> : <Wheel label="Hour" width={72} values={HOURS} value={h12} text={(v) => String(v)} onChange={(v) => setH(from12(v, pm))} />}
        <T kind="title3" style={{ fontSize: 22 }}>:</T>
        <Wheel label="Minute" width={72} values={MINUTES} value={m} text={(v) => String(v).padStart(2, '0')} onChange={setM} />
        {h24 ? null : <Wheel label="Morning or afternoon" width={72} values={HALVES} value={pm ? 1 : 0} text={(v) => (v ? 'pm' : 'am')} onChange={(v) => setH(from12(h12, !!v))} />}
      </View>
      {dayText ? <T kind="foot" tone="text2" style={{ marginTop: 6 }} accessibilityLiveRegion="polite">{dayText}</T> : null}
      {days?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ alignSelf: 'stretch', marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityLabel="Day">
          {days.map((d) => {
            const on = d.day === day;
            return (
              <Pressable key={d.day} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={d.a11y} onPress={() => { haptic.select(); setDay(d.day); }}
                android_ripple={{ color: c.fill }}
                style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: ios ? 20 : 8, justifyContent: 'center', backgroundColor: on ? c.tint : c.fill, borderWidth: ios ? 0 : on ? 0 : 1, borderColor: c.sep, opacity: pressed ? 0.8 : 1 })}>
                <T kind="sub" style={{ color: on ? '#FFFFFF' : c.text, fontWeight: on ? '600' : '400' }}>{d.label}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType={ios && !still ? 'slide' : 'fade'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[s.wrap, !ios && { justifyContent: 'center' }]}>
        <Pressable accessibilityRole="button" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} onPress={onClose} accessibilityLabel="Close" />
        {ios ? (
          <Animated.View style={[s.sheet, { marginLeft: side.left, marginRight: side.right, backgroundColor: c.card, paddingBottom: Math.max(ins.bottom, 16) }, drag.style]}>
            <View {...drag.handlers}>
              <SheetGrabber onClose={onClose} />
              <View style={s.bar}>
                <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}><T kind="body" tone="tint">Cancel</T></Pressable>
                <T kind="headline" accessibilityRole="header">When</T>
                <Pressable accessibilityRole="button" onPress={done} hitSlop={10}><T kind="body" tone="tint" style={{ fontWeight: '600' }}>Done</T></Pressable>
              </View>
            </View>
            <Segmented value={kind} onChange={choose} options={kinds} />
            {wheels}
          </Animated.View>
        ) : (
          <View style={[s.dialog, { backgroundColor: c.dark ? '#22262E' : '#F3F5FA' }]}>
            <T kind="title3" accessibilityRole="header" style={{ fontSize: 24, marginHorizontal: 24, marginTop: 24 }}>When</T>
            <Segmented value={kind} onChange={choose} options={kinds} />
            {wheels}
            <View style={s.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} android_ripple={{ color: c.fill }} style={s.textBtn}><T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Cancel</T></Pressable>
              <Pressable accessibilityRole="button" onPress={done} android_ripple={{ color: c.fill }} style={s.textBtn}><T kind="sub" tone="tint" style={{ fontWeight: '600' }}>OK</T></Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, paddingBottom: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  dialog: { marginHorizontal: 24, borderRadius: 28, paddingBottom: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  textBtn: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
});
