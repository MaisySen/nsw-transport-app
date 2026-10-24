import { useEffect, useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { daysText, shortName, todText } from '@/lib/format';
import { enablePush, getPushState, PushState } from '@/lib/push';
import { I } from '@/components/Icon';
import { Row, Screen, Section, Sep, T } from '@/components/ui';
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
  const editCommute = (cm: Commute) => {
    const move = (d: number) => api.saveCommute({ ...cm, tod: (cm.tod + d + 1440) % 1440 }).then(refresh);
    Alert.alert(cm.name, `${shortName(cm.from.name)} to ${shortName(cm.to.name)}, ${daysText(cm.days)} around ${cm.todText}`, [
      { text: `Earlier (${todText((cm.tod - 15 + 1440) % 1440)})`, onPress: () => move(-15) },
      { text: `Later (${todText((cm.tod + 15) % 1440)})`, onPress: () => move(15) },
      { text: cm.days === '12345' ? 'Every day' : 'Weekdays only', onPress: () => api.saveCommute({ ...cm, days: cm.days === '12345' ? '1234567' : '12345' }).then(refresh) },
      { text: 'Delete', style: 'destructive', onPress: () => api.deleteCommute(cm.id).then(refresh) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
    </>
  );
}
