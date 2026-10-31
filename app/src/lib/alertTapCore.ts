// Where a tapped alert opens (1 Nov follow-up, Bidur's bus then T4 trip). The server's trip alerts carry the trip's
// watch id (data.watch, url "/#/watch/<id>") and no go flag, so a tap on "At Central: change here" opened the Watching
// screen, whose one button is "Stop watching". The trip was stopped 12 s later and the T4 leg never ran. An alert of the
// trip in progress on this phone now opens the live trip. Pure, so the tests check it.

export type TapData = { go?: unknown; watch?: unknown } | null | undefined;

/** "go": the live trip screen; "watch": that watch's own screen; null: neither (the caller looks at the other kinds). */
export function alertTapRoute(d: TapData, live: { watchId?: string | null } | null | undefined): 'go' | 'watch' | null {
  if (!d) return null;
  if (d.go) return 'go';
  if (d.watch == null || d.watch === '') return null;
  return live && live.watchId && String(d.watch) === String(live.watchId) ? 'go' : 'watch';
}
