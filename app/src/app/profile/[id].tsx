import { useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { Button, Screen, Section, T } from '@/components/ui';

// nswtransport://profile/<id> moves this install to the saved trips of another profile.
// It always asks first, so a link from someone else cannot quietly switch your trips.
export default function ProfileLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clean = String(id || '').toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 40);
  const valid = clean.length >= 3;
  const [done, setDone] = useState(false);

  const adopt = async () => {
    await AsyncStorage.setItem('profile', clean);
    setDone(true);
    try { await Updates.reloadAsync(); } catch { /* Expo Go or a dev build: reopen by hand */ }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Saved trips' }} />
      <Screen>
        <Section footer={done ? 'Close and reopen Transport to load the saved trips.' : 'Your current trips stay saved on the server under your old profile.'}>
          <View style={{ padding: 16, gap: 8 }}>
            <T kind="headline">{!valid ? 'This link is not valid' : done ? 'Profile changed' : 'Open the saved trips from this link?'}</T>
            <T tone="text2">{valid ? 'This switches this phone to the trips, home and work saved with the link.' : 'Ask for a new link.'}</T>
          </View>
        </Section>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {valid && !done ? <Button title="Open saved trips" onPress={adopt} /> : null}
          <Button kind="plain" title={done ? 'Done' : 'Cancel'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      </Screen>
    </>
  );
}
