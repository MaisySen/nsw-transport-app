import Foundation

/// When a widget may still call a time live (build 209). The same rule as the app's rows
/// (app/src/lib/liveLabelCore.ts, 28 Oct liveness pass): a live time whose data is over 5 minutes old
/// (LIVE_MAX_MS), or over 2 minutes old (STALE_DATA_MS) for a service under 10 minutes away (STALE_NEAR_MS),
/// is shown as its timetable time with "Updated N min ago" instead of a live time.
///
/// The data's age counts from the feed's own time where the answer has it (a board row's `liveAt`, the
/// answer's `live.feedTs`), else the newest fetch (`live.feedAt`), else when the widget asked. The server's `now`
/// turns that into the phone's clock, so a phone whose clock is off does not make data look newer or older.
///
/// Pure Foundation: app/test/swift/WidgetLiveCheck.swift compiles it on its own and checks it.
/// No timer: the widget timeline already has an entry every minute, and each entry asks this rule again.
public enum WidgetLive {
    /// LIVE_MAX_MS: never live past this, however far off the service is.
    public static let maxAge: TimeInterval = 300
    /// STALE_DATA_MS: a service close by stops counting down past this.
    public static let nearAge: TimeInterval = 120
    /// STALE_NEAR_MS: what "close by" means.
    public static let nearWindow: TimeInterval = 600
    /// A feed time more than a day before the fetch is not a feed time.
    static let maxTrust: TimeInterval = 86_400

    /// When the live data was made, on the phone's clock. `feedMs` is the feed's own time in ms since 1970 and
    /// `serverNowMs` the server's clock in the same answer; both optional (older servers send neither).
    public static func dataAt(fetched: Date, feedMs: Double?, serverNowMs: Double?) -> Date {
        guard let f = feedMs, f.isFinite, f > 0 else { return fetched }
        var age: TimeInterval
        if let n = serverNowMs, n.isFinite, n > 0 { age = (n - f) / 1000 } else { age = fetched.timeIntervalSince1970 - f / 1000 }
        if !age.isFinite || age < 0 { age = 0 }
        if age > maxTrust { return fetched.addingTimeInterval(-maxTrust) }
        return fetched.addingTimeInterval(-age)
    }

    /// The oldest of several feed times (ms), ignoring missing ones; nil when there are none.
    public static func oldest(_ ms: [Double?]) -> Double? {
        ms.compactMap { $0 }.filter { $0.isFinite && $0 > 0 }.min()
    }

    /// Whether a live time for a service leaving at `leave`, from data made at `dataAt`, is still live at `at`.
    public static func isFresh(dataAt: Date, leave: Date, at: Date) -> Bool {
        let age = at.timeIntervalSince(dataAt)
        if age > maxAge { return false }
        if leave.timeIntervalSince(at) < nearWindow && age > nearAge { return false }
        return true
    }

    /// "Updated 7 min ago" (never "0 min"); past an hour, "Updated over an hour ago".
    public static func ago(_ dataAt: Date, at: Date) -> String {
        let m = Int(max(0, at.timeIntervalSince(dataAt)) / 60)
        if m >= 60 { return "Updated over an hour ago" }
        return "Updated \(max(1, m)) min ago"
    }

    /// The timetable time behind a live one: the live time less the first service's delay. `live` and
    /// `planned` are that service's own live and timetable times; with either missing, nil.
    public static func timetable(leave: Date, live: Date?, planned: Date?) -> Date? {
        guard let l = live, let p = planned else { return nil }
        return leave.addingTimeInterval(-l.timeIntervalSince(p))
    }

    /// One row at one moment: its time and whether it is still live. A stale live row shows its timetable time
    /// (or keeps its time when it has none); a row that was never live is left alone.
    public static func settle(leave: Date, timetable: Date?, isLive: Bool, dataAt: Date?, at: Date) -> (leave: Date, isLive: Bool, demoted: Bool) {
        guard isLive, let d = dataAt else { return (leave, isLive, false) }
        if isFresh(dataAt: d, leave: leave, at: at) { return (leave, true, false) }
        return (timetable ?? leave, false, true)
    }
}
