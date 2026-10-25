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

/**
 * Which mode a stop screen asks the server for. A board answer is 40 services, so at a station with trains and many bus
 * stands a mixed board covers about 15 minutes (Strathfield, 26 Oct 2026, 7:51am: 7:51 to 8:07, and the 8:10 415 to
 * Chiswick from Stand G was past the end). When the stop serves more than one mode and a mode chip is on, or a route
 * chip (always a bus, coach or school bus line) is on, the screen asks for that mode alone: 40 buses there reach
 * about 50 minutes ahead. Null asks for every mode, as before: a stop with one mode, nothing chosen, or another time.
 */
export function boardAsk(served: string[], mode: string | null | undefined, pick: string | null | undefined, at: unknown): string | null {
  if (at != null || served.length < 2) return null;
  if (mode) return served.includes(mode) ? mode : null;
  return pick && served.some((m) => m === 'bus' || m === 'coach') ? 'bus' : null;
}

/** The key a board read is noted under for Recently departed: a board for one mode is kept apart from the full one. */
export function boardKey(stop: string, mode?: string | null): string {
  return mode ? `${stop}|${mode}` : stop;
}

/**
 * The modes a stop serves, from its board for every mode. A board asked for one mode (askedMode) lists only that mode,
 * so what was known stays.
 */
export function modesServed(prev: string[], data: { askedMode?: string; items?: { mode?: string }[] } | null | undefined): string[] {
  if (!data || data.askedMode || !Array.isArray(data.items)) return prev;
  const next = Array.from(new Set(data.items.map((d) => String(d.mode || '')).filter(Boolean)));
  return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next;
}
