// The commute card's look (Bidur, 25 Oct 7:33 PM: "little shiny or metallic border and main card element"). Three
// looks to choose from, drawn with styles React Native 0.88 already has (backgroundImage gradients, boxShadow), so no
// native module. No React here (test/cardskin.test.mjs).

export type CardSkin = 'plain' | 'titanium' | 'line' | 'glass';
export const SKINS: CardSkin[] = ['plain', 'titanium', 'line', 'glass'];

/** "titanium", "a", "B", "glass" and so on, from a dev switch; anything else is plain. */
export function skinFrom(v: unknown): CardSkin {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'a' || s === 'titanium') return 'titanium';
  if (s === 'b' || s === 'line' || s === 'lineglow' || s === 'line-glow') return 'line';
  if (s === 'c' || s === 'glass') return 'glass';
  return 'plain';
}

const hex = (h: string) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
/** a and b mixed, t from 0 (a) to 1 (b), as #rrggbb. A colour that is not hex counts as silver. */
export function mix(a: string, b: string, t: number): string {
  const A = hex(a) || [192, 196, 202], B = hex(b) || [192, 196, 202];
  const k = Math.max(0, Math.min(1, t));
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
/** #rrggbb with an alpha from 0 to 1, as rgba(). */
export function rgba(h: string, a: number): string {
  const v = hex(h) || [192, 196, 202];
  return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${Math.max(0, Math.min(1, a))})`;
}

export type SkinStyle = {
  /** The ring around the card: a gradient (backgroundImage), or null for a solid border. */
  ring: string | null;
  /** Ring width in points (1 when plain). */
  width: number;
  /** Solid border colour when ring is null. */
  border: string | null;
  /** The card's own fill: a gradient, or null for the theme card colour. */
  fill: string | null;
  /** A thin highlight along the inside top edge, or null. */
  highlight: string | null;
  /** boxShadow under the card (a soft shadow in light, a faint glow in dark), or null. */
  shadow: string | null;
  /** The countdown's size and weight. */
  count: { size: number; line: number; weight: '800' | '900' };
};

const SILVER_L = ['#E4E7EB', '#8A9099', '#D2D6DC', '#6F757E'];
const SILVER_D = ['#D9DDE3', '#6E747D', '#C3C8CF', '#555A62'];

/**
 * How the card is drawn. plain is today's card. solid (Reduce Transparency, Increase Contrast or high text contrast)
 * swaps every look for a solid 1 pt border with no glow or translucency.
 */
export function skinStyle(skin: CardSkin, o: { dark: boolean; line?: string | null; solid?: boolean; cardColor: string; text3: string }): SkinStyle {
  const big = { size: 64, line: 70, weight: '900' as const };
  if (skin === 'plain') return { ring: null, width: 0, border: null, fill: null, highlight: null, shadow: null, count: { size: 56, line: 62, weight: '800' } };
  if (o.solid) return { ring: null, width: 1, border: o.dark ? '#8E949C' : '#6E747D', fill: null, highlight: null, shadow: null, count: big };
  const s = o.dark ? SILVER_D : SILVER_L;
  if (skin === 'titanium') {
    return {
      ring: `linear-gradient(135deg, ${s[0]} 0%, ${s[1]} 35%, ${s[2]} 60%, ${s[3]} 85%, ${s[0]} 100%)`, width: 1.5, border: null, fill: null,
      highlight: o.dark ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%)' : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%)',
      shadow: o.dark ? '0px 0px 18px 0px rgba(200, 206, 214, 0.16)' : '0px 6px 18px 0px rgba(16, 24, 40, 0.12)', count: big,
    };
  }
  if (skin === 'line') {
    const lc = hex(o.line || '') ? (o.line as string) : '#A9AFB8';
    const a = mix(lc, s[0], 0.15), b = mix(lc, s[2], 0.55);
    return {
      ring: `linear-gradient(135deg, ${a} 0%, ${b} 45%, ${s[0]} 70%, ${mix(lc, s[1], 0.4)} 100%)`, width: 1.5, border: null, fill: null,
      highlight: o.dark ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%)' : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
      shadow: `0px ${o.dark ? 0 : 6}px 22px 0px ${rgba(lc, o.dark ? 0.32 : 0.22)}`, count: big,
    };
  }
  // glass: a lighter, see through fill with a bright top edge and a hairline ring that fades down the sides.
  return {
    ring: o.dark ? 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0.22) 100%)'
      : 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(160,168,180,0.45) 50%, rgba(255,255,255,0.9) 100%)',
    width: 1, border: null,
    fill: o.dark ? 'linear-gradient(180deg, rgba(58,60,66,0.92) 0%, rgba(36,37,41,0.86) 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(246,247,250,0.82) 100%)',
    highlight: o.dark ? 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.05) 100%)' : 'linear-gradient(90deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.3) 100%)',
    shadow: o.dark ? '0px 8px 24px 0px rgba(0, 0, 0, 0.45)' : '0px 8px 24px 0px rgba(30, 40, 60, 0.14)', count: big,
  };
}
