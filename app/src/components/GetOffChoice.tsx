// Trip mode: Get off alert. How many stops before your stop the heads up comes (1, 2 or 3) and an optional
// "Get off now" 30 s before the service reaches it, in one system menu (lib/getOffCore.ts). Kept on this phone for every trip.
import { Alert, Platform, Pressable, View } from 'react-native';
import { PullDownButton } from './HoldMenu';
import { Icon, I } from './Icon';
import { T } from './ui';
import { haptic } from '@/lib/haptic';
import { radius, usePalette } from '@/lib/theme';
import { store, useStore } from '@/lib/store';
import { getLive, type LiveTrip } from '@/lib/live';
import { tickLive } from '@/lib/liveEngine';
import type { LiveState } from '@/lib/liveCalc';
import { shortName } from '@/lib/format';
import { canNotify } from '@/lib/smartNotify';
import { GETOFF_STOPS, getOffShortText, getOffSubText, getOffValueText, readGetOff, stopsWords, type GetOffPref } from '@/lib/getOffCore';
import type { MenuSpec } from '@/lib/menuCore';

const short = (n?: string | null) => shortName(n || '').replace(/ Station$/, '');

export function getOffMenu(pref: GetOffPref, set: (p: GetOffPref) => void, os: string = Platform.OS): MenuSpec {
  const items = GETOFF_STOPS.map((n) => {
    const on = pref.stops === n;
    // The iPhone menu here is a system sheet of plain buttons (no icons), so the chosen one carries a check mark in its words.
    const text = `${stopsWords(n)}${on && os === 'ios' ? ' \u2713' : ''}`;
    return { text, sf: on ? 'checkmark' : 'bell', icon: on ? 'check' : 'bell', destructive: false, onPress: () => { haptic.select(); set({ ...pref, stops: n }); } };
  });
  items.push({ text: pref.now ? 'Turn off Get off now' : 'Also Get off now', sf: pref.now ? 'xmark' : 'figure.walk', icon: pref.now ? 'close' : 'walk', destructive: false,
    onPress: () => { haptic.select(); set({ ...pref, now: !pref.now }); } });
  return { title: 'Get off alert', message: 'How many stops before yours the alert comes. Get off now adds one more 30 seconds before the service reaches your stop, from live times when there are any.', items };
}

/** Saves the choice, asks for notifications when a new alert needs them, and refreshes the trip so it takes effect now. */
async function choose(p: GetOffPref) {
  store.setGetOff(p);
  if ((p.stops > 1 || p.now) && !(await canNotify(true))) {
    Alert.alert('Notifications are off', 'Get off alerts need notifications. Turn them on for Transport in your phone settings.');
  }
  if (getLive()) tickLive().catch(() => {});
}

export function GetOffRow({ g, st }: { g: LiveTrip; st: LiveState | null }) {
  const c = usePalette();
  const pref = readGetOff(useStore().getOff);
  const legs = g.legs;
  const k = st && !st.done ? st.cur : legs.length - 1;
  const stop = short(legs[k]?.to);
  const menu = getOffMenu(pref, (p) => { choose(p).catch(() => {}); });
  const value = getOffValueText(pref);
  const done = !!st?.done;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
      <PullDownButton menu={menu}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Get off alert, ${value}`} accessibilityHint="Choose how many stops before yours the alert comes"
          android_ripple={{ color: c.fill }} disabled={done}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 64, backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card })}>
          <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}>
            <Icon name={I.bell} size={16} color={c.tint} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T kind="body">Get off alert</T>
            <T kind="foot" tone="text2" numberOfLines={3}>{done ? 'Trip finished' : getOffSubText(pref, stop)}</T>
          </View>
          <T kind="foot" tone="text2" numberOfLines={1} style={{ marginLeft: 8 }}>{getOffShortText(pref)}</T>
          <Icon name={I.chevron} size={12} color={c.text3} style={{ marginLeft: 6, transform: [{ rotate: '90deg' }] }} />
        </Pressable>
      </PullDownButton>
    </View>
  );
}
