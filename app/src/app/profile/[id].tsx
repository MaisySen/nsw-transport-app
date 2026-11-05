import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { Button, Screen, Section, T } from '@/components/ui';
import { isSharedProfile } from '@/lib/profileMigrate';

// nswtransport://profile/<id> moves this install to the saved trips of another profile (the owner's way to bring their
// own trips to a new install, docs/STORE.md). It always asks first. Since the 5 Nov 2026 security review it also says
// plainly that anyone holding the link can read and change those trips, keeps this phone's own id as
// 'profilePrevious', and offers to switch back, so a link from someone else can no longer cost you your own trips.
const PREVIOUS_KEY = 'profilePrevious';

export default function ProfileLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clean = String(id || '').toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 40);
  // The old shared test profile is public, so a link to it is refused. Short ids are refused too.
  const valid = clean.length >= 16 && !isSharedProfile(clean);
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.multiGet(['profile', PREVIOUS_KEY]).then((kv) => {
      setCurrent(kv[0][1]);
      setPrevious(kv[1][1]);
    }).catch(() => {});
  }, []);

  const reload = async () => { try { await Updates.reloadAsync(); } catch { /* Expo Go or a dev build: reopen by hand */ } };

  const adopt = async () => {
    // This phone's own id is kept before the switch, so Switch back can always return to it.
    if (current && current !== clean) await AsyncStorage.setItem(PREVIOUS_KEY, current);
    await AsyncStorage.setItem('profile', clean);
    setDone(true);
    await reload();
  };

  const back = async () => {
    if (!previous) return;
    await AsyncStorage.setItem('profile', previous);
    await AsyncStorage.removeItem(PREVIOUS_KEY);
    setDone(true);
    await reload();
  };

  const same = !!current && current === clean;
  return (
    <>
      <Stack.Screen options={{ title: 'Saved trips' }} />
      <Screen>
        <Section footer={done ? 'Close and reopen Transport to load the saved trips.' : 'Your own trips stay saved on the server, and this phone keeps its own id so you can switch back.'}>
          <View style={{ padding: 16, gap: 8 }}>
            <T kind="headline">{!valid ? 'This link is not valid' : done ? 'Profile changed' : same ? 'These are already your saved trips' : 'Open the saved trips from this link?'}</T>
            <T tone="text2">{valid
              ? 'Only open a link you made for yourself. Anyone who has this link can see and change the trips, home and work saved with it, including any you save after switching.'
              : 'Ask for a new link.'}</T>
          </View>
        </Section>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {valid && !done && !same ? <Button title="Open saved trips" onPress={adopt} /> : null}
          {previous && !done ? <Button kind="plain" title="Switch back to my own trips" onPress={back} /> : null}
          <Button kind="plain" title={done ? 'Done' : 'Cancel'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      </Screen>
    </>
  );
}
