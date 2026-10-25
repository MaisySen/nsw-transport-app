// Stop boards and service stop lists, the parts with no phone dependencies (unit tested in test/stopboard.test.mjs).

type StopLike = { id: string; name?: string; mine?: boolean; alight?: boolean };

/**
 * Which stops in a service's list get GET ON and GET OFF: only when the list was opened from a trip or a plan (`to`
 * is the stop you get off at). GET ON is the stop you board at (the server's `mine`, else the `from` id); GET OFF is
 * the server's `alight`, else the first stop after it with the `to` id. -1 where there is none.
 */
export function boardAlight(stops: StopLike[] | undefined, from?: string | null, to?: string | null): { on: number; off: number } {
  const list = stops || [];
  if (!to || !list.length) return { on: -1, off: -1 };
  let on = list.findIndex((s) => s.mine);
  if (on < 0 && from) on = list.findIndex((s) => s.id === from);
  let off = list.findIndex((s, i) => s.alight && i > on);
  if (off < 0) off = list.findIndex((s, i) => i > on && s.id === String(to));
  if (on >= 0 && off >= 0 && off <= on) off = -1;
  return { on, off };
}

export type RouteHere = { line: string; mode?: string; color?: string };

/** Departures for the chosen route (all when none is chosen). */
export function byRoute<T extends { line?: string }>(items: T[], route: string | null | undefined): T[] {
  return route ? items.filter((d) => d.line === route) : items;
}

/** The chosen route, kept only while the board still runs it. */
export function keepRoute(route: string | null, routes: RouteHere[]): string | null {
  return route && routes.some((r) => r.line === route) ? route : null;
}
