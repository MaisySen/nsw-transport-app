import { initProfile } from './device';
import { loadCachedConfig } from './config';
import { loadStore } from './store';
import { warmOffline } from './offline';
import { loadPacks } from './timetablePack';
import { loadHomeBundle } from './homeBundle';

/** The longest the first frame waits for the kept copies; a slow storage read never holds the splash longer. */
export const WARM_WAIT_MS = 400;

let started: Promise<void> | null = null;

/**
 * Everything the first screen needs from the phone, read side by side in one go (g13, 26 Oct): the profile, the last
 * good config and server address, the saved places and trips, and the kept copies of the last answers. Before, these
 * were three steps one after another (profile and config, then the saved places once the first screen was drawn, then
 * one read per card after that), so Home drew empty cards first and their times a few frames later.
 * Nothing here asks the network.
 */
export function bootLocal(): Promise<void> {
  if (started) return started;
  const wait = new Promise<void>((res) => setTimeout(res, WARM_WAIT_MS));
  started = Promise.all([
    initProfile().catch(() => ''),
    loadCachedConfig(),
    loadStore(),
    // The reads Home made last time, for the one request that asks for them all (homeBundleCore.ts).
    loadHomeBundle(),
    // The kept timetable packs too (timetablePack.ts), so a stop with no recent live copy paints its timetable first.
    Promise.race([Promise.all([warmOffline(), loadPacks()]), wait]),
  ]).then(() => undefined, () => undefined);
  return started;
}
