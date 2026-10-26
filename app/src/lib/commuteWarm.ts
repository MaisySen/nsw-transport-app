// The commute card's trip request goes out first (27 Oct, after the 8:35 AM cold open): the moment the phone's own data
// is read at start (lib/boot.ts), before Home has drawn, so it is already on its way when the rest of Home asks for its
// cards. Home's commute card then asks for the very same trip and joins this request (api.ts shares reads while one is
// out and reuses a good answer for 4 s), so it costs no extra request. Once per start of the app; nothing in the
// background.
import { store } from './store';
import { planTrip } from './trips';
import { commuteDir, halfDayKey } from './smart';
import { commutePlanOf } from './coldOpenCore';

let sent = false;

/** Asks for the commute card's trip now, the same request Home's commute card makes. True when one went out. */
export function warmCommute(now: number = Date.now()): boolean {
  if (sent) return false;
  const st = store.snapshot();
  const dir = commuteDir(now, st.commuteFlip === halfDayKey(now));
  const plan = commutePlanOf(st.places, dir);
  if (!plan) return false;
  sent = true;
  // The same arguments as Home's commute card (TripBoard: count 6, not All services, not a refresh).
  planTrip(plan, { refresh: false, count: 6, all: false }).catch(() => {});
  return true;
}
