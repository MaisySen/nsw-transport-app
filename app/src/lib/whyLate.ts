// "Why it's late" on screens: full alert texts for the few lines that need one, then whyLate (whyLateCore.ts).
// No polling of its own: it asks /api/alerts?q=<line> (an address the server in use already answers) only when a
// screen's own live data shows a delayed, cancelled or changed service with linked alerts, and keeps each answer
// for 3 minutes. A failed ask just leaves the line hidden.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { alertTexts, linesToAsk, whyLate, type Why, type WhyAlert, type WhyInput } from './whyLateCore';

const KEEP_MS = 3 * 60000;
const kept = new Map<string, { at: number; r: { items?: any[] } | null }>();
const asking = new Map<string, Promise<void>>();

function ask(line: string): Promise<void> {
  const k = line.toUpperCase();
  const have = kept.get(k);
  if (have && Date.now() - have.at < KEEP_MS) return Promise.resolve();
  if (asking.has(k)) return asking.get(k)!;
  const p = api.alerts(k)
    .then((r) => { kept.set(k, { at: Date.now(), r: r || null }); })
    .catch(() => { kept.set(k, { at: Date.now() - KEEP_MS + 30000, r: have?.r || null }); })
    .finally(() => { asking.delete(k); });
  asking.set(k, p);
  return p;
}

function sameTexts(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

type Row = WhyInput & { line?: string | null };

/**
 * The reason line for each service a screen shows. `rows` are the departures or legs on view, `board` the
 * board's alert list when rows carry ids. Call `why(row)` per row; it is null when there is no linked reason.
 */
export function useWhyLate(rows: Row[] | null | undefined, board?: WhyAlert[] | null) {
  const lines = useMemo(() => linesToAsk(rows || [], board || []), [rows, board]);
  const key = lines.join(',');
  const [texts, setTexts] = useState<Record<string, string>>(() => alertTexts(lines.map((l) => kept.get(l)?.r)));
  useEffect(() => {
    let live = true;
    if (!lines.length) return;
    Promise.all(lines.map(ask)).then(() => {
      if (!live) return;
      const next = alertTexts(lines.map((l) => kept.get(l)?.r));
      // Same texts, same object: no redraw (rows that are rebuilt every render cannot loop through here).
      setTexts((prev) => (sameTexts(prev, next) ? prev : next));
    });
    return () => { live = false; };
    // rows: a new answer from the screen's own poll is the moment to look again (kept answers make it free).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rows]);
  // Rows rebuilt on every render would ask on every render; pass the screen's answer (its items) where possible.
  return useCallback((r: Row | null | undefined): Why | null => (r ? whyLate(r, board || [], texts) : null), [board, texts]);
}
