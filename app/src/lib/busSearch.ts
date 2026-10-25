// Plan search extras for buses: a stop number from a sign (2046100) finds that exact stop, and a route number
// (410, M90) offers the route. Both are looked up after a short pause, only while the text looks like one.
import { useEffect, useState } from 'react';
import { api } from './api';
import { isStopNumber, routeDirs, routeQuery } from './busCore';

export type StopHit = { id: string; name: string; stand: string | null; modes: string[] };
export type RouteHit = { line: string; ends: string[]; mode: string };

/** The stop a 6 or 7 digit number names, from its own departure board; null when no stop has that number. */
export function stopFromBoard(q: string, r: any): StopHit | null {
  const s = r?.stop;
  if (!s || !s.fullName || String(s.name) === q) return null;
  const exact = String(s.exactName || '');
  const stand = /^(Stand|Side|Platform|Wharf) /i.test(exact) ? exact : (exact.match(/\b(Stand|Side) [A-Z0-9]+\b/) || [])[0] || null;
  const name = exact && !stand && exact !== s.name ? exact : String(s.fullName || s.name);
  const modes = Array.from(new Set(((r.items || []) as any[]).map((d) => String(d.mode)))) as string[];
  return { id: q, name, stand, modes };
}

export function useBusLookup(text: string) {
  const [stop, setStop] = useState<StopHit | null>(null);
  const [route, setRoute] = useState<RouteHit | null>(null);
  useEffect(() => {
    const q = text.trim();
    const num = isStopNumber(q) ? q : null;
    const line = routeQuery(q);
    setStop(null); setRoute(null);
    if (!num && !line) return;
    let live = true;
    const t = setTimeout(() => {
      if (num) api.departures(num).then((r) => { if (live) setStop(stopFromBoard(num, r)); }).catch(() => {});
      if (line) api.route(line).then((raw) => { const d = routeDirs(raw); if (live && d.length) setRoute({ line, mode: 'bus', ends: d.map((x) => x.to).filter(Boolean) }); }).catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [text]);
  return { stop, route };
}
