// Not stopping today (28 Oct): a bus detour or a closed stop, from the service's own alerts (server notStopping on
// departures and bus legs, GET /api/detours for a route). Trains already say "Not stopping" from the realtime feed;
// this is the same words for buses. Pure, so it is unit tested. Answers from servers before this carry no field and
// show exactly as before.

export type NotStopping = { at?: 'from' | 'to'; stop?: string | null; id?: string; title?: string | null; url?: string | null } | null;

const BUS = new Set(['bus', 'coach']);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Main St opp Park Rd" from a stop or platform name: no suburb tail, no "Stand" or "Platform" part. */
export function stopShort(name: string | null | undefined): string {
  const s = String(name || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (!s) return '';
  const parts = s.split(', ').filter((p) => !/^(stand|platform|bay|side)\b/i.test(p));
  return (parts[0] || '').slice(0, 60);
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Whether a row's notStopping is one to show: an object from the server on a bus or coach. */
export function hasNotStopping(x: { mode?: string; notStopping?: NotStopping } | null | undefined): boolean {
  const v = x && x.notStopping;
  return !!v && typeof v === 'object' && BUS.has(String((x && x.mode) || 'bus'));
}

/**
 * "Not stopping at Main St today" for a departure or leg the server marked, else null. `when` is the bus's time
 * there: a board for another day says "on <day>" instead of "today". With no stop name: "Not stopping here today".
 */
export function notStoppingText(x: { mode?: string; notStopping?: NotStopping; planned?: string | null; arrPlanned?: string | null } | null | undefined, now: number): string | null {
  if (!hasNotStopping(x)) return null;
  const v = x!.notStopping!;
  const stop = stopShort(v.stop);
  const t = new Date((v.at === 'to' ? x!.arrPlanned : x!.planned) || '').getTime();
  const day = !Number.isFinite(t) || sameDay(t, now) ? 'today' : `on ${DAYS[new Date(t).getDay()]}`;
  return stop ? `Not stopping at ${stop} ${day}` : `Not stopping here ${day}`;
}

/** The alert's own words, for VoiceOver and TalkBack after the label, or null. */
export function notStoppingWhy(x: { notStopping?: NotStopping } | null | undefined): string | null {
  const t = x && x.notStopping && typeof x.notStopping === 'object' ? String(x.notStopping.title || '').trim() : '';
  return t ? t.replace(/[.\s]+$/, '') : null;
}

export type Detour = { id?: string; title?: string | null; url?: string | null; stops: string[]; until?: string | null };

/** /api/detours answer -> the stops of this route not served today, each with its alert. Bad input gives none. */
export function routeDetours(raw: any): Map<string, Detour> {
  const out = new Map<string, Detour>();
  const items = raw && Array.isArray(raw.items) ? raw.items : [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.stops)) continue;
    const d: Detour = { id: it.id ? String(it.id) : undefined, title: typeof it.title === 'string' ? it.title : null, url: typeof it.url === 'string' ? it.url : null,
      stops: it.stops.map(String), until: typeof it.until === 'string' ? it.until : null };
    for (const s of d.stops) if (s && !out.has(s)) out.set(s, d);
  }
  return out;
}

/** The line above a route's stops: one stop by name, or how many. Null when every stop is served. */
export function detourSummary(stops: { id: string; name: string }[] | null | undefined, skipped: Map<string, Detour>): string | null {
  if (!stops || !skipped.size) return null;
  const hit = stops.filter((s) => skipped.has(String(s.id)));
  if (!hit.length) return null;
  if (hit.length === 1) return `Not stopping at ${stopShort(hit[0].name) || `stop ${hit[0].id}`} today`;
  return `Not stopping at ${hit.length} stops today`;
}
