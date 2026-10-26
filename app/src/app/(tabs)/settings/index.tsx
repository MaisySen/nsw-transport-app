import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Switch, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { versionLine } from '@/lib/format';
import { api } from '@/lib/api';
import { useLive } from '@/lib/hooks';
import { usePalette } from '@/lib/theme';
import { daysText, shortName, todText } from '@/lib/format';
import { disablePush, enablePush, getPushState, PushState } from '@/lib/push';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haptic } from '@/lib/haptic';
import { store, useStore } from '@/lib/store';
import { FARE_TYPES } from '@/lib/fare';
import { endLive } from '@/lib/live';
import { I } from '@/components/Icon';
import { Row, Screen, Section, Sep, T } from '@/components/ui';
import { ActionSheet, type SheetAction } from '@/components/Sheet';
import { RowMenu } from '@/components/RowMenu';
import { menuOf, type MenuSpec } from '@/lib/menuCore';
import { LineStatusSection } from '@/components/LineStatus';
import { syncLiftAlerts } from '@/lib/liftAlerts';
import type { Commute } from '@/lib/types';
import { COMPANY } from '@/lib/company';
import { PRIVACY_URL, SUPPORT_URL } from '@/lib/server';
import { clearAskChat, confirmClearChat, useAskChat } from '@/lib/askChat';
import { useConfig, useFlag } from '@/lib/config';
import { setTripAlerts } from '@/lib/tripAlerts';
import { checkSubtitle, checkTitle } from '@/lib/morning';
import { clearLastHomeLocal, localLastSupported } from '@/lib/lastHome';
import { setTrackworkHeadsUp } from '@/lib/trackwork';
import { forgetPushTokens, PUSH_FORGOTTEN_KEY } from '@/lib/forgetTokens';
import { askCalendarRead, calendarReadSupported } from '@/lib/calendarLeaveBy';
import { hasSpeech } from '@/lib/nativeExtras';

/** "1.0.0 (204) · update 01a16ff7": the build on the phone and the update it runs, for support. */
function versionText() {
  try {
    return versionLine(Application.nativeApplicationVersion || Constants.expoConfig?.version, Application.nativeBuildVersion, Platform.OS === 'web' ? null : Updates.updateId);
  } catch {
    return Constants.expoConfig?.version || '1.0.0';
  }
}

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
  // Same chat as the Ask tab (lib/askChat.ts), so clearing here empties Ask at once.
  const { msgs: askMsgs } = useAskChat();
  const askCount = askMsgs.length;
  const nStops = (st.recents || []).length, nTrips = (st.recentTrips || []).length;

  const deleteServerHistory = () => Alert.alert('Delete your trip history?', 'This deletes the trips you searched for that the server keeps, and the commute suggestions made from them. Saved trips, commutes and watches stay. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete trip history', style: 'destructive', onPress: async () => {
      try {
        const r = await api.deleteHistory('history');
        const n = r.deleted?.searches ?? 0;
        haptic.success();
        Alert.alert('Done', `Deleted ${n} trip search${n === 1 ? '' : 'es'}.`);
      } catch (e: any) { Alert.alert("Couldn't delete it", e.message); }
    } },
  ]);
  const deleteAll = () => Alert.alert('Delete all your data?', 'This deletes your saved trips, starred stops, commutes, watched trips, alerts and trip history, on this phone and on the server. Alerts on this phone turn off. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete all', style: 'destructive', onPress: async () => {
      try {
        await api.deleteHistory('all');
        // The server removes morning checks with scope all too; this makes sure, and does not block.
        await api.morningDelete().catch(() => {});
      } catch (e: any) { Alert.alert("Couldn't reach the server", `${e.message} Nothing was deleted. Try again when you're online.`); return; }
      await endLive().catch(() => {});
      await disablePush().catch(() => {});
      // iPhone trip card and phone push tokens live on the push server; a server without the route is skipped.
      const tokens = await forgetPushTokens().catch(() => 'failed' as const);
      await syncLiftAlerts(false).catch(() => {});
      clearLastHomeLocal();
      setTrackworkHeadsUp(false).catch(() => {});
      store.resetAll();
      // Everything this app keeps on the phone goes, except the install's private id, device id, and the server
      // address and switches (not personal data; the widgets read the address).
      try {
        const keys = await AsyncStorage.getAllKeys();
        await AsyncStorage.multiRemove(keys.filter((k) => !['profile', 'device', 'store', 'apiBase', 'remoteConfig', PUSH_FORGOTTEN_KEY].includes(k)));
      } catch {}
      await clearAskChat();
      setPush(await getPushState());
      refresh();
      haptic.success();
      Alert.alert('All your data is deleted', tokens === 'failed' && Platform.OS === 'ios'
        ? 'This phone and the server no longer keep your trips, stops or alerts. The Lock Screen trip card and alert tokens could not be deleted just now; the server deletes them on its own within 30 days.'
        : 'This phone and the server no longer keep your trips, stops or alerts.');
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
  // iPhone: these rows open the system pull-down menu from the row (RowMenu); Android: the Material 3 menu under it.
  const commuteMenu = (cm: Commute): MenuSpec => ({ title: cm.name, message: `${shortName(cm.from.name)} to ${shortName(cm.to.name)}, ${daysText(cm.days)} around ${cm.todText}`,
    items: menuOf(commuteActions(cm).map((a) => ({ text: a.text, destructive: a.destructive, onPress: a.onPress }))) });
  const fareName = (FARE_TYPES.find((f) => f.k === (st.fareType || 'adult')) || FARE_TYPES[0]).name;
  const fareMenu = (): MenuSpec => ({ title: 'Opal fare type', message: 'Trips show an Opal fare estimate for this fare type. It is not your card\'s charge.',
    items: menuOf(FARE_TYPES.map((f) => { const on = (st.fareType || 'adult') === f.k; return { text: f.name + (on ? ' (current)' : ''), sf: on ? 'checkmark' : '', icon: on ? 'check' : 'fare', onPress: () => { haptic.select(); store.setFareType(f.k); } }; })) });
  const n = (k: number) => (k ? ` (${k})` : '');
  const dataSheet = () => ({ title: 'Privacy and data', message: 'Recent stops and trips are kept on this phone. The server keeps trips you search for 90 days, under this app\'s private id, to suggest commutes.',
    actions: [
      ...(nStops ? [{ text: `Clear recent stops${n(nStops)}`, onPress: () => { store.clearRecents(); haptic.select(); } }] : []),
      ...(nTrips ? [{ text: `Clear recent trips${n(nTrips)}`, onPress: () => { store.clearRecentTrips(); haptic.select(); } }] : []),
      ...(askCount ? [{ text: `Clear Ask chat${n(askCount)}`, onPress: () => confirmClearChat(askCount, () => { clearAskChat(); haptic.success(); },
        (w) => setSheet({ title: w.title, message: w.message, actions: [{ text: w.confirm, icon: I.trash, destructive: true, onPress: () => { clearAskChat(); haptic.success(); } }] })) }] : []),
      { text: `Email ${COMPANY.privacyEmail}`, onPress: () => { Linking.openURL(`mailto:${COMPANY.privacyEmail}`).catch(() => Alert.alert('No email app', `Write to ${COMPANY.privacyEmail}`)); } },
      { text: 'Delete my trip history on server', icon: I.trash, destructive: true, onPress: deleteServerHistory },
      { text: 'Delete all my data', icon: I.trash, destructive: true, onPress: deleteAll },
    ] });
  const dataMenu = (): MenuSpec => { const d = dataSheet(); return { title: d.title, message: d.message, items: menuOf(d.actions.map((a: SheetAction) => ({ text: a.text, destructive: a.destructive, onPress: a.onPress }))) }; };

  // Accessibility: step free trips and lift outage alerts for stations on saved trips.
  const [liftBusy, setLiftBusy] = useState(false);
  const setLift = async (on: boolean) => {
    haptic.select();
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
  const sw = (v: boolean, onChange: (v: boolean) => void, label: string, disabled?: boolean) => (
    <Switch value={v} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} trackColor={Platform.OS === 'android' ? { true: c.tint, false: c.fill } : undefined} thumbColor={Platform.OS === 'android' ? (v ? (c.dark ? '#062E6F' : '#fff') : c.text3) : undefined} />
  );

  const [canSpeak] = useState(() => hasSpeech());
  const morningOn = useFlag('morningCheck');
  // One local notification, set from Home while it is open (docs/TRACKWORK.md). Needs the DATE trigger (201 to 206).
  const twOn = useFlag('weekendTrackwork') && localLastSupported();
  const setTw = async (v: boolean) => {
    haptic.select();
    const ok = await setTrackworkHeadsUp(v);
    if (!ok) Alert.alert('Notifications are off', 'Open Settings, find Transport, and allow notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
  };
  // Alerts for my trips (lib/tripAlerts.ts): shown only when the server says it matches them (flags.tripAlerts true).
  const taOn = useConfig().flags.tripAlerts === true;
  const [taBusy, setTaBusy] = useState(false);
  const setTa = async (v: boolean) => {
    haptic.select();
    setTaBusy(true);
    const r = await setTripAlerts(v).finally(() => setTaBusy(false));
    if (!r.ok && r.reason === 'denied') Alert.alert('Notifications are off', 'Open Settings, find Transport, and allow notifications.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
    else if (!r.ok) Alert.alert('Not turned on', 'The server did not answer. Try again in a minute.');
    else if (v && r.noTrips) Alert.alert('Alerts for my trips is on', 'Add a trip on Home and its alerts start from then.');
    else if (v && r.now.length) Alert.alert('Already on your trips', r.now.slice(0, 3).map((x) => `${x.trip}: ${x.title}`).join('\n\n'));
  };
  // Calendar leave by: hidden on builds that can't read the calendar (iPhone before 208, Android before the
  // calendar module), and off until switched on here (docs/CALENDAR-LEAVE-BY.md).
  const calFlag = useFlag('calendarLeaveBy');
  const [calSupported] = useState(() => calendarReadSupported());
  const calOn = calFlag && calSupported;
  const setCal = async (v: boolean) => {
    haptic.select();
    if (!v) { store.setCalLeaveBy(false); return; }
    const r = await askCalendarRead();
    if (r.granted) { store.setCalLeaveBy(true); haptic.success(); return; }
    Alert.alert('Calendar access is off', Platform.OS === 'ios'
      ? 'To see when to leave for your events, open Settings, tap Calendars under Transport, and choose Full Access. Events are read on this phone only.'
      : 'To see when to leave for your events, open Settings and allow Calendar for Transport. Events are read on this phone only.',
      [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
  };
  const mList = st.morning || [];
  const morningSub = mList.length === 1 ? `${checkTitle(mList[0])}, ${checkSubtitle(mList[0]).split('. ')[0]}` : mList.length ? `${mList.length} checks` : 'One alert before your usual trip, only if something is wrong';
  const pl = st.places || {};
  const homeWork = pl.home || pl.work ? [pl.home ? `Home ${shortName(pl.home.name).replace(/ Station$/, '')}` : 'No home', pl.work ? `Work ${shortName(pl.work.name).replace(/ Station$/, '')}` : 'No work'].join(', ') : 'Not set';
  const pushWord = push?.status === 'on' ? 'On' : push?.status === 'local' ? 'App open only' : push?.status === 'denied' ? 'Blocked' : 'Off';
  const pushOff = !push || push.status === 'off' || push.status === 'denied';

  return (
    <>
      <Stack.Screen options={{ title: 'More' }} />
      <Screen>
        <Section footer="Simple mode opens the app on one plain screen: From, To and your places, then a list of trips and big simple steps.">
          <Row icon={I.list} iconBg={c.green} title="Simple mode" subtitle="One screen: from here to there" chevron={false}
            right={sw(!!st.simple, (v) => { haptic.select(); store.setSimple(v); if (v) router.replace('/simple'); }, 'Simple mode')} />
        </Section>

        <Section>
          <Row icon={I.home} iconBg={c.tint} title="Home and work" subtitle={homeWork} onPress={() => router.push({ pathname: '/welcome', params: { edit: '1' } })} />
          {morningOn ? (
            <>
              <Sep inset={57} />
              <Row icon={I.clock} iconBg={c.green} title="Check my trip before I go" subtitle={morningSub} onPress={() => router.push('/morning')} />
            </>
          ) : null}
          <Sep inset={57} />
          <Row icon={I.bell} iconBg={c.indigo} title="Watching" right={data?.watching ? <T kind="body" tone="text2">{String(data.watching)}</T> : undefined} onPress={() => router.push('/watching')} />
          <Sep inset={57} />
          <Row icon={I.car} iconBg="#0A84FF" title="Car parks" subtitle="Park and Ride, live spaces" onPress={() => router.push('/parking')} />
          <Sep inset={57} />
          <Row icon={I.fare} iconBg={c.indigo} title="Opal top up machines" onPress={() => router.push('/topup')} />
        </Section>

        <LineStatusSection />

        {data?.commutes.length ? (
          <Section title="Commutes">
            {data.commutes.map((cm, i) => (
              <View key={cm.id}>
                {i ? <Sep inset={57} /> : null}
                <RowMenu icon={I.clock} sf="clock" iconBg={c.indigo} title={cm.name} subtitle={`${daysText(cm.days)}, ${cm.todText}`} menu={commuteMenu(cm)}
                  right={<Switch value={cm.active} onValueChange={(v) => api.saveCommute({ ...cm, active: v }).then(refresh)} accessibilityLabel={`${cm.name} alerts`} />} />
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Settings" footer={push?.status === 'local' ? 'Alerts show while Transport is open.' : push?.status === 'denied' ? 'Turn on notifications for Transport in your phone settings.' : undefined}>
          <Row icon={I.bell} iconBg={c.red} title={busy ? 'Turning on' : 'Notifications'} right={<T kind="body" tone="text2">{pushWord}</T>}
            onPress={pushOff ? (push?.status === 'denied' ? () => Linking.openSettings() : turnOn) : push?.status === 'on' ? test : undefined} chevron={pushOff} />
          {canSpeak ? (
            <>
              <Sep inset={57} />
              <Row icon={I.speaker} iconBg={c.indigo} title="Voice" subtitle="For trip guidance and Speak departures" right={<T kind="body" tone="text2">{st.voiceId ? 'Chosen' : 'Automatic'}</T>} onPress={() => router.push('/voice')} />
            </>
          ) : null}
          <Sep inset={57} />
          <Row icon={I.access} iconBg={c.tint} title="Accessible trips" subtitle="Step free trips only" chevron={false}
            right={sw(!!st.acc, (v) => { store.setAcc(v); haptic.select(); }, 'Accessible trips')} />
          <Sep inset={57} />
          <Row icon={I.bell} iconBg={c.orange} title="Lift outage alerts" subtitle="Stations on your saved trips" chevron={false}
            right={liftBusy ? <ActivityIndicator size="small" color={c.tint} /> : sw(!!st.liftAlerts, setLift, 'Lift outage alerts')} />
          {twOn ? (
            <>
              <Sep inset={57} />
              <Row icon={I.warn} iconBg={c.orange} title="Weekend trackwork heads up" subtitle="Thursday 6pm, only when work touches your trips" chevron={false}
                right={sw(!!st.twHeadsUp, setTw, 'Weekend trackwork heads up')} />
            </>
          ) : null}
          {taOn ? (
            <>
              <Sep inset={57} />
              <Row icon={I.warn} iconBg={c.red} title="Alerts for my trips" subtitle="Only delays and work on the trips on Home, near when you travel" chevron={false}
                right={taBusy ? <ActivityIndicator size="small" color={c.tint} /> : sw(!!st.tripAlerts, setTa, 'Alerts for my trips')} />
            </>
          ) : null}
          {calOn ? (
            <>
              <Sep inset={57} />
              <Row icon={I.calendar} iconBg={c.red} title="Calendar leave by" subtitle="When to leave for events with a place. Read on this phone only" chevron={false}
                right={sw(!!st.calLeaveBy, setCal, 'Calendar leave by')} />
            </>
          ) : null}
          <Sep inset={57} />
          <RowMenu icon={I.fare} sf="creditcard" iconBg={c.green} title="Opal fare type" value={fareName} menu={fareMenu()} />
          <Sep inset={57} />
          <RowMenu icon={I.trash} sf="trash" iconBg={c.text2} title="Privacy and data" menu={dataMenu()} />
        </Section>

        <Section title="About" footer={`Transport: Sydney Live is made by Fintex Australia Pty Ltd. Data from Transport for NSW (CC BY 4.0) and OpenStreetMap contributors. Not made or endorsed by Transport for NSW.\n\u00A9 ${new Date().getFullYear()} Fintex Australia Pty Ltd`}>
          <Row title="Made by" right={<T kind="body" tone="text2">Fintex Australia Pty Ltd</T>} chevron={false} />
          <Sep />
          <Row title="Contact us" subtitle={COMPANY.email} onPress={() => Linking.openURL(`mailto:${COMPANY.email}`).catch(() => Alert.alert('No email app', `Write to ${COMPANY.email}`))} accessibilityHint="Opens your email app" />
          <Sep />
          <Row title="Fintex website" subtitle={COMPANY.site.replace('https://', '')} onPress={() => Linking.openURL(COMPANY.site).catch(() => {})} accessibilityHint="Opens in your browser" />
          <Sep />
          <Row title="Help and support" onPress={() => Linking.openURL(SUPPORT_URL).catch(() => {})} />
          <Sep />
          <Row title="Privacy policy" onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} />
          <Sep />
          <Row title="Version" right={<T kind="body" tone="text2" selectable>{versionText()}</T>} chevron={false} />
        </Section>
      </Screen>
      <ActionSheet visible={!!sheet} title={sheet?.title} message={sheet?.message} actions={sheet?.actions || []} onClose={() => setSheet(null)} />
    </>
  );
}
