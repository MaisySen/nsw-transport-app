#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

/// The Live Activity for a trip you started with Start trip: Lock Screen and Dynamic Island.
/// Keep this struct identical to targets/widget/LiveTripActivity.swift, which draws it.
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
        /// Build 212 (G31): the leg's delay in whole minutes, from the same live time the countdown uses (more than 0 late,
        /// less than 0 early, 0 on time). Nil when not known; older app code and servers send none, and the card then
        /// reads the delay from the warning as build 211 did.
        public var delayMin: Int?
        /// Build 212 (G31): whether `departs` and `legArrives` are live times (false: timetable). Nil from older senders.
        public var departsLive: Bool?
        public var legArrivesLive: Bool?

        public init(line: String, lineColorHex: String, mode: String, nextStop: String?, stopsLeft: Int?, getOffAt: String,
                    arrival: Date, phase: String, warning: String?, progress: Double, fareLine: String? = nil,
                    towards: String? = nil, platform: String? = nil, departs: Date? = nil, legArrives: Date? = nil, destination: String? = nil, updated: Date? = nil,
                    stopTrack: StopTrack? = nil, delayMin: Int? = nil, departsLive: Bool? = nil, legArrivesLive: Bool? = nil) {
            self.line = line; self.lineColorHex = lineColorHex; self.mode = mode; self.nextStop = nextStop
            self.stopsLeft = stopsLeft; self.getOffAt = getOffAt; self.arrival = arrival; self.phase = phase
            self.warning = warning; self.progress = progress; self.fareLine = fareLine
            self.towards = towards; self.platform = platform; self.departs = departs; self.legArrives = legArrives
            self.destination = destination
            self.updated = updated
            self.stopTrack = stopTrack
            self.delayMin = delayMin; self.departsLive = departsLive; self.legArrivesLive = legArrivesLive
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
#endif
