import Foundation

// Shapes of the JSON served by the backend.
// Every field the server may leave out is optional so a missing value never breaks decoding.

public struct StopRef: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var modes: [Int]?
    public var distance: Double?

    public init(id: String, name: String, modes: [Int]? = nil, distance: Double? = nil) {
        self.id = id
        self.name = name
        self.modes = modes
        self.distance = distance
    }
}

public struct SearchResponse: Codable, Sendable {
    public var items: [StopRef]
}

public struct NearbyResponse: Codable, Sendable {
    public var stops: [StopRef]?
}

public struct Occupancy: Codable, Hashable, Sendable {
    public var level: Int?
    public var text: String?
}

public struct Vehicle: Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double
    public var bearing: Double?
    public var speedKmh: Double?
    public var ageS: Double?
    public var label: String?
    public var occupancy: Occupancy?
}

public struct StatusInfo: Codable, Hashable, Sendable {
    public var key: String?
    public var text: String?
}

public struct Prediction: Codable, Hashable, Sendable {
    public var text: String?
    public var short: String?
    public var n: Int?
}

public struct ServiceAlert: Codable, Hashable, Sendable, Identifiable {
    public var id: String { stableID ?? url ?? title ?? "alert" }
    public var stableID: String?
    public var title: String?
    public var url: String?
    public var priority: String?
    public var lines: [String]?

    enum CodingKeys: String, CodingKey {
        case stableID = "id"
        case title, url, priority, lines
    }

    public init(stableID: String?, title: String?, url: String?, priority: String?, lines: [String]?) {
        self.stableID = stableID; self.title = title; self.url = url; self.priority = priority; self.lines = lines
    }

    /// Departures carry alerts as bare ids that point into the board's alert list; legs carry full objects.
    public init(from decoder: Decoder) throws {
        if let c = try? decoder.singleValueContainer(), let s = try? c.decode(String.self) {
            self.init(stableID: s, title: nil, url: nil, priority: nil, lines: nil)
            return
        }
        let k = try decoder.container(keyedBy: CodingKeys.self)
        self.init(stableID: try k.decodeIfPresent(String.self, forKey: .stableID),
                  title: try k.decodeIfPresent(String.self, forKey: .title),
                  url: try k.decodeIfPresent(String.self, forKey: .url),
                  priority: try k.decodeIfPresent(String.self, forKey: .priority),
                  lines: try k.decodeIfPresent([String].self, forKey: .lines))
    }

    public var isSerious: Bool {
        let p = (priority ?? "").lowercased()
        return p == "high" || p == "veryhigh" || p == "very high"
    }
}

public struct Departure: Codable, Hashable, Sendable, Identifiable {
    public var id: String { "\(tripId ?? line)-\(stopId ?? "")-\(planned?.timeIntervalSince1970 ?? 0)" }
    public var mode: String?
    public var modeName: String?
    public var line: String
    public var color: String?
    public var dest: String?
    public var destId: String?
    public var description: String?
    public var platform: String?
    public var platformChangedFrom: String?
    public var stopId: String?
    public var stopName: String?
    public var tripId: String?
    public var planned: Date?
    public var estimated: Date?
    public var realtime: Bool?
    public var delayMin: Int?
    public var cancelled: Bool?
    public var wheelchair: Bool?
    public var occupancy: Occupancy?
    public var alerts: [ServiceAlert]?
    public var vehicle: Vehicle?
    public var stopsAway: Int?
    public var status: StatusInfo?
    public var pred: Prediction?

    /// The time to show as the main number: live when the feed has it, else the timetable.
    public var bestTime: Date? { (isLive ? estimated : nil) ?? planned }
    /// True only when the server says this time is realtime. A scheduled time is never live.
    public var isLive: Bool { realtime == true && estimated != nil }
    public var isCancelled: Bool { cancelled == true }
}

public struct LiveInfo: Codable, Hashable, Sendable {
    public var feedAt: Double?
    public var liveCount: Int?
    public var total: Int?
}

public struct DeparturesResponse: Codable, Sendable {
    public var stop: StopRef?
    public var items: [Departure]
    public var modes: [String]?
    public var alerts: [ServiceAlert]?
    public var live: LiveInfo?

    /// The full alerts for one departure, looked up by id in the board's list.
    public func alerts(for d: Departure) -> [ServiceAlert] {
        let all = alerts ?? []
        return (d.alerts ?? []).compactMap { ref in
            if ref.title != nil { return ref }
            return all.first { $0.stableID == ref.stableID }
        }
    }
}

public struct Leg: Codable, Hashable, Sendable, Identifiable {
    public var id: String { "\(kind)-\(tripId ?? "")-\(stopId ?? from ?? "")-\(planned?.timeIntervalSince1970 ?? 0)" }
    public var kind: String
    public var mode: String?
    public var modeName: String?
    public var line: String?
    public var color: String?
    public var towards: String?
    public var destId: String?
    public var tripId: String?
    public var stopId: String?
    public var toStopId: String?
    public var from: String?
    public var fromPlatform: String?
    public var to: String?
    public var toPlatform: String?
    public var planned: Date?
    public var estimated: Date?
    public var arrPlanned: Date?
    public var arrEstimated: Date?
    public var realtime: Bool?
    public var delayMin: Int?
    public var durationMin: Int?
    public var stops: Int?
    public var cancelled: Bool?
    public var occupancy: Occupancy?
    public var platformChangedFrom: String?
    public var alerts: [ServiceAlert]?
    public var path: [[Double]]?
    /// Step free access and lift status where you board and get off (stations only).
    public var access: LegAccess?

    public var isWalk: Bool { kind == "walk" }
    public var isLive: Bool { realtime == true && estimated != nil }
    public var departTime: Date? { (isLive ? estimated : nil) ?? planned }
    public var arriveTime: Date? { (realtime == true ? arrEstimated : nil) ?? arrPlanned }
}

public struct Journey: Codable, Hashable, Sendable, Identifiable {
    public var id: String { "\(leave?.timeIntervalSince1970 ?? 0)-\(arrive?.timeIntervalSince1970 ?? 0)-\(legs.count)" }
    public var leave: Date?
    public var board: Date?
    public var arrive: Date?
    public var durationMin: Int?
    public var changes: Int?
    public var live: Bool?
    public var anyCancelled: Bool?
    public var risk: String?
    public var beaten: Bool?
    public var legs: [Leg]
    /// Opal fare estimate for the fare type sent with the request.
    public var fare: Fare?
    /// A tight or missed change on a multi leg trip, as text.
    public var warn: String?

    public var transitLegs: [Leg] { legs.filter { !$0.isWalk } }
    public var firstTransit: Leg? { transitLegs.first }
}

public struct TripResponse: Codable, Sendable {
    public var from: StopRef?
    public var to: StopRef?
    public var saved: String?
    public var journeys: [Journey]
    public var tomorrow: Bool?
    /// True when the request asked for step free trips only.
    public var accessible: Bool?
    /// Live Park and Ride spaces when the first leg starts at a Park and Ride station.
    public var parking: TripParking?
}

public struct ServiceStop: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var lat: Double?
    public var lon: Double?
    public var planned: Date?
    public var estimated: Date?
    public var passed: Bool?
    public var mine: Bool?
    public var alight: Bool?
    public var skipped: Bool?

    public var bestTime: Date? { estimated ?? planned }
}

public struct WhereInfo: Codable, Hashable, Sendable {
    public var text: String?
    public var near: String?
    public var next: String?
}

public struct ServiceResponse: Codable, Sendable {
    public var tripId: String?
    public var mode: String?
    public var line: String?
    public var color: String?
    public var dest: String?
    public var live: Bool?
    public var delayMin: Int?
    public var cancelled: Bool?
    public var vehicle: Vehicle?
    public var `where`: WhereInfo?
    public var nextIndex: Int?
    public var mineIndex: Int?
    /// Where you get off, when the request named it with `to`.
    public var alightIndex: Int?
    public var stopsAway: Int?
    public var stops: [ServiceStop]
    public var path: [[Double]]?
    public var alerts: [ServiceAlert]?
}

public struct SavedTrip: Codable, Hashable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var from: StopRef
    public var to: StopRef
}

public struct SavedResponse: Codable, Sendable {
    public var items: [SavedTrip]
}

public struct Commute: Codable, Hashable, Sendable, Identifiable {
    public var id: FlexID
    public var name: String?
    public var from: StopRef
    public var to: StopRef
    public var tod: Int
    public var todText: String?
    public var days: String?
    public var active: Bool?
}

public struct CommuteSuggestion: Codable, Hashable, Sendable {
    public var from: StopRef?
    public var to: StopRef?
    public var tod: Int?
    public var todText: String?
    public var name: String?
    public var key: String?
}

public struct CommutesResponse: Codable, Sendable {
    public var items: [Commute]
    public var suggestion: CommuteSuggestion?
}

/// One leg of a watch, in the exact shape the server expects on POST /api/watch.
public struct WatchLeg: Codable, Hashable, Sendable {
    public var mode: String?
    public var line: String?
    public var tripId: String?
    public var stopId: String?
    public var toStopId: String?
    public var from: String?
    public var to: String?
    public var planned: Date?
    public var arrPlanned: Date?
    public var estimated: Date?
    public var fromPlatform: String?
    public var toPlatform: String?
    public var color: String?
    public var towards: String?
    public var destId: String?
    public var walkBefore: Int?

    public init(mode: String?, line: String?, tripId: String?, stopId: String?, toStopId: String?, from: String?, to: String?,
                planned: Date?, arrPlanned: Date?, estimated: Date?, fromPlatform: String?, toPlatform: String?,
                color: String?, towards: String?, destId: String?, walkBefore: Int?) {
        self.mode = mode; self.line = line; self.tripId = tripId; self.stopId = stopId; self.toStopId = toStopId
        self.from = from; self.to = to; self.planned = planned; self.arrPlanned = arrPlanned; self.estimated = estimated
        self.fromPlatform = fromPlatform; self.toPlatform = toPlatform; self.color = color; self.towards = towards
        self.destId = destId; self.walkBefore = walkBefore
    }
}

public struct SnapLeg: Codable, Hashable, Sendable {
    public var dep: Double?
    public var depLive: Bool?
    public var arr: Double?
    public var arrLive: Bool?
    public var delay: Int?
    public var platform: String?
    public var platformFrom: String?
    public var cancelled: Bool?
}

public struct WatchSnap: Codable, Hashable, Sendable {
    public var at: Double?
    public var phase: String?
    public var legs: [SnapLeg]?
}

public struct Watch: Codable, Hashable, Sendable, Identifiable {
    public var id: FlexID
    public var kind: String?
    public var title: String?
    public var active: Bool?
    public var ended: String?
    public var created: Double?
    public var expires: Double?
    public var legs: [WatchLeg]?
    public var lead: Int?
    public var snap: WatchSnap?
    public var replanned: Int?
}

public struct WatchNote: Codable, Hashable, Sendable, Identifiable {
    public var id: FlexID
    public var watch_id: FlexID?
    public var at: Double?
    public var title: String?
    public var body: String?
}

public struct WatchesResponse: Codable, Sendable {
    public var items: [Watch]
    public var notes: [WatchNote]?
    public var lastTick: Double?
}

public struct WatchRequest: Codable, Sendable {
    public var device: String
    public var profile: String
    public var kind: String
    public var title: String
    public var legs: [WatchLeg]
    public var origin: StopRef?
    public var to: StopRef?
    public var lead: Int

    public init(device: String, profile: String, kind: String, title: String, legs: [WatchLeg], origin: StopRef?, to: StopRef?, lead: Int) {
        self.device = device; self.profile = profile; self.kind = kind; self.title = title
        self.legs = legs; self.origin = origin; self.to = to; self.lead = lead
    }
}

/// The answer to POST /api/watch: the new watch id and the first note the server sent about it.
public struct WatchCreated: Codable, Sendable {
    public struct Created: Codable, Sendable {
        public var id: FlexID?
        public var phase: String?
        public var ended: Bool?
        public var sent: [Sent]?
    }
    public struct Sent: Codable, Sendable {
        public var title: String?
        public var body: String?
    }
    public var ok: Bool?
    public var watch: Created?
}

// MARK: Building watches, matching the web app (svcSpec and tripSpec in app.js)

public extension Departure {
    func watchRequest(device: String, profile: String, lead: Int = 5) -> WatchRequest {
        let towards = Naming.short(dest ?? "")
        let leg = WatchLeg(mode: mode, line: line, tripId: tripId, stopId: stopId, toStopId: nil,
                           from: Naming.short(stopName ?? ""), to: nil, planned: planned, arrPlanned: nil,
                           estimated: estimated, fromPlatform: platform ?? "", toPlatform: nil, color: color,
                           towards: towards, destId: destId, walkBefore: nil)
        return WatchRequest(device: device, profile: profile, kind: "svc", title: "\(line) to \(towards)",
                            legs: [leg], origin: nil, to: nil, lead: lead)
    }
}

public extension Journey {
    func watchRequest(device: String, profile: String, from: StopRef, to: StopRef, extraLead: Int = 0) -> WatchRequest {
        var legsOut: [WatchLeg] = []
        var walk = 0
        for x in legs {
            if x.isWalk { walk += x.durationMin ?? 0; continue }
            legsOut.append(WatchLeg(mode: x.mode, line: x.line, tripId: x.tripId, stopId: x.stopId, toStopId: x.toStopId,
                                    from: x.from, to: x.to, planned: x.planned, arrPlanned: x.arrPlanned,
                                    estimated: x.estimated, fromPlatform: x.fromPlatform, toPlatform: x.toPlatform,
                                    color: x.color, towards: Naming.short(x.towards ?? ""), destId: x.destId, walkBefore: walk))
            walk = 0
        }
        let firstWalk = legsOut.first?.walkBefore ?? 0
        return WatchRequest(device: device, profile: profile, kind: "trip",
                            title: "\(Naming.short(from.name)) to \(Naming.short(to.name))",
                            legs: legsOut, origin: from, to: to, lead: firstWalk + extraLead)
    }
}

public enum Naming {
    /// "Strathfield Station, Albert Rd, Stand G" becomes "Strathfield Station".
    public static func short(_ s: String) -> String {
        let first = s.split(separator: ",").first.map(String.init) ?? s
        return first.trimmingCharacters(in: .whitespaces)
    }

    /// For tight spaces: "Burwood Station to Central Station" becomes "Burwood to Central".
    public static func compact(_ s: String) -> String {
        s.replacingOccurrences(of: " Station", with: "")
    }
}

/// An id the server may send as a number or a string.
public struct FlexID: Codable, Hashable, Sendable, CustomStringConvertible {
    public var value: String
    public init(_ value: String) { self.value = value }
    public var description: String { value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let i = try? c.decode(Int.self) { value = String(i) }
        else { value = String(try c.decode(Double.self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}
