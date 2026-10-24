import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { apiBase } from '@/lib/server';
import { I } from '@/components/Icon';
import { Button, Empty, Screen } from '@/components/ui';

// A live trip someone shared (transportsydney.app/trip/<id>): the live page from the server the share was
// made on, in the in-app browser. Closing it returns to where the person was.
const ok = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{12,40}$/.test(v);

export default function SharedTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [failed, setFailed] = useState(false);
  const opened = useRef(false);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const open = useCallback(async () => {
    if (!ok(id)) return;
    setFailed(false);
    try {
      await WebBrowser.openBrowserAsync(`${apiBase()}/live/?t=${encodeURIComponent(id)}`);
      leave();
    } catch {
      setFailed(true);
    }
  }, [id]);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open();
  }, [open]);
  return (
    <>
      <Stack.Screen options={{ title: 'Shared trip' }} />
      <Screen>
        {!ok(id) ? (
          <Empty icon={I.route} title="This link is not valid" body="Ask for the trip link again." action={<Button title="Done" onPress={leave} />} />
        ) : failed ? (
          <Empty icon={I.warn} title="Can't open the live trip" body="Check your connection and try again." action={<Button title="Try again" onPress={open} />} />
        ) : (
          <Empty icon={I.route} title="Opening the live trip" action={<Button title="Show live trip" kind="tinted" onPress={open} />} />
        )}
      </Screen>
    </>
  );
}
