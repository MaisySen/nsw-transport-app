import { Platform, useColorScheme } from 'react-native';

// iOS system colours (light / dark) so the app reads like a first party iPhone app.
// Android gets Material 3 neutral surfaces with the same accent family.
const ios = {
  light: {
    bg: '#F2F2F7', card: '#FFFFFF', card2: '#F2F2F7', fill: 'rgba(120,120,128,0.12)', text: '#000000', text2: 'rgba(60,60,67,0.6)', text3: 'rgba(60,60,67,0.3)',
    sep: 'rgba(60,60,67,0.29)', tint: '#007AFF', green: '#34C759', liveText: '#248A3D', orange: '#FF9500', lateText: '#C93400', red: '#FF3B30', yellow: '#FFCC00', indigo: '#5856D6',
    redText: '#D70015', liveBg: '#248A3D',
  },
  dark: {
    bg: '#000000', card: '#1C1C1E', card2: '#2C2C2E', fill: 'rgba(120,120,128,0.24)', text: '#FFFFFF', text2: 'rgba(235,235,245,0.6)', text3: 'rgba(235,235,245,0.3)',
    sep: 'rgba(84,84,88,0.65)', tint: '#0A84FF', green: '#30D158', liveText: '#30D158', orange: '#FF9F0A', lateText: '#FF9F0A', red: '#FF453A', yellow: '#FFD60A', indigo: '#5E5CE6',
    redText: '#FF6961', liveBg: '#1B7431',
  },
};
const md = {
  // Every text colour here is at least 4.5:1 on bg, card, card2 and fill (checked by test/a11y.test.mjs).
  light: { ...ios.light, bg: '#F7F9FC', card: '#FFFFFF', card2: '#EEF1F6', fill: '#E3E7EE', tint: '#1A5FCF', text2: '#4A5260', text3: '#5F6672', sep: '#E1E4EA',
    liveText: '#1B7431', lateText: '#B02F00', redText: '#B3261E', liveBg: '#1B7431' },
  dark: { ...ios.dark, bg: '#111317', card: '#1B1E24', card2: '#252931', fill: '#2C313A', tint: '#8AB4F8', text2: '#BCC3CE', text3: '#9099A6', sep: '#2C313A',
    liveText: '#4ADE80', lateText: '#FFB74D', redText: '#FF8A80', liveBg: '#1B7431' },
};

export type Palette = typeof ios.light;
/** Both palettes, for the contrast test. */
export const palettes = { ios, md };

/** Android styling. The web export can be built with EXPO_PUBLIC_LOOK=android to preview it in a browser. */
export const androidLook = Platform.OS === 'android' || (Platform.OS === 'web' && process.env.EXPO_PUBLIC_LOOK === 'android');

export function usePalette(): Palette & { dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const set = androidLook ? md : ios;
  return { ...(dark ? set.dark : set.light), dark };
}

export const isIOS = Platform.OS === 'ios';
export const radius = androidLook ? 16 : 12;

// Brand colours for modes, used when the feed has no colour.
export const modeColor: Record<string, string> = {
  train: '#F99D1C', metro: '#168388', bus: '#00B5EF', lightrail: '#E4022D', ferry: '#5AB031', coach: '#742282', school: '#5C5C5C',
};

function lum(hex: string) {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return 0.2;
  const h = hex.slice(1, 7);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
/** Contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** White or near black text, whichever reads better on a line or badge colour (light lines like T1 orange get dark text). */
export function onColor(bg: string) {
  return contrast('#FFFFFF', bg) >= contrast('#111111', bg) ? '#FFFFFF' : '#111111';
}
