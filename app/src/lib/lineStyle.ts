// One look for every line badge in the app (Home, Plan, departures, trip detail, live trip, Ask): the official
// mode or line colour on a small rounded label with the line name, the way Transport for NSW and Opal draw them.
// Pure, so test/badges.test.mjs can check it without React Native.

/** Transport for NSW mode colours, used when the feed sends no line colour (or only a neutral grey). */
export const MODE_COLOR: Record<string, string> = {
  train: '#F6891F', metro: '#168388', bus: '#00B5EF', lightrail: '#E4022D', ferry: '#5AB031', coach: '#742282',
  // School buses are buses: the same blue, never grey.
  school: '#00B5EF',
};

const MODES = new Set(['train', 'metro', 'bus', 'lightrail', 'ferry', 'coach']);
// Intercity and regional train lines that do not start with T.
const TRAIN_LINES = /^(T\d+[A-Z]?|CCN|BMT|SCO|HUN|SHL|BNE|NRC|NRW|STH|WST|NTH|XPT|RTT)$/i;

/** The mode of a badge: the feed's word when it is one we draw, otherwise read from the line name, otherwise bus. */
export function badgeMode(line?: string | null, mode?: string | null): string {
  const m = (mode || '').toLowerCase();
  if (m === 'school') return 'bus';
  if (MODES.has(m)) return m;
  const l = (line || '').trim();
  if (TRAIN_LINES.test(l)) return 'train';
  if (/^M\d+$/i.test(l)) return 'metro';
  if (/^L\d+$/i.test(l)) return 'lightrail';
  if (/^F\d+$|^MFF$|^(Stkn|Manly)\b/i.test(l)) return 'ferry';
  return 'bus';
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** True for a colour that carries no line or mode: missing, not #RRGGBB, or a neutral grey such as the server's
 *  "#495054" for an unknown service class. Line colours with a tint (T7 slate blue #6F818E) are kept. */
export function isNeutral(hex?: string | null): boolean {
  const c = hex ? rgb(hex) : null;
  if (!c) return true;
  return Math.max(...c) - Math.min(...c) < 24;
}

function lum(c: [number, number, number]) {
  const ch = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: number, b: number) { const [x, y] = a > b ? [a, b] : [b, a]; return (x + 0.05) / (y + 0.05); }

export type BadgeLook = { bg: string; fg: string; mode: string; text: string; label: string };

const NOUN: Record<string, string> = { train: 'Train', metro: 'Metro', bus: 'Bus', lightrail: 'Light rail', ferry: 'Ferry', coach: 'Coach' };

// NSW TrainLink regional trains and coaches come with a route number for a line ("427" is the Dubbo train), which
// reads as a bus number on a badge. A train or coach whose line is only digits shows what it is instead, and the
// number stays in the spoken label.
const KIND: Record<string, { text: string; noun: string }> = { train: { text: 'Regional', noun: 'Regional train' }, coach: { text: 'Coach', noun: 'Coach' } };
function kindOf(m: string, text: string) { return /^\d+$/.test(text) ? KIND[m] || null : null; }

/** Colours and words for one badge. The live state of a service never changes its badge: "No live data" stays text. */
export function badgeLook(line?: string | null, mode?: string | null, color?: string | null): BadgeLook {
  const m = badgeMode(line, mode);
  const bg = !isNeutral(color) ? `#${rgb(color as string)!.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}` : MODE_COLOR[m];
  const L = lum(rgb(bg)!);
  const fg = ratio(1, L) >= ratio(lum([17, 17, 17]), L) ? '#FFFFFF' : '#111111';
  const text = (line || '').trim();
  const kind = kindOf(m, text);
  if (kind) return { bg, fg, mode: m, text: kind.text, label: `${kind.noun} ${text}` };
  return { bg, fg, mode: m, text, label: text ? `${NOUN[m]} ${text}` : NOUN[m] };
}

/** The one badge size: every badge in the app uses these numbers. */
export const BADGE = { height: 20, minWidth: 30, padX: 6, radius: 5, font: 13, glyph: 13 } as const;
