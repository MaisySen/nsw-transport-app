import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, LayoutAnimation, Platform, View, type KeyboardEvent } from 'react-native';
import { keyboardOverlap } from './keyboardCore';

/**
 * Keeps the bottom of a view clear of the keyboard on iPhone. Put `ref` and `onLayout` on the view that holds the
 * list and the field, and give it `paddingBottom: pad`. The overlap is measured in window coordinates (the view's
 * bottom edge against the keyboard's top edge), so it is right whether the view ends at the screen edge or above
 * the floating tab bar, and needs no guessed header offset. Android resizes the window for the keyboard, so `pad`
 * stays 0 there. `onShow` runs after the keyboard has come up (a chat uses it to show its latest message).
 */
export function useKeyboardPad(onShow?: () => void) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [pad, setPad] = useState(0);
  const kbTop = useRef<number | null>(null);
  const show = useRef(onShow);
  show.current = onShow;

  const measure = useCallback((animate?: KeyboardEvent) => {
    const v = ref.current;
    if (!v || typeof v.measureInWindow !== 'function') return;
    v.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const next = keyboardOverlap(y + h, kbTop.current);
      setPad((prev) => {
        if (prev === next) return prev;
        if (animate && animate.duration) {
          LayoutAnimation.configureNext({ duration: Math.max(animate.duration, 10), update: { duration: Math.max(animate.duration, 10), type: (LayoutAnimation.Types as any)[animate.easing] || 'keyboard' } });
        }
        return next;
      });
      if (next > 0) show.current?.();
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const change = Keyboard.addListener('keyboardWillChangeFrame', (e) => { kbTop.current = e.endCoordinates?.screenY ?? null; measure(e); });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => { kbTop.current = null; measure(e); });
    return () => { change.remove(); hide.remove(); };
  }, [measure]);

  // The view's own frame does not change with the padding, so a new layout (rotation, a resized window) re-measures.
  const onLayout = useCallback(() => { if (kbTop.current != null) measure(); }, [measure]);
  return { ref, onLayout, pad: Platform.OS === 'ios' ? pad : 0 };
}
