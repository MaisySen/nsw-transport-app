import { Platform, useColorScheme } from 'react-native';

// iOS system colours (light / dark) so the app reads like a first party iPhone app.
// Android gets Material 3 neutral surfaces with the same accent family.
const ios = {
  light: {
    bg: '#F2F2F7', card: '#FFFFFF', card2: '#F2F2F7', fill: 'rgba(120,120,128,0.12)', text: '#000000', text2: 'rgba(60,60,67,0.6)', text3: 'rgba(60,60,67,0.3)',
    sep: 'rgba(60,60,67,0.29)', tint: '#007AFF', green: '#34C759', liveText: '#248A3D', orange: '#FF9500', lateText: '#C93400', red: '#FF3B30', yellow: '#FFCC00', indigo: '#5856D6',
  },
  dark: {
    bg: '#000000', card: '#1C1C1E', card2: '#2C2C2E', fill: 'rgba(120,120,128,0.24)', text: '#FFFFFF', text2: 'rgba(235,235,245,0.6)', text3: 'rgba(235,235,245,0.3)',
    sep: 'rgba(84,84,88,0.65)', tint: '#0A84FF', green: '#30D158', liveText: '#30D158', orange: '#FF9F0A', lateText: '#FF9F0A', red: '#FF453A', yellow: '#FFD60A', indigo: '#5E5CE6',
  },
};
const md = {
  light: { ...ios.light, bg: '#F7F9FC', card: '#FFFFFF', card2: '#EEF1F6', fill: '#E3E7EE', tint: '#1F6FEB', text2: '#4A5260', text3: '#9AA2AF', sep: '#E1E4EA' },
  dark: { ...ios.dark, bg: '#111317', card: '#1B1E24', card2: '#252931', fill: '#2C313A', tint: '#8AB4F8', text2: '#BCC3CE', text3: '#6B7280', sep: '#2C313A' },
};

export type Palette = typeof ios.light;

export function usePalette(): Palette & { dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const set = Platform.OS === 'android' ? md : ios;
  return { ...(dark ? set.dark : set.light), dark };
}

export const isIOS = Platform.OS === 'ios';
export const radius = Platform.select({ ios: 12, android: 16, default: 12 }) as number;

// Brand colours for modes, used when the feed has no colour.
export const modeColor: Record<string, string> = {
  train: '#F99D1C', metro: '#168388', bus: '#00B5EF', lightrail: '#E4022D', ferry: '#5AB031', coach: '#742282', school: '#5C5C5C',
};
