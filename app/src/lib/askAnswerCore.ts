// Ask answers after the question is understood (askBrain.ts): a trip card for another day or a mode from the
// planner's own answer, trips with no change, the first and last times shown (for "the one after"), and the
// actions under the card. Pure: no React Native, no network. Every time and number here is copied from live data.

// The phone's 24-Hour Time setting (iPhone Settings, General, Date and Time): lib/rowTime.ts installs the reader
// at start (installPhoneClock). Until then, and in tests, the 12 hour clock the app has always used.
const PHONE24 = (): boolean => { try { return (globalThis as any).__tslPhone24h?.() === true; } catch { return false; } };
/** "07:55" (or "07:55:30"), Sydney time, for a phone set to 24 hour time. */
const C24 = (t: number, sec = false): string => {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hourCycle: 'h23', timeZone: 'Australia/Sydney' } as Intl.DateTimeFormatOptions).format(new Date(t)); }
  catch { const d = new Date(t); return [d.getHours(), d.getMinutes(), ...(sec ? [d.getSeconds()] : [])].map((n) => String(n).padStart(2, '0')).join(':'); }
};

export type ALeg = { kind: string; mode?: string; line?: string; color?: string; from?: string; to?: string; fromPlatform?: string | null; planned?: string; estimated?: string | null; realtime?: boolean; delayMin?: number | null; cancelled?: boolean; durationMin?: number; link?: any; access?: any };
export type AJourney = { leave: string; arrive: string; durationMin?: number; changes: number; legs: ALeg[]; warn?: string | null; fare?: any; board?: string };
export type ACard = { type: string; title?: string; titleOnly?: boolean; link?: any; items?: any[]; journeys?: AJourney[]; from?: { id: string; name: string }; to?: { id: string; name: string }; [k: string]: any };

const LEG_KEYS = ['kind', 'mode', 'line', 'color', 'from', 'to', 'fromPlatform', 'planned', 'estimated', 'realtime', 'delayMin', 'cancelled', 'durationMin', 'link', 'access'];
function pick(o: any, keys: string[]) { const r: any = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; }

/** The journeys of a /api/trip answer, cut to what the Ask card reads. */
export function journeysFrom(resp: any, max = 5): AJourney[] {
  const js = Array.isArray(resp?.journeys) ? resp.journeys : [];
  return js.slice(0, max).map((j: any) => ({
    leave: j.leave, arrive: j.arrive, durationMin: j.durationMin, changes: j.changes || 0, warn: j.warn || null, fare: j.fare || null,
    legs: (j.legs || []).map((l: any) => ({ ...pick(l, LEG_KEYS), realtime: !!l.realtime, cancelled: !!l.cancelled })),
  }));
}

/** The first trip card of an answer, if any. */
export const tripCardOf = (cards: ACard[] | null | undefined) => (cards || []).find((c) => c && c.type === 'trip' && c.from?.id && c.to?.id) || null;
export const depCardOf = (cards: ACard[] | null | undefined) => (cards || []).find((c) => c && c.type === 'departures') || null;

/** Trips with no change first; says so plainly when none of them goes without one. */
export function directFirst(journeys: AJourney[]): { journeys: AJourney[]; note: string | null } {
  const none = journeys.filter((j) => !j.changes);
  if (none.length) return { journeys: none, note: null };
  return { journeys: [...journeys].sort((a, b) => (a.changes || 0) - (b.changes || 0)), note: journeys.length ? 'None of these go without a change. Fewest changes first.' : null };
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  if (PHONE24()) return C24(d.getTime());
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Sydney' }).replace(/\s?(am|pm)/i, (_m, p) => ' ' + p.toLowerCase());
}
const short = (n?: string) => String(n || '').split(',')[0].replace(/ (Station|Light Rail)$/, '');

/** The reply line for a trip card the phone built: the first service, from the card's own legs. */
export function tripReply(card: ACard, label: string | null, now: number): string {
  const js = card.journeys || [];
  const j = js.find((x) => Date.parse(x.leave) >= now - 60000) || js[0];
  const head = `${short(card.from?.name)} to ${short(card.to?.name)}${label ? ', ' + label : ''}.`;
  if (!j) return `${head}\nNo trips found for that time. Try another time.`;
  const tl = (j.legs || []).filter((l) => l.kind === 'transit');
  const f = tl[0];
  if (!f) return head;
  const lines = [...new Set(tl.map((l) => l.line).filter(Boolean))].join(' then ');
  const plat = f.fromPlatform ? ', ' + String(f.fromPlatform).replace(/^Platform /, 'Plat ') : '';
  const ch = j.changes ? ` with ${j.changes} change${j.changes > 1 ? 's' : ''}` : ', no change';
  return `${head} Next: the ${lines} from ${short(f.from || card.from?.name)}${plat} at ${clock(f.estimated || f.planned || j.leave)}, arriving ${short(card.to?.name)} ${clock(j.arrive)}${ch}.`;
}

/** The first and last departure times on show, so "the one after" and "earlier" start from them. */
export function shownTimes(cards: ACard[] | null | undefined): { firstLeave: string | null; lastLeave: string | null } {
  const times: string[] = [];
  for (const c of cards || []) {
    if (c.type === 'trip') for (const j of c.journeys || []) { const f = (j.legs || []).find((l) => l.kind === 'transit'); times.push((f && (f.planned || f.estimated)) || j.leave); }
    if (c.type === 'departures') for (const it of c.items || []) times.push(it.planned || it.estimated);
  }
  const ok = times.filter((t) => t && Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { firstLeave: ok[0] || null, lastLeave: ok[ok.length - 1] || null };
}

/** The departures card rows from a /api/departures answer at another time. */
export function depItemsFrom(resp: any, max = 8): any[] {
  const items = Array.isArray(resp?.items) ? resp.items : [];
  return items.filter((i: any) => !i.departed).slice(0, max).map((i: any) => ({
    line: i.line, color: i.color, mode: i.mode, dest: i.dest || i.towards || '', platform: i.platform || null, planned: i.planned, estimated: i.estimated || null,
    realtime: !!i.realtime, delayMin: i.delayMin || 0, cancelled: !!i.cancelled,
    link: { kind: 'service', trip: i.tripId || '', line: i.line || '', stop: i.stopId || '', planned: i.planned || '', mode: i.mode || '', destId: i.destId || '', color: i.color || '', dest: i.dest || '' },
  }));
}

export type CardAction = { kind: 'open' | 'directions' | 'speak'; label: string; link?: any; url?: string };
/** The buttons under an answer: open the trip or the board, directions to a car park, and Speak. */
export function actionsFor(cards: ACard[] | null | undefined, os: string): CardAction[] {
  const out: CardAction[] = [];
  const t = tripCardOf(cards);
  const d = depCardOf(cards);
  if (t && t.link) out.push({ kind: 'open', label: 'Open trip', link: t.link });
  else if (d && d.link) out.push({ kind: 'open', label: 'Open board', link: d.link });
  const park = (cards || []).find((c) => c.type === 'parking' && (c.items || []).some((p: any) => typeof p.lat === 'number' && typeof p.lon === 'number'));
  if (park) {
    const p = (park.items || []).find((x: any) => typeof x.lat === 'number' && typeof x.lon === 'number');
    const ll = `${p.lat},${p.lon}`;
    out.push({ kind: 'directions', label: 'Directions', url: os === 'ios' ? `https://maps.apple.com/?daddr=${ll}` : `https://www.google.com/maps/dir/?api=1&destination=${ll}` });
  } else {
    const st = (cards || []).find((c) => c.type === 'station' && c.link);
    if (st && !out.length) out.push({ kind: 'open', label: 'Open station', link: st.link });
  }
  if (t || d) out.push({ kind: 'speak', label: 'Speak' });
  return out;
}
