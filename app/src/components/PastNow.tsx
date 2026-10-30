// The "Earlier" header and the "Now, 5:08pm" divider between gone services and the ones still to come (pastNowCore.ts),
// shared by the trip screen's list and a stop's board. iOS: a grouped list section header (footnote caps, secondary
// label) and a tint rule with its label; Android (Material 3): a title-small label and an outline-variant divider in the
// primary colour. Both scale with the text size.
import { useRef } from 'react';
import { Platform, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openSettled, scrollToNow } from '@/lib/pastNowCore';
import { usePalette } from '@/lib/theme';
import { useFlag } from '@/lib/config';
import { PAST_NOW } from '@/lib/features';
import { T } from './ui';

const android = Platform.OS === 'android';

/** On unless PAST_NOW is false or the server turned pastNow off. A hook, so call it on every render. */
export function usePastNow() {
  const on = useFlag('pastNow');
  return PAST_NOW && on;
}

export function EarlierHeader({ count }: { count: number }) {
  const c = usePalette();
  return (
    <View accessibilityRole="header" accessibilityLabel={`Earlier, ${count === 1 ? '1 service' : `${count} services`} already gone`}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 32, marginTop: 18, marginBottom: 6 }}>
      <T kind={android ? 'sub' : 'foot'} tone="text2" maxFontSizeMultiplier={1.4}
        style={android ? { fontWeight: '600' } : { textTransform: 'uppercase', letterSpacing: 0.2 }}>Earlier</T>
    </View>
  );
}

export function NowDivider({ label, a11y, onLayout }: { label: string; a11y: string; onLayout?: (y: number) => void }) {
  const c = usePalette();
  // A solid accent band between the two zones (palette nowBg/nowText, 4.5:1 or more): "Now" on the left, the clock
  // on the right, a down arrow saying the services to come are below.
  const [word, time] = label.includes(', ') ? label.split(', ') : [label, ''];
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={a11y} onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, marginBottom: 8, minHeight: 34, paddingHorizontal: 14, paddingVertical: 6,
        borderRadius: android ? 17 : 10, backgroundColor: c.nowBg }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.nowText, marginRight: 8 }} />
      <T kind={android ? 'sub' : 'sub'} maxFontSizeMultiplier={1.4} style={{ color: c.nowText, fontWeight: '700', flex: 1 }}>{word}</T>
      {time ? <T kind="sub" maxFontSizeMultiplier={1.4} style={{ color: c.nowText, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{time}</T> : null}
      <T kind="sub" accessible={false} maxFontSizeMultiplier={1.4} style={{ color: c.nowText, fontWeight: '700', marginLeft: 8 }}>{'\u2193'}</T>
    </View>
  );
}

/** The next service's light mark: a short tint bar on the card's leading edge, beside the first row still to come. */
export function NextMark() {
  const c = usePalette();
  return <View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: 0, top: 12, height: 52, width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2, backgroundColor: c.tint }} />;
}

/** Open the list at Now (pastNowCore.scrollToNow): the screen gives its scroll view this ref, calls onDrag from its drag
 * start and onDividerLayout from the Now row's layout. Once per list key, never after the reader has scrolled, and
 * never because a row went on the minute tick after the list was first shown. The server flag pastNowScroll (false)
 * turns only this part off. */
export function useOpenAtNow(on: boolean, key: string, rows: number, divider: boolean) {
  const scrollOn = useFlag('pastNowScroll');
  const ref = useRef<ScrollViewInstance>(null);
  const done = useRef<string | null>(null);
  const dragged = useRef(false);
  const seenKey = useRef(key);
  const insets = useSafeAreaInsets();
  if (seenKey.current !== key) { seenKey.current = key; dragged.current = false; }
  if (done.current !== key && openSettled(on && scrollOn, rows, divider)) done.current = key;
  // iPhone: the header is see-through and the list scrolls under it (headerOptions.ts); a standard bar is 44 pt.
  const headerH = Platform.OS === 'ios' ? insets.top + 44 : 0;
  const onDividerLayout = (y: number) => {
    const target = scrollToNow({ split: { divider }, dividerY: y, done: done.current, key, dragged: dragged.current, headerH });
    if (target == null) return;
    done.current = key;
    ref.current?.scrollTo({ y: target, animated: false });
  };
  return { ref, onDividerLayout, onDrag: () => { dragged.current = true; } };
}
