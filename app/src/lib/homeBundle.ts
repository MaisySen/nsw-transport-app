// Home in one request (homeBundleCore.ts): the phone's one bundle state, the reads noted last time kept on the phone,
// and whether Home is the screen on view (a return to the front sends a bundle only then).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createHomeBundle, type HomeLists } from './homeBundleCore';

const KEY = 'homeBundle:v1';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const homeBundle = createHomeBundle(
  { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as any) },
  (lists: HomeLists) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; AsyncStorage.setItem(KEY, JSON.stringify(lists)).catch(() => {}); }, 500);
  },
);

let loaded: Promise<void> | null = null;
/** Reads the kept list once (lib/boot.ts reads it with everything else before the first frame). */
export function loadHomeBundle(): Promise<void> {
  if (!loaded) loaded = AsyncStorage.getItem(KEY).then((raw) => { if (raw) homeBundle.load(JSON.parse(raw)); }).catch(() => {});
  return loaded;
}

let onView = false;
/** Home says when it is the screen on view (its focus effect). */
export function setHomeOnView(on: boolean) { onView = on; }
export const homeOnView = () => onView;
