#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

/// The Live Activity for a trip you started with Start trip: Lock Screen and Dynamic Island.
public struct LiveTripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var line: String
        public var lineColorHex: String
        public var mode: String
        /// "Strathfield"
        public var nextStop: String?
        public var stopsLeft: Int?
        /// Where you get off this leg.
        public var getOffAt: String
        /// When you arrive at the end of the trip.
        public var arrival: Date
        /// wait, ride or change
        public var phase: String
        /// "Tight change at Central" or "You'll likely miss the 5:12pm T1".
        public var warning: String?
        /// Share of stops done on this leg, 0 to 1.
        public var progress: Double
        /// Not shown on the Lock Screen any more; kept so older cards still decode.
        public var fareLine: String?
        /// "Central": where this leg's service is going.
        public var towards: String?
        /// "Platform 2" for the leg you are waiting for.
        public var platform: String?
        /// When this leg leaves your stop.
        public var departs: Date?
        /// When this leg gets to where you get off.
        public var legArrives: Date?
        /// "Kings Cross": the end of the whole trip.
        public var destination: String?
        /// When the app loaded the live times on this card. Cards from older app code have none.
        public var updated: Date?
        /// The leg's stops for the stop track that replaces the plain bar (build 210). Older app code and server pushes
        /// send none, and the card then draws the bar as before.
        public var stopTrack: StopTrack?

        public init(line: String, lineColorHex: String, mode: String, nextStop: String?, stopsLeft: Int?, getOffAt: String,
                    arrival: Date, phase: String, warning: String?, progress: Double, fareLine: String? = nil,
                    towards: String? = nil, platform: String? = nil, departs: Date? = nil, legArrives: Date? = nil, destination: String? = nil, updated: Date? = nil,
                    stopTrack: StopTrack? = nil) {
            self.line = line; self.lineColorHex = lineColorHex; self.mode = mode; self.nextStop = nextStop
            self.stopsLeft = stopsLeft; self.getOffAt = getOffAt; self.arrival = arrival; self.phase = phase
            self.warning = warning; self.progress = progress; self.fareLine = fareLine
            self.towards = towards; self.platform = platform; self.departs = departs; self.legArrives = legArrives
            self.destination = destination
            self.updated = updated
            self.stopTrack = stopTrack
        }
    }

    /// The stops on the leg (app/platform/tripCard.ts stopTrackFor, the server sends the same). `passed`: stops behind
    /// you, your boarding stop included. `next`: the stops to come, next first and your stop off last, at most 10.
    /// `hidden`: stops left out after the first `hiddenAt` names of a long ride. `live`: false when only the
    /// timetable says where the run is, and the card labels it so. A missing field reads as empty, never failing the card.
    public struct StopTrack: Codable, Hashable {
        public var passed: Int
        public var next: [String]
        public var hidden: Int
        public var hiddenAt: Int
        public var live: Bool

        public init(passed: Int, next: [String], hidden: Int = 0, hiddenAt: Int = 0, live: Bool) {
            self.passed = passed; self.next = next; self.hidden = hidden; self.hiddenAt = hiddenAt; self.live = live
        }

        enum CodingKeys: String, CodingKey { case passed, next, hidden, hiddenAt, live }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            passed = max(0, (try? c.decode(Int.self, forKey: .passed)) ?? 0)
            next = (try? c.decode([String].self, forKey: .next)) ?? []
            hidden = max(0, (try? c.decode(Int.self, forKey: .hidden)) ?? 0)
            hiddenAt = max(0, (try? c.decode(Int.self, forKey: .hiddenAt)) ?? 0)
            live = (try? c.decode(Bool.self, forKey: .live)) ?? false
        }
    }

    public var title: String
    public var legsCount: Int

    public init(title: String, legsCount: Int) {
        self.title = title
        self.legsCount = legsCount
    }
}

/// The words on the trip card. `stale` is true once the system marks the card out of date.
/// A card with `updated` (app code from 25 Oct 2026) goes stale 2 minutes after its live times, when the app can no
/// longer refresh it; it then says "Updated 8:21am" and shows clock times instead of a countdown, so it never claims
/// "now" from old data. A card without `updated` goes stale at its arrival time and says it has arrived, as before.
extension LiveTripAttributes.ContentState {
    public func arrived(stale: Bool) -> Bool { phase == "arrived" || (stale && updated == nil) }

    /// True when the live times on the card are old: show them as clock times with when they are from.
    public func outdated(stale: Bool) -> Bool { stale && updated != nil && phase != "arrived" }

    /// "Updated 8:21am".
    public var updatedLine: String { updated.map { "Updated \(Clock.time($0))" } ?? "" }

    /// The label over the big number: "Leaves", "Get off", "Arrived"; with old times "Leaves about" or "Get off about".
    public func countdownLabel(stale: Bool) -> String {
        if arrived(stale: stale) { return "Arrived" }
        let base = phase == "wait" ? "Leaves" : "Get off"
        return outdated(stale: stale) ? "\(base) about" : base
    }

    /// The delay beside the Dynamic Island countdown and after "2 stops" on the Lock Screen (build 211, owner's build 210
    /// iPhone, 31 Oct: the Lock Screen said "3 min late", the Island did not): "3 min late" when that is the card's whole
    /// warning (app/platform/tripCard.ts legNote), "On time" when the card's stops are live and it has no warning.
    /// Nothing for old times, an arrived card, a timetable card or a change warning (those stay where they were).
    public func delayStatus(stale: Bool) -> String? {
        if arrived(stale: stale) || outdated(stale: stale) { return nil }
        if let w = warning?.trimmingCharacters(in: .whitespaces), !w.isEmpty {
            return w.range(of: #"^[0-9]+ min late$"#, options: .regularExpression) != nil ? w : nil
        }
        return stopTrack?.live == true ? "On time" : nil
    }

    /// A missed or at risk change shows red, a tight one orange.
    public var warningIsRed: Bool { (warning ?? "").contains("miss") || (warning ?? "").contains("risk") }

    /// Waiting: "To Central". On board: "Get off at Redfern". At the end: "You've arrived at Strathfield".
    public func headline(stale: Bool = false) -> String {
        if arrived(stale: stale) { return "You've arrived at \(destination ?? getOffAt)" }
        if phase == "wait" { return "To \(towards ?? getOffAt)" }
        return "Get off at \(getOffAt)"
    }

    /// Waiting: "Leaves 9:51pm, Platform 2". On board: "3 stops" or "Next stop". At the end: the time.
    public func detail(stale: Bool = false) -> String {
        if arrived(stale: stale) { return "Got in at \(Clock.time(arrival)). The trip has ended." }
        if phase == "wait" {
            var t = departs.map { "Leaves \(Clock.time($0))" } ?? "Board at \(nextStop ?? "")"
            if let p = platform, !p.isEmpty { t += ", \(p)" }
            return t
        }
        if let n = stopsLeft, n > 1 { return "\(n) stops" }
        if let n = stopsLeft, n == 1 { return "Next stop" }
        return nextStop.map { "Next stop: \($0)" } ?? ""
    }

    /// What the big number counts to: leaving while you wait, getting off while on board.
    public var countdownTarget: Date { phase == "wait" ? (departs ?? arrival) : (legArrives ?? arrival) }

    /// The Dynamic Island on board: "Off Redfern", or "Change Redfern" when another leg follows.
    public var compactAction: String {
        let off = Naming.compact(Naming.short(getOffAt))
        if let d = destination, Naming.compact(Naming.short(d)) != off { return "Change \(off)" }
        return "Off \(off)"
    }

    /// The Dynamic Island on board from build 209: just where you get off with a colon, "Redfern:", so the compact
    /// view stays short and the system clock beside it stays visible (28 Oct).
    public var compactStation: String { "\(Naming.compact(Naming.short(getOffAt))):" }

    public var arriveLine: String { "Arrive \(destination ?? getOffAt) \(Clock.time(arrival))" }

    /// "Arrive 5:28pm": the arrival when the whole line does not fit beside the next stop.
    public var arriveTimeLine: String { "Arrive \(Clock.time(arrival))" }

    /// The stop track replaces the plain bar on a running card that carries the leg's stops (build 210). An arrived
    /// card, and a card from older app code or an older server, keeps the bar.
    public func showsTrack(stale: Bool) -> Bool {
        guard let t = stopTrack, !t.next.isEmpty, !arrived(stale: stale) else { return false }
        return t.next.allSatisfy { !$0.isEmpty }
    }

    /// Stops still to come on this leg, your stop off included.
    public var trackStopsLeft: Int { (stopTrack?.next.count ?? 0) + (stopTrack?.hidden ?? 0) }

    /// The words under the stop track. On board "Next: Lyons Rd", or "Next: Five Dock Shops, your stop"; when only the
    /// timetable says where the run is, "Next by timetable: Lyons Rd" (never shown as live). Waiting "6 stops to
    /// Five Dock Shops". Nil when the live times are old: the card says when they are from instead.
    public func trackNext(stale: Bool, short: Bool = false) -> String? {
        guard showsTrack(stale: stale), let t = stopTrack, let first = t.next.first, !outdated(stale: stale) else { return nil }
        let n = trackStopsLeft
        if phase == "wait" {
            let stops = n == 1 ? "1 stop" : "\(n) stops"
            return short ? stops : "\(stops) to \(Naming.compact(Naming.short(getOffAt)))"
        }
        if !t.live { return short ? "Timetable: \(first)" : "Next by timetable: \(first)" }
        if n == 1 && !short { return "Next: \(first), your stop" }
        return "Next: \(first)"
    }

    /// VoiceOver for the stop track: what the dots and the bell say.
    public var trackAccessibility: String {
        guard let t = stopTrack, let last = t.next.last, let first = t.next.first else { return "" }
        let n = trackStopsLeft
        let stops = n == 1 ? "1 stop" : "\(n) stops"
        if phase == "wait" { return "\(stops) from your stop to \(last), where you get off." }
        var s = "Next stop \(first). \(stops) to \(last), where you get off."
        if !t.live { s += " Where the service is comes from the timetable, not live." }
        return s
    }
}
#endif
