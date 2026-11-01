import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The trip's registrations with the server, kept until the server has them (build after 214, 1 Nov 2026).
///
/// Why: the real-time harness (files/day-1nov/rt-harness.md, bugs #2 to #4). Start trip sent the trip watch (the server's
/// alerts, Get off now among them) and the Lock Screen card's push token once, from JavaScript. With the phone locked
/// before the token came, no signal, or a server blip at that moment, the card stayed frozen for the whole trip and no
/// server alert came. Now JavaScript queues each registration here too (app/src/lib/tripRegCore.ts, same rules) and the
/// app's background upload (TripOutboxUploader.swift, sent by iOS while the phone is locked and the app suspended) and
/// the widgets' timeline send it until a 2xx answer. The server keeps one watch per key, so a repeat is harmless.
///
/// Pure Foundation, the same file in the app module (modules/transport-ios/ios) and the widget (targets/widget):
/// app/test/swift/tripoutbox/main.swift compiles it on its own and checks it.
public enum TripOutbox {
    public static let storeKey = "tripOutbox"
    public static let cardKey = "tripOutboxCard"
    /// Seconds between tries, as tripRegCore.ts REG_BACKOFF_S: 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min.
    public static let backoff: [TimeInterval] = [5, 15, 30, 60, 120, 300]
    /// The card's copy waits this long while the app is open (JavaScript sends it itself), as REG_NATIVE_DELAY_S.
    public static let nativeDelay: TimeInterval = 20

    public struct Entry: Codable, Equatable {
        public var kind: String
        public var method: String
        public var path: String
        public var body: String?
        /// Not before, and given up at (ms since 1970).
        public var after: Double
        public var until: Double
        /// The phone's own Get off now notifications to take off when the server says yes with getOff true.
        public var offNotes: [String]?
        public var base: String?
        public var tries: Int?
    }

    public enum Outcome: String { case ok, retry, gone }

    /// 2xx: the server has it. 408, 429, 5xx, no answer or no connection: again later. Any other 4xx: never again.
    public static func outcome(status: Int?) -> Outcome {
        guard let s = status, s > 0 else { return .retry }
        if (200..<300).contains(s) { return .ok }
        if s == 408 || s == 429 || s >= 500 { return .retry }
        return .gone
    }

    public static func wait(afterTries tries: Int) -> TimeInterval {
        backoff[max(0, min(backoff.count - 1, tries - 1))]
    }

    // MARK: the queue in the app group (one entry per kind: watch, card, stop)

    public static func load(_ d: UserDefaults) -> [Entry] {
        guard let data = d.data(forKey: storeKey), let list = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return list
    }

    public static func save(_ list: [Entry], _ d: UserDefaults) {
        if list.isEmpty { d.removeObject(forKey: storeKey); return }
        if let data = try? JSONEncoder().encode(list) { d.set(data, forKey: storeKey) }
    }

    /// Queues an entry from JavaScript (tripRegCore.ts OutboxEntry as JSON), replacing one of the same kind. A stop also
    /// takes out the watch (End trip: the watch is never sent after it). False when the JSON is not an entry.
    @discardableResult
    public static func put(kind: String, json: String, base: String, _ d: UserDefaults) -> Bool {
        guard var e = try? JSONDecoder().decode(Entry.self, from: Data(json.utf8)), ["watch", "card", "stop"].contains(kind),
              e.path.hasPrefix("/api/"), e.method == "POST" || e.method == "DELETE" else { return false }
        e.kind = kind
        e.base = base
        e.tries = 0
        var list = load(d).filter { $0.kind != kind && !(kind == "stop" && $0.kind == "watch") }
        list.append(e)
        save(list, d)
        return true
    }

    public static func take(kind: String, _ d: UserDefaults) {
        save(load(d).filter { $0.kind != kind }, d)
    }

    /// The card registration's body without its token, from JavaScript at Start trip (nil clears it and the queued card).
    public static func setCard(json: String?, base: String, _ d: UserDefaults) {
        if let json, (try? JSONSerialization.jsonObject(with: Data(json.utf8))) is [String: Any] {
            d.set(["json": json, "base": base], forKey: cardKey)
        } else {
            d.removeObject(forKey: cardKey)
            take(kind: "card", d)
        }
    }

    /// iOS handed over the card's push token: the card's registration with the token in it, queued. `appOpen`: JavaScript
    /// is running and sends it itself, so this copy waits `nativeDelay`. nil without a body from Start trip.
    @discardableResult
    public static func cardToken(_ token: String, activity: String, appOpen: Bool, now: Date, _ d: UserDefaults) -> Entry? {
        guard let t = d.dictionary(forKey: cardKey), let json = t["json"] as? String, let base = t["base"] as? String,
              var o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { return nil }
        o["token"] = token
        o["activity"] = activity
        guard let body = try? JSONSerialization.data(withJSONObject: o), let s = String(data: body, encoding: .utf8) else { return nil }
        let ms = now.timeIntervalSince1970 * 1000
        let e = Entry(kind: "card", method: "POST", path: "/api/live-activity", body: s, after: ms + (appOpen ? nativeDelay * 1000 : 0),
                      until: ms + 4 * 3600 * 1000, offNotes: nil, base: base, tries: 0)
        var list = load(d).filter { $0.kind != "card" }
        list.append(e)
        save(list, d)
        return e
    }

    /// Entries to send now (their time has come, not given up), oldest kind order: stop, watch, card.
    public static func due(_ list: [Entry], now: Date) -> [Entry] {
        let ms = now.timeIntervalSince1970 * 1000
        let order = ["stop": 0, "watch": 1, "card": 2]
        return list.filter { $0.after <= ms && $0.until > ms }.sorted { (order[$0.kind] ?? 9) < (order[$1.kind] ?? 9) }
    }

    /// After a try: ok or gone takes the entry out (nil); else the next try waits by the backoff. Past `until`: nil.
    public static func after(_ e: Entry, outcome: Outcome, now: Date) -> Entry? {
        guard outcome == .retry else { return nil }
        var n = e
        n.tries = (e.tries ?? 0) + 1
        n.after = now.timeIntervalSince1970 * 1000 + wait(afterTries: n.tries ?? 1) * 1000
        return n.after < e.until ? n : nil
    }

    /// Writes a try's result back (the entry may have been replaced or taken meanwhile: then nothing changes).
    public static func record(_ e: Entry, outcome: Outcome, now: Date, _ d: UserDefaults) {
        var list = load(d)
        guard let i = list.firstIndex(where: { $0.kind == e.kind && $0.path == e.path && $0.body == e.body }) else { return }
        if let n = after(list[i], outcome: outcome, now: now) { list[i] = n } else { list.remove(at: i) }
        save(list, d)
    }

    /// Whether a yes to the watch says the server sends Get off now (the phone's own then come off): {"watch":{"getOff":true}}.
    public static func serverSendsGetOff(_ data: Data?) -> Bool {
        guard let data, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let w = o["watch"] as? [String: Any] else { return false }
        return w["getOff"] as? Bool == true
    }

    public static func request(_ e: Entry, timeout: TimeInterval) -> URLRequest? {
        guard let b = e.base, let base = URL(string: b), let u = URL(string: e.path, relativeTo: base)?.absoluteURL,
              u.scheme == "https" else { return nil }
        var r = URLRequest(url: u)
        r.httpMethod = e.method
        r.timeoutInterval = timeout
        r.cachePolicy = .reloadIgnoringLocalCacheData
        if e.body != nil { r.setValue("application/json", forHTTPHeaderField: "content-type") }
        return r
    }

    /// The widgets' way (no background session in an extension): every due entry once, `timeout` seconds each. Returns
    /// how many the server took. Used on each widget timeline reload during a trip.
    public static func flush(_ d: UserDefaults, now: Date = Date(), timeout: TimeInterval = 6) async -> Int {
        var took = 0
        for e in due(load(d), now: now) {
            guard var r = request(e, timeout: timeout) else { record(e, outcome: .gone, now: now, d); continue }
            if let b = e.body { r.httpBody = Data(b.utf8) }
            var status: Int? = nil
            if let (_, resp) = try? await URLSession.shared.data(for: r) { status = (resp as? HTTPURLResponse)?.statusCode }
            let o = outcome(status: status)
            if o == .ok { took += 1 }
            record(e, outcome: o, now: Date(), d)
        }
        return took
    }
}
