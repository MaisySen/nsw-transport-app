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

        public init(line: String, lineColorHex: String, mode: String, nextStop: String?, stopsLeft: Int?, getOffAt: String,
                    arrival: Date, phase: String, warning: String?, progress: Double, fareLine: String? = nil,
                    towards: String? = nil, platform: String? = nil, departs: Date? = nil, legArrives: Date? = nil, destination: String? = nil, updated: Date? = nil) {
            self.line = line; self.lineColorHex = lineColorHex; self.mode = mode; self.nextStop = nextStop
            self.stopsLeft = stopsLeft; self.getOffAt = getOffAt; self.arrival = arrival; self.phase = phase
            self.warning = warning; self.progress = progress; self.fareLine = fareLine
            self.towards = towards; self.platform = platform; self.departs = departs; self.legArrives = legArrives
            self.destination = destination
            self.updated = updated
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
}
#endif
