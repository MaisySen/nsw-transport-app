// Last way home: "Remind me 15 min before" on the last service home (Ask and trip results), and the Home card
// for a reminder that is set. On the new server and iPhone the server sends one push; everywhere else the phone
// schedules its own notification and looks at live times again while the app is open (docs/LAST-WAY-HOME.md).
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '@/lib/haptic';
import { radius, usePalette } from '@/lib/theme';
import { useFlag } from '@/lib/config';
import { apiBase } from '@/lib/server';
import { getPushState, enablePush } from '@/lib/push';
import { cancelLastHome, cancelLastLocal, localLastSupported, recheckLastLocal, refreshLastHome, remindLastHome, remindLastLocal, useLastHome } from '@/lib/lastHome';
import { cardWords, chooseLastPath, LAST_HOME_LEAD, setNote, setNoteLocal, type LastHomeHint } from '@/lib/lastHomeCore';
import { useNow } from '@/lib/hooks';
import { Icon, I } from './Icon';
import { T } from './ui';

/** True when this server has the reminder and the flag is on. Unknown until the first answer, so nothing shows before it. */
export function useLastHomeOn(probe = true) {
  const on = useFlag('lastWayHome');
  const s = useLastHome();
  useEffect(() => { if (on && probe) refreshLastHome(); }, [on, probe]);
  return on && s.base === apiBase() && s.available === true;
}

/**
 * The one tap. `known` skips the server probe: Ask only sends lastHome when the server has the feature.
 * The note after it says plainly what will happen on this phone.
 */
export function RemindLastButton({ hint, known = false, acc = false }: { hint: LastHomeHint; known?: boolean; acc?: boolean }) {
  const c = usePalette();
  const flag = useFlag('lastWayHome');
  const probed = useLastHomeOn(!known);
  const s = useLastHome();
  const [busy, setBusy] = useState(false);
  const [note, setNoteText] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  // Server push where it exists (new server, iPhone), else the phone's own notification (docs/LAST-WAY-HOME.md).
  const serverKnown = known || (s.base === apiBase() && s.available !== null);
  const server = known ? !(s.base === apiBase() && s.available === false) : probed;
  const path = chooseLastPath(Platform.OS, server, localLastSupported() && !!hint.svc);
  const match = (x: { status: string; from: { id: string }; to: { id: string } } | null) => !!x && x.status === 'waiting' && x.from.id === hint.from.id && x.to.id === hint.to.id;
  const mine = path === 'local' ? (match(s.local) ? s.local : null) : match(s.item) ? s.item : null;
  const show = flag && !gone && serverKnown && !!path;
  if (!show) return null;

  const set = async () => {
    if (busy) return;
    setBusy(true); setNoteText(null);
    try {
      if (path === 'local') {
        const r = await remindLastLocal(hint, acc);
        if (r.ok) { haptic.success(); setNoteText(setNoteLocal(r.item)); }
        else if (r.denied) {
          setNoteText(r.error);
          Alert.alert('Notifications are off', 'The reminder comes as a notification. Allow notifications for Transport in Settings.', [
            { text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'OK', style: 'cancel' }]);
        } else setNoteText(r.error);
        return;
      }
      if (Platform.OS === 'ios') {
        // The reminder is a push from the server. With notifications off it can only show on Home, so ask once.
        const ps = await getPushState().catch(() => null);
        if (ps && ps.status !== 'on') {
          const r = await enablePush(false).catch(() => null);
          if (r && (r.status === 'denied' || r.status === 'off')) {
            Alert.alert('Notifications are off', 'The reminder comes as a notification. Allow notifications for Transport in Settings, or keep going and see it on Home.', [
              { text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'OK', style: 'cancel' }]);
          }
        }
      }
      const r = await remindLastHome(hint.from, hint.to, hint.mode || null, acc);
      if (r.ok) { haptic.success(); setNoteText(setNote(r.item, Platform.OS, r.push)); }
      else if (r.missing) setGone(true);
      else setNoteText(r.error);
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    const ok = path === 'local' ? (await cancelLastLocal(), true) : await cancelLastHome();
    setBusy(false);
    setNoteText(ok ? 'Reminder cancelled.' : "Couldn't cancel it. Check your connection and try again.");
    if (ok) haptic.select();
  };

  const label = mine ? `Reminder at ${mine.remindText}. Cancel` : `Remind me ${LAST_HOME_LEAD} min before`;
  return (
    <View style={{ marginTop: 6 }}>
      <Pressable onPress={mine ? cancel : set} disabled={busy} accessibilityRole="button"
        accessibilityLabel={mine ? `Reminder set for ${mine.remindText}. Double tap to cancel it` : `Remind me ${LAST_HOME_LEAD} minutes before the last service home. One notification${path === 'server' ? ', checked against live times first' : ''}`}
        accessibilityState={{ busy, disabled: busy }}
        android_ripple={{ color: c.fill }}
        style={({ pressed }) => [st.btn, { borderColor: c.sep, backgroundColor: pressed && Platform.OS !== 'android' ? c.fill : c.card }]}>
        {busy ? <ActivityIndicator size="small" color={c.tint} /> : <Icon name={mine ? I.bellOff : I.bell} size={16} color={c.tint} />}
        <T kind="sub" tone="tint" style={{ marginLeft: 8, fontWeight: '600' }}>{label}</T>
      </Pressable>
      {note ? <T kind="foot" tone="text2" accessibilityLiveRegion="polite" style={{ marginTop: 4, maxWidth: 320 }}>{note}</T> : null}
    </View>
  );
}

/** On Home while a reminder is set: when the last service leaves, then "Leave in 12 min" once it is time. */
function LastHomeCardView() {
  const c = usePalette();
  const on = useLastHomeOn();
  const s = useLastHome();
  const now = useNow(15000);
  const [busy, setBusy] = useState(false);
  const minute = Math.floor(now / 60000);
  useEffect(() => { if (on) refreshLastHome(); }, [on, minute]);
  // The phone's own reminder looks at live times again while Home is open (throttled in recheckDue).
  useEffect(() => { recheckLastLocal(); }, [minute]);
  const serverW = on ? cardWords(s.item, now) : null;
  const localW = serverW ? null : cardWords(s.local, now);
  const w = serverW || localW;
  if (!w) return null;
  const isLocal = !serverW;
  const status = isLocal ? s.local?.status : s.item?.status;
  const cancel = () => Alert.alert('Cancel the reminder?', 'No notification for your last service home tonight.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel reminder', style: 'destructive', onPress: async () => { setBusy(true); if (isLocal) await cancelLastLocal(); else await cancelLastHome(); setBusy(false); haptic.select(); } },
  ]);
  return (
    <View accessible accessibilityLabel={`${w.title}. ${w.line}`} style={[st.card, { backgroundColor: c.card, borderLeftColor: w.go ? c.orange : c.tint }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Icon name={I.bell} size={15} color={w.go ? c.orange : c.tint} />
        <T kind="body" style={{ marginLeft: 8, fontWeight: '600', flex: 1 }} numberOfLines={1}>{w.title}</T>
        {status === 'waiting' ? (
          <Pressable onPress={cancel} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel the reminder" style={st.x}>
            {busy ? <ActivityIndicator size="small" color={c.text2} /> : <Icon name={I.close} size={14} color={c.text2} />}
          </Pressable>
        ) : null}
      </View>
      <T kind="sub" tone="text2" style={{ marginTop: 4 }}>{w.line}</T>
      {!isLocal && Platform.OS === 'android' && !w.go ? <T kind="foot" tone="text3" style={{ marginTop: 4 }}>Shown here, not as a notification: this Android version can't get notifications from the server yet.</T> : null}
    </View>
  );
}

const st = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: radius, padding: 14, borderLeftWidth: 4 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -12, marginRight: -10 },
});

// Home redraws at each countdown minute; this card takes nothing that changes with the clock, so it skips those redraws
// (27 Oct speed pass 5).
export const LastHomeCard = memo(LastHomeCardView);
