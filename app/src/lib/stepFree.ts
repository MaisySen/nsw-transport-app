// Step free trips (acc=1) and lift aware trips: the words the Plan and trip screens show (docs/API.md, Lift aware trips).
import type { Journey, TripResp } from './types';

const st = (n: string) => String(n || '').replace(/ Station$/, '');
function listWords(xs: string[]) {
  const a = [...new Set(xs.map(st).filter(Boolean))];
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/**
 * The note above step free results. allAffected: every trip found meets a lift outage (warn). avoided: trips
 * left out for one (info). null when lift aware trips are off, or there is nothing to say.
 */
export function liftAwareNote(r: Pick<TripResp, 'accessible' | 'liftAware'> | null | undefined, on = true): { tone: 'warn' | 'info'; text: string } | null {
  if (!on || !r?.accessible || !r.liftAware) return null;
  const la = r.liftAware;
  const where = listWords(la.stations || []);
  if (la.allAffected) return { tone: 'warn', text: `Every trip found passes a lift that is out of service${where ? ` at ${where}` : ''}. Each trip shows where.` };
  const n = Number(la.avoided) || 0;
  if (n > 0) return { tone: 'info', text: `Left out ${n} trip${n === 1 ? '' : 's'} with a lift out of service${where ? ` at ${where}` : ''}.` };
  return null;
}

/** For one trip: step free at every station, and the stations with a lift out now (lift aware on). */
export function journeyAccess(j: Pick<Journey, 'stepFree' | 'liftOutages'>, on = true): { stepFree: boolean; outages: string[] } {
  const outages = on ? [...new Set((j.liftOutages || []).map((o) => st(o?.name || '')).filter(Boolean))] : [];
  return { stepFree: j.stepFree === true, outages };
}
