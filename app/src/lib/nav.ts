import { router, type Href } from 'expo-router';

/**
 * Back, or to `fallback` when there is nothing to go back to (the screen was opened from a link, a widget, a
 * notification or Siri as the first screen). A bare router.back() does nothing there: a dead button.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
