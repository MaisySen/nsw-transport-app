// Switches for whole features, kept in one place.
//
// PLATFORM_VIEW: the station board (app/platform.tsx). Off since 26 Oct: the owner asked for it to stay hidden
// until its stop lists are reliable. While false, nothing opens it: no icon on the stop screen, no item in the hold
// menu, openPlatform() does nothing, and a link straight to /platform goes to Home. The code stays in the repo;
// turning it back on is this one line (true) and an over the air update.
export const PLATFORM_VIEW = false;

// LIVE_DATA_AGE: a live row's "Live 30 s ago" counts from when the server read that time upstream (the row's liveAt:
// the realtime feed copy for engine boards, the Trip Planner answer otherwise), corrected for the phone's clock with
// the answer's own `now`, instead of from when the phone received the answer. Shown only where rows already show
// their live state (LiveStatus, LivePill). Off until the server's liveAt is live and checked on a device; turning it
// on is this one line (true) and an over the air update.
export const LIVE_DATA_AGE = false;
