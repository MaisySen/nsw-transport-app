// Switches for whole features, kept in one place.
//
// LIVE_DATA_AGE: a live row's "Live 30 s ago" counts from when the server read that time upstream (the row's liveAt:
// the realtime feed copy for engine boards, the Trip Planner answer otherwise), corrected for the phone's clock with
// the answer's own `now`, instead of from when the phone received the answer. Shown only where rows already show
// their live state (LiveStatus, LivePill). Off until the server's liveAt is live and checked on a device; turning it
// on is this one line (true) and an over the air update.
export const LIVE_DATA_AGE = false;
