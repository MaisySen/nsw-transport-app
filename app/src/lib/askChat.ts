// Ask chat history on this phone, shared by the Ask tab and More > Privacy and data (Clear chat in either place
// empties the other at once). Kept in AsyncStorage under the same key as before, capped at ASK_KEEP messages.
import { useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ASK_KEEP, capHistory, clearChatWords, parseHistory } from './askChatCore';

export const ASK_KEY = 'ask_chat_v1';

type AnyMsg = { id: string; role: 'me' | 'bot'; text: string; [k: string]: any };
let cur: AnyMsg[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = AsyncStorage.getItem(ASK_KEY).then((v) => {
      // A message sent before the saved chat was read stays after it.
      cur = capHistory([...parseHistory<AnyMsg>(v), ...cur]);
    }).catch(() => {}).finally(() => { loaded = true; emit(); });
  }
  return loading;
}

/** The chat, oldest first, and whether it has been read from the phone yet. */
export function useAskChat<T extends AnyMsg>(): { msgs: T[]; ready: boolean } {
  load();
  const msgs = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur) as T[];
  return { msgs, ready: loaded };
}

/** Changes the chat and saves it (the newest ASK_KEEP messages). */
export function setAskChat<T extends AnyMsg>(f: (m: T[]) => T[]) {
  cur = capHistory(f(cur as T[]), ASK_KEEP);
  emit();
  if (loaded) AsyncStorage.setItem(ASK_KEY, JSON.stringify(cur)).catch(() => {});
  else load().then(() => AsyncStorage.setItem(ASK_KEY, JSON.stringify(cur)).catch(() => {}));
}

/** How many messages are saved, without opening Ask. */
export async function askChatCount(): Promise<number> {
  await load();
  return cur.length;
}

/** Deletes the chat on this phone. Ask keeps no chat on the server (only trip searches, see More). */
export async function clearAskChat() {
  cur = [];
  emit();
  await AsyncStorage.removeItem(ASK_KEY).catch(() => {});
}

/**
 * Asks before clearing: the system alert on iPhone and Android. The web has no alerts, so it is given `sheet`,
 * which shows the same choice in the app's own sheet.
 */
export function confirmClearChat(count: number, run: () => void, sheet?: (w: { title: string; message: string; confirm: string }) => void) {
  const w = clearChatWords(count);
  if (Platform.OS === 'web') {
    if (sheet) sheet(w); else run();
    return;
  }
  Alert.alert(w.title, w.message, [{ text: 'Cancel', style: 'cancel' }, { text: w.confirm, style: 'destructive', onPress: run }]);
}
