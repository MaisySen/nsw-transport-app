// Get me home on Home: one tap plans from where you are to your saved Home (lib/goHomeCore.ts). Without a Home it
// asks once to set it. Opens the trip screen; it changes nothing else on Home.
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Icon, I } from './Icon';
import { T } from './ui';
import { haptic } from '@/lib/haptic';
import { radius, usePalette } from '@/lib/theme';
import { myPosition } from '@/lib/where';
import { goHomeStep } from '@/lib/goHomeCore';
import { shortName } from '@/lib/format';
import type { Place } from '@/lib/types';

export function GetMeHome({ home }: { home?: Place | null }) {
  const c = usePalette();
  const [busy, setBusy] = useState(false);
  const sub = home ? `From where you are to ${shortName(home.name).replace(/ Station$/, '')}` : 'Set your Home first';
  const go = async () => {
    if (busy) return;
    haptic.tap();
    if (!home?.id) {
      Alert.alert('Where is home?', 'Set your Home stop once, then Get me home plans from wherever you are.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Set Home', onPress: () => router.push({ pathname: '/add-trip', params: { place: 'home' } }) },
      ]);
      return;
    }
    setBusy(true);
    try {
      const step = goHomeStep(home, await myPosition(true, false));
      if (step.kind === 'open') { router.push({ pathname: '/trip', params: step.params }); return; }
      if (step.kind === 'outside') { Alert.alert('Too far away', 'Trips can only be planned from within NSW.'); return; }
      Alert.alert('Location is off', 'Get me home needs your location to plan from where you are. You can turn it on in Settings.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
      ]);
    } finally { setBusy(false); }
  };
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: c.card, borderRadius: radius, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Get me home. ${sub}`} accessibilityState={{ busy }} onPress={go} android_ripple={{ color: c.fill }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 52, backgroundColor: pressed && Platform.OS === 'ios' ? c.card2 : c.card })}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint, marginRight: 12 }}>
          <Icon name={I.home} size={15} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T kind="body" style={{ fontWeight: '600' }}>Get me home</T>
          <T kind="foot" tone="text2" numberOfLines={1}>{sub}</T>
        </View>
        {busy ? <ActivityIndicator color={c.tint} /> : <Icon name={I.chevron} size={13} color={c.text3} />}
      </Pressable>
    </View>
  );
}
