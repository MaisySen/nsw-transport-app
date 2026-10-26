// Limited Stops tag (docs/FEATURES.md): a service that runs past stops its own line normally serves. The server
// works it out from the timetable for every mode (backend/tools/limited_stops.py) and sends limited: true on board rows
// and trip legs; a service whose own Transport for NSW description says "Limited stops" counts too. No React here,
// so the rule is unit tested (test/limited.test.mjs).

export const LIMITED_TEXT = 'Limited stops';
export const LIMITED_A11Y = 'Limited stops. Does not stop at every stop on the line.';

/** True when the server marks the service limited, or its own description says "Limited stops". */
export function isLimited(x: { limited?: boolean | null; description?: string | null } | null | undefined): boolean {
  if (!x) return false;
  if (x.limited === true) return true;
  return /\blimited stops\b/i.test(x.description || '');
}
