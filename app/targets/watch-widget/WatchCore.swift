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
    /// Saved trips in the phone's order (context version 2, from build 207). Missing from older phones.
    var trips: [WTrip]?
    /// The last times the phone loaded, by trip key, for when the watch cannot reach the server.
    var times: [String: WTimes]?

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

    /// The trip cards the watch lists, in the phone's order: Home to Work (or back) first when both are set, then
    /// the saved trips. No repeats.
    func cards(now: Date = Date()) -> [WCard] {
        var out: [WCard] = []
        var seen = Set<String>()
        if let m = commute(now: now) {
            out.append(WCard(key: m.key, name: m.title, from: m.from, to: m.to, plan: nil, isCommute: true))
            seen.insert(m.key)
            seen.insert("\(m.to.id)>\(m.from.id)")
        }
        for t in trips ?? [] where !t.key.isEmpty && !seen.contains(t.key) && t.from.id != t.to.id {
            seen.insert(t.key)
            out.append(WCard(key: t.key, name: t.name, from: t.from, to: t.to, plan: t.plan, isCommute: false))
        }
        return out
    }
}

/// One saved trip from the phone (platform/watchShare.ts WatchTrip).
struct WTrip: Codable, Hashable {
    var key: String
    var name: String
    var kind: String?
    var from: WStop
    var to: WStop
    /// The legs as /api/plan takes them (JSON) for a trip with changes you chose; nil for a plain A to B trip.
    var plan: String?
}

/// One service the phone loaded (platform/watchShare.ts WatchNext). `dep` is milliseconds since 1970.
struct WNext: Codable, Hashable {
    var line: String
    var color: String?
    var mode: String?
    var platform: String?
    var dep: Double
    var delay: Double?
    var live: Bool?
    var cancelled: Bool?
    var lines: [String]?
    var colors: [String]?

    var service: WService {
        WService(line: line, colorHex: color, mode: mode, dest: nil, platform: platform,
                 time: Date(timeIntervalSince1970: dep / 1000), live: live == true, cancelled: cancelled == true,
                 arrive: nil, delay: delay.map { Int($0.rounded()) }, lines: lines, colors: colors, legs: nil)
    }
}

struct WTimes: Codable, Hashable {
    var at: Double
    var next: [WNext]
}

/// A leg of a trip with changes, as /api/plan takes it.
struct WPlanLeg: Codable, Hashable {
    var f: String
    var fn: String
    var t: String
    var tn: String
    var m: String?
    var c: Double?
    var a: Double?
    var w: Double?
}

/// A trip card on the watch: Home to Work, or a saved trip, or either one the other way round.
struct WCard: Hashable, Identifiable {
    var key: String
    var name: String
    var from: WStop
    var to: WStop
    var plan: String?
    var isCommute: Bool
    var id: String { key }

    /// "Kings Cross to Strathfield"
    var title: String { "\(WText.short(from.name)) to \(WText.short(to.name))" }

    /// The same trip the other way: legs in the other order, each change time staying with its change stop
    /// (the phone's reverseTrip does the same).
    func reversed() -> WCard {
        var plan: String? = nil
        var key = "\(to.id)>\(from.id)"
        if let p = self.plan, let d = p.data(using: .utf8), let legs = try? JSONDecoder().decode([WPlanLeg].self, from: d), legs.count > 1 {
            let n = legs.count
            var out: [WPlanLeg] = []
            for i in 0..<n {
                let l = legs[n - 1 - i]
                let conn: Double? = i == 0 ? nil : legs[n - i].c
                out.append(WPlanLeg(f: l.t, fn: l.tn, t: l.f, tn: l.fn, m: l.m, c: conn ?? 5, a: l.a, w: l.w))
            }
            if let e = try? JSONEncoder().encode(out) { plan = String(data: e, encoding: .utf8) }
            key = ([out[0].f] + out.dropLast().map(\.t) + [out[n - 1].t]).joined(separator: ">")
        }
        return WCard(key: key, name: "", from: to, to: from, plan: plan, isCommute: false)
    }
}

/// Where a complication tap opens the watch app: "nswtransportwatch://trip?key=10101>10102". The scheme is in the
/// watch app's Info.plist.
enum WatchLinks {
    static let scheme = "nswtransportwatch"

    static func trip(_ key: String) -> URL? {
        var c = URLComponents()
        c.scheme = scheme
        c.host = "trip"
        c.queryItems = [URLQueryItem(name: "key", value: key)]
        return c.url
    }

    /// The trip key in a link from `trip(_:)`, or nil for anything else.
    static func tripKey(_ url: URL) -> String? {
        guard url.scheme == scheme, url.host == "trip",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let key = items.first(where: { $0.name == "key" })?.value, !key.isEmpty else { return nil }
        return key
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
    /// Minutes late by the live times (0 on time), nil when there are no live times.
    var delay: Int?
    /// Every line of the trip in order ("T4", "T1") and their colours, for the bar and "T4, T1 Lines".
    var lines: [String]?
    var colors: [String]?
    /// The legs of a planned trip, for the service screen.
    var legs: [WLeg]?
    var id: String { "\(line)-\(time.timeIntervalSince1970)-\(platform ?? "")" }

    /// The lines to name: every line of the trip, else the first one.
    var allLines: [String] {
        let l = (lines ?? []).filter { !$0.isEmpty }
        return l.isEmpty ? (line.isEmpty ? [] : [line]) : l
    }

    /// The colours for the bar on the left, one per line.
    var barColors: [String?] {
        let c = colors ?? []
        if !c.isEmpty, c.count == (lines ?? []).count { return c.map { $0.isEmpty ? nil : $0 } }
        return [colorHex]
    }

    /// How the countdown is drawn: on time, a little late, very late or cancelled.
    var status: WStatus {
        if cancelled { return .cancelled }
        guard live, let d = delay else { return .onTime }
        if d >= 5 { return .late }
        if d >= 2 { return .slightlyLate }
        return .onTime
    }
}

enum WStatus { case onTime, slightlyLate, late, cancelled }

/// One leg of a planned trip.
struct WLeg: Codable, Hashable {
    var line: String
    var colorHex: String?
    var mode: String?
    var from: String?
    var fromPlatform: String?
    var to: String?
    var toPlatform: String?
    var dep: Date?
    var arr: Date?
    var delay: Int?
}

/// What the watch last loaded, kept so it can show it with no signal.
struct WatchSnapshot: Codable {
    var commuteKey: String?
    var commute: [WService] = []
    var commuteAt: Date?
    var stops: [String: [WService]] = [:]
    var stopsAt: [String: Date] = [:]
    /// Saved trips (and Home to Work both ways) by trip key, and when each was loaded.
    var trips: [String: [WService]] = [:]
    var tripsAt: [String: Date] = [:]

    init() {}

    /// Snapshots kept by the build 206 watch app have no trips yet; they still load.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        commuteKey = try c.decodeIfPresent(String.self, forKey: .commuteKey)
        commute = try c.decodeIfPresent([WService].self, forKey: .commute) ?? []
        commuteAt = try c.decodeIfPresent(Date.self, forKey: .commuteAt)
        stops = try c.decodeIfPresent([String: [WService]].self, forKey: .stops) ?? [:]
        stopsAt = try c.decodeIfPresent([String: Date].self, forKey: .stopsAt) ?? [:]
        trips = try c.decodeIfPresent([String: [WService]].self, forKey: .trips) ?? [:]
        tripsAt = try c.decodeIfPresent([String: Date].self, forKey: .tripsAt) ?? [:]
    }

    /// The services to show for a card: what the watch loaded, else the times the phone sent (no signal on the
    /// watch), gone ones left out. `fromPhone` is true for the second.
    func services(for card: WCard, context: WatchContext?, now: Date = Date()) -> (list: [WService], fromPhone: Bool, at: Date?) {
        let mine = Self.upcoming(trips[card.key] ?? [], now: now)
        if !mine.isEmpty { return (mine, false, tripsAt[card.key]) }
        if card.isCommute, commuteKey == card.key {
            let c = Self.upcoming(commute, now: now)
            if !c.isEmpty { return (c, false, commuteAt) }
        }
        if let t = context?.times?[card.key] {
            let p = Self.upcoming(t.next.map(\.service), now: now)
            if !p.isEmpty { return (p, true, Date(timeIntervalSince1970: t.at / 1000)) }
        }
        return ([], false, tripsAt[card.key])
    }

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
        var kind: String?
        var line: String?
        var color: String?
        var mode: String?
        var towards: String?
        var from: String?
        var to: String?
        var fromPlatform: String?
        var toPlatform: String?
        var planned: Date?
        var estimated: Date?
        var arrPlanned: Date?
        var arrEstimated: Date?
        var realtime: Bool?
        var cancelled: Bool?
        var delayMin: Double?

        enum CodingKeys: String, CodingKey {
            case kind, line, color, mode, towards, from, to, fromPlatform, toPlatform, planned, estimated, arrPlanned,
                 arrEstimated, realtime, cancelled, delayMin
        }

        /// One odd field (an empty time, a number where text was expected) must not lose the whole answer.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = try? c.decodeIfPresent(String.self, forKey: .kind)
            line = try? c.decodeIfPresent(String.self, forKey: .line)
            color = try? c.decodeIfPresent(String.self, forKey: .color)
            mode = try? c.decodeIfPresent(String.self, forKey: .mode)
            towards = try? c.decodeIfPresent(String.self, forKey: .towards)
            from = try? c.decodeIfPresent(String.self, forKey: .from)
            to = try? c.decodeIfPresent(String.self, forKey: .to)
            fromPlatform = try? c.decodeIfPresent(String.self, forKey: .fromPlatform)
            toPlatform = try? c.decodeIfPresent(String.self, forKey: .toPlatform)
            planned = try? c.decodeIfPresent(Date.self, forKey: .planned)
            estimated = try? c.decodeIfPresent(Date.self, forKey: .estimated)
            arrPlanned = try? c.decodeIfPresent(Date.self, forKey: .arrPlanned)
            arrEstimated = try? c.decodeIfPresent(Date.self, forKey: .arrEstimated)
            realtime = try? c.decodeIfPresent(Bool.self, forKey: .realtime)
            cancelled = try? c.decodeIfPresent(Bool.self, forKey: .cancelled)
            delayMin = try? c.decodeIfPresent(Double.self, forKey: .delayMin)
        }

        var isTransit: Bool { kind != "walk" && mode != "walk" }
    }
    private struct Journey: Decodable {
        var arrive: Date?
        var anyCancelled: Bool?
        var legs: [Leg]

        enum CodingKeys: String, CodingKey { case arrive, anyCancelled, legs }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            arrive = try? c.decodeIfPresent(Date.self, forKey: .arrive)
            anyCancelled = try? c.decodeIfPresent(Bool.self, forKey: .anyCancelled)
            legs = (try? c.decodeIfPresent([Leg].self, forKey: .legs)) ?? []
        }
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
        return Array(WatchSnapshot.upcoming(Self.services(r)).prefix(count))
    }

    /// A trip with changes you chose (the legs as /api/plan takes them).
    func plan(legs: String, count: Int = 6) async throws -> [WService] {
        let r: Trip = try await get("api/plan", ["legs": legs, "count": String(count + 1)])
        return Array(WatchSnapshot.upcoming(Self.services(r)).prefix(count))
    }

    /// The cards' trips: a plain A to B trip asks /api/trip, a trip with changes /api/plan.
    func load(_ card: WCard, count: Int = 6) async throws -> [WService] {
        if let p = card.plan, !p.isEmpty { return try await plan(legs: p, count: count) }
        return try await trip(from: card.from.id, to: card.to.id, count: count)
    }

    /// The first train, bus or ferry of each journey, with every line of the journey and its legs.
    private static func services(_ r: Trip) -> [WService] {
        r.journeys.compactMap { j -> WService? in
            let transit = j.legs.filter(\.isTransit)
            guard let l = transit.first else { return nil }
            let live = l.realtime == true && l.estimated != nil
            guard let t = (live ? l.estimated : nil) ?? l.planned else { return nil }
            var lines: [String] = []
            var colors: [String] = []
            for x in transit {
                let n = x.line ?? ""
                if n.isEmpty || lines.contains(n) { continue }
                lines.append(n)
                colors.append(x.color ?? "")
            }
            let legs = transit.map { x -> WLeg in
                let xl = x.realtime == true
                return WLeg(line: x.line ?? "", colorHex: x.color, mode: x.mode, from: x.from, fromPlatform: x.fromPlatform,
                            to: x.to, toPlatform: x.toPlatform, dep: (xl ? x.estimated : nil) ?? x.planned,
                            arr: (xl ? x.arrEstimated : nil) ?? x.arrPlanned,
                            delay: xl ? x.delayMin.map { Int($0.rounded()) } : nil)
            }
            return WService(line: l.line ?? "", colorHex: l.color, mode: l.mode, dest: l.towards, platform: l.fromPlatform,
                            time: t, live: live, cancelled: l.cancelled == true || j.anyCancelled == true, arrive: j.arrive,
                            delay: live ? l.delayMin.map { Int($0.rounded()) } : nil,
                            lines: lines, colors: colors, legs: legs)
        }
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

    /// "9:41am", Sydney time, as the phone app writes times.
    static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = sydney
        f.dateFormat = "h:mma"
        return f.string(from: d).lowercased().replacingOccurrences(of: " ", with: "")
    }

    /// "11:56", Sydney time, no am or pm.
    static func hm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = sydney
        f.dateFormat = "h:mm"
        return f.string(from: d)
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

    /// "Leaves in 4 min", "Leaves now", or "Leaves at 9:41am" an hour or more away.
    static func leaves(_ t: Date, now: Date = Date()) -> String {
        let m = Clock.minutes(until: t, from: now)
        if m < 1 { return "Leaves now" }
        if m >= 60 { return "Leaves at \(Clock.hhmm(t))" }
        return "Leaves in \(m) min"
    }

    /// The big countdown on a trip card, whole minutes: "Now" under a minute, "1 min", "2 mins", and
    /// "1 h 20 min" for an hour or more (the phone app writes long times the same way).
    static func mins(_ t: Date, now: Date = Date()) -> String {
        let m = Clock.minutes(until: t, from: now)
        if m < 1 { return "Now" }
        if m == 1 { return "1 min" }
        if m < 60 { return "\(m) mins" }
        let h = m / 60, r = m % 60
        return r == 0 ? "\(h) h" : "\(h) h \(r) min"
    }

    /// The same for VoiceOver: "now", "1 minute", "2 minutes", "1 hour 20 minutes".
    static func minsSpoken(_ t: Date, now: Date = Date()) -> String {
        let m = Clock.minutes(until: t, from: now)
        if m < 1 { return "now" }
        if m < 60 { return m == 1 ? "1 minute" : "\(m) minutes" }
        let h = m / 60, r = m % 60
        let hs = h == 1 ? "1 hour" : "\(h) hours"
        return r == 0 ? hs : "\(hs) \(r == 1 ? "1 minute" : "\(r) minutes")"
    }

    /// "Next: 16, 18 mins" from the services after the first one.
    static func nextLine(_ rest: [WService], now: Date = Date()) -> String? {
        let ms = rest.filter { !$0.cancelled }.prefix(2).map { Clock.minutes(until: $0.time, from: now) }
        guard !ms.isEmpty else { return nil }
        if ms.allSatisfy({ $0 < 60 }) {
            let unit = ms.count == 1 && ms[0] == 1 ? "min" : "mins"
            return "Next: " + ms.map(String.init).joined(separator: ", ") + " " + unit
        }
        return "Next: " + rest.filter { !$0.cancelled }.prefix(2).map { Clock.hhmm($0.time) }.joined(separator: ", ")
    }

    /// "Platform 1" in full ("1" alone becomes "Platform 1"); stands and wharves keep their own word.
    static func platformFull(_ p: String?) -> String? {
        guard let p = p?.trimmingCharacters(in: .whitespaces), !p.isEmpty else { return nil }
        if p.allSatisfy({ $0.isNumber }) { return "Platform \(p)" }
        return p
    }

    /// "T4, T1 Lines", "T1 Line", "Route 311", "Routes 311, 333".
    static func lines(_ s: WService) -> String? {
        let l = s.allLines
        guard !l.isEmpty else { return nil }
        let joined = l.joined(separator: ", ")
        if (s.mode ?? "") == "bus" { return (l.count == 1 ? "Route " : "Routes ") + joined }
        return joined + (l.count == 1 ? " Line" : " Lines")
    }

    /// "train", "bus", "ferry" for VoiceOver.
    static func modeWord(_ mode: String?) -> String {
        let m = (mode ?? "").lowercased()
        switch m {
        case "train", "metro", "bus", "ferry", "coach": return m
        case "lightrail", "light rail", "tram": return "light rail"
        default: return "service"
        }
    }

    /// "2 min late", "On time" or "Timetable" for a service row.
    static func delay(_ s: WService) -> String {
        if s.cancelled { return "Cancelled" }
        guard s.live else { return "Timetable" }
        guard let d = s.delay, d >= 1 else { return "On time" }
        return "\(d) min late"
    }

    /// For VoiceOver: "Kings Cross to Strathfield, next train in 2 minutes, platform 1, T4 and T1 lines, then 16
    /// and 18 minutes".
    static func spokenCard(title: String, services: [WService], now: Date = Date()) -> String {
        guard let s = services.first else { return "\(title), no services found right now" }
        var parts = [title]
        let word = modeWord(s.mode)
        if s.cancelled {
            parts.append("next \(word) cancelled")
        } else {
            let m = Clock.minutes(until: s.time, from: now)
            parts.append(m < 1 ? "next \(word) now" : "next \(word) in \(minsSpoken(s.time, now: now))")
            if s.live, let d = s.delay, d >= 1 { parts.append(d == 1 ? "1 minute late" : "\(d) minutes late") }
        }
        if let p = platformFull(s.platform) { parts.append(p.lowercased()) }
        let l = s.allLines
        if !l.isEmpty {
            let names = l.count == 1 ? l[0] : l.dropLast().joined(separator: ", ") + " and " + l[l.count - 1]
            parts.append((s.mode ?? "") == "bus" ? "route \(names)" : "\(names) \(l.count == 1 ? "line" : "lines")")
        }
        let rest = services.dropFirst().filter { !$0.cancelled }.prefix(2).map { Clock.minutes(until: $0.time, from: now) }
        if !rest.isEmpty, rest.allSatisfy({ $0 < 60 }) {
            let n = rest.map(String.init)
            parts.append("then " + (n.count == 1 ? n[0] : "\(n[0]) and \(n[1])") + (n.count == 1 && rest[0] == 1 ? " minute" : " minutes"))
        }
        return parts.joined(separator: ", ")
    }

    /// "11:56 to 12:18": when it leaves and when you arrive, no am or pm (the card is small); the leaving time
    /// alone when the arrival is not known.
    static func span(_ s: WService) -> String {
        guard let a = s.arrive else { return Clock.hm(s.time) }
        return "\(Clock.hm(s.time)) to \(Clock.hm(a))"
    }

    /// "26 min late" when a service runs 2 or more minutes late by the live times.
    static func late(_ s: WService) -> String? {
        guard !s.cancelled, s.live, let d = s.delay, d >= 2 else { return nil }
        return "\(d) min late"
    }

    /// "To work" on the Home and Work card, or the name given to a saved trip when it says more than the route.
    static func tag(_ card: WCard) -> String? {
        let n = card.name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n.lowercased() != card.title.lowercased() else { return nil }
        return String(n.prefix(1)).uppercased() + String(n.dropFirst())
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
