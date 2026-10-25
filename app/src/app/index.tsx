import { Redirect } from 'expo-router';
import { useLoaded, useStore } from '@/lib/store';

// The app opens on Home, or on the one Simple mode screen when that is on (More > Simple mode). The store is read
// from the phone first (a few milliseconds), so the choice is known before anything is drawn.
export default function Index() {
  const ok = useLoaded();
  const st = useStore();
  if (!ok) return null;
  return <Redirect href={st.simple ? '/simple' : '/home'} />;
}
