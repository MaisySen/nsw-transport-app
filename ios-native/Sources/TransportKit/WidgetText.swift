import Foundation

/// Words the widgets show, kept out of the views so they can be tested.
/// Rules: never a seconds timer, whole minutes under an hour, the clock time past that.
public enum WidgetText {
    /// "Now", "4 min", or the clock time ("11:14pm") when it leaves an hour or more from now.
    public static func wait(_ leave: Date, from now: Date) -> String {
        let s = leave.timeIntervalSince(now)
        if s >= 3600 { return Clock.time(leave) }
        let m = Int((s / 60).rounded(.down))
        return m <= 0 ? "Now" : "\(m) min"
    }

    /// VoiceOver words for the same wait.
    public static func spokenWait(_ leave: Date, from now: Date) -> String {
        let s = leave.timeIntervalSince(now)
        if s >= 3600 { return "at \(Clock.time(leave))" }
        let m = Int((s / 60).rounded(.down))
        return m <= 0 ? "now" : (m == 1 ? "in 1 minute" : "in \(m) minutes")
    }

    /// "Platform 1" and "Stand A" become "Plat 1" and "Stand A".
    public static func plat(_ p: String?) -> String? {
        guard let p = p?.trimmingCharacters(in: .whitespaces), !p.isEmpty else { return nil }
        if p.lowercased().hasPrefix("platform ") { return "Plat " + p.dropFirst("platform ".count) }
        if p.allSatisfy(\.isNumber) { return "Plat \(p)" }
        return p
    }

    /// "On time", "3 min late", "Cancelled", or "No live data" when the service has no live times.
    public static func status(isLive: Bool, status: String) -> String {
        if status == "Cancelled" { return status }
        if !isLive || status == "Scheduled" || status.isEmpty { return "No live data" }
        return status
    }

    /// "1 change", "2 changes", or nil for a direct trip.
    public static func changes(_ n: Int) -> String? {
        n <= 0 ? nil : (n == 1 ? "1 change" : "\(n) changes")
    }

    /// One short line for an alert: drops the line name the badge already shows
    /// ("T1 Western Line: Trains run to a changed timetable" becomes "Trains run to a changed timetable")
    /// and, when still too long, ends at a whole word with an ellipsis. Never cuts a word in half.
    public static func compactAlert(_ text: String, maxChars: Int) -> String {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = t.range(of: ":"), t.distance(from: t.startIndex, to: r.lowerBound) <= 40 {
            let head = t[..<r.lowerBound]
            let codeLike = head.first?.isLetter == true && head.dropFirst().first?.isNumber == true
            let looksLikeLine = head.contains(" Line") || codeLike
            let rest = t[r.upperBound...].trimmingCharacters(in: .whitespaces)
            if looksLikeLine && !rest.isEmpty { t = rest }
        }
        t = t.replacingOccurrences(of: "  ", with: " ")
        if let f = t.first, f.isLowercase { t = f.uppercased() + t.dropFirst() }
        if t.count <= maxChars { return t }
        var out = ""
        for w in t.split(separator: " ") {
            let next = out.isEmpty ? String(w) : out + " " + w
            if next.count + 1 > maxChars { break }
            out = next
        }
        if out.isEmpty { return String(t.prefix(max(1, maxChars - 1))) + "\u{2026}" }
        while let l = out.last, ",.;:".contains(l) { out.removeLast() }
        return out + "\u{2026}"
    }

    /// When the widget should redraw: every minute for 20 minutes, plus the moment each service
    /// leaves, so a departed service is never on screen.
    public static func entryDates(updated: Date, departures: [Date], minutes: Int = 20) -> [Date] {
        let end = updated.addingTimeInterval(Double(minutes) * 60)
        var set = Set((0..<minutes).map { updated.addingTimeInterval(Double($0) * 60) })
        for d in departures where d > updated && d < end { set.insert(d) }
        return set.sorted()
    }

    /// When to fetch fresh live data: about every 5 minutes, or when the next service leaves if
    /// that comes first (never sooner than a minute).
    public static func reloadDate(updated: Date, departures: [Date]) -> Date {
        let five = updated.addingTimeInterval(300)
        guard let first = departures.filter({ $0 > updated }).min() else { return five }
        return min(five, max(first, updated.addingTimeInterval(60)))
    }

    /// Services still to come at `date`. A service is gone the moment it leaves.
    public static func upcoming<T>(_ items: [T], at date: Date, leave: (T) -> Date) -> [T] {
        items.filter { leave($0) > date }
    }

    /// The widget title: a saved trip's name, else "From to To".
    public static func title(name: String, from: String, to: String) -> String {
        let n = name.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty && n != to && n != "Transport" { return n }
        if from.isEmpty || to.isEmpty { return n.isEmpty ? "Next trip" : n }
        return "\(from) to \(to)"
    }

    /// The Lock Screen inline line: "T1 4 min, Plat 2".
    public static func inline(line: String, leave: Date, platform: String?, now: Date) -> String {
        var s = "\(line) \(wait(leave, from: now))"
        if let p = plat(platform) { s += ", \(p)" }
        return s
    }

    /// The link a widget row opens: that trip, at that departure.
    public static func tripURL(from: String, to: String, leave: Date?) -> URL? {
        guard !from.isEmpty, !to.isEmpty else { return URL(string: "nswtransport://tab/home") }
        var s = "nswtransport://trip/\(from)/\(to)"
        if let leave { s += "?at=\(Int(leave.timeIntervalSince1970))" }
        return URL(string: s)
    }

    /// The link the alert line opens: the alerts for this trip.
    public static func alertsURL(from: String, to: String) -> URL? {
        guard !from.isEmpty, !to.isEmpty else { return URL(string: "nswtransport://tab/home") }
        return URL(string: "nswtransport://alerts/\(from)/\(to)")
    }

    /// The journey a widget row meant: the one leaving closest to `at`, within 2 minutes
    /// (live times move a little between the widget and the app).
    public static func closest(_ journeys: [Journey], to at: Date, within: TimeInterval = 120) -> Journey? {
        journeys
            .compactMap { j in j.leave.map { (j, abs($0.timeIntervalSince(at))) } }
            .filter { $0.1 <= within }
            .min { $0.1 < $1.1 }?.0
    }
}
