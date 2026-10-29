import AppIntents
import Foundation

// Siri, Shortcuts, Spotlight and Control Center. This folder is built into both the app and the widget
// extension (apple-targets _shared), so it only uses Foundation and AppIntents and reads what the app
// writes into the app group: Home and Work ("homeWork"), starred stops ("starredStops"), the server
// address ("apiBase.v1"), the profile ("apiProfile") and a trip in progress ("liveCard").

enum TSShared {
    static let appGroup = "group.com.maisysen.nswtransport"
    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
    static let builtInBase = "https://api.transportsydney.app"
    static let allowedDomains = ["api.transportsydney.app"]
    /// The half day the widget's swap button turned the commute round for, "2026-10-25 pm".
    static let widgetFlipKey = "commuteFlip.widget"
    /// A link the app opens the next time it comes to the front, written by "Start my commute".
    static let pendingKey = "intentPendingOpen"
    static let pendingNote = Notification.Name("TransportIntentQueued")
    static let sydney = TimeZone(identifier: "Australia/Sydney") ?? .current

    struct Stop: Decodable {
        var id: String
        var name: String
    }

    struct HomeWork: Decodable {
        var home: Stop?
        var work: Stop?
        var flip: String?
    }

    struct LiveCard: Decodable {
        var line: String
        var phase: String
        var getOffAt: String
        var platform: String?
        var departs: Double?
        var legArrives: Double?
        var arrival: Double
        var until: Double
    }

    static func decode<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        let d = defaults
        if let data = d.data(forKey: key) { return try? JSONDecoder().decode(T.self, from: data) }
        if let s = d.string(forKey: key) { return try? JSONDecoder().decode(T.self, from: Data(s.utf8)) }
        return nil
    }

    static func homeWork() -> HomeWork? { decode(HomeWork.self, "homeWork") }
    static func starred() -> [Stop] { (decode([Stop].self, "starredStops") ?? []).filter { !$0.id.isEmpty } }

    /// The trip in progress, while the app still keeps it.
    static func liveCard(now: Date = Date()) -> LiveCard? {
        guard let c = decode(LiveCard.self, "liveCard"), c.phase != "arrived",
              Date(timeIntervalSince1970: c.until / 1000) > now else { return nil }
        return c
    }

    // MARK: Server

    /// The address the app uses now (it writes "apiBase.v1"), else the built in one. Only https on the
    /// built in host or a host under one of `allowedDomains`.
    static func apiBase() -> URL {
        if let s = defaults.string(forKey: "apiBase.v1"), let u = acceptBase(s) { return u }
        return URL(string: builtInBase)!
    }

    static func acceptBase(_ s: String) -> URL? {
        guard let c = URLComponents(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme?.lowercased() == "https", let host = c.host?.lowercased(), !host.isEmpty,
              c.user == nil, c.password == nil, c.query == nil else { return nil }
        let builtHost = URL(string: builtInBase)?.host ?? ""
        let ok = host == builtHost || allowedDomains.contains { host == $0 || host.hasSuffix("." + $0) }
        guard ok, host.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else { return nil }
        var path = c.path
        while path.hasSuffix("/") { path.removeLast() }
        return URL(string: "https://\(host)\(path)")
    }

    static func get<T: Decodable>(_ type: T.Type, _ path: String, _ query: [String: String]) async throws -> T {
        guard var c = URLComponents(url: apiBase().appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw URLError(.badURL)
        }
        var items = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        if let p = defaults.string(forKey: "apiProfile"), !p.isEmpty { items.append(URLQueryItem(name: "profile", value: p)) }
        c.queryItems = items
        guard let u = c.url else { throw URLError(.badURL) }
        var req = URLRequest(url: u)
        req.timeoutInterval = 10
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // MARK: Trips

    struct Leg: Decodable {
        var kind: String?
        var line: String?
        var mode: String?
        var from: String?
        var fromPlatform: String?
        var planned: String?
        var estimated: String?
        var realtime: Bool?
        var delayMin: Double?
    }

    struct Journey: Decodable {
        var leave: String?
        var arrive: String?
        var anyCancelled: Bool?
        var legs: [Leg]?
    }

    struct TripResponse: Decodable {
        var journeys: [Journey]?
    }

    struct Departure: Decodable {
        var line: String?
        var mode: String?
        var dest: String?
        var platform: String?
        var planned: String?
        var estimated: String?
        var realtime: Bool?
        var cancelled: Bool?
        var delayMin: Double?
    }

    struct DeparturesResponse: Decodable {
        var items: [Departure]?
    }

    /// The next service of a trip, as said out loud.
    struct Next {
        var line: String
        var mode: String
        var leave: Date
        var board: Date
        var arrive: Date?
        var platform: String?
        var stopName: String?
        var live: Bool
        var delayMin: Int
        var skippedCancelled: Bool
    }

    /// The last live times the Next trip widget kept for this pair of stops (key "nextTripCache.FROM.TO",
    /// dates as the default Codable seconds since 2001).
    struct CachedLine: Decodable {
        var line: String
        var mode: String
        var leave: Date
        var board: Date?
        var arrive: Date?
        var platform: String?
    }

    struct Cached: Decodable {
        var updated: Date
        var trips: [CachedLine]
    }

    /// The next service from what the widget last saw, marked as not live. Nil when nothing is kept or it is
    /// more than an hour old.
    static func cachedTrip(from: Stop, to: Stop, now: Date = Date()) -> (Next, Date)? {
        guard let data = defaults.data(forKey: "nextTripCache.\(from.id).\(to.id)"),
              let c = try? JSONDecoder().decode(Cached.self, from: data),
              now.timeIntervalSince(c.updated) < 3600,
              let t = c.trips.sorted(by: { $0.leave < $1.leave }).first(where: { $0.leave > now }) else { return nil }
        let n = Next(line: t.line, mode: t.mode, leave: t.leave, board: t.board ?? t.leave, arrive: t.arrive,
                     platform: t.platform, stopName: nil, live: false, delayMin: 0, skippedCancelled: false)
        return (n, c.updated)
    }

    static func nextTrip(from: Stop, to: Stop, now: Date = Date()) async throws -> Next? {
        let r = try await get(TripResponse.self, "api/trip", ["from": from.id, "to": to.id, "count": "4"])
        let all = (r.journeys ?? []).filter { j in
            guard let l = date(j.leave), l > now.addingTimeInterval(-30) else { return false }
            return (j.legs ?? []).contains { $0.kind == "transit" }
        }
        let ok = all.filter { $0.anyCancelled != true }
        guard let j = ok.first, let leave = date(j.leave),
              let t = (j.legs ?? []).first(where: { $0.kind == "transit" }) else { return nil }
        let board = date(t.estimated) ?? date(t.planned) ?? leave
        return Next(line: t.line ?? "", mode: t.mode ?? "", leave: leave, board: board, arrive: date(j.arrive),
                    platform: t.fromPlatform, stopName: t.from, live: t.realtime == true,
                    delayMin: Int((t.delayMin ?? 0).rounded()), skippedCancelled: all.first?.anyCancelled == true)
    }

    /// The next train or metro from a stop, else the next service of any kind.
    static func nextDeparture(at stop: Stop, now: Date = Date()) async throws -> (Departure, Date)? {
        let r = try await get(DeparturesResponse.self, "api/departures", ["stop": stop.id])
        let list: [(Departure, Date)] = (r.items ?? []).compactMap { d in
            guard d.cancelled != true, let t = date(d.estimated) ?? date(d.planned), t > now else { return nil }
            return (d, t)
        }.sorted { $0.1 < $1.1 }
        let rail = list.first { ["train", "metro"].contains(($0.0.mode ?? "").lowercased()) }
        return rail ?? list.first
    }

    // MARK: Commute

    static func minuteOfDay(_ d: Date) -> Int {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = sydney
        let c = cal.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// "2026-10-25 am" in Sydney, the key the app writes when you swap the commute card.
    static func halfDayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = sydney
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d) + (minuteOfDay(d) < 12 * 60 ? " am" : " pm")
    }

    /// True when the commute is turned round for this half day by the widget's swap button.
    static func widgetFlipped(now: Date = Date()) -> Bool {
        defaults.string(forKey: widgetFlipKey) == halfDayKey(now)
    }

    /// Home to Work before 12pm and Work to Home after, turned round for this half day by the app's
    /// commute card or the widget's swap button. Nil until Home and Work are two different stops.
    static func commute(_ hw: HomeWork?, now: Date = Date()) -> (toWork: Bool, from: Stop, to: Stop)? {
        guard let hw, let h = hw.home, let w = hw.work, !h.id.isEmpty, !w.id.isEmpty, h.id != w.id else { return nil }
        var flipped = hw.flip == halfDayKey(now)
        if widgetFlipped(now: now) { flipped.toggle() }
        let morning = minuteOfDay(now) < 12 * 60
        return morning != flipped ? (true, h, w) : (false, w, h)
    }

    // MARK: Links into the app

    /// nswtransport://trip?from=&fromName=&to=&toName=, plus start=1 to start the trip leaving closest to `at`.
    static func tripURL(from: Stop, to: Stop, start: Bool, at: Date? = nil) -> URL {
        var c = URLComponents()
        c.scheme = "nswtransport"
        c.host = "trip"
        var q = [URLQueryItem(name: "from", value: from.id), URLQueryItem(name: "fromName", value: from.name),
                 URLQueryItem(name: "to", value: to.id), URLQueryItem(name: "toName", value: to.name)]
        if let at { q.append(URLQueryItem(name: "at", value: String(Int(at.timeIntervalSince1970)))) }
        if start { q.append(URLQueryItem(name: "start", value: "1")) }
        c.queryItems = q
        return c.url ?? URL(string: "nswtransport://")!
    }

    /// The commute the way the commute card picks it, else the app's Home tab.
    static func commuteURL(start: Bool, now: Date = Date()) -> URL {
        guard let c = commute(homeWork(), now: now) else { return URL(string: "nswtransport://")! }
        return tripURL(from: c.from, to: c.to, start: start)
    }

    /// Work to Home (or Home to Work), else the app's Home tab.
    static func directionURL(toWork: Bool) -> URL {
        guard let hw = homeWork(), let h = hw.home, let w = hw.work, !h.id.isEmpty, !w.id.isEmpty, h.id != w.id else {
            return URL(string: "nswtransport://")!
        }
        return toWork ? tripURL(from: h, to: w, start: false) : tripURL(from: w, to: h, start: false)
    }

    /// Leaves a link for the app to open when it comes to the front, and tells the app if it is running.
    static func queueOpen(_ url: URL, now: Date = Date()) {
        let body: [String: Any] = ["url": url.absoluteString, "at": Int(now.timeIntervalSince1970)]
        if let data = try? JSONSerialization.data(withJSONObject: body), let s = String(data: data, encoding: .utf8) {
            defaults.set(s, forKey: pendingKey)
        }
        NotificationCenter.default.post(name: pendingNote, object: nil)
    }
}

// MARK: Words

enum TSSay {
    static let setHomeWork = "Add Home and Work on the Home tab in Transport, then ask again."
    static let offline = "I couldn't get live times just now. Check your connection and try again."

    static func clock(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = TSShared.sydney
        f.dateFormat = "h:mm a"
        return f.string(from: d).lowercased().replacingOccurrences(of: " ", with: "")
    }

    /// "now", "in 1 minute", "in 12 minutes", or "at 7:40pm" an hour or more out.
    static func when(_ d: Date, now: Date) -> String {
        let m = Int((d.timeIntervalSince(now) / 60).rounded(.down))
        if m <= 0 { return "now" }
        if m == 1 { return "in 1 minute" }
        if m >= 60 { return "at \(clock(d))" }
        return "in \(m) minutes"
    }

    /// "Strathfield" from "Strathfield Station" or "Strathfield Station, Platform 2".
    static func place(_ s: String?) -> String? {
        guard let first = s?.split(separator: ",").first else { return nil }
        var n = String(first).trimmingCharacters(in: .whitespaces)
        if n.hasSuffix(" Station") { n = String(n.dropLast(8)) }
        return n.isEmpty ? nil : n
    }

    static func noun(_ mode: String) -> String {
        switch mode.lowercased() {
        case "train": return "train"
        case "metro": return "metro"
        case "bus", "schoolbus": return "bus"
        case "ferry": return "ferry"
        case "lightrail", "light rail", "tram": return "light rail"
        case "coach": return "coach"
        default: return "service"
        }
    }

    static func service(_ line: String, _ mode: String) -> String {
        line.isEmpty ? noun(mode) : "\(line) \(noun(mode))"
    }

    static func platform(_ p: String?) -> String? {
        guard let p = p?.trimmingCharacters(in: .whitespaces), !p.isEmpty else { return nil }
        return p
    }

    /// What to say about the next service of a trip.
    static func trip(_ n: TSShared.Next, toWhat: String, now: Date = Date()) -> String {
        let svc = service(n.line, n.mode)
        let at = place(n.stopName).map { " at \($0)" } ?? ""
        let plat = platform(n.platform).map { " from \($0)" } ?? ""
        var s: String
        if n.board.timeIntervalSince(n.leave) > 90 {
            s = "Leave \(when(n.leave, now: now)) for the \(clock(n.board)) \(svc)\(plat)\(at)."
        } else {
            s = "The next \(svc) \(toWhat) leaves\(at) \(when(n.board, now: now))"
            if n.board.timeIntervalSince(now) < 60 * 60 { s += ", at \(clock(n.board))" }
            s += "\(plat)."
        }
        if let a = n.arrive { s += " You'll get there at \(clock(a))." }
        if n.delayMin >= 2 { s += " It's running \(n.delayMin) minutes late." }
        if !n.live { s += " That's the timetable time; there are no live times for it yet." }
        if n.skippedCancelled { s += " The one before it is cancelled." }
        return s
    }

    /// Offline: the last times kept on the phone, said as such, else the offline line.
    static func cached(_ hit: (TSShared.Next, Date)?, toWhat: String, now: Date = Date()) -> String {
        guard let hit else { return offline }
        let n = hit.0, updated = hit.1
        let svc = service(n.line, n.mode)
        let plat = platform(n.platform).map { " from \($0)" } ?? ""
        return "I can't reach live times right now. As of \(clock(updated)), the next \(svc) \(toWhat) was due \(when(n.board, now: now))\(plat)."
    }

    static func departure(_ d: TSShared.Departure, _ t: Date, stop: String, now: Date = Date()) -> String {
        let svc = service(d.line ?? "", d.mode ?? "")
        let to = place(d.dest).map { " to \($0)" } ?? ""
        let plat = platform(d.platform).map { " from \($0)" } ?? ""
        var s = "The next \(svc)\(to) leaves \(stop) \(when(t, now: now))"
        if t.timeIntervalSince(now) < 60 * 60 { s += ", at \(clock(t))" }
        s += "\(plat)."
        if Int((d.delayMin ?? 0).rounded()) >= 2 { s += " It's running \(Int((d.delayMin ?? 0).rounded())) minutes late." }
        return s
    }

    static func live(_ c: TSShared.LiveCard, now: Date = Date()) -> String {
        let off = place(c.getOffAt) ?? c.getOffAt
        if c.phase == "wait", let d = c.departs {
            let t = Date(timeIntervalSince1970: d / 1000)
            let plat = platform(c.platform).map { " from \($0)" } ?? ""
            return "Your \(c.line.isEmpty ? "service" : c.line) leaves \(when(t, now: now))\(plat). Get off at \(off)."
        }
        let t = Date(timeIntervalSince1970: (c.legArrives ?? c.arrival) / 1000)
        return "Get off at \(off) \(when(t, now: now)), at \(clock(t))."
    }
}

// MARK: Answers

enum TSAnswers {
    /// The next service home (toWork false) or to work.
    static func direction(toWork: Bool) async -> String {
        guard let hw = TSShared.homeWork(), let h = hw.home, let w = hw.work, !h.id.isEmpty, !w.id.isEmpty else {
            return TSSay.setHomeWork
        }
        if h.id == w.id { return "Home and Work are the same stop. Change one on the Home tab in Transport." }
        let (from, to) = toWork ? (h, w) : (w, h)
        do {
            guard let n = try await TSShared.nextTrip(from: from, to: to) else {
                return "I couldn't find a service \(toWork ? "to work" : "home") in the next few hours."
            }
            return TSSay.trip(n, toWhat: toWork ? "to work" : "home")
        } catch {
            return TSSay.cached(TSShared.cachedTrip(from: from, to: to), toWhat: toWork ? "to work" : "home")
        }
    }

    /// A trip in progress first, then the commute for this time of day, then the first starred stop.
    static func next() async -> String {
        if let c = TSShared.liveCard() { return TSSay.live(c) }
        if let c = TSShared.commute(TSShared.homeWork()) {
            do {
                guard let n = try await TSShared.nextTrip(from: c.from, to: c.to) else {
                    return "I couldn't find a service \(c.toWork ? "to work" : "home") in the next few hours."
                }
                return TSSay.trip(n, toWhat: c.toWork ? "to work" : "home")
            } catch {
                return TSSay.cached(TSShared.cachedTrip(from: c.from, to: c.to), toWhat: c.toWork ? "to work" : "home")
            }
        }
        if let s = TSShared.starred().first {
            do {
                guard let hit = try await TSShared.nextDeparture(at: s) else {
                    return "Nothing leaves \(TSSay.place(s.name) ?? s.name) in the next few hours."
                }
                return TSSay.departure(hit.0, hit.1, stop: TSSay.place(s.name) ?? s.name)
            } catch {
                return TSSay.offline
            }
        }
        return "Add Home and Work on the Home tab in Transport, or star a stop, then ask again."
    }
}

// MARK: Intents

@available(iOS 17.0, *)
struct NextTrainHomeIntent: AppIntent {
    static var title: LocalizedStringResource { "Next train home" }
    static var description: IntentDescription { IntentDescription("The next service from Work to Home, with live times.") }

    init() {}

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let s = await TSAnswers.direction(toWork: false)
        return .result(value: s, dialog: "\(s)")
    }
}

@available(iOS 17.0, *)
struct NextTrainToWorkIntent: AppIntent {
    static var title: LocalizedStringResource { "Next train to work" }
    static var description: IntentDescription { IntentDescription("The next service from Home to Work, with live times.") }

    init() {}

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let s = await TSAnswers.direction(toWork: true)
        return .result(value: s, dialog: "\(s)")
    }
}

@available(iOS 17.0, *)
struct NextTrainIntent: AppIntent {
    static var title: LocalizedStringResource { "When is my next train" }
    static var description: IntentDescription {
        IntentDescription("Your trip in progress, else the next service between Home and Work for this time of day, else your first starred stop.")
    }

    init() {}

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let s = await TSAnswers.next()
        return .result(value: s, dialog: "\(s)")
    }
}

/// Opens the app and starts the next trip between Home and Work. The app picks up the link when it comes
/// to the front (builds from 206).
@available(iOS 17.0, *)
struct StartCommuteIntent: AppIntent {
    static var title: LocalizedStringResource { "Start my commute" }
    static var description: IntentDescription {
        IntentDescription("Opens Transport and starts the next trip between Home and Work, the same way round as the commute card.")
    }
    static var openAppWhenRun: Bool { true }

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        TSShared.queueOpen(TSShared.commuteURL(start: true))
        return .result()
    }
}

/// Control Center: opens the trip from Work to Home.
@available(iOS 18.0, *)
struct OpenTrainHomeIntent: AppIntent {
    static var title: LocalizedStringResource { "Open next train home" }
    static var description: IntentDescription { IntentDescription("Opens your trip from Work to Home with live times.") }
    static var isDiscoverable: Bool { false }
    static var openAppWhenRun: Bool { true }

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(TSShared.directionURL(toWork: false)))
    }
}

/// Control Center: opens the commute for this time of day and starts its next trip.
@available(iOS 18.0, *)
struct OpenStartCommuteIntent: AppIntent {
    static var title: LocalizedStringResource { "Open and start my commute" }
    static var description: IntentDescription { IntentDescription("Opens Transport and starts the next trip between Home and Work.") }
    static var isDiscoverable: Bool { false }
    static var openAppWhenRun: Bool { true }

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(TSShared.commuteURL(start: true)))
    }
}

// The phrases need no setup: they work as soon as the app is installed, and show in Spotlight and the
// Shortcuts app. Built into the app only (the widget extension cannot import the app's Expo modules).
#if canImport(ExpoModulesCore)
@available(iOS 17.0, *)
struct TransportShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NextTrainHomeIntent(), phrases: [
            "Next train home in \(.applicationName)",
            "When's my train home in \(.applicationName)",
            "\(.applicationName) train home",
        ], shortTitle: "Next train home", systemImageName: "house.fill")
        AppShortcut(intent: NextTrainToWorkIntent(), phrases: [
            "Next train to work in \(.applicationName)",
            "When's my train to work in \(.applicationName)",
            "\(.applicationName) train to work",
        ], shortTitle: "Next train to work", systemImageName: "briefcase.fill")
        AppShortcut(intent: NextTrainIntent(), phrases: [
            "When is my next train in \(.applicationName)",
            "When's my next train in \(.applicationName)",
            "Next train in \(.applicationName)",
        ], shortTitle: "Next train", systemImageName: "tram.fill")
        AppShortcut(intent: StartCommuteIntent(), phrases: [
            "Start my commute in \(.applicationName)",
            "Start my commute with \(.applicationName)",
        ], shortTitle: "Start my commute", systemImageName: "location.fill")
    }

    static var shortcutTileColor: ShortcutTileColor { .blue }
}
#endif
