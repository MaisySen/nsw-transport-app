// Header options for the tab stacks (Home, Plan, Ask, More) and the stop screen.
//
// No large titles. On iPhone (iOS 26, build 203) a large title under the transparent header with
// headerBlurEffect is drawn behind the blur: the app opened with an empty dark band where "Home" should
// be and the content pushed down, and only a scroll (which collapses the large title) showed the
// normal header. The standard title is the state that renders correctly, so every launch and every
// return to the app looks the same. Pure data so the unit tests can check it without React Native.

export type HeaderPalette = { tint: string; bg: string; text?: string };

export function tabHeaderOptions(os: string, c: HeaderPalette) {
  const ios = os === 'ios';
  return {
    headerLargeTitle: false,
    headerTransparent: ios,
    headerBlurEffect: 'systemChromeMaterial' as const,
    headerShadowVisible: false,
    headerTintColor: c.tint,
    headerStyle: os === 'android' ? { backgroundColor: c.bg } : undefined,
    contentStyle: { backgroundColor: c.bg },
  };
}

/** The stop screen: same header, no title text (the screen draws its own heading). */
export function stopHeaderOptions(os: string) {
  const ios = os === 'ios';
  return {
    title: '',
    headerLargeTitle: false,
    headerTransparent: ios,
    headerBlurEffect: 'systemChromeMaterial' as const,
    headerShadowVisible: false,
  };
}

/**
 * New trip and Add a trip (sheets on iPhone). iOS 26 draws the sheet's navigation bar over the top of the screen
 * whatever the header settings say, and build 206 showed the station picker's own heading under the Back button
 * and the title. So on iPhone the bar is transparent on purpose, scrolling screens inset themselves (the
 * ScrollView's automatic content inset, as in the tabs) and the station picker moves its top edge down by the
 * measured header height. Android keeps a solid Material 3 top app bar.
 */
export function sheetHeaderOptions(os: string, c: HeaderPalette) {
  const ios = os === 'ios';
  return {
    headerLargeTitle: false,
    headerTransparent: ios,
    headerBlurEffect: 'systemChromeMaterial' as const,
    headerShadowVisible: false,
    headerTintColor: c.tint,
    headerStyle: os === 'android' ? { backgroundColor: c.bg } : undefined,
    headerTitleAlign: 'center' as const,
    // The title in the label colour (only the buttons take the tint), as in system sheets.
    headerTitleStyle: c.text ? { color: c.text } : undefined,
  };
}
