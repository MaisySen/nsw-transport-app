import * as Haptics from 'expo-haptics';

// Haptics never block a tap: each call is fire and forget and can't throw. Call it after the action
// (navigation, state change), so a slow or failing vibration never stands between a tap and its result.
const safe = (p: () => Promise<unknown>) => { try { p().catch(() => {}); } catch {} };
export const haptic = {
  select: () => safe(() => Haptics.selectionAsync()),
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** One light tap: "leave now" and arrival on a live trip. */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
