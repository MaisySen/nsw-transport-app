// Nearby: fold the stops /api/nearby returns into the places a person thinks in. Pure, so it is unit tested.

export type NearPick = { id: string; name: string; distance?: number; modes?: number[]; seg: string; parent: boolean };

const base = (s: string) => s.toLowerCase().replace(/\s+(station|wharf)$/, '').trim();
// What is left of a name after the station's own name, when it only names a mode at that station, and the
// mode code it stands for (1 train, 2 metro, 4 light rail, 9 ferry; 0 when any mode fits).
const PART: [RegExp, number][] = [[/^light rail$/, 4], [/^metro( station)?$/, 2], [/^(ferry )?wharf$/, 9], [/^station$/, 0]];

/** True when `seg` is a mode's stop at the station `parent` (its modes, when known, include that mode). */
function partOf(seg: string, parent: NearPick): boolean {
  const b = base(seg), q = base(parent.seg);
  if (b === q || !b.startsWith(q + ' ')) return false;
  const rest = b.slice(q.length + 1);
  const hit = PART.find(([re]) => re.test(rest));
  if (!hit) return false;
  return !hit[1] || !parent.modes || !parent.modes.length || parent.modes.includes(hit[1]);
}

/**
 * Drops a pick that is part of a station also listed: "Circular Quay Light Rail" next to the station
 * "Circular Quay" (found as the parent of its platforms, light rail among its modes) is the same place, and two
 * rows both titled Circular Quay read as a mistake. A different stop that only shares the start of the name
 * ("Parramatta Square Light Rail") stays. Also drops repeated ids. Keeps the order, at most `max`.
 */
export function foldNear(picks: NearPick[], max = 3): NearPick[] {
  const parents = picks.filter((p) => p.parent);
  const out: NearPick[] = [];
  for (const p of picks) {
    if (out.some((o) => o.id === p.id)) continue;
    if (!p.parent && parents.some((q) => partOf(p.seg, q))) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
