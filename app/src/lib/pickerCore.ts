// The stop and station pickers (New trip, Add a trip, Plan): the words in the search field and the keyboard
// settings every search field shares. Pure data so the unit tests can check it without React Native.

/** Longest placeholder that still fits a 390 pt wide iPhone search field at the body size. */
export const PLACEHOLDER_MAX = 34;

/**
 * The question asked by the station picker, shown as the search field's placeholder (the navigation bar shows the
 * title, "From" or "To"). The To step names where you got on ("Kings Cross to where?") when that fits on one line.
 */
export function pickerPlaceholder(which: 'from' | 'to', fromName?: string) {
  if (which === 'from') return 'Where do you get on?';
  const named = fromName ? `${fromName} to where?` : '';
  return named && named.length <= PLACEHOLDER_MAX ? named : 'Where do you get off?';
}

/**
 * Every search field: no automatic capitals (stop names, route numbers like 410 or M30 and stop numbers all match
 * without them; build 206 turned caps lock on in the bus search), no autocorrect or spell check (it rewrites stop
 * names), and a Search key on the keyboard.
 */
export const searchFieldProps = {
  autoCapitalize: 'none' as const,
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off' as const,
  returnKeyType: 'search' as const,
  enterKeyHint: 'search' as const,
};
