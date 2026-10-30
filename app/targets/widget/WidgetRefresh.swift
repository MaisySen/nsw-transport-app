import Foundation

/// When a widget asks iOS for fresh live times, and how far ahead its timeline reaches (30 Oct, build 210).
///
/// Why: up to build 209 every widget asked for a new timeline every 5 to 15 minutes, all day and all night. That is
/// 96 to 288 asks a day per widget, well past the 40 to 70 a day WidgetKit gives a widget, so iOS served the asks
/// later and later and, once the day's budget was gone, not at all until the app was opened (a reload from the app in
/// front is free). The timeline also ended after 20 minutes (15 on the stop board), so a late reload froze the minutes.
///
/// Now: the timeline has an entry every minute for an hour, so the minutes keep counting down and services drop off
/// by the clock however late iOS reloads; and the asks are spent where they matter: every 15 minutes in the weekday
/// peaks, 20 minutes in the rest of the day, 30 in the evening, hourly overnight: about 65 a weekday, 59 on a weekend. A trip in progress keeps its 5 minutes.
///
/// Pure Foundation: app/test/swift/widgetrefresh/main.swift compiles it on its own and checks it.
public enum WidgetRefresh {
    /// How far ahead the minute entries reach.
    public static let horizon: TimeInterval = 60 * 60
    /// Weekday peaks (6:30 to 9:30am and 3:30 to 7pm, Sydney).
    public static let busyEvery: TimeInterval = 15 * 60
    /// Daytime otherwise (5am to 9pm).
    public static let dayEvery: TimeInterval = 20 * 60
    /// 9pm to 12:30am.
    public static let eveningEvery: TimeInterval = 30 * 60
    /// 12:30 to 5am: hourly, so the timeline (an hour long) never runs out.
    public static let nightEvery: TimeInterval = 60 * 60
    /// The last fetch failed (offline, server slow): try again in this long.
    public static let offlineEvery: TimeInterval = 15 * 60
    /// A trip in progress (read from the app's card, no network).
    public static let liveEvery: TimeInterval = 5 * 60
    /// Never sooner than this, however short the list, outside a trip in progress.
    public static let floor: TimeInterval = 5 * 60
    /// Seconds a widget waits for the server before it shows what it saved last time.
    public static let fetchTimeout: TimeInterval = 8

    public enum Band: String { case busy, day, evening, night }

    static var sydney: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Sydney") ?? .current
        return c
    }

    /// Which part of the day `at` is in, on the Sydney clock.
    public static func band(at: Date) -> Band {
        let cal = sydney
        let p = cal.dateComponents([.hour, .minute, .weekday], from: at)
        let m = (p.hour ?? 0) * 60 + (p.minute ?? 0)
        let weekday = (2...6).contains(p.weekday ?? 1)
        if m >= 30 && m < 5 * 60 { return .night }
        if m >= 21 * 60 || m < 30 { return .evening }
        if weekday && ((m >= 6 * 60 + 30 && m < 9 * 60 + 30) || (m >= 15 * 60 + 30 && m < 19 * 60)) { return .busy }
        return .day
    }

    public static func every(_ b: Band) -> TimeInterval {
        switch b {
        case .busy: return busyEvery
        case .day: return dayEvery
        case .evening: return eveningEvery
        case .night: return nightEvery
        }
    }

    /// When to ask for fresh live times. `departures` are the services on the widget, `live` a trip in progress,
    /// `failed` that this fetch did not answer (the widget shows saved times, not live).
    public static func next(updated: Date, departures: [Date], live: Bool = false, failed: Bool = false) -> Date {
        let ahead = departures.filter { $0 > updated }.sorted()
        if live {
            let soon = updated.addingTimeInterval(liveEvery)
            guard let first = ahead.first else { return soon }
            return min(soon, max(first, updated.addingTimeInterval(60)))
        }
        let b = band(at: updated)
        var gap = every(b)
        if failed { gap = max(offlineEvery, b == .night ? nightEvery : 0) }
        let latest = updated.addingTimeInterval(gap)
        // Quiet hours: never sooner than 10 minutes. Otherwise sooner when the list is down to its last service,
        // so the next ones show up, but not before the floor.
        let least = updated.addingTimeInterval(b == .night || b == .evening ? max(floor, 10 * 60) : floor)
        guard !failed, ahead.count >= 2 else {
            return ahead.isEmpty || failed ? latest : max(least, min(latest, ahead[0]))
        }
        return min(latest, max(ahead[ahead.count - 2], least))
    }

    /// The moments the widget redraws: every minute for `horizon`, plus the moment each service leaves, so the
    /// minutes keep counting down and a service that has left is never on screen, with no network and no timer.
    public static func entryDates(updated: Date, departures: [Date], horizon: TimeInterval = WidgetRefresh.horizon) -> [Date] {
        let n = max(1, Int(horizon / 60))
        let end = updated.addingTimeInterval(Double(n) * 60)
        var set = Set((0..<n).map { updated.addingTimeInterval(Double($0) * 60) })
        for d in departures where d > updated && d < end { set.insert(d) }
        return set.sorted()
    }

    /// About how many asks a day the policy makes for a widget whose list never runs short (the budget check).
    public static func asksPerDay(from start: Date) -> Int {
        var t = start, n = 0
        let end = start.addingTimeInterval(86_400)
        while t < end {
            t = next(updated: t, departures: [t.addingTimeInterval(7200), t.addingTimeInterval(7300)])
            n += 1
        }
        return n
    }
}
