// The server's x-serves words for this phone (servesCore.ts), kept on the phone so a cold open already knows them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getConfig } from './config';
import { configServes, createServes } from './servesCore';

const KEY = 'serves:v1';
const S = createServes();
let loaded: Promise<void> | null = null;

/** Reads the kept words once (a few ms); every request that places ids waits on it the first time. */
export function loadServes(): Promise<void> {
  if (!loaded) loaded = AsyncStorage.getItem(KEY).then((raw) => { if (raw) S.load(JSON.parse(raw)); }).catch(() => {});
  return loaded;
}

/** One answer from the server: its x-serves header (or none). */
export function noteServes(base: string, path: string, status: number, header: string | null | undefined) {
  if (S.note(base, path, status, header)) AsyncStorage.setItem(KEY, JSON.stringify(S.snapshot())).catch(() => {});
}

/** True when the server at this address said the word, or the app config switched it on. */
export function serves(word: string, base: string): boolean {
  return S.has(word, base, configServes(getConfig()));
}
