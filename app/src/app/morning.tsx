import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { keepOffline, peekOffline } from '@/lib/offline';
import { LIST_KEYS } from '@/lib/offlineCore';
import { useConfig, flagOn } from '@/lib/config';
import { haptic } from '@/lib/haptic';
import { clock } from '@/lib/format';
import { enablePush, getPushState, type PushState } from '@/lib/push';
import { store, useStore } from '@/lib/store';
import { radius, usePalette } from '@/lib/theme';
import { checkSubtitle, checkTitle, hhmm, minutesOf, DAY_SHORT, DEFAULT_LEAD, LEADS, MODES, noTargets, previewWords, stepTime, timeText, toggleDay } from '@/lib/morning';
import type { MorningCheck, MorningListResp, MorningMode, Place } from '@/lib/types';
import { Icon, I } from '@/components/Icon';
import { Button, Chip, Empty, Screen, Section, Sep, T } from '@/components/ui';

type Dir = 'toWork' | 'toHome';
type Form = { id?: string; dir: Dir; time: string; days: number[]; lead: number; mode: MorningMode | null };
type Prev = { loading?: boolean; error?: string; words?: ReturnType<typeof previewWords> };
const short = (n?: string) => String(n || '').replace(/ Station$/, '').replace(/,.*$/, '');

/** More > Check my trip before I go: one alert before the usual trip, only when something is wrong. */
export default function MorningScreen() {
  const c = usePalette();
  const st = useStore();
  const cfg = useConfig();
  const params = useLocalSearchParams<{ dir?: string }>();
  const home = st.places?.home, work = st.places?.work;
  const hasPlaces = !!(home && work && home.id !== work.id);
  // The checks kept on the phone paint the first frame (27 Oct speed pass 3); the server's list replaces them.
  const [list, setList] = useState<MorningListResp | null>(() => peekOffline<MorningListResp>(LIST_KEYS.morning)?.data ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [prev, setPrev] = useState<Record<string, Prev>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.morningList();
      setList(r); setErr(null);
      store.setMorning(r.items || []);
      keepOffline(LIST_KEYS.morning, r);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); getPushState().then(setPush).catch(() => {}); }, [load]);

  const items = list?.items || [];
  const dirOf = (m: MorningCheck): Dir => (home && m.from.id === home.id ? 'toWork' : 'toHome');
  const newForm = (dir?: Dir): Form => {
    const d: Dir = dir || (params.dir === 'toHome' ? 'toHome' : 'toWork');
    return { dir: d, time: d === 'toWork' ? '08:00' : '17:30', days: [1, 2, 3, 4, 5], lead: DEFAULT_LEAD, mode: null };
  };
  // Opened from the commute card with no check yet: start the form straight away.
  useEffect(() => { if (list && !items.length && hasPlaces && !form) setForm(newForm()); }, [list, hasPlaces]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flagOn(cfg, 'morningCheck')) {
    return (<><Stack.Screen options={{ title: 'Check before I go' }} />
      <Screen><Empty icon={I.clock} title="Not available right now" body={cfg.kill.morningCheck || 'Morning checks are switched off for the moment. Your checks are kept.'} /></Screen></>);
  }

  const ends = (d: Dir): { from: Place; to: Place } | null => (home && work ? (d === 'toWork' ? { from: home, to: work } : { from: work, to: home }) : null);

  const save = async () => {
    if (!form) return;
    const e = ends(form.dir);
    if (!e) return;
    if (!form.days.length) { setNote('Pick at least one day.'); return; }
    setBusy(true); setNote(null);
    try {
      // The server sends the alert as a push. With nowhere to send it, ask for notifications first.
      let ps = push || (await getPushState());
      if (noTargets(list?.push) && ps.status !== 'on') {
        ps = await enablePush(false);
        setPush(ps);
        if (ps.status === 'denied' || ps.status === 'off') {
          setBusy(false);
          Alert.alert('Notifications are off', 'The check sends its alert as a notification. Allow notifications for Transport in your phone settings, then save again.', [
            { text: 'Not now', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }]);
          return;
        }
      }
      const r = await api.morningSave({ ...(form.id ? { id: form.id } : {}), ...e, time: form.time, days: form.days, lead: form.lead, mode: form.mode });
      haptic.success();
      setForm(null);
      await load();
      setNote(noTargets(r.push)
        ? 'Saved. It starts sending once this phone can get alerts with Transport closed (see above).'
        : `Saved. You'll hear from it at ${checkTime(r.item)} on those days, only if something is wrong.`);
    } catch (e: any) {
      setNote(`Couldn't save it. ${e.message}`);
    } finally { setBusy(false); }
  };

  const remove = (m: MorningCheck) => Alert.alert(`Delete ${checkTitle(m)}?`, 'No more alerts for this trip.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api.morningDelete(m.id); haptic.success(); setNote('Deleted.'); if (form?.id === m.id) setForm(null); await load(); } catch (e: any) { setNote(`Couldn't delete it. ${e.message}`); }
    } },
  ]);
  const removeAll = () => Alert.alert('Delete all your checks?', 'They are removed from this phone and the server.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete all', style: 'destructive', onPress: async () => {
      try { await api.morningDelete(); haptic.success(); setForm(null); setPrev({}); setNote('All checks deleted.'); await load(); } catch (e: any) { setNote(`Couldn't delete them. ${e.message}`); }
    } },
  ]);
  const checkNow = async (m: MorningCheck) => {
    haptic.select();
    setPrev((p) => ({ ...p, [m.id]: { loading: true } }));
    try {
      const r = await api.morningPreview(m.id);
      setPrev((p) => ({ ...p, [m.id]: { words: previewWords(r, clock) } }));
    } catch (e: any) { setPrev((p) => ({ ...p, [m.id]: { error: e.message } })); }
  };

  const pushLine = noTargets(list?.push) && list
    ? push?.status === 'local'
      ? "This phone can't get alerts while Transport is closed yet. Checks are kept and start sending with the next app version. Check now works any time."
      : 'Needs notifications. Saving a check asks to turn them on.'
    : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Check before I go' }} />
      <Screen>
        <T kind="sub" tone="text2" style={{ marginHorizontal: 20, marginTop: 8 }}>
          Before your usual trip, one alert only if something is wrong: a delay over 5 min, a cancellation, trackwork, a platform change or a lift out of service. Nothing when all is fine.
        </T>
        {list && !list.enabled ? <Banner text="Morning checks are paused on the server for now. Your checks are kept." /> : null}
        {pushLine ? <Banner text={pushLine} /> : null}
        {note ? <T kind="sub" accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, marginTop: 12 }}>{note}</T> : null}

        {!hasPlaces ? (
          <Empty icon={I.home} title="Set your home and work first" body="The check uses the trip between them."
            action={<Button title="Set home and work" onPress={() => router.push({ pathname: '/welcome', params: { edit: '1' } })} />} />
        ) : null}
        {!list && !err ? <ActivityIndicator style={{ marginTop: 30 }} color={c.tint} /> : null}
        {err && !list ? <Empty icon={I.warn} title="Can't load your checks" body={err} action={<Button title="Try again" onPress={load} />} /> : null}

        {items.length ? (
          <Section title="Your checks">
            {items.map((m, i) => {
              const p = prev[m.id];
              return (
                <View key={m.id}>
                  {i ? <Sep inset={16} /> : null}
                  <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <T kind="headline">{checkTitle(m)}</T>
                    <T kind="foot" tone="text2" style={{ marginTop: 2 }}>{checkSubtitle(m)}</T>
                    {m.last?.alert ? <T kind="foot" tone="text2" style={{ marginTop: 2 }} numberOfLines={2}>Last alert: {m.last.alert.body}</T> : null}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <SmallButton label="Check now" a11y={`Check now, ${checkTitle(m)}`} icon={I.history} onPress={() => checkNow(m)} />
                      <SmallButton label="Edit" a11y={`Edit ${checkTitle(m)}`} icon={I.edit} onPress={() => { haptic.select(); setNote(null); setForm({ id: m.id, dir: dirOf(m), time: m.time, days: m.days, lead: m.lead, mode: m.mode }); }} />
                      <SmallButton label="Delete" a11y={`Delete ${checkTitle(m)}`} icon={I.trash} onPress={() => remove(m)} />
                    </View>
                    {p ? <PreviewBox p={p} /> : null}
                  </View>
                </View>
              );
            })}
          </Section>
        ) : null}

        {hasPlaces && form ? (
          <CheckForm form={form} setForm={setForm} home={home!} work={work!} busy={busy} onSave={save} onCancel={() => setForm(null)} canCancel={!!items.length || !!form.id} />
        ) : null}
        {hasPlaces && list && !form && items.length < (list.max || 6) ? (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Button title="Add a check" icon={I.plus} kind="tinted" onPress={() => { haptic.select(); setNote(null); setForm(newForm(items.some((m) => dirOf(m) === 'toWork') ? 'toHome' : 'toWork')); }} />
          </View>
        ) : null}
        {items.length ? (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <Button title="Delete all checks" kind="plain" onPress={removeAll} />
          </View>
        ) : null}
      </Screen>
    </>
  );
}

function checkTime(m: MorningCheck) {
  return timeText(hhmm(minutesOf(m.time) - m.lead));
}

function Banner({ text }: { text: string }) {
  const c = usePalette();
  return (
    <View style={[s.banner, { backgroundColor: c.card2 }]} accessible accessibilityLabel={text}>
      <Icon name={I.info} size={16} color={c.text2} />
      <T kind="foot" tone="text2" style={{ flex: 1, marginLeft: 8 }}>{text}</T>
    </View>
  );
}

function SmallButton({ label, a11y, icon, onPress }: { label: string; a11y: string; icon: typeof I.edit; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} android_ripple={{ color: c.fill }}
      style={({ pressed }) => [s.small, { backgroundColor: c.fill, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
      <Icon name={icon} size={16} color={c.tint} />
      <T kind="sub" tone="tint" style={{ marginLeft: 6, fontWeight: '600' }}>{label}</T>
    </Pressable>
  );
}

function PreviewBox({ p }: { p: Prev }) {
  const c = usePalette();
  if (p.loading) return <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={c.tint} /><T kind="foot" tone="text2">Checking live times</T></View>;
  if (p.error) return <T kind="foot" style={{ marginTop: 10, color: c.lateText }} accessibilityLiveRegion="polite">{p.error}</T>;
  const w = p.words!;
  const col = w.tone === 'issue' ? c.lateText : w.tone === 'ok' ? c.liveText : c.text2;
  return (
    <View style={[s.preview, { backgroundColor: c.bg }]} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${w.title}. ${w.lines.join(' ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={w.tone === 'issue' ? I.warn : w.tone === 'ok' ? I.check : I.info} size={15} color={w.tone === 'issue' ? c.orange : col} />
        <T kind="sub" style={{ color: col, fontWeight: '600' }}>{w.title}</T>
      </View>
      {w.lines.map((l, i) => <T key={i} kind="foot" style={{ marginTop: 4 }}>{l}</T>)}
    </View>
  );
}

function CheckForm({ form, setForm, home, work, busy, onSave, onCancel, canCancel }: {
  form: Form; setForm: (f: Form) => void; home: Place; work: Place; busy: boolean; onSave: () => void; onCancel: () => void; canCancel: boolean;
}) {
  const c = usePalette();
  const set = (p: Partial<Form>) => { haptic.select(); setForm({ ...form, ...p }); };
  const hw = `${short(home.name)} to ${short(work.name)}`, wh = `${short(work.name)} to ${short(home.name)}`;
  const later = () => set({ time: stepTime(form.time, 5) });
  const earlier = () => set({ time: stepTime(form.time, -5) });
  return (
    <Section title={form.id ? 'Edit check' : 'New check'}>
      <View style={{ padding: 16, gap: 16 }}>
        <View>
          <T kind="foot" tone="text2" style={s.label}>Trip</T>
          <View style={s.chips}>
            <Chip label={hw} on={form.dir === 'toWork'} onPress={() => set({ dir: 'toWork' })} />
            <Chip label={wh} on={form.dir === 'toHome'} onPress={() => set({ dir: 'toHome' })} />
          </View>
        </View>
        <View>
          <T kind="foot" tone="text2" style={s.label}>Usual leave time</T>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RoundButton icon={I.minus} label="5 minutes earlier" onPress={earlier} />
            <View accessible accessibilityRole="adjustable" accessibilityLabel={`Usual leave time, ${timeText(form.time)}`}
              accessibilityValue={{ min: 0, max: 1439, now: minutesOf(form.time), text: timeText(form.time) }}
              aria-valuemin={0} aria-valuemax={1439} aria-valuenow={minutesOf(form.time)} aria-valuetext={timeText(form.time)}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? later() : earlier())}
              style={{ minWidth: 120, alignItems: 'center' }}>
              <T kind="title3" style={{ fontVariant: ['tabular-nums'] }}>{timeText(form.time)}</T>
            </View>
            <RoundButton icon={I.plus} label="5 minutes later" onPress={later} />
          </View>
        </View>
        <View>
          <T kind="foot" tone="text2" style={s.label}>Days</T>
          <View style={s.chips}>
            {DAY_SHORT.map((d, i) => <Chip key={d} label={d} on={form.days.includes(i + 1)} onPress={() => set({ days: toggleDay(form.days, i + 1) })} />)}
          </View>
        </View>
        <View>
          <T kind="foot" tone="text2" style={s.label}>Check this long before</T>
          <View style={s.chips}>
            {LEADS.map((l) => <Chip key={l} label={`${l} min`} on={form.lead === l} onPress={() => set({ lead: l })} />)}
          </View>
        </View>
        <View>
          <T kind="foot" tone="text2" style={s.label}>Usually by (optional)</T>
          <View style={s.chips}>
            {MODES.map((m) => <Chip key={m.label} label={m.label} on={form.mode === m.key} onPress={() => set({ mode: m.key })} />)}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button title={busy ? 'Saving' : form.id ? 'Save changes' : 'Turn on check'} onPress={onSave} disabled={busy} /></View>
          {canCancel ? <Button title="Cancel" kind="tinted" onPress={onCancel} /> : null}
        </View>
      </View>
    </Section>
  );
}

function RoundButton({ icon, label, onPress }: { icon: typeof I.plus; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} android_ripple={{ color: c.fill, borderless: true, radius: 24 }}
      style={({ pressed }) => [s.round, { backgroundColor: c.fill, opacity: pressed && Platform.OS !== 'android' ? 0.7 : 1 }]}>
      <Icon name={icon} size={22} color={c.tint} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: radius },
  small: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, borderRadius: 24 },
  preview: { marginTop: 10, padding: 12, borderRadius: 12 },
  label: { marginBottom: 8, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, rowGap: 14 },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
