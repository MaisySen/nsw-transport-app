import Foundation

/// One travel update on a live trip.
public struct TravelStep: Equatable, Sendable {
    public enum Kind: String, Sendable { case leave, board, nextStop, change, arrived }
    public var kind: Kind
    /// The leg it belongs to.
    public var leg: Int
    /// Stable per trip: "leave", "board0", "next0", "change1", "arrived".
    public var key: String
    public var at: Date
    public var title: String
    public var body: String
}

/// The travel updates for a live trip: Leave now, Board, Next stop (get off or change here),
/// Change, and Arrived. Each step is said once. Steps still to come are scheduled with the
/// system, so they arrive on time with the app closed, and every refresh moves them to the
/// latest live time under the same identifier (a move replaces, it never adds a second one).
public enum TravelUpdates {
    /// Every step of the trip with the best times known now. After arrival only "arrived" is left.
    public static func steps(record: LiveTripRecord, state: LiveTripState?, services: [ServiceResponse?] = [],
                             now: Date = Date()) -> [TravelStep] {
        let legs = record.legs
        guard !legs.isEmpty else { return [] }
        let last = legs.count - 1
        let times: [(dep: Date, arr: Date)] = legs.indices.map { i in
            if let st = state, st.times.indices.contains(i) { return (st.times[i].dep, st.times[i].arr) }
            let dep = legs[i].estimated ?? legs[i].planned ?? now
            return (dep, legs[i].arrPlanned ?? dep.addingTimeInterval(600))
        }
        let toName = Naming.compact(Naming.short(record.to.name))
        if state?.done == true {
            return [TravelStep(kind: .arrived, leg: last, key: "arrived", at: min(times[last].arr, now),
                               title: "You've arrived at \(toName)", body: "Got in at \(Clock.time(min(times[last].arr, now))).")]
        }
        func name(_ s: String?) -> String { Naming.compact(Naming.short(s ?? "")) }
        func platText(_ p: String?) -> String {
            guard let p, !p.isEmpty else { return "" }
            let s = p.lowercased().hasPrefix("platform ") ? "Plat " + p.dropFirst("platform ".count) : (p.allSatisfy(\.isNumber) ? "Plat \(p)" : p)
            return ", \(s)"
        }
        var out: [TravelStep] = []
        let first = legs[0]
        let line0 = first.line ?? "service"
        let walk = max(0, first.walkBefore ?? 0)
        let leaveAt = times[0].dep.addingTimeInterval(-Double(walk > 0 ? walk + 2 : 5) * 60)
        let leaveBody = walk > 0
            ? "\(walk) min walk to \(name(first.from)). The \(line0) leaves at \(Clock.time(times[0].dep))\(platText(first.fromPlatform))."
            : "The \(line0) leaves \(name(first.from)) at \(Clock.time(times[0].dep))\(platText(first.fromPlatform))."
        out.append(TravelStep(kind: .leave, leg: 0, key: "leave", at: leaveAt, title: "Leave now", body: leaveBody))

        for i in legs.indices {
            let l = legs[i]
            let line = l.line ?? "service"
            let off = name(l.to)
            let svc = i < services.count ? services[i] : nil
            let stops = stopCount(svc)
            if i == 0 {
                var body = "\(name(l.from))\(platText(l.fromPlatform)), leaves \(Clock.time(times[0].dep))."
                body += stops == 1 ? " Get off at the next stop, \(off)." : (stops.map { " Get off at \(off), \($0) stops." } ?? " Get off at \(off).")
                out.append(TravelStep(kind: .board, leg: 0, key: "board0", at: times[0].dep.addingTimeInterval(-60),
                                      title: "Board the \(line) to \(towards(l) ?? off)", body: body))
            } else {
                let prev = legs[i - 1]
                let at = name(l.from ?? prev.to)
                let spare = Int((times[i].dep.timeIntervalSince(times[i - 1].arr) / 60).rounded())
                out.append(TravelStep(kind: .change, leg: i, key: "change\(i)", at: times[i - 1].arr,
                                      title: "Change at \(at)",
                                      body: "Take the \(line) to \(towards(l) ?? off)\(platText(l.fromPlatform)), leaves \(Clock.time(times[i].dep))\(spare >= 0 ? " (\(spare) min)" : "")."))
            }
            // One stop before you get off: when the service leaves the stop before yours.
            var nextAt = times[i].arr.addingTimeInterval(-120)
            if let svc, let a = svc.alightIndex, a > 0, svc.stops.indices.contains(a - 1),
               let t = svc.stops[a - 1].estimated ?? svc.stops[a - 1].planned {
                nextAt = t.addingTimeInterval(30)
            }
            nextAt = max(nextAt, times[i].dep.addingTimeInterval(30))
            nextAt = min(nextAt, times[i].arr.addingTimeInterval(-30))
            let title = i < last ? "Next stop: \(off), change here" : "Next stop: \(off), get off"
            let body = i < last
                ? "Arrive \(Clock.time(times[i].arr)), then the \(legs[i + 1].line ?? "next service")."
                : "Arrive \(Clock.time(times[i].arr))."
            out.append(TravelStep(kind: .nextStop, leg: i, key: "next\(i)", at: nextAt, title: title, body: body))
        }
        out.append(TravelStep(kind: .arrived, leg: last, key: "arrived", at: times[last].arr,
                              title: "You've arrived at \(toName)", body: "Got in at \(Clock.time(times[last].arr))."))
        return out
    }

    static func towards(_ l: WatchLeg) -> String? {
        guard let t = l.towards, !t.isEmpty else { return nil }
        return Naming.compact(Naming.short(t))
    }

    /// Stops you ride on a leg, from the live service when it names where you get on and off.
    static func stopCount(_ s: ServiceResponse?) -> Int? {
        guard let s, let m = s.mineIndex, let a = s.alightIndex, a > m, m >= 0, a < s.stops.count else { return nil }
        return s.stops[(m + 1)...a].filter { $0.skipped != true }.count
    }
}

/// What the phone has said and scheduled for one trip, saved with the trip.
public struct TravelUpdateLedger: Codable, Equatable, Sendable {
    /// Steps said, or delivered by the system at their scheduled time.
    public private(set) var said: Set<String> = []
    /// Steps scheduled with the system, and when.
    public private(set) var scheduled: [String: Date] = [:]
    public private(set) var finished = false

    public init() {}

    public struct Actions: Equatable, Sendable {
        /// Say now.
        public var post: [TravelStep] = []
        /// Schedule (or move) for later, under the step's identifier.
        public var schedule: [TravelStep] = []
        /// Scheduled steps to take back.
        public var cancel: [String] = []
        /// Steps whose moment passed while nobody was listening; marked said, never shown late.
        public var skipped: [String] = []
        /// Scheduled steps whose time came since the last update: the system showed them.
        /// With the app in front the system shows nothing, so the app shows its own banner.
        public var shown: [TravelStep] = []

        public init() {}
    }

    /// How late a step may still be said. Older ones are skipped: a "Board" five minutes after
    /// the train left is noise.
    public static let lateLimit: TimeInterval = 180

    /// Works out what to say, schedule and take back for these steps at `now`.
    /// `canSchedule` is false in the replay, where the clock is not the system's.
    public mutating func update(_ steps: [TravelStep], now: Date, canSchedule: Bool = true) -> Actions {
        var a = Actions()
        guard !finished else { return a }
        // A scheduled step whose time has come was shown by the system.
        for (k, t) in scheduled.sorted(by: { $0.value < $1.value }) where t <= now {
            said.insert(k)
            scheduled[k] = nil
            if let s = steps.first(where: { $0.key == k }) { a.shown.append(s) }
        }
        let open = steps.filter { !said.contains($0.key) }
        let due = open.filter { $0.at <= now }.sorted { $0.at < $1.at }
        if let newest = due.last {
            // Only the newest step that is due; earlier ones were overtaken.
            for s in due.dropLast() { a.skipped.append(s.key) }
            if now.timeIntervalSince(newest.at) <= Self.lateLimit || newest.kind == .arrived {
                a.post.append(newest)
            } else {
                a.skipped.append(newest.key)
            }
            for s in due {
                said.insert(s.key)
                if scheduled.removeValue(forKey: s.key) != nil { a.cancel.append(s.key) }
            }
        }
        let keys = Set(steps.map(\.key))
        for k in scheduled.keys.sorted() where !keys.contains(k) {
            scheduled[k] = nil
            a.cancel.append(k)
        }
        if canSchedule {
            for s in open where s.at > now {
                if let t = scheduled[s.key], abs(t.timeIntervalSince(s.at)) < 20 { continue }
                scheduled[s.key] = s.at
                a.schedule.append(s)
            }
        }
        if steps.contains(where: { $0.kind == .arrived }) && said.contains("arrived") {
            finished = true
            for k in scheduled.keys.sorted() { a.cancel.append(k) }
            scheduled = [:]
        }
        return a
    }

    /// End trip: nothing more is said and everything scheduled is taken back.
    public mutating func end() -> [String] {
        finished = true
        let keys = scheduled.keys.sorted()
        scheduled = [:]
        return keys
    }

    /// The notification identifier of a step on the trip that started at `started`.
    public static func identifier(started: Date, key: String) -> String {
        "trip-\(Int(started.timeIntervalSince1970))-\(key)"
    }
}
