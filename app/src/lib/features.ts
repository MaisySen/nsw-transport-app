// Switches for whole features, kept in one place.
//
// LIVE_DATA_AGE: a live row's "Live 30 s ago" counts from when the server read that time upstream (the row's liveAt:
// the realtime feed copy for engine boards, the Trip Planner answer otherwise), corrected for the phone's clock with
// the answer's own `now`, instead of from when the phone received the answer. Shown only where rows already show
// their live state (LiveStatus, LivePill). On since 28 Oct (liveness pass): the server's liveAt has been live since
// 26 Oct and since 28 Oct it is the feed copy's own header time; a row's age can only grow from it (rowSeenAt never
// makes a row younger than its answer), and the GPS age is not counted twice (liveLead). Off is this one line (false)
// and an over the air update.
export const LIVE_DATA_AGE = true;
