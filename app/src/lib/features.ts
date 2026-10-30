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

// FREQUENT_LINES (30 Oct): on a stop's board for now, a line and direction with at least 4 services in the next 30
// minutes, none more than 10 minutes apart, gets one line above the list ("M1 to Tallawong: every 3 to 5 min"),
// worked out on the phone from the rows the board already has (frequentCore.ts). No request, no server part. Off is
// this one line (false) and an over the air update.
export const FREQUENT_LINES = true;
