// Shared by the watch app (targets/watch) and its complications (targets/watch-widget). The two copies must stay
// the same file; test/watchshare.test.mjs checks that.
//
// What the iPhone sends (WatchContext, built by platform/watchShare.ts), what the watch keeps between launches
// (WatchSnapshot), the two server calls the watch makes itself, and the words and times it shows.
import Foundation
import Security
import SwiftUI

// MARK: From the phone

struct WStop: Codable, Hashable, Identifiable {
    var id: String
    var name: String
}

/// The card of a trip in progress, as the phone's widgets get it (platform/widgetShare.ts liveCardFor).
/// Times are milliseconds since 1970.
struct WLiveCard: Codable, Hashable {
    var title: String?
    var line: String
    var lineColorHex: String?
    var mode: String?
    var phase: String
    var getOffAt: String
    var destination: String?
    var nextStop: String?
    var stopsLeft: Int?
    var platform: String?
    var towards: String?
    var warning: String?
    var departs: Double?
    var legArrives: Double?
    var arrival: Double
    var until: Double
    var updated: Double?
    /// Build 212: the delay in minutes and whether the times are live (app/platform/tripCard.ts); older phones send none.
    var delayMin: Int?
    var departsLive: Bool?
    var legArrivesLive: Bool?

    /// Leaving while you wait, getting off while on board.
    var target: Date {
        let ms: Double = (phase == "wait" ? departs : legArrives) ?? arrival
        return Date(timeIntervalSince1970: ms / 1000)
    }

    var getOffTime: Date { Date(timeIntervalSince1970: (legArrives ?? arrival) / 1000) }
    var updatedAt: Date? { updated.map { Date(timeIntervalSince1970: $0 / 1000) } }

    /// True while the trip runs: not arrived and not past the moment the phone said to stop showing it.
    func isActive(now: Date = Date()) -> Bool {
        phase != "arrived" && Date(timeIntervalSince1970: until / 1000) > now
    }

    /// A warning that needs attention now, like a change at risk.
    var isRisk: Bool {
        let w = (warning ?? "").lowercased()
        return w.contains("risk") || w.contains("miss") || w.contains("cancel")
    }
}

struct WatchContext: Codable, Hashable {
    var v: Int
    var base: String
    var profile: String?
    var home: WStop?
    var work: WStop?
    var flip: String?
    var starred: [WStop]
    var live: WLiveCard?

    static func decode(_ json: String) -> WatchContext? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WatchContext.self, from: data)
    }

    /// The server address, only https.
    var baseURL: URL? {
        guard let u = URL(string: base), u.scheme?.lowercased() == "https", u.host != nil else { return nil }
        return u
    }

    /// Home to Work before 12pm and Work to Home after, the other way round when the commute card on the phone
    /// was swapped for this half day. The same rule as the phone's commute card and Next trip widget.
    func commute(now: Date = Date()) -> Commute? {
        guard let h = home, let w = work, !h.id.isEmpty, !w.id.isEmpty, h.id != w.id else { return nil }
        let morning = Clock.minuteOfDay(now) < 12 * 60
        let flipped = flip == Clock.halfDayKey(now)
        if morning != flipped { return Commute(title: "To work", from: h, to: w) }
        return Commute(title: "To home", from: w, to: h)
    }

    /// Why there is no commute, in words that say what to do.
    var commuteHint: String {
        if home == nil || work == nil { return "Set Home and Work in Transport on your iPhone." }
        return "Home and Work are the same stop. Change one on your iPhone."
    }
}

struct Commute: Hashable {
    var title: String
    var from: WStop
    var to: WStop
    var key: String { "\(from.id)>\(to.id)" }
}

// MARK: What the watch shows

/// One service: a departure from a stop, or the first train, bus or ferry of a planned trip.
struct WService: Codable, Hashable, Identifiable {
    var line: String
    var colorHex: String?
    var mode: String?
    var dest: String?
    var platform: String?
    var time: Date
    var live: Bool
    var cancelled: Bool
    /// For a planned trip: when you arrive.
    var arrive: Date?
    var id: String { "\(line)-\(time.timeIntervalSince1970)-\(platform ?? "")" }
}

/// What the watch last loaded, kept so it can show it with no signal.
struct WatchSnapshot: Codable {
    var commuteKey: String?
    var commute: [WService] = []
    var commuteAt: Date?
    var stops: [String: [WService]] = [:]
    var stopsAt: [String: Date] = [:]

    /// Services still to come, gone ones left out.
    static func upcoming(_ s: [WService], now: Date = Date()) -> [WService] {
        s.filter { $0.time > now.addingTimeInterval(-30) }.sorted { $0.time < $1.time }
    }
}

// MARK: Server

/// The two calls the watch makes: departures from a stop and the next trips between two stops.
struct WatchAPI {
    var base: URL
    var profile: String?

    init?(_ c: WatchContext) {
        guard let b = c.baseURL else { return nil }
        base = b
        profile = c.profile
    }

    private struct Dep: Decodable {
        var line: String
        var color: String?
        var mode: String?
        var dest: String?
        var platform: String?
        var planned: Date?
        var estimated: Date?
        var realtime: Bool?
        var cancelled: Bool?
    }
    private struct Deps: Decodable { var items: [Dep] }
    private struct Leg: Decodable {
        var kind: String
        var line: String?
        var color: String?
        var mode: String?
        var towards: String?
        var fromPlatform: String?
        var planned: Date?
        var estimated: Date?
        var realtime: Bool?
        var cancelled: Bool?
    }
    private struct Journey: Decodable {
        var arrive: Date?
        var legs: [Leg]
    }
    private struct Trip: Decodable { var journeys: [Journey] }

    func departures(stop: String, count: Int = 3) async throws -> [WService] {
        let r: Deps = try await get("api/departures", ["stop": stop])
        let all = r.items.compactMap { d -> WService? in
            let live = d.realtime == true && d.estimated != nil
            guard let t = (live ? d.estimated : nil) ?? d.planned else { return nil }
            return WService(line: d.line, colorHex: d.color, mode: d.mode, dest: d.dest, platform: d.platform,
                            time: t, live: live, cancelled: d.cancelled == true, arrive: nil)
        }
        return Array(WatchSnapshot.upcoming(all).prefix(count))
    }

    func trip(from: String, to: String, count: Int = 3) async throws -> [WService] {
        let r: Trip = try await get("api/trip", ["from": from, "to": to, "count": String(count + 1)])
        let all = r.journeys.compactMap { j -> WService? in
            guard let l = j.legs.first(where: { $0.kind != "walk" }) else { return nil }
            let live = l.realtime == true && l.estimated != nil
            guard let t = (live ? l.estimated : nil) ?? l.planned else { return nil }
            return WService(line: l.line ?? "", colorHex: l.color, mode: l.mode, dest: l.towards, platform: l.fromPlatform,
                            time: t, live: live, cancelled: l.cancelled == true, arrive: j.arrive)
        }
        return Array(WatchSnapshot.upcoming(all).prefix(count))
    }

    private func get<T: Decodable>(_ path: String, _ query: [String: String]) async throws -> T {
        guard var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw URLError(.badURL)
        }
        var items: [URLQueryItem] = []
        if let p = profile, !p.isEmpty { items.append(URLQueryItem(name: "profile", value: p)) }
        for (k, v) in query.sorted(by: { $0.key < $1.key }) { items.append(URLQueryItem(name: k, value: v)) }
        c.queryItems = items
        guard let u = c.url else { throw URLError(.badURL) }
        var req = URLRequest(url: u)
        req.timeoutInterval = 8
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw URLError(.badServerResponse) }
        return try Self.decoder.decode(T.self, from: data)
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { dec in
            let c = try dec.singleValueContainer()
            if let n = try? c.decode(Double.self) {
                return Date(timeIntervalSince1970: n > 100_000_000_000 ? n / 1000 : n)
            }
            let s = try c.decode(String.self)
            if let date = Clock.parseISO(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unreadable date")
        }
        return d
    }()
}

// MARK: Kept on the watch

/// The context and the last loaded times, kept in a keychain group both the app and the complications can read
/// (no App Group is needed for that). Falls back to the app's own defaults if the keychain says no.
enum WatchStore {
    static let accessGroup = "B85KQRQZW7.com.maisysen.nswtransport.watch"
    static let service = "com.maisysen.nswtransport.watch"

    static func loadContext() -> WatchContext? {
        guard let d = read("context") else { return nil }
        return try? JSONDecoder().decode(WatchContext.self, from: d)
    }

    static func save(_ c: WatchContext) {
        if let d = try? JSONEncoder().encode(c) { write("context", d) }
    }

    static func loadSnapshot() -> WatchSnapshot {
        guard let d = read("snapshot"), let s = try? JSONDecoder().decode(WatchSnapshot.self, from: d) else {
            return WatchSnapshot()
        }
        return s
    }

    static func save(_ s: WatchSnapshot) {
        if let d = try? JSONEncoder().encode(s) { write("snapshot", d) }
    }

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key,
         kSecAttrAccessGroup as String: accessGroup]
    }

    private static func read(_ key: String) -> Data? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return d }
        return UserDefaults.standard.data(forKey: "watch." + key)
    }

    private static func write(_ key: String, _ data: Data) {
        let q = query(key)
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        var status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = q
            add.merge(attrs) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status == errSecSuccess {
            UserDefaults.standard.removeObject(forKey: "watch." + key)
        } else {
            UserDefaults.standard.set(data, forKey: "watch." + key)
        }
    }
}

// MARK: Refreshing on its own (30 Oct, build 210)

/// When the complications and the watch app load fresh times by themselves. Up to build 209 the complications never
/// loaded anything and the watch app loaded only while on screen, so the watch face changed only after one of the
/// apps was opened. Now the complications load the commute themselves when what is kept is older than `fresh`, and
/// the app asks watchOS for a background refresh on the same clock. Spent by the time of day, inside watchOS's budget
/// (about 50 complication reloads a day): every 20 minutes in the weekday peaks, 30 in the rest of the day, 45 in the
/// evening, hourly overnight. A trip in progress (the phone's card, no loading) every 5 minutes.
enum WatchRefresh {
    static let busyEvery: TimeInterval = 20 * 60
    static let dayEvery: TimeInterval = 30 * 60
    static let eveningEvery: TimeInterval = 45 * 60
    static let nightEvery: TimeInterval = 60 * 60
    static let liveEvery: TimeInterval = 5 * 60
    static let offlineEvery: TimeInterval = 15 * 60
    /// Times loaded less than this long ago are used as they are, so the app and the complications never load twice.
    static let fresh: TimeInterval = 4 * 60

    enum Band: String { case busy, day, evening, night }

    /// Which part of the day `at` is in, on the Sydney clock: weekday 6:30 to 9:30am and 3:30 to 7pm are the peaks,
    /// 9pm to 12:30am the evening, 12:30 to 5am the night.
    static func band(at: Date) -> Band {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Clock.sydney
        let p = cal.dateComponents([.hour, .minute, .weekday], from: at)
        let m = (p.hour ?? 0) * 60 + (p.minute ?? 0)
        let weekday = (2...6).contains(p.weekday ?? 1)
        if m >= 30 && m < 5 * 60 { return .night }
        if m >= 21 * 60 || m < 30 { return .evening }
        if weekday && ((m >= 6 * 60 + 30 && m < 9 * 60 + 30) || (m >= 15 * 60 + 30 && m < 19 * 60)) { return .busy }
        return .day
    }

    /// The next reload (complications) or background refresh (app) after `now`.
    static func next(_ now: Date, live: Bool = false, failed: Bool = false) -> Date {
        if live { return now.addingTimeInterval(liveEvery) }
        let b = band(at: now)
        var gap: TimeInterval
        switch b {
        case .busy: gap = busyEvery
        case .day: gap = dayEvery
        case .evening: gap = eveningEvery
        case .night: gap = nightEvery
        }
        if failed { gap = min(gap, offlineEvery) }
        return now.addingTimeInterval(gap)
    }

    /// Whether the kept commute times need loading again at `now`.
    static func commuteStale(_ s: WatchSnapshot, key: String, now: Date) -> Bool {
        guard s.commuteKey == key, let at = s.commuteAt else { return true }
        return now.timeIntervalSince(at) >= fresh || WatchSnapshot.upcoming(s.commute, now: now).count < 2
    }

    /// Loads the commute (and, for the app, the starred stops) into `snap`. Returns the new snapshot and whether any
    /// part failed (the kept times stay for that part). Stops no longer starred are dropped.
    static func load(_ c: WatchContext, into snap: WatchSnapshot, stops: Bool, now: Date = Date()) async -> (WatchSnapshot, Bool) {
        guard let api = WatchAPI(c) else { return (snap, true) }
        var s = snap
        var failed = false
        if let m = c.commute(now: now) {
            if let got = try? await api.trip(from: m.from.id, to: m.to.id, count: 6) {
                s.commuteKey = m.key; s.commute = got; s.commuteAt = Date()
            } else { failed = true }
        }
        guard stops else { return (s, failed) }
        let starred = c.starred
        await withTaskGroup(of: (String, [WService]?).self) { g in
            for st in starred {
                g.addTask { (st.id, try? await api.departures(stop: st.id)) }
            }
            for await (id, got) in g {
                if let got { s.stops[id] = got; s.stopsAt[id] = Date() } else { failed = true }
            }
        }
        let ids = Set(starred.map(\.id))
        s.stops = s.stops.filter { ids.contains($0.key) }
        s.stopsAt = s.stopsAt.filter { ids.contains($0.key) }
        return (s, failed)
    }
}

// MARK: Words and times

enum Clock {
    static let sydney = TimeZone(identifier: "Australia/Sydney") ?? .current

    static func minuteOfDay(_ d: Date) -> Int {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = sydney
        let c = cal.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// "2026-10-25 am" in Sydney, the key the phone writes when the commute card is swapped.
    static func halfDayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = sydney
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d) + (minuteOfDay(d) < 12 * 60 ? " am" : " pm")
    }

    /// "9:41am", Sydney time, as the phone app writes times; "09:41" when the watch uses 24 hour time.
    static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = sydney
        let h24 = !(DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: .autoupdatingCurrent) ?? "a").contains("a")
        f.dateFormat = h24 ? "HH:mm" : "h:mma"
        return f.string(from: d).lowercased().replacingOccurrences(of: " ", with: "")
    }

    static func parseISO(_ s: String) -> Date? {
        let a = ISO8601DateFormatter()
        a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        a.formatOptions = [.withInternetDateTime]
        return a.date(from: s)
    }

    /// Whole minutes until `t`, never below 0.
    static func minutes(until t: Date, from now: Date = Date()) -> Int {
        max(0, Int((t.timeIntervalSince(now) / 60).rounded(.down)))
    }

    /// "Now", "4 min", or the time for an hour or more away.
    static func countdown(_ t: Date, from now: Date = Date()) -> String {
        let m = minutes(until: t, from: now)
        if m < 1 { return "Now" }
        if m >= 60 { return hhmm(t) }
        return "\(m) min"
    }
}

enum WText {
    /// "Plat 2" for "Platform 2" or "2"; stands and wharves keep their own word.
    static func platform(_ p: String?) -> String? {
        guard let p = p?.trimmingCharacters(in: .whitespaces), !p.isEmpty else { return nil }
        let lower = p.lowercased()
        if lower.hasPrefix("platform") {
            let rest = p.dropFirst("platform".count).trimmingCharacters(in: .whitespaces)
            return rest.isEmpty ? nil : "Plat \(rest)"
        }
        if p.allSatisfy({ $0.isNumber }) { return "Plat \(p)" }
        return p
    }

    /// "T1 4 min, Plat 2"
    static func line(_ line: String, _ t: Date, platform: String?, now: Date = Date()) -> String {
        var s = line.isEmpty ? Clock.countdown(t, from: now) : "\(line) \(Clock.countdown(t, from: now))"
        if let p = self.platform(platform) { s += ", \(p)" }
        return s
    }

    /// "Leaves in 4 min", "Due now" (build 212, as the phone; was "Leaves now"), or "Leaves at 9:41am" an hour or more away.
    static func leaves(_ t: Date, now: Date = Date()) -> String {
        let m = Clock.minutes(until: t, from: now)
        if m < 1 { return "Due now" }
        if m >= 60 { return "Leaves at \(Clock.hhmm(t))" }
        return "Leaves in \(m) min"
    }

    /// "Kings Cross Station, Kings Cross" becomes "Kings Cross".
    static func short(_ n: String?) -> String {
        var s = (n ?? "").components(separatedBy: ",").first ?? ""
        s = s.trimmingCharacters(in: .whitespaces)
        for suffix in [" Station", " Light Rail", " Wharf"] where s.hasSuffix(suffix) {
            s = String(s.dropLast(suffix.count))
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}

extension Color {
    /// "#0A84FF" or "0A84FF"; the system blue when it cannot be read.
    init(hexString: String?) {
        var s = (hexString ?? "").trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { self = .blue; return }
        self = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

// MARK: The moments of a started trip (build 212)

/// The same moments as the phone's "Your trip" widget (targets/widget/TripMoments.swift; keep the two in step): the
/// countdown to the live departure, Due, on board, your stop next, Get off now, Arrived. Build 212 (G27): the watch
/// said "Leaving now" at the old time and its timer then counted up past it.
enum WTripKind: String, Codable, Hashable { case wait, due, ride, next, getOff, arrived }

struct WTripMoment: Hashable {
    var at: Date
    var kind: WTripKind
    var target: Date?
}

enum WTripMoments {
    static let nextLead: TimeInterval = 120
    static let getOffLead: TimeInterval = 30
    static let dueLead: TimeInterval = 60
    static let dueFor: TimeInterval = 60
    static let liveFor: TimeInterval = 120

    static func list(_ c: WLiveCard, now: Date) -> [WTripMoment] {
        var all: [WTripMoment] = []
        let off = c.getOffTime
        if c.phase == "arrived" { return [WTripMoment(at: now, kind: .arrived, target: nil)] }
        if c.phase == "wait" {
            guard let d = c.departs.map({ Date(timeIntervalSince1970: $0 / 1000) }) else {
                return [WTripMoment(at: now, kind: .wait, target: nil)]
            }
            all.append(WTripMoment(at: .distantPast, kind: .wait, target: d))
            all.append(WTripMoment(at: d.addingTimeInterval(-dueLead), kind: .due, target: nil))
            let left = d.addingTimeInterval(dueFor)
            if left < off.addingTimeInterval(-nextLead) { all.append(WTripMoment(at: left, kind: .ride, target: off)) }
        } else {
            all.append(WTripMoment(at: .distantPast, kind: .ride, target: off))
        }
        all.append(WTripMoment(at: off.addingTimeInterval(-nextLead), kind: .next, target: off))
        all.append(WTripMoment(at: off.addingTimeInterval(-getOffLead), kind: .getOff, target: nil))
        all.append(WTripMoment(at: off, kind: .arrived, target: nil))
        var sorted: [WTripMoment] = []
        for m in all where sorted.last.map({ m.at > $0.at }) ?? true { sorted.append(m) }
        let current = sorted.last(where: { $0.at <= now }) ?? sorted[0]
        return [WTripMoment(at: now, kind: current.kind, target: current.target)] + sorted.filter { $0.at > now }
    }

    /// 0 live, 1 "about" (2 to 5 min old), 2 no live data (5 min on), as the phone (spec 2.4).
    static func ageStep(_ c: WLiveCard, at: Date) -> Int {
        guard let u = c.updatedAt else { return 0 }
        let a = at.timeIntervalSince(u)
        return a >= 300 ? 2 : (a >= liveFor ? 1 : 0)
    }

    /// The big words for a moment: "Leaves in 4 min", "Due", "6 min", "Get off now", "Arrived"; with old live times
    /// the clock time with "about" (never a countdown on old data).
    static func big(_ c: WLiveCard, _ m: WTripMoment, at: Date) -> String {
        let step = ageStep(c, at: at)
        switch m.kind {
        case .due: return "Due"
        case .getOff: return "Get off now"
        case .arrived: return WText.short(c.getOffAt) == WText.short(c.destination ?? c.getOffAt) ? "Arrived" : "Change here"
        case .wait, .ride, .next:
            guard let t = m.target else { return "Leaves soon" }
            if step >= 1 { return "About \(Clock.hhmm(t))" }
            return m.kind == .wait ? WText.leaves(t, now: at) : Clock.countdown(t, from: at)
        }
    }

    /// The line under it: the delay, your stop next, where you get off.
    static func detail(_ c: WLiveCard, _ m: WTripMoment, at: Date) -> String? {
        if ageStep(c, at: at) >= 1, let u = c.updatedAt {
            return ageStep(c, at: at) >= 2 ? "No live data since \(Clock.hhmm(u))" : "Updated \(Clock.hhmm(u))"
        }
        let delay: String? = c.delayMin.map { $0 > 0 ? "\($0) min late" : ($0 < 0 ? "\(-$0) min early" : "On time") }
        switch m.kind {
        case .wait, .due: return delay ?? WText.platform(c.platform)
        case .ride: return c.nextStop.map { "Next: \(WText.short($0))" } ?? delay
        case .next: return "\(WText.short(c.getOffAt)) next"
        case .getOff: return WText.short(c.getOffAt)
        case .arrived: return Clock.hhmm(c.getOffTime)
        }
    }
}
