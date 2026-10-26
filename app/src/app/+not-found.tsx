import { router, Stack } from 'expo-router';
import { I } from '@/components/Icon';
import { Button, Empty, Screen } from '@/components/ui';

/**
 * A link to a screen the app does not have (an old link to Platform view, removed 26 Oct, or a mistyped address):
 * a plain message and the way Home, instead of the router's own "Unmatched Route" page with its Sitemap link.
 */
export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen>
        <Empty icon={I.warn} title="This link isn't in the app" body="It may be from an older version. Everything else is on Home."
          action={<Button title="Go to Home" onPress={() => router.replace('/')} />} />
      </Screen>
    </>
  );
}
