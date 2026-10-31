import Foundation

/// The moments of a started trip, from the trip card the app shares (build 212, spec 2.5 "the widget for the whole trip",
/// G4, G5, G11, G28). The Home Screen and Lock Screen "Your trip" widget draws one timeline entry per moment, so from
/// Start trip to the end it shows the same phase as the Lock Screen card: the countdown to the live departure, Due,
/// on board, your stop next, Get off now, then Arrived. It never drops its row because a time passed, never says
/// "Checking for the next one" or "Trip started" during a trip, and marks every moment "about" once the live times
/// behind it are over 2 minutes old (spec 2.4). Pure, so the native audit tests it (WidgetRefreshLogicTests).
/// The Apple Watch has the same rules in WatchCore.swift (WTripMoments); keep the two in step.
enum TripMomentKind: String, Codable, Hashable {
    /// Waiting: counting down to the live departure.
    case wait
    /// The service is under a minute from leaving, or has reached its live departure: "Due".
    case due
    /// On board, counting down to where you get off.
    case ride
    /// Your stop is next (from 2 minutes before the live arrival there).
    case next
    /// Get off now (30 seconds before the live arrival, as the alert).
    case getOff
    /// At your stop: "Arrived" on the last leg, "Change here" when another leg follows.
    case arrived
}

struct TripMoment: Hashable {
    var at: Date
    var kind: TripMomentKind
    /// What the countdown counts to; nil when the moment shows a word instead.
    var target: Date?
}

enum TripMoments {
    /// "Croydon next" from this long before the live arrival there.
    static let nextLead: TimeInterval = 120
    /// Get off now this long before the live arrival (the alert's own lead, getOffCore.ts GETOFF_LEAD).
    static let getOffLead: TimeInterval = 30
    /// Due is shown from a minute before the live departure.
    static let dueLead: TimeInterval = 60
    /// The service is taken to have left this long after the live departure, when no newer card says otherwise.
    static let dueFor: TimeInterval = 60
    /// Live for 2 minutes, then "about", from 5 minutes no live data, from 10 minutes open the app (spec 2.4).
    static let liveFor: TimeInterval = 120

    /// The moments from `now` on, the one showing now first. `departs` and `legArrives` are the live times on the card
    /// (the timetable when the card has no live time). Waiting with no departure: one waiting moment.
    static func list(phase: String, departs: Date?, legArrives: Date?, arrival: Date, now: Date) -> [TripMoment] {
        var all: [TripMoment] = []
        let off = legArrives ?? arrival
        if phase == "arrived" { return [TripMoment(at: now, kind: .arrived, target: nil)] }
        if phase == "wait" {
            guard let d = departs else { return [TripMoment(at: now, kind: .wait, target: nil)] }
            all.append(TripMoment(at: .distantPast, kind: .wait, target: d))
            all.append(TripMoment(at: d.addingTimeInterval(-dueLead), kind: .due, target: nil))
            let left = d.addingTimeInterval(dueFor)
            if left < off.addingTimeInterval(-nextLead) { all.append(TripMoment(at: left, kind: .ride, target: off)) }
        } else {
            all.append(TripMoment(at: .distantPast, kind: .ride, target: off))
        }
        all.append(TripMoment(at: off.addingTimeInterval(-nextLead), kind: .next, target: off))
        all.append(TripMoment(at: off.addingTimeInterval(-getOffLead), kind: .getOff, target: nil))
        all.append(TripMoment(at: off, kind: .arrived, target: nil))
        // Keep them in time order (a short ride can put Next before the service has left: the later wins its place).
        var sorted: [TripMoment] = []
        for m in all where sorted.last.map({ m.at > $0.at }) ?? true { sorted.append(m) }
        // The one showing now, starting now, then the rest.
        let current = sorted.last(where: { $0.at <= now }) ?? sorted[0]
        var out = [TripMoment(at: now, kind: current.kind, target: current.target)]
        out += sorted.filter { $0.at > now }
        return out
    }

    /// How old the live times are at `at`, in the steps of spec 2.4: 0 live, 1 "about", 2 no live data, 3 open the app.
    static func ageStep(updated: Date?, at: Date) -> Int {
        guard let u = updated else { return 0 }
        let a = at.timeIntervalSince(u)
        if a >= 600 { return 3 }
        if a >= 300 { return 2 }
        return a >= liveFor ? 1 : 0
    }

    /// "4 min late", "2 min early", "On time"; nil when not known.
    static func delayWords(_ d: Int?) -> String? {
        guard let d else { return nil }
        if d > 0 { return "\(d) min late" }
        if d < 0 { return "\(-d) min early" }
        return "On time"
    }
}
