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

/// The words on the trip card. `stale` is true once the system marks the card out of date.
/// A card with `updated` (app code from 25 Oct 2026) goes stale 2 minutes after its live times, when the app can no
/// longer refresh it; it then says "Updated 8:21am" and shows clock times instead of a countdown, so it never claims
/// "now" from old data. A card without `updated` goes stale at its arrival time and says it has arrived, as before.
extension LiveTripAttributes.ContentState {
    public func arrived(stale: Bool) -> Bool { phase == "arrived" || (stale && updated == nil) }

    /// True when the live times on the card are old: show them as clock times with when they are from.
    /// Build 212 (G3): the system also marks the card stale at the live departure (app/platform/tripCard.ts staleAt), so
    /// that the Island never sits on 0:00. A card stale for that reason with live times under 2 minutes old is not old:
    /// it shows "Due" instead.
    public func outdated(stale: Bool, now: Date = Date()) -> Bool {
        guard stale, let u = updated, phase != "arrived" else { return false }
        return now.timeIntervalSince(u) >= Self.liveFor
    }

    /// Live times are live for 2 minutes (spec 2.4), then "about" with when they are from, then the timetable.
    public static let liveFor: TimeInterval = 120

    /// How old the live times are, in the steps of spec 2.4: 0 under 2 min, 1 from 2 min ("about"), 2 from 5 min (no live
    /// data, timetable time), 3 from 10 min. Worked out from `updated` when the card is drawn, so the card moves on by
    /// itself when no push comes (build 212, G25). 0 for a card from code that sends no `updated`.
    public func ageStep(stale: Bool, now: Date = Date()) -> Int {
        guard outdated(stale: stale, now: now), let u = updated else { return 0 }
        let a = now.timeIntervalSince(u)
        return a >= 600 ? 3 : (a >= 300 ? 2 : 1)
    }

    /// The service has reached the moment the big number counts to, with live times under 2 minutes old: waiting it is
    /// Due, on board it is time to get off. The countdown then shows a word, never 0:00 (G3, G27).
    public func targetReached(stale: Bool, now: Date = Date()) -> Bool {
        if arrived(stale: stale) || outdated(stale: stale, now: now) { return false }
        let target = countdownTarget
        // Waiting, the last minute is "Due" (the board's own word for a service under a minute away).
        return phase == "wait" ? target.timeIntervalSince(now) < 60 : target <= now
    }

    /// The word in place of the countdown: "Due" while waiting, "Now" on board at your stop; nil while it counts.
    public func countdownWord(stale: Bool, now: Date = Date()) -> String? {
        guard targetReached(stale: stale, now: now) else { return nil }
        return phase == "wait" ? "Due" : "Now"
    }

    /// "Updated 8:21am"; from 5 minutes old "No live data since 8:21am" (spec 2.4).
    public var updatedLine: String { ageLine(stale: true) }
    public func ageLine(stale: Bool, now: Date = Date()) -> String {
        guard let u = updated else { return "" }
        return ageStep(stale: stale, now: now) >= 2 ? "No live data since \(Clock.time(u))" : "Updated \(Clock.time(u))"
    }

    /// The time the big number shows once the live times are old: the live time with "about" for 2 to 5 minutes, then
    /// the timetable time (the live time less the delay), never a countdown on old data.
    public func oldTarget(stale: Bool, now: Date = Date()) -> Date {
        let t = countdownTarget
        if ageStep(stale: stale, now: now) >= 2, let d = delayMin, d != 0 { return t.addingTimeInterval(-Double(d) * 60) }
        return t
    }

    /// The time the big number is about: the countdown target, or once old the time from `oldTarget`.
    public func shownTarget(stale: Bool, now: Date = Date()) -> Date {
        outdated(stale: stale, now: now) ? oldTarget(stale: stale, now: now) : countdownTarget
    }

    /// VoiceOver for the countdown alone (G30): "Leaves in 4 minutes", "Train due now", "Get off now", "Leaves about
    /// 7:54pm"; never "zero" or a frozen timer.
    public func spokenCountdown(stale: Bool, now: Date = Date()) -> String {
        if arrived(stale: stale) { return "Arrived" }
        let verb = phase == "wait" ? "Leaves" : "Get off"
        if let w = countdownWord(stale: stale, now: now) { return w == "Due" ? "\(modeNoun) due now" : "Get off now" }
        if outdated(stale: stale, now: now) { return "\(verb) about \(Clock.time(oldTarget(stale: stale, now: now)))" }
        return "\(verb) \(Self.spokenWait(countdownTarget, from: now))"
    }

    /// "Train", "Bus": the label over "Due".
    public var modeNoun: String {
        switch mode.lowercased() {
        case "train": return "Train"
        case "metro": return "Metro"
        case "bus": return "Bus"
        case "coach": return "Coach"
        case "ferry": return "Ferry"
        case "lightrail", "light rail", "tram": return "Light rail"
        default: return "Service"
        }
    }

    /// The label over the big number: "Leaves", "Get off", "Arrived"; "Train" over "Due"; with old times "Leaves about"
    /// or "Get off about", and from 5 minutes old "Timetable".
    public func countdownLabel(stale: Bool, now: Date = Date()) -> String {
        if arrived(stale: stale) { return "Arrived" }
        if phase == "wait" && targetReached(stale: stale, now: now) { return modeNoun }
        let base = phase == "wait" ? "Leaves" : "Get off"
        let step = ageStep(stale: stale, now: now)
        if step >= 2 && delayMin != nil { return "Timetable" }
        return step >= 1 ? "\(base) about" : base
    }

    /// The delay beside the Dynamic Island countdown and after "2 stops" on the Lock Screen (build 211, owner's build 210
    /// iPhone, 31 Oct: the Lock Screen said "3 min late", the Island did not): "3 min late" when that is the card's whole
    /// warning (app/platform/tripCard.ts legNote), "On time" when the card's stops are live and it has no warning.
    /// Nothing for old times, an arrived card, a timetable card or a change warning (those stay where they were).
    public func delayStatus(stale: Bool) -> String? {
        if arrived(stale: stale) || outdated(stale: stale) { return nil }
        // Build 212 (G31): from the card's own delay number when it carries one, never by reading the warning's words.
        if let d = delayMin {
            let live = (phase == "wait" ? departsLive : legArrivesLive) ?? (stopTrack?.live ?? true)
            guard live else { return nil }
            return d > 0 ? "\(d) min late" : (d < 0 ? "\(-d) min early" : "On time")
        }
        if let w = warning?.trimmingCharacters(in: .whitespaces), !w.isEmpty {
            return w.range(of: #"^[0-9]+ min late$"#, options: .regularExpression) != nil ? w : nil
        }
        return stopTrack?.live == true ? "On time" : nil
    }

    /// The warning line as the card shows it (build 212): nothing once arrived, and nothing when it only says what the
    /// countdown and the delay beside it already say ("Due now · 4 min late", "3 min late", "On time"), so the Lock
    /// Screen status stays one line (G24). A change, a cancellation, a platform or timetable note stays.
    public func displayWarning(stale: Bool) -> String? {
        guard !arrived(stale: stale), let w = warning?.trimmingCharacters(in: .whitespaces), !w.isEmpty else { return nil }
        if delayStatus(stale: stale) != nil || countdownWord(stale: stale) != nil,
           w.range(of: #"^(Due now)?( · )?([0-9]+ min (late|early)|On time)?$"#, options: .regularExpression) != nil {
            return nil
        }
        return w
    }

    /// One VoiceOver sentence for the whole card (G30): where to, the countdown in words, the delay, the platform and
    /// the arrival. A countdown past its moment reads "Due" or "Get off now", never "zero".
    public func spokenSummary(stale: Bool, now: Date = Date()) -> String {
        if arrived(stale: stale) { return "\(headline(stale: stale)). Got in at \(Clock.time(arrival))." }
        var parts: [String] = ["\(line). \(headline(stale: stale))"]
        if let w = countdownWord(stale: stale, now: now) {
            parts.append(w == "Due" ? "\(modeNoun) due now" : "Get off now")
        } else if outdated(stale: stale, now: now) {
            parts.append("\(phase == "wait" ? "Leaves" : "Get off") about \(Clock.time(oldTarget(stale: stale, now: now)))")
            parts.append(ageLine(stale: stale, now: now))
        } else {
            parts.append("\(phase == "wait" ? "Leaves" : "Get off") \(Self.spokenWait(countdownTarget, from: now))")
        }
        if let d = delayStatus(stale: stale) { parts.append(d) }
        if let w = displayWarning(stale: stale) { parts.append(w) }
        if phase == "wait", let p = platform, !p.isEmpty { parts.append(p.replacingOccurrences(of: "Plat ", with: "Platform ")) }
        parts.append(arriveLine.replacingOccurrences(of: "Arrive ", with: "Arrives "))
        return parts.joined(separator: ". ") + "."
    }

    /// "in 4 minutes", "in 1 minute", "at 9:41pm" an hour or more away; "now" in the last minute.
    public static func spokenWait(_ t: Date, from now: Date) -> String {
        let s = t.timeIntervalSince(now)
        if s >= 3600 { return "at \(Clock.time(t))" }
        let m = Int((s / 60).rounded(.down))
        return m <= 0 ? "now" : (m == 1 ? "in 1 minute" : "in \(m) minutes")
    }

    /// A missed or at risk change shows red, a tight one orange.
    public var warningIsRed: Bool { (warning ?? "").contains("miss") || (warning ?? "").contains("risk") }

    /// Waiting: "To Central". On board: "Get off at Redfern". At the end: "You've arrived at Strathfield".
    public func headline(stale: Bool = false) -> String {
        if arrived(stale: stale) { return "You've arrived at \(destination ?? getOffAt)" }
        if phase == "wait" { return "To \(towards ?? getOffAt)" }
        return "Get off at \(getOffAt)"
    }

    /// For very large text (build 211): just the stop, "Redfern", or where you arrived; the label over the countdown
    /// says "Get off" or "Arrived". Waiting keeps "To Central" (its label says "Leaves").
    public func bareHeadline(stale: Bool = false) -> String {
        if arrived(stale: stale) { return destination ?? getOffAt }
        if phase == "wait" { return "To \(towards ?? getOffAt)" }
        return getOffAt
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

    /// Build 212: the stop alone for the Island beside its bell ("Croydon").
    public var compactStop: String { Naming.compact(Naming.short(getOffAt)) }

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
