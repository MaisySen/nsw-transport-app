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

// PAST_NOW (30 Oct, Bidur testing build 209: "Hard to differentiate past and current list here"): on the trip screen's
// list and a stop's board, gone services sit in their own muted card under an "Earlier" header, a "Now, 5:08pm" divider
// marks where the services still to come start, the next one is lightly marked, and the list opens at Now (pastNowCore.ts).
// Gone is decided exactly as before (over a minute past, phone clock) and the minute tick the screens already have
// redraws it. Off is this one line (false) and an over the air update, or the server flag pastNow (false) at once.
export const PAST_NOW = true;
