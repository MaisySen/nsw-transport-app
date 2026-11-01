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
    /// Get off now (38 seconds before the live arrival, as the alert from build 214).
    case getOff
    /// At your stop: "Arrived" on the last leg, "Change here" when another leg follows.
    case arrived
}

/// The next leg of the trip, on the card the app saves for the widget (2 Nov 2026, the owner's first real trip on 214:
/// the widget sat on "Change here · Now" from 4:48 to 4:55 with the T4 at 4:52 nowhere, because the saved card described
/// one leg only). With it the widget's own timeline moves on to "T4 4:52 · Platform 5" after the change, offline too.
/// Times in ms. Optional on the card: older apps leave it out and the widget draws as before.
struct SharedNextLeg: Codable, Hashable {
    var line: String
    var lineColorHex: String?
    var mode: String?
    /// The stop you board it at ("Town Hall") and where you get off it.
    var from: String?
    var to: String?
    var platform: String?
    var departs: Double?
    var arrives: Double?
    var departsLive: Bool?
    var arrivesLive: Bool?
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
    /// Get off now this long before the live arrival (the alert's own lead from build 214, tripState getOffLeadMs:
    /// 30 s plus the feed's 8 s lag).
    static let getOffLead: TimeInterval = 38
    /// Due is shown from a minute before the live departure.
    static let dueLead: TimeInterval = 60
    /// The service is taken to have left this long after the live departure, when no newer card says otherwise.
    static let dueFor: TimeInterval = 60
    /// Live for 2 minutes, then "about", from 5 minutes no live data, from 10 minutes open the app (spec 2.4).
    static let liveFor: TimeInterval = 120

    /// The moments from `now` on, the one showing now first. `departs` and `legArrives` are the live times on the card
    /// (the timetable when the card has no live time). Waiting with no departure: one waiting moment.
    static func list(phase: String, departs: Date?, legArrives: Date?, arrival: Date, now: Date,
                     updated: Date? = nil) -> [TripMoment] {
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
        sorted = holdWhenOld(sorted, updated: updated, departs: departs, off: off)
        // The one showing now, starting now, then the rest.
        let current = sorted.last(where: { $0.at <= now }) ?? sorted[0]
        var out = [TripMoment(at: now, kind: current.kind, target: current.target)]
        out += sorted.filter { $0.at > now }
        return out
    }

    /// Build 214 (found in the 1 Nov known-issues sweep): old live times never claim "now" (spec 2.4, R-A, R-B). The
    /// widget said "Get off now", "Arrived" and "Due now" by the clock from old data. Like the phone's tripState and the
    /// Lock Screen card, those three need live times under 2 min old at the moment they start; from older data the moment
    /// shows with "about" instead ("Croydon next" with "~7:59pm" at your stop, "Due about" with the departure), then the
    /// timetable time. A moment reached on fresh data stays, and the trip never steps back. An arrival the app wrote
    /// (phase arrived) is evidence and stays. Same rule as the Watch (WatchCore.swift WTripMoments.holdWhenOld).
    static func holdWhenOld(_ sorted: [TripMoment], updated: Date?, departs: Date?, off: Date) -> [TripMoment] {
        guard let u = updated else { return sorted }
        let order: [TripMomentKind] = [.wait, .due, .ride, .next, .getOff, .arrived]
        var out: [TripMoment] = []
        for m in sorted {
            var k = m.kind, t = m.target
            if ageStep(updated: u, at: m.at) >= 1 {
                if k == .due { k = .wait; t = departs }
                if k == .getOff || k == .arrived { k = .next; t = off }
            }
            // Held: the moment it is in carries on, as a new entry at this time, so a complication's timer stops here
            // (its entries drop the countdown once the data is old) and never counts past the moment.
            if let last = out.last, (order.firstIndex(of: k) ?? 0) <= (order.firstIndex(of: last.kind) ?? 0) { k = last.kind; t = last.target }
            out.append(TripMoment(at: m.at, kind: k, target: t))
        }
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

    /// "Change here" shows this long before the widget moves on to the next leg (2 Nov).
    static let changeHold: TimeInterval = 60

    /// When the widget moves on from "Change here" to the next leg: a minute after the arrival at the change, never
    /// before now (2 Nov).
    static func nextLegAt(off: Date, now: Date) -> Date { max(off.addingTimeInterval(changeHold), now) }

    /// The moments a word that does not count ("Change here · Now") must be drawn again so it ages by the stale ladder
    /// (spec 2.4: 2 min "about", 5 min no live data, 10 min open the app), after `after` (2 Nov: "Now" with "Updated
    /// 4:48am" under it stayed for 7 min).
    static func ladder(updated: Date?, after: Date) -> [Date] {
        guard let u = updated else { return [] }
        return [liveFor, 300, 600].map { u.addingTimeInterval($0) }.filter { $0 > after }
    }

    /// "4 min late", "2 min early", "On time"; nil when not known.
    static func delayWords(_ d: Int?) -> String? {
        guard let d else { return nil }
        if d > 0 { return "\(d) min late" }
        if d < 0 { return "\(-d) min early" }
        return "On time"
    }
}
