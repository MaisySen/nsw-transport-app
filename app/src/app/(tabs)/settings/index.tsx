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

function pushText(p: PushState | null) {
  if (!p) return '';
  if (p.status === 'on') return 'On. Alerts reach you even when the app is closed.';
  if (p.status === 'local') return 'On while the app is open or in the background.';
  if (p.status === 'denied') return 'Blocked. Turn on notifications for Transport in your phone settings.';
  return 'Off';
}

export default function Settings() {
  const c = usePalette();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, refresh } = useLive(async () => {
    const [cm, sv] = await Promise.all([api.commutes(), api.saved()]);
    return { commutes: cm.items, saved: sv.items };
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
  // Commute actions: 5 choices, more than an Android dialog shows, so they go in a bottom sheet.
  const [sheet, setSheet] = useState<Commute | null>(null);
  const commuteActions = (cm: Commute): SheetAction[] => {
    const move = (d: number) => api.saveCommute({ ...cm, tod: (cm.tod + d + 1440) % 1440 }).then(refresh).catch((e: any) => Alert.alert("Couldn't change it", e.message));
    return [
      { text: `Earlier (${todText((cm.tod - 15 + 1440) % 1440)})`, icon: I.up, onPress: () => move(-15) },
      { text: `Later (${todText((cm.tod + 15) % 1440)})`, icon: I.down, onPress: () => move(15) },
      { text: cm.days === '12345' ? 'Every day' : 'Weekdays only', icon: I.clock, onPress: () => api.saveCommute({ ...cm, days: cm.days === '12345' ? '1234567' : '12345' }).then(refresh).catch((e: any) => Alert.alert("Couldn't change it", e.message)) },
      { text: 'Delete', icon: I.trash, destructive: true, onPress: () => api.deleteCommute(cm.id).then(refresh).catch((e: any) => Alert.alert("Couldn't delete it", e.message)) },
    ];
  };
  const editCommute = (cm: Commute) => setSheet(cm);

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
      Alert.alert('Lift outage alerts on', now.length ? `Out of service now on your saved trips: ${now.map((x: any) => x.title).join('. ')}.` : "No lifts are out on your saved trips right now. I'll tell you if one goes out.");
    } catch (e: any) {
      Alert.alert("Couldn't turn it on", e.message);
    } finally { setLiftBusy(false); }
  };
  const sw = (v: boolean, onChange: (v: boolean) => void, disabled?: boolean) => (
    <Switch value={v} onValueChange={onChange} disabled={disabled} trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined} thumbColor={Platform.OS === 'android' ? (v ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Screen>
        <Section title="Alerts" footer={pushText(push)}>
          {push?.status === 'on' || push?.status === 'local' ? (
            <>
              <Row icon={I.bell} iconBg={c.red} title="Notifications" right={<T kind="body" tone="text2">On</T>} chevron={false} />
              <Sep inset={57} />
              <Row icon={I.check} iconBg={c.green} title="Send a test alert" onPress={test} />
            </>
          ) : (
            <Row icon={I.bell} iconBg={c.red} title={busy ? 'Turning on' : 'Turn on alerts'} onPress={turnOn} />
          )}
        </Section>

        <Section title="Commutes" footer="A commute gets a heads up about 30 minutes before, only when something is wrong, then a leave now alert near your usual time.">
          {data?.commutes.length ? data.commutes.map((cm, i) => (
            <View key={cm.id}>
              {i ? <Sep inset={57} /> : null}
              <Row icon={I.clock} iconBg={c.indigo} title={cm.name} subtitle={`${shortName(cm.from.name)} to ${shortName(cm.to.name)} \u00b7 ${daysText(cm.days)}, ${cm.todText}`}
                onPress={() => editCommute(cm)} chevron={false}
                right={<Switch value={cm.active} onValueChange={(v) => api.saveCommute({ ...cm, active: v }).then(refresh)} />} />
            </View>
          )) : <Row title="No commutes yet" subtitle="Plan the same trip on two days and Home offers to make it your commute." chevron={false} />}
        </Section>

        <Section title="Saved trips" footer='Saved trips show live on Home. You can also text the name, like "home", to Tab on WhatsApp.'>
          {data?.saved.length ? data.saved.map((s, i) => (
            <View key={s.name}>
              {i ? <Sep inset={57} /> : null}
              <Row icon={I.route} iconBg={c.tint} title={s.name.charAt(0).toUpperCase() + s.name.slice(1)} subtitle={`${shortName(s.from.name)} to ${shortName(s.to.name)}`} chevron={false}
                onPress={() => Alert.alert(`Delete "${s.name}"?`, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => api.deleteSaved(s.name).then(refresh) }])} />
            </View>
          )) : <Row title="No saved trips" subtitle="Open a trip and tap the star to save it as Home or Work." chevron={false} />}
        </Section>

        <Section title="Accessibility" footer="Accessible trips asks the Trip Planner for step free trips only. Lift outage alerts tell you when a lift goes out at a station on your saved trips. Lift status from Transport for NSW service alerts, live.">
          <Row icon={I.access} iconBg={c.tint} title="Accessible trips" subtitle="Step free trips only, from the Trip Planner" chevron={false}
            right={sw(!!st.acc, (v) => { Haptics.selectionAsync(); store.setAcc(v); })} />
          <Sep inset={57} />
          <Row icon={I.bell} iconBg={c.red} title="Lift outage alerts" subtitle="For stations on your saved trips" chevron={false}
            right={liftBusy ? <ActivityIndicator size="small" color={c.tint} /> : sw(!!st.liftAlerts, setLift)} />
          <Sep inset={57} />
          <Row icon={I.fare} iconBg={c.indigo} title="Opal top up machines near me" onPress={() => router.push('/topup')} />
        </Section>

        <Section title="Opal fare estimates" footer="Trips show an Opal fare estimate for this fare type, worked out from the Opal fare tables: peak or off peak, transfer discount, airport station fee and daily cap. It is not your card's charge.">
          {FARE_TYPES.map((f, i) => {
            const on = (st.fareType || 'adult') === f.k;
            return (
              <View key={f.k}>
                {i ? <Sep /> : null}
                <Row title={f.name} subtitle={f.sub} chevron={false} onPress={() => { Haptics.selectionAsync(); store.setFareType(f.k); }}
                  right={on ? <Icon name={I.check} size={18} color={c.tint} /> : undefined} />
              </View>
            );
          })}
        </Section>

        <Section title="Clear history" footer="Recent stops and trips are kept only on this phone. The server keeps the trips you search for 90 days, under this app's private id, to suggest commutes. Delete them here at any time.">
          <Row title="Clear recent stops" subtitle="Stops you searched for or opened" right={count(nStops)} chevron={false}
            onPress={nStops ? () => { store.clearRecents(); Haptics.selectionAsync(); } : undefined} />
          <Sep />
          <Row title="Clear recent trips" right={count(nTrips)} chevron={false}
            onPress={nTrips ? () => { store.clearRecentTrips(); Haptics.selectionAsync(); } : undefined} />
          <Sep />
          <Row title="Clear Ask chat" right={count(askCount)} chevron={false}
            onPress={askCount ? () => { AsyncStorage.removeItem('ask_chat_v1').catch(() => {}); setAskCount(0); Haptics.selectionAsync(); } : undefined} />
          <Sep />
          <Row title="Delete my trip history on server" destructive chevron={false} onPress={deleteServerHistory} />
          <Sep />
          <Row title="Delete all my data" destructive chevron={false} onPress={deleteAll} />
        </Section>

        <Section title="About" footer="Contains transport data from Transport for NSW, licensed under Creative Commons Attribution 4.0. Map data from OpenStreetMap contributors. Transport is an independent app and is not made or endorsed by Transport for NSW. Green times are live from the vehicle, grey times are the timetable, and predictions are always labelled.">
          <Row title="Version" right={<T kind="body" tone="text2">{Constants.expoConfig?.version || '1.0.0'}</T>} chevron={false} />
          <Sep />
          <Row title="Open the web version" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/')} />
          <Sep />
          <Row title="Help and support" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/support/')} />
          <Sep />
          <Row title="Privacy policy" onPress={() => Linking.openURL('https://nsw-transport-bot.sites.tab.bot/privacy/')} />
        </Section>
      </Screen>
      <ActionSheet visible={!!sheet} title={sheet?.name}
        message={sheet ? `${shortName(sheet.from.name)} to ${shortName(sheet.to.name)}, ${daysText(sheet.days)} around ${sheet.todText}` : undefined}
        actions={sheet ? commuteActions(sheet) : []} onClose={() => setSheet(null)} />
    </>
  );
}
