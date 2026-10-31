// Reminders on a saved trip: several per trip, each at a time on chosen weekdays. They ring on the phone
// (weekly local notifications, reminders.ts) and open the trip with live times. Asks for notifications only
// when the first reminder is saved.
import { useEffect, useState } from 'react';
import { Animated, Alert, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SHEET_RADIUS, SheetGrabber, useSheetDrag } from './EditorSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSides } from '@/lib/layout';
import { haptic } from '@/lib/haptic';
import { radius, usePalette, androidLook } from '@/lib/theme';
import { from12, to12 } from '@/lib/planCore';
import { DAY_LONG, DAY_NAMES, MAX_PER_TRIP, newReminder, reminderText, type Reminder } from '@/lib/reminderCore';
import { remindersSupported, setTripReminders, useTripReminders } from '@/lib/reminders';
import { HALVES, HOURS, HOURS24, ITEM, MINUTES, Wheel } from './WhenPicker';
import { phone24h } from '@/lib/rowTime';
import { Icon, I } from './Icon';
import { Sep, T } from './ui';
import { useReduceMotion } from '@/lib/motion';

const ORDER = [2, 3, 4, 5, 6, 7, 1]; // Mon first, as Sydney calendars show the week

export function TripReminders({ tripKey, name, open, suggest }: { tripKey: string; name: string; open: Record<string, string>; suggest?: { hour: number; minute: number } | null }) {
  const c = usePalette();
  const list = useTripReminders(tripKey);
  const [edit, setEdit] = useState<{ r: Reminder; isNew: boolean } | null>(null);
  if (!remindersSupported()) return null;

  const save = async (next: Reminder[]) => {
    const res = await setTripReminders(tripKey, name, open, next);
    if (res.ok) { haptic.success(); return true; }
    if (res.reason === 'denied') {
      Alert.alert('Notifications are off', 'Turn on notifications for Transport in Settings to get trip reminders.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
      ]);
    } else Alert.alert("Couldn't set the reminder", 'Try again in a moment.');
    return false;
  };
  const add = () => { haptic.tap(); setEdit({ r: newReminder(`r${Date.now().toString(36)}`, suggest), isNew: true }); };

  return (
    <View style={{ marginHorizontal: 16, marginTop: 18 }}>
      <T kind="foot" tone="text2" style={{ textTransform: androidLook ? 'none' : 'uppercase', marginLeft: 16, marginBottom: 6, fontWeight: '600', letterSpacing: 0.4 }} accessibilityRole="header">Reminders</T>
      <View style={{ backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
        {list.map((r, i) => (
          <View key={r.id}>
            {i ? <Sep inset={52} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Reminder ${reminderText(r)}`} accessibilityHint="Change or delete this reminder"
              android_ripple={{ color: c.fill }} onPress={() => { haptic.tap(); setEdit({ r, isNew: false }); }}
              style={({ pressed }) => [st.row, { backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card }]}>
              <Icon name={I.bell} size={18} color={c.tint} />
              <View style={{ flex: 1, marginLeft: 16 }}>
                <T kind="body" style={{ fontVariant: ['tabular-nums'] }}>{reminderText(r).split(', ')[0]}</T>
                <T kind="foot" tone="text2">{reminderText(r).split(', ').slice(1).join(', ')}</T>
              </View>
              <Icon name={I.chevron} size={12} color={c.text3} />
            </Pressable>
          </View>
        ))}
        {list.length < MAX_PER_TRIP ? (
          <>
            {list.length ? <Sep inset={52} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={list.length ? 'Add another reminder' : 'Add a reminder'} android_ripple={{ color: c.fill }} onPress={add}
              style={({ pressed }) => [st.row, { backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card }]}>
              <Icon name={I.bellPlus} size={18} color={c.tint} />
              <T kind="body" tone="tint" style={{ flex: 1, marginLeft: 16 }}>{list.length ? 'Add another reminder' : 'Add a reminder'}</T>
            </Pressable>
          </>
        ) : null}
      </View>
      <T kind="foot" tone="text2" style={{ marginHorizontal: 16, marginTop: 6 }}>
        {list.length ? 'Rings on this phone on the days you chose, and opens this trip with live times.' : 'Get a nudge to check this trip, at a time and on the days you choose.'}
      </T>
      <ReminderSheet value={edit?.r || null} isNew={!!edit?.isNew} onClose={() => setEdit(null)}
        onSave={async (r) => { const next = edit?.isNew ? [...list, r] : list.map((x) => (x.id === r.id ? r : x)); if (await save(next)) setEdit(null); }}
        onDelete={async (r) => { if (await save(list.filter((x) => x.id !== r.id))) setEdit(null); }} />
    </View>
  );
}

function ReminderSheet({ value, isNew, onClose, onSave, onDelete }: { value: Reminder | null; isNew: boolean; onClose: () => void; onSave: (r: Reminder) => void; onDelete: (r: Reminder) => void }) {
  const c = usePalette();
  // Reduce Motion: the sheet fades in instead of sliding up.
  const still = useReduceMotion();
  const ins = useSafeAreaInsets();
  const side = useSides();
  const ios = Platform.OS === 'ios';
  // A drag down on the grabber or the title bar closes the sheet, as a native sheet does.
  const drag = useSheetDrag(onClose);
  const [h, setH] = useState(7);
  const [m, setM] = useState(30);
  const [days, setDays] = useState<number[]>([]);
  useEffect(() => {
    if (!value) return;
    setH(value.hour); setM(MINUTES.includes(value.minute) ? value.minute : Math.round(value.minute / 5) * 5 % 60); setDays(value.days);
  }, [value]);
  if (!value) return null;
  const { h12, pm } = to12(h);
  // The phone's 24-Hour Time setting: one 00 to 23 hour wheel and no am/pm wheel, as the system picker does (1 Nov).
  const h24 = phone24h();
  const toggle = (d: number) => { haptic.select(); setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]); };
  const done = () => { if (!days.length) return; haptic.select(); onSave({ id: value.id, hour: h, minute: m, days: [...days].sort((a, b) => a - b) }); };
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={ios ? { height: ITEM, borderRadius: 10, backgroundColor: c.fill, marginHorizontal: 12 } : { height: ITEM, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.tint, marginHorizontal: 24 }} />
        </View>
        {h24 ? <Wheel label="Hour" width={72} values={HOURS24} value={h} text={(v) => String(v).padStart(2, '0')} onChange={setH} /> : <Wheel label="Hour" width={72} values={HOURS} value={h12} text={(v) => String(v)} onChange={(v) => setH(from12(v, pm))} />}
        <T kind="title3" style={{ fontSize: 22 }}>:</T>
        <Wheel label="Minute" width={72} values={MINUTES} value={m} text={(v) => String(v).padStart(2, '0')} onChange={setM} />
        {h24 ? null : <Wheel label="Morning or afternoon" width={72} values={HALVES} value={pm ? 1 : 0} text={(v) => (v ? 'pm' : 'am')} onChange={(v) => setH(from12(h12, !!v))} />}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14, paddingHorizontal: 12 }}>
        {ORDER.map((d) => {
          const on = days.includes(d);
          return (
            <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={DAY_LONG[d - 1]} onPress={() => toggle(d)} hitSlop={2}
              style={[st.day, { backgroundColor: on ? c.tint : c.fill }]}>
              <T kind="foot" style={{ fontWeight: '700', color: on ? (c.dark && !ios ? '#062E6F' : '#fff') : c.text }}>{DAY_NAMES[d - 1].slice(0, 2)}</T>
            </Pressable>
          );
        })}
      </View>
      <T kind="foot" tone={days.length ? 'text2' : 'lateText'} style={{ textAlign: 'center', marginTop: 8 }} accessibilityLiveRegion="polite">
        {days.length ? reminderText({ id: '', hour: h, minute: m, days }) : 'Choose at least one day'}
      </T>
      {!isNew ? (
        <Pressable accessibilityRole="button" onPress={() => { haptic.tap(); onDelete(value); }} style={{ alignSelf: 'center', marginTop: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 }}>
          <T kind="body" style={{ color: c.red }}>Delete reminder</T>
        </Pressable>
      ) : null}
    </>
  );
  return (
    <Modal visible transparent animationType={ios && !still ? 'slide' : 'fade'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[st.wrap, !ios && { justifyContent: 'center' }]}>
        <Pressable accessibilityRole="button" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} onPress={onClose} accessibilityLabel="Close" />
        {ios ? (
          <Animated.View style={[st.sheet, { marginLeft: side.left, marginRight: side.right, backgroundColor: c.card, paddingBottom: Math.max(ins.bottom, 16) }, drag.style]}>
            <View {...drag.handlers}>
              <SheetGrabber onClose={onClose} />
              <View style={st.bar}>
                <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}><T kind="body" tone="tint">Cancel</T></Pressable>
                <T kind="headline" accessibilityRole="header">{isNew ? 'New reminder' : 'Reminder'}</T>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: !days.length }} onPress={done} hitSlop={10}><T kind="body" tone={days.length ? 'tint' : 'text3'} style={{ fontWeight: '600' }}>Save</T></Pressable>
              </View>
            </View>
            {body}
          </Animated.View>
        ) : (
          <View style={[st.dialog, { backgroundColor: c.dark ? '#22262E' : '#F3F5FA' }]}>
            <T kind="title3" accessibilityRole="header" style={{ fontSize: 24, marginHorizontal: 24, marginTop: 24 }}>{isNew ? 'New reminder' : 'Reminder'}</T>
            {body}
            <View style={st.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} android_ripple={{ color: c.fill }} style={st.textBtn}><T kind="sub" tone="tint" style={{ fontWeight: '600' }}>Cancel</T></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !days.length }} onPress={done} android_ripple={{ color: c.fill }} style={st.textBtn}><T kind="sub" tone={days.length ? 'tint' : 'text3'} style={{ fontWeight: '600' }}>Save</T></Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, paddingVertical: 8 },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, paddingBottom: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  dialog: { marginHorizontal: 24, borderRadius: 28, paddingBottom: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  textBtn: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
});
