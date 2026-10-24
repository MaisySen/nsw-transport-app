import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Build 9: Opal fare estimates, station access, Park and Ride, Opal machines, multi leg plans,
// history deletion and live trips. Shapes follow docs/API.md on the backend.

// MARK: Opal fare estimates

public struct OffPeakSaving: Codable, Hashable, Sendable {
    public var from: String?
    public var save: Double?
}

public struct FareLeg: Codable, Hashable, Sendable {
    public var line: String?
    public var mode: String?
    public var km: Double?
    public var peak: Bool?
    public var fare: Double?
    public var transferOff: Double?
    public var airportFee: Double?
    public var amount: Double?
    public var joined: Bool?
}

public struct Fare: Codable, Hashable, Sendable {
    public var type: String?
    public var typeName: String?
    public var total: Double?
    public var peak: Bool?
    public var offPeak: OffPeakSaving?
    public var transfer: Double?
    public var airportFee: Double?
    public var capped: Bool?
    public var unknown: Bool?
    public var legs: [FareLeg]?
    public var estimate: Bool?

    /// "Adult, off peak" or "Child, peak".
    public var summary: String {
        "\(typeName ?? FareType.current.title), \(peak == true ? "peak" : "off peak")"
    }

    /// "Off peak from 7pm, save $1.62", when the trip is in peak.
    public var offPeakText: String? {
        guard let o = offPeak, let save = o.save, save > 0 else { return nil }
        return "Off peak from \(o.from ?? "7pm"), save \(Money.text(save))"
    }
}

public enum FareType: String, CaseIterable, Identifiable, Sendable {
    case adult, child, concession, gold

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .adult: return "Adult"
        case .child: return "Child"
        case .concession: return "Concession"
        case .gold: return "Gold"
        }
    }

    /// The row titles in Settings.
    public var longTitle: String {
        switch self {
        case .adult: return "Adult"
        case .child: return "Child or Youth"
        case .concession: return "Concession"
        case .gold: return "Gold Senior or Pensioner"
        }
    }

    public static var current: FareType {
        FareType(rawValue: TripPrefs.fare) ?? .adult
    }
}

public enum Money {
    public static func text(_ d: Double) -> String {
        String(format: "$%.2f", d)
    }
}

/// Settings every trip request carries, shared with the widget through the app group.
public enum TripPrefs {
    static var defaults: UserDefaults { AppIdentity.groupDefaults }

    /// adult, child, concession or gold.
    public static var fare: String {
        get { defaults.string(forKey: "tb_fare") ?? "adult" }
        set { defaults.set(newValue, forKey: "tb_fare") }
    }

    /// Step free trips only (acc=1).
    public static var accessible: Bool {
        get { defaults.bool(forKey: "tb_acc") }
        set { defaults.set(newValue, forKey: "tb_acc") }
    }

    /// The extra query items for /api/trip, /api/plan, /api/next and /api/ask.
    public static var query: [String: String?] {
        ["fare": fare, "acc": accessible ? "1" : nil]
    }
}

/// Peak hours for the stop board nudge: Monday to Thursday, 6:30 to 10am and 3 to 7pm Sydney time.
public enum Peak {
    public static func isPeak(_ date: Date = Date()) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Sydney") ?? .current
        let c = cal.dateComponents([.weekday, .hour, .minute], from: date)
        guard let wd = c.weekday, (2...5).contains(wd) else { return false }
        let m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return (m >= 390 && m < 600) || (m >= 900 && m < 1140)
    }

    /// When off peak starts again: "10am" in the morning peak, else "7pm".
    public static func offPeakFrom(_ date: Date = Date()) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Sydney") ?? .current
        return cal.component(.hour, from: date) < 12 ? "10am" : "7pm"
    }
}

// MARK: Station access

public struct AccessPoint: Codable, Hashable, Sendable {
    public var id: String?
    public var level: String?
    public var lift: Bool?
    public var outage: String?
    public var outages: Int?
}

public struct LegAccess: Codable, Hashable, Sendable {
    public var from: AccessPoint?
    public var to: AccessPoint?
}

public enum AccessText {
    public static func level(_ l: String?) -> String {
        switch l {
        case "independent": return "Step free access"
        case "assisted": return "Assisted access"
        case "none": return "No step free access"
        default: return "Access not known"
        }
    }

    public static func chip(_ l: String?) -> String {
        switch l {
        case "independent": return "Step free"
        case "assisted": return "Assisted access"
        case "none": return "Not step free"
        default: return "Access not known"
        }
    }
}

public struct StationAccess: Codable, Hashable, Sendable {
    public var level: String?
    public var label: String?
    public var note: String?
    public var lift: Bool?
    public var escalator: Bool?
    public var ramp: Bool?
    public var hearingLoop: Bool?
    public var tactile: Bool?
}

public struct StationTicket: Codable, Hashable, Sendable {
    public var kind: String?
    public var label: String?
    public var cash: Bool?
}

public struct LiftOutage: Codable, Hashable, Sendable, Identifiable {
    public var id: FlexID?
    public var kind: String?
    public var title: String?
    public var detail: String?
    public var url: String?

    public var identity: String { id?.value ?? (title ?? "") }
}

public struct CarPark: Codable, Hashable, Sendable, Identifiable {
    public var id: FlexID
    public var name: String?
    public var station: String?
    public var spots: Int?
    public var free: Int?
    public var occupied: Int?
    public var status: String?
    public var label: String?
    public var updated: String?
    public var stale: Bool?
    public var lat: Double?
    public var lon: Double?
    public var address: String?

    public var updatedDate: Date? { updated.flatMap(ISODates.parse) }

    /// Share of spaces still free, 0 to 1.
    public var freeShare: Double {
        guard let s = spots, s > 0, let f = free else { return 0 }
        return min(1, max(0, Double(f) / Double(s)))
    }

    public var badge: String {
        if stale == true { return "No live count" }
        switch status {
        case "ok": return "Spaces free"
        case "nearly": return "Nearly full"
        case "full": return "Full"
        default: return "No live count"
        }
    }

    /// "Tallawong P1" at Tallawong reads "Car park P1"; "Kellyville (north)" reads "North car park".
    public func shortName(station: String?) -> String {
        let n = name ?? "Car park"
        let st = Naming.compact(Naming.short(station ?? ""))
        if let open = n.firstIndex(of: "("), let close = n.firstIndex(of: ")"), open < close {
            let inside = n[n.index(after: open)..<close].trimmingCharacters(in: .whitespaces)
            if !inside.isEmpty { return inside.prefix(1).uppercased() + String(inside.dropFirst()) + " car park" }
        }
        if !st.isEmpty, n.hasPrefix(st) {
            let rest = n.dropFirst(st.count).trimmingCharacters(in: .whitespaces)
            if !rest.isEmpty { return "Car park \(rest)" }
        }
        return n
    }
}

public struct StationInfo: Codable, Hashable, Sendable {
    public var id: String?
    public var name: String?
    public var access: StationAccess?
    public var ticket: StationTicket?
    public var facilities: [String]?
    public var shortPlatform: Bool?
    public var outages: [LiftOutage]?
    public var parking: [CarPark]?
    public var read: String?
}

public struct TripParking: Codable, Hashable, Sendable {
    public var station: StopRef?
    public var carparks: [CarPark]?
}

public struct TopupPlace: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var lat: Double?
    public var lon: Double?
    public var kind: String?
    public var label: String?
    public var cash: Bool?
    public var distance: Double?
}

public enum TicketText {
    public static func machine(_ kind: String?) -> String {
        switch kind {
        case "cash": return "Opal top up and tickets, Cash or card"
        case "card": return "Card only"
        case "topup": return "Opal top up machine, Card only"
        case "none": return "No Opal machine, Top up in the Opal Travel app or at a retailer"
        default: return "Opal machine not known"
        }
    }
}

// MARK: Multi leg trips

/// One leg of a trip you made: it starts where the one before it ends.
public struct TripLeg: Codable, Hashable, Sendable {
    public var mode: String?
    public var from: StopRef
    public var to: StopRef
    /// Minutes to change before this leg (legs after the first).
    public var conn: Int?
    /// This leg may use services with a change.
    public var any: Bool?
    /// Minutes for a walk leg.
    public var walk: Int?

    public init(mode: String?, from: StopRef, to: StopRef, conn: Int? = nil, any: Bool? = nil, walk: Int? = nil) {
        self.mode = mode; self.from = from; self.to = to; self.conn = conn; self.any = any; self.walk = walk
    }

    enum CodingKeys: String, CodingKey { case mode, from, to, conn, any, walk }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try? c.decodeIfPresent(String.self, forKey: .mode)
        from = try c.decode(StopRef.self, forKey: .from)
        to = try c.decode(StopRef.self, forKey: .to)
        conn = (try? c.decodeIfPresent(Int.self, forKey: .conn)) ?? nil
        any = (try? c.decodeIfPresent(Bool.self, forKey: .any)) ?? nil
        walk = (try? c.decodeIfPresent(Int.self, forKey: .walk)) ?? nil
    }

    /// The trip key: from id, then each leg end id, joined with ">".
    public static func key(_ legs: [TripLeg]) -> String {
        guard let first = legs.first else { return "" }
        return ([first.from.id] + legs.map(\.to.id)).joined(separator: ">")
    }

    /// The JSON the server takes in /api/plan?legs= and POST /api/saved.
    public static func wire(_ legs: [TripLeg]) -> String {
        var out: [[String: Any]] = []
        for (i, l) in legs.enumerated() {
            var o: [String: Any] = ["f": l.from.id, "fn": l.from.name, "t": l.to.id, "tn": l.to.name, "m": l.mode ?? ""]
            if i > 0, l.mode != "walk" { o["c"] = l.conn ?? 5 }
            if l.any == true { o["a"] = 1 }
            if l.mode == "walk" { o["w"] = l.walk ?? 5 }
            out.append(o)
        }
        let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// Reads the legs list Ask sends in a link (a JSON string).
    public static func parse(_ json: String?) -> [TripLeg]? {
        guard let json, let data = json.data(using: .utf8),
              let legs = try? JSONDecoder().decode([TripLeg].self, from: data), !legs.isEmpty else { return nil }
        return legs
    }
}

// MARK: Live trips

public struct ShareLink: Codable, Hashable, Sendable {
    public var id: String
    public var key: String
    public var url: String
    public var expires: Double?
}

/// The trip you started: saved on this phone until you end it.
public struct LiveTripRecord: Codable, Hashable, Sendable {
    public var title: String
    public var from: StopRef
    public var to: StopRef
    public var legs: [WatchLeg]
    public var fare: Fare?
    public var started: Date
    public var watchID: String?
    public var share: ShareLink?

    public init(title: String, from: StopRef, to: StopRef, legs: [WatchLeg], fare: Fare?, started: Date, watchID: String? = nil, share: ShareLink? = nil) {
        self.title = title; self.from = from; self.to = to; self.legs = legs; self.fare = fare
        self.started = started; self.watchID = watchID; self.share = share
    }
}

/// Where you are on a live trip, worked out the same way as the web app.
public struct LiveTripState: Sendable, Equatable {
    public struct LegTimes: Sendable, Equatable {
        public var dep: Date
        public var arr: Date
        public var live: Bool
    }
    public struct Connection: Sendable, Equatable {
        public var index: Int
        public var at: String
        public var spare: Int
        /// ok, tight or miss
        public var risk: String
        public var nextLine: String
        public var nextPlanned: Date?
    }

    public var done: Bool
    public var current: Int
    /// wait (not on board yet) or ride
    public var phase: String
    public var nextStop: String?
    public var stopsLeft: Int?
    public var times: [LegTimes]
    public var connections: [Connection]
    public var eta: Date
    public var live: Bool

    public var arrivalAtCurrentStop: Date? { times.indices.contains(current) ? times[current].arr : nil }
}

public enum LiveTripLogic {
    static func best(_ s: ServiceStop?) -> Date? { s.flatMap { $0.estimated ?? $0.planned } }

    static func timed(_ s: ServiceStop) -> Bool { (s.planned != nil || s.estimated != nil) && s.skipped != true }

    /// A service answer belongs to a leg only when it is the same run: the stop you board at is
    /// planned within 2 minutes of the leg. Once a run has finished, the server can answer with
    /// the next service on the line; that answer must not move the trip onto the next train.
    public static func matches(_ r: ServiceResponse, leg l: WatchLeg) -> Bool {
        guard let m = r.mineIndex, r.stops.indices.contains(m), let p = r.stops[m].planned, let lp = l.planned else { return true }
        return abs(p.timeIntervalSince(lp)) <= sameRunTolerance
    }

    /// Seconds a service's planned boarding time may differ from the leg's and still be the same
    /// run. 120 by default; the server config can change it.
    nonisolated(unsafe) public static var sameRunTolerance: TimeInterval = 120

    /// `services[i]` is the latest /api/service answer for leg i, or nil.
    public static func compute(legs: [WatchLeg], services raw: [ServiceResponse?], now: Date = Date()) -> LiveTripState? {
        guard !legs.isEmpty else { return nil }
        let services: [ServiceResponse?] = legs.indices.map { i in
            guard i < raw.count, let r = raw[i], matches(r, leg: legs[i]) else { return nil }
            return r
        }
        var times: [LiveTripState.LegTimes] = []
        for (i, l) in legs.enumerated() {
            let d = services[i]
            let mine = d.flatMap { r in r.mineIndex.flatMap { r.stops.indices.contains($0) ? r.stops[$0] : nil } }
            let off = d.flatMap { r in r.alightIndex.flatMap { r.stops.indices.contains($0) ? r.stops[$0] : nil } }
            let plannedDep = l.estimated ?? l.planned ?? now
            var delay: TimeInterval = 0
            if let m = mine, let e = m.estimated, let p = m.planned { delay = e.timeIntervalSince(p) }
            else if let e = l.estimated, let p = l.planned { delay = e.timeIntervalSince(p) }
            let dep = best(mine) ?? plannedDep
            var arr = best(off) ?? (l.arrPlanned.map { $0.addingTimeInterval(delay) } ?? dep.addingTimeInterval(600))
            if let d, let a = d.alightIndex, a >= 0, let n = d.nextIndex, n > a {
                arr = min(arr, now.addingTimeInterval(-60))
            }
            times.append(.init(dep: dep, arr: arr, live: d?.live == true))
        }
        let last = legs.count - 1
        guard let cur = times.firstIndex(where: { now < $0.arr.addingTimeInterval(45) }) else {
            return LiveTripState(done: true, current: last, phase: "ride", nextStop: nil, stopsLeft: nil,
                                 times: times, connections: [], eta: times[last].arr, live: times[last].live)
        }
        let d = cur < services.count ? services[cur] : nil
        var phase = "wait"
        if let d, let m = d.mineIndex, m >= 0, let n = d.nextIndex, n > m { phase = "ride" }
        else if d == nil || (d?.mineIndex ?? -1) < 0 { phase = now >= times[cur].dep ? "ride" : "wait" }
        var nextStop: String?
        var stopsLeft: Int?
        if let d, var n = d.nextIndex, n >= 0, n < d.stops.count {
            let alight = d.alightIndex ?? -1
            while n < d.stops.count - 1 && n != alight && !timed(d.stops[n]) { n += 1 }
            nextStop = Naming.short(d.stops[n].name)
            if alight >= 0 && phase == "ride" {
                let start = max(n, (d.mineIndex ?? -1) + 1)
                if start <= alight {
                    stopsLeft = d.stops[start...alight].filter(timed).count
                } else {
                    stopsLeft = 0
                }
            }
        }
        var conns: [LiveTripState.Connection] = []
        if cur < last {
            for i in cur..<last {
                let a = times[i], b = times[i + 1]
                let walk = Double(legs[i + 1].walkBefore ?? 0)
                let spare = Int((b.dep.timeIntervalSince(a.arr) / 60 - walk).rounded())
                let risk = spare < 0 ? "miss" : (spare < 2 ? "tight" : "ok")
                conns.append(.init(index: i, at: legs[i].to ?? "", spare: spare, risk: risk,
                                   nextLine: legs[i + 1].line ?? "", nextPlanned: legs[i + 1].planned))
            }
        }
        return LiveTripState(done: false, current: cur, phase: phase, nextStop: nextStop, stopsLeft: stopsLeft,
                             times: times, connections: conns, eta: times[last].arr, live: times[cur].live)
    }
}

// MARK: Notification dedupe

/// Each trip alert once. The phone can hear the same moment twice: from the server watch and
/// from the app's own live trip, or from two server checks that ran together. Alerts about the
/// same moment share a key ("Arriving at X in 2 min", "Next stop: X" and "Change at X in 1 min"
/// are all "arrive:x"), and a key posts once inside the window.
public struct NoticeDeduper: Sendable {
    public private(set) var recent: [String: Date] = [:]
    public init() {}

    public static func key(title: String) -> String {
        var t = title.lowercased().trimmingCharacters(in: .whitespaces)
        t = t.replacingOccurrences(of: #" in \d+ min(utes?)?"#, with: "", options: .regularExpression)
        for suffix in [", change here", " (get off)", ", get off"] where t.hasSuffix(suffix) {
            t = String(t.dropLast(suffix.count))
        }
        for prefix in ["next stop: ", "arriving at ", "change at "] where t.hasPrefix(prefix) {
            t = "arrive:" + t.dropFirst(prefix.count)
        }
        if t.hasPrefix("arrive:") && t.hasSuffix(" station") { t = String(t.dropLast(" station".count)) }
        return t
    }

    /// True the first time an alert with this title is seen inside the window.
    public mutating func shouldPost(title: String, now: Date = Date(), window: TimeInterval = 15 * 60) -> Bool {
        recent = recent.filter { now.timeIntervalSince($0.value) < window }
        let k = Self.key(title: title)
        if recent[k] != nil { return false }
        recent[k] = now
        return true
    }
}

// MARK: Endpoints

public struct HistoryDeleted: Decodable, Sendable {
    public struct Counts: Decodable, Sendable {
        public var searches: Int?
        public var saved: Int?
        public var commutes: Int?
        public var watches: Int?
    }
    public var ok: Bool?
    public var scope: String?
    public var deleted: Counts?
}

public extension TransportAPI {
    /// A multi leg trip in one call: the server pairs each leg with the first catchable connection.
    func plan(legs: [TripLeg], count: Int = 5, time: String? = nil, all: Bool = false) async throws -> TripResponse {
        var q: [String: String?] = ["legs": TripLeg.wire(legs), "count": String(count), "time": time, "all": all ? "1" : nil]
        for (k, v) in TripPrefs.query { q[k] = v }
        return try await send(TripResponse.self, "api/plan", query: q)
    }

    func saveTrip(name: String, legs: [TripLeg]) async throws {
        guard let first = legs.first, let last = legs.last else { return }
        let wireData = Data(TripLeg.wire(legs).utf8)
        let wireLegs = (try? JSONSerialization.jsonObject(with: wireData)) ?? []
        var body: [String: Any] = [
            "profile": profile, "name": name,
            "from": ["id": first.from.id, "name": first.from.name],
            "to": ["id": last.to.id, "name": last.to.name],
            "legs": wireLegs,
        ]
        if legs.count == 2 {
            body["via"] = ["id": first.to.id, "name": first.to.name]
            body["conn"] = legs[1].conn ?? 5
        }
        let data = try JSONSerialization.data(withJSONObject: body)
        _ = try await send(Ignored.self, "api/saved", method: "POST", body: data)
    }

    /// scope "history" deletes trip searches; "all" also saved trips, commutes, watches and alerts.
    func deleteHistory(scope: String, device: String) async throws -> HistoryDeleted {
        let data = try JSONSerialization.data(withJSONObject: ["profile": profile, "device": device, "scope": scope])
        return try await send(HistoryDeleted.self, "api/history/delete", method: "POST", body: data)
    }

    func station(id: String) async throws -> StationInfo {
        try await send(StationInfo.self, "api/station", query: ["id": id])
    }

    func parking() async throws -> [CarPark] {
        struct R: Decodable { var carparks: [CarPark]? }
        return try await send(R.self, "api/parking").carparks ?? []
    }

    func watchParking(facility: String, device: String) async throws {
        let data = try JSONSerialization.data(withJSONObject: ["profile": profile, "device": device, "facility": facility])
        _ = try await send(Ignored.self, "api/parking/watch", method: "POST", body: data)
    }

    /// Turns lift outage alerts on or off for the stations on saved trips.
    /// Returns the titles of outages already showing at those stations.
    func liftAlerts(on: Bool, stations: [String], device: String) async throws -> [String] {
        struct R: Decodable { var now: [LiftOutage]? }
        let data = try JSONSerialization.data(withJSONObject: ["profile": profile, "device": device, "on": on, "stations": Array(stations.prefix(40))] as [String: Any])
        return try await send(R.self, "api/lifts/alerts", method: "POST", body: data).now?.compactMap(\.title) ?? []
    }

    func topup(lat: Double?, lon: Double?, limit: Int = 25) async throws -> [TopupPlace] {
        struct R: Decodable { var items: [TopupPlace]? }
        return try await send(R.self, "api/topup", query: ["lat": lat.map { String($0) }, "lon": lon.map { String($0) }, "limit": String(limit)]).items ?? []
    }

    /// The service for one leg of a live trip, with where you get off.
    func liveService(_ l: WatchLeg) async throws -> ServiceResponse {
        try await send(ServiceResponse.self, "api/service", query: [
            "trip": l.tripId, "line": l.line, "stop": l.stopId, "mode": l.mode, "destId": l.destId,
            "planned": l.planned.map(ISODates.format), "to": l.toStopId, "dest": l.towards, "stopName": l.from,
        ])
    }

    func share(device: String, title: String, from: StopRef, to: StopRef, legs: [WatchLeg]) async throws -> ShareLink {
        struct Body: Encodable { let device: String; let title: String; let from: StopRef; let to: StopRef; let legs: [WatchLeg] }
        let data = try Self.makeEncoder().encode(Body(device: device, title: title, from: StopRef(id: from.id, name: from.name),
                                                      to: StopRef(id: to.id, name: to.name), legs: legs))
        return try await send(ShareLink.self, "api/share", method: "POST", body: data)
    }

    func updateShare(_ s: ShareLink, leg: Int, phase: String, next: String?, stopsLeft: Int?, eta: Date) async throws {
        var prog: [String: Any] = ["leg": leg, "phase": phase, "eta": ISODates.format(eta)]
        if let next { prog["next"] = next }
        if let stopsLeft { prog["stopsLeft"] = stopsLeft }
        let data = try JSONSerialization.data(withJSONObject: ["id": s.id, "key": s.key, "prog": prog] as [String: Any])
        _ = try await send(Ignored.self, "api/share/update", method: "POST", body: data)
    }

    func endShare(_ s: ShareLink) async throws {
        var req = URLRequest(url: try url("api/share", ["id": s.id]))
        req.httpMethod = "DELETE"
        req.timeoutInterval = 12
        req.setValue(s.key, forHTTPHeaderField: "x-share-key")
        _ = try await Self.fetch(req, retry: false)
    }
}

public extension TransportAPI {
    /// POST /api/watch for a live trip: the server follows it and sends Next stop and change alerts.
    func trackWatch(_ request: WatchRequest) async throws -> WatchCreated {
        let base = try Self.makeEncoder().encode(request)
        var obj = (try JSONSerialization.jsonObject(with: base) as? [String: Any]) ?? [:]
        obj["track"] = true
        obj["silentStart"] = true
        obj["lead"] = 0
        let data = try JSONSerialization.data(withJSONObject: obj)
        return try await send(WatchCreated.self, "api/watch", method: "POST", body: data)
    }
}
