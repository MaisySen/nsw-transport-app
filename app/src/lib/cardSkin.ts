// Which look the commute card uses, and whether the phone asks for solid colours. The shipped look is Line glow (B);
// in development the others stay switchable (on the web: ?card=plain, titanium, line or glass).
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { skinFrom, type CardSkin } from './cardSkinCore';

/** The look shipped to everyone. */
export const SHIPPED_SKIN: CardSkin = 'line';

/** The card look: SHIPPED_SKIN, or in development the one asked for. */
export function useCardSkin(): CardSkin {
  if (!__DEV__) return SHIPPED_SKIN;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('card');
      if (q) return skinFrom(q);
    }
    const g = (globalThis as any).__TAB_CARD_SKIN;
    if (g) return skinFrom(g);
  } catch {}
  return SHIPPED_SKIN;
}

/** Reduce Transparency, Increase Contrast (iPhone) or High contrast text (Android): draw solid borders, no glow. */
export function useSolidLook(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const ask = async (f?: () => Promise<boolean>) => { try { return f ? await f() : false; } catch { return false; } };
      let v = false;
      if (Platform.OS === 'web') {
        try { v = !!(window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches || window.matchMedia?.('(prefers-contrast: more)').matches); } catch {}
      } else {
        const A: any = AccessibilityInfo;
        v = (await ask(A.isReduceTransparencyEnabled?.bind(A))) || (await ask(A.isDarkerSystemColorsEnabled?.bind(A))) || (await ask(A.isHighTextContrastEnabled?.bind(A)));
      }
      if (alive) setOn(v);
    };
    read();
    const subs: { remove: () => void }[] = [];
    if (Platform.OS !== 'web') {
      for (const ev of ['reduceTransparencyChanged', 'darkerSystemColorsChanged', 'highTextContrastChanged']) {
        try { subs.push(AccessibilityInfo.addEventListener(ev as any, read as any)); } catch {}
      }
    }
    return () => { alive = false; subs.forEach((s) => { try { s.remove(); } catch {} }); };
  }, []);
  return on;
}
