// Occupancy from Transport for NSW, only when it is sent for that service (docs/API.md, Occupancy).
// Nothing is ever filled in: no value means no chip.
import type { Occupancy } from './types';

/** The words to show ("Few seats"), or null when there is nothing to show or the feature is off. */
export function occText(o: Occupancy | undefined, on = true): string | null {
  if (!on || !o || typeof o !== 'object') return null;
  const t = typeof o.text === 'string' ? o.text.trim() : '';
  return t ? t : null;
}
/** busy for standing room and fuller (level 3 and 4), calm otherwise. */
export const occBusy = (o: Occupancy | undefined) => !!o && Number(o.level) >= 3;
