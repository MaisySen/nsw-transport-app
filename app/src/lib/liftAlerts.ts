import { useEffect } from 'react';
import { api } from './api';
import { store, useStore } from './store';
import { liftStations } from './access';

/** Every stop id on saved trips: the trips on this phone plus the server's saved trips (Home, Work). */
export async function savedStations(): Promise<string[]> {
  const mine = store.myTrips();
  const server = await api.saved().then((r) => r.items || []).catch(() => []);
  return liftStations([...mine, ...server]);
}

/** Turn lift outage alerts on or off on the server. On answers the outages already showing. */
export async function syncLiftAlerts(on: boolean) {
  if (!on) return api.liftAlerts(false);
  return api.liftAlerts(true, await savedStations());
}

/** Keeps the server's list in step: once per app open while on, and again when saved trips change. */
export function LiftAlertSync() {
  const st = useStore();
  const on = !!st.liftAlerts;
  const key = (st.myTrips || []).map((t) => [t.from?.id, t.to?.id, t.via?.id, ...(t.legs || []).map((l) => l.to?.id)].join('>')).join('|');
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => { syncLiftAlerts(true).catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [on, key]);
  return null;
}
