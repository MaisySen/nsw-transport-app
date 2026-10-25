// Moving a phone to the new server (26 Oct 2026): what it carries over from the first server. Pure logic, tested in
// test/servermove.test.mjs; the steps that read and write are in serverMove.ts.

export type MorningLike = { id?: string; name?: string | null; from: { id: string; name?: string }; to: { id: string; name?: string };
  time: string; days: number[]; lead?: number; active?: boolean; mode?: string | null };

const sig = (c: MorningLike) => [c?.from?.id, c?.to?.id, c?.time, (c?.days || []).join(''), c?.mode || ''].join('|');

/**
 * The morning checks this phone has on the first server and not yet on the new one, as bodies for POST
 * /api/morning-check (no id: the new server gives each its own). Matched by trip, time, days and mode, so running the
 * move again copies nothing twice. At most `max` in all on the new server (the server allows a few per phone).
 */
export function morningToCopy(oldItems: MorningLike[] | null | undefined, newItems: MorningLike[] | null | undefined, max = 5): Omit<MorningLike, 'id'>[] {
  const have = new Set((newItems || []).map(sig));
  const room = Math.max(0, max - (newItems || []).length);
  const out: Omit<MorningLike, 'id'>[] = [];
  for (const c of oldItems || []) {
    if (out.length >= room) break;
    if (!c || !c.from?.id || !c.to?.id || !c.time || !Array.isArray(c.days) || !c.days.length) continue;
    const k = sig(c);
    if (have.has(k)) continue;
    have.add(k);
    out.push({ name: c.name ?? null, from: { id: c.from.id, name: c.from.name }, to: { id: c.to.id, name: c.to.name }, time: c.time, days: c.days,
      lead: c.lead ?? 15, active: c.active !== false, mode: c.mode ?? null });
  }
  return out;
}
