import { Redirect, useLocalSearchParams } from 'expo-router';

// Links to /plan (transportsydney.app/plan?from=..&to=.. once Android App Links are in the build, or the app's own
// scheme now): with both ends it opens the trip, otherwise the Plan tab.
export default function PlanLink() {
  const p = useLocalSearchParams<{ from?: string; to?: string; fromName?: string; toName?: string }>();
  const ok = (v?: string) => typeof v === 'string' && /^[A-Za-z0-9:_.-]{1,40}$/.test(v);
  if (ok(p.from) && ok(p.to)) {
    return <Redirect href={{ pathname: '/trip', params: { from: p.from!, to: p.to!, fromName: String(p.fromName || ''), toName: String(p.toName || '') } }} />;
  }
  return <Redirect href="/search" />;
}
