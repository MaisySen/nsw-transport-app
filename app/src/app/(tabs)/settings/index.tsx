import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Switch, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { daysText, shortName, todText } from '@/lib/format';
import { disablePush, enablePush, getPushState, PushState } from '@/lib/push';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { store, useStore } from '@/lib/store';
import { FARE_TYPES } from '@/lib/fare';
import { endLive } from '@/lib/live';
import { Icon, I } from '@/components/Icon';
import { Row, Screen, Section, Sep, T } from '@/components/ui';
import { ActionSheet, type SheetAction } from '@/components/Sheet';
import { syncLiftAlerts } from '@/lib/liftAlerts';
import type { Commute } from '@/lib/types';

export default function Settings() {
  const c = usePalette();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, refresh } = useLive(async () => {
    const [cm, w] = await Promise.all([api.commutes(), api.watches().catch(() => null)]);
    return { commutes: cm.items, watching: (w?.items || []).filter((x) => x.active).length };
  }, 60000);
  useEffect(() => { getPushState().then(setPush); }, []);
  const st = useStore();
  const [askCount, setAskCount] = useState(0);
  useEffect(() => { AsyncStorage.getItem('ask_chat_v1').then((v) => { try { setAskCount(v ? JSON.parse(v).length : 0); } catch {} }).catch(() => {}); }, []);
  const nStops = (st.recents || []).length, nTrips = (st.recentTrips || []).length;
  const count = (n: number) => <T kind="body" tone="text2">{n ? String(n) : 'None'}</T>;

  const deleteServerHistory = () => Alert.alert('Delete your trip history?', 'This deletes the trips you searched for that the server keeps, and the commute suggestions made from them. Saved trips, commutes and watches stay. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete trip history', style: 'destructive', onPress: async () => {
      try {
        const r = await api.deleteHistory('history');
        const n = r.deleted?.searches ?? 0;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Done', `Deleted ${n} trip search${n === 1 ? '' : 'es'}.`);
      } catch (e: any) { Alert.alert("Couldn't delete it", e.message); }
    } },
  ]);
  const deleteAll = () => Alert.alert('Delete all your data?', 'This deletes your saved trips, starred stops, commutes, watched trips, alerts and trip history, on this phone and on the server. Alerts on this phone turn off. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete all', style: 'destructive', onPress: async () => {
      try {
        await api.deleteHistory('all');
      } catch (e: any) { Alert.alert("Couldn't reach the server", `${e.message} Nothing was deleted. Try again when you're online.`); return; }
      await endLive().catch(() => {});
      await disablePush().catch(() => {});
      await syncLiftAlerts(false).catch(() => {});
      store.resetAll();
      // Everything this app keeps on the phone goes, except the install's private id and device id.
      try {
        const keys = await AsyncStorage.getAllKeys();
        await AsyncStorage.multiRemove(keys.filter((k) => k !== 'profile' && k !== 'device' && k !== 'store'));
      } catch {}
      setAskCount(0);
      setPush(await getPushState());
      refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('All your data is deleted', 'This phone and the server no longer keep your trips, stops or alerts.');
    } },
  ]);

  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush(true);
    setPush(r);
    setBusy(false);
    if (r.status === 'denied') Alert.alert('Notifications are off', 'Open Settings, find Transport, and allow notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
  };
  const test = async () => {
    try { await api.testPush(); Alert.alert('Sent', 'A test alert is on its way.'); } catch (e: any) { Alert.alert("Couldn't send", e.message); }
  };
  // Menus with more choices than an Android dialog shows go in a bottom sheet.
  const [sheet, setSheet] = useState<{ title: string; message?: string; actions: SheetAction[] } | null>(null);
  const commuteActions = (cm: Commute): SheetAction[] => {
    const move = (d: number) => api.saveCommute({ ...cm, tod: (cm.tod + d + 1440) % 1440 }).then(refresh).catch((e: any) => Alert.alert("Couldn't change it", e.message));
    return [
      { text: `Earlier (${todText((cm.tod - 15 + 1440) % 1440)})`, icon: I.up, onPress: () => move(-15) },
      { text: `Later (${todText((cm.tod + 15) % 1440)})`, icon: I.down, onPress: () => move(15) },
      { text: cm.days === '12345' ? 'Every day' : 'Weekdays only', icon: I.clock, onPress: () => api.saveCommute({ ...cm, days: cm.days === '12345' ? '1234567' : '12345' }).then(refresh).catch((e: any) => Alert.alert("Couldn't change it", e.message)) },
      { text: 'Delete', icon: I.trash, destructive: true, onPress: () => api.deleteCommute(cm.id).then(refresh).catch((e: any) => Alert.alert("Couldn't delete it", e.message)) },
    ];
  };
  const editCommute = (cm: Commute) => setSheet({ title: cm.name, message: `${shortName(cm.from.name)} to ${shortName(cm.to.name)}, ${daysText(cm.days)} around ${cm.todText}`, actions: commuteActions(cm) });
  const fareName = (FARE_TYPES.find((f) => f.k === (st.fareType || 'adult')) || FARE_TYPES[0]).name;
  const pickFare = () => setSheet({ title: 'Opal fare type', message: 'Trips show an Opal fare estimate for this fare type. It is not your card\'s charge.',
    actions: FARE_TYPES.map((f) => ({ text: f.name + ((st.fareType || 'adult') === f.k ? ' (current)' : ''), onPress: () => { Haptics.selectionAsync(); store.setFareType(f.k); } })) });
  const n = (k: number) => (k ? ` (${k})` : '');
  const dataMenu = () => setSheet({ title: 'Privacy and data', message: 'Recent stops and trips are kept on this phone. The server keeps trips you search for 90 days, under this app\'s private id, to suggest commutes.',
    actions: [
      ...(nStops ? [{ text: `Clear recent stops${n(nStops)}`, onPress: () => { store.clearRecents(); Haptics.selectionAsync(); } }] : []),
      ...(nTrips ? [{ text: `Clear recent trips${n(nTrips)}`, onPress: () => { store.clearRecentTrips(); Haptics.selectionAsync(); } }] : []),
      ...(askCount ? [{ text: `Clear Ask chat${n(askCount)}`, onPress: () => { AsyncStorage.removeItem('ask_chat_v1').catch(() => {}); setAskCount(0); Haptics.selectionAsync(); } }] : []),
      { text: 'Delete my trip history on server', icon: I.trash, destructive: true, onPress: deleteServerHistory },
      { text: 'Delete all my data', icon: I.trash, destructive: true, onPress: deleteAll },
    ] });

  // Accessibility: step free trips and lift outage alerts for stations on saved trips.
  const [liftBusy, setLiftBusy] = useState(false);
  const setLift = async (on: boolean) => {
    Haptics.selectionAsync();
    if (!on) {
      store.setLiftAlerts(false);
      syncLiftAlerts(false).catch(() => {});
      return;
    }
    setLiftBusy(true);
    try {
      let ps = push && (push.status === 'on' || push.status === 'local') ? push : await enablePush(false);
      setPush(ps);
      if (ps.status === 'denied') { Alert.alert('Notifications are off', 'Open Settings, find Transport, and allow notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]); return; }
      const r = await syncLiftAlerts(true);
      store.setLiftAlerts(true);
      const now = (r as any)?.now || [];
      Alert.alert('Lift outage alerts on', now.length ? `Out of service now on your saved trips: ${now.map((x: any) => x.title).join('. ')}.${ps.status === 'local' ? ' Alerts need the app open.' : ''}` : "No lifts are out on your saved trips right now. I'll tell you if one goes out." + (ps.status === 'local' ? ' Alerts need the app open.' : ''));
    } catch (e: any) {
      Alert.alert("Couldn't turn it on", e.message);
    } finally { setLiftBusy(false); }
  };
  const sw = (v: boolean, onChange: (v: boolean) => void, disabled?: boolean) => (
    <Switch value={v} onValueChange={onChange} disabled={disabled} trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined} thumbColor={Platform.OS === 'android' ? (v ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
  );

  const pushWord = push?.status === 'on' ? 'On' : push?.status === 'local' ? 'App open only' : push?.status === 'denied' ? 'Blocked' : 'Off';
  const pushOff = !push || push.status === 'off' || push.status === 'denied';

  return (
    <>
      <Stack.Screen options={{ title: 'More' }} />
      <Screen>
        <Section>
          <Row icon={I.bell} iconBg={c.indigo} title="Watching" right={data?.watching ? <T kind="body" tone="text2">{String(data.watching)}</T> : undefined} onPress={() => router.push('/watching')} />
          <Sep inset={57} />
          <Row icon={I.car} iconBg="#0A84FF" title="Park and Ride" onPress={() => router.push('/parking')} />
          <Sep inset={57} />
          <Row icon={I.fare} iconBg={c.indigo} title="Opal top up machines" onPress={() => router.push('/topup')} />
        </Section>

        {data?.commutes.length ? (
          <Section title="Commutes">
            {data.commutes.map((cm, i) => (
              <View key={cm.id}>
                {i ? <Sep inset={57} /> : null}
                <Row icon={I.clock} iconBg={c.indigo} title={cm.name} subtitle={`${daysText(cm.days)}, ${cm.todText}`}
                  onPress={() => editCommute(cm)} chevron={false}
                  right={<Switch value={cm.active} onValueChange={(v) => api.saveCommute({ ...cm, active: v }).then(refresh)} accessibilityLabel={`${cm.name} alerts`} />} />
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Settings" footer={push?.status === 'local' ? 'Alerts show while Transport is open.' : push?.status === 'denied' ? 'Turn on notifications for Transport in your phone settings.' : undefined}>
          <Row icon={I.bell} iconBg={c.red} title={busy ? 'Turning on' : 'Notifications'} right={<T kind="body" tone="text2">{pushWord}</T>}
            onPress={pushOff ? (push?.status === 'denied' ? () => Linking.openSettings() : turnOn) : push?.status === 'on' ? test : undefined} chevron={pushOff} />
          <Sep inset={57} />
          <Row icon={I.access} iconBg={c.tint} title="Accessible trips" subtitle="Step free trips only" chevron={false}
            right={sw(!!st.acc, (v) => { Haptics.selectionAsync(); store.setAcc(v); })} />
          <Sep inset={57} />
          <Row icon={I.bell} iconBg={c.orange} title="Lift outage alerts" subtitle="Stations on your saved trips" chevron={false}
            right={liftBusy ? <ActivityIndicator size="small" color={c.tint} /> : sw(!!st.liftAlerts, setLift)} />
          <Sep inset={57} />
          <Row icon={I.fare} iconBg={c.green} title="Opal fare type" right={<T kind="body" tone="text2">{fareName}</T>} onPress={pickFare} />
          <Sep inset={57} />
          <Row icon={I.trash} iconBg={c.text2} title="Privacy and data" onPress={dataMenu} />
        </Section>

        <Section title="About" footer="Transport: Sydney Live is provided by Fintex Australia Pty Ltd. Data from Transport for NSW (CC BY 4.0) and OpenStreetMap contributors. Not made or endorsed by Transport for NSW.">
          <Row title="Help and support" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/support/')} />
          <Sep />
          <Row title="Privacy policy" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/privacy/')} />
          <Sep />
          <Row title="Web version" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/')} />
          <Sep />
          <Row title="Version" right={<T kind="body" tone="text2">{Constants.expoConfig?.version || '1.0.0'}</T>} chevron={false} />
        </Section>
      </Screen>
      <ActionSheet visible={!!sheet} title={sheet?.title} message={sheet?.message} actions={sheet?.actions || []} onClose={() => setSheet(null)} />
    </>
  );
}
