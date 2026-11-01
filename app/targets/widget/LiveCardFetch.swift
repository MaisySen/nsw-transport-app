import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The trip card from the server, for the widgets and the Watch complications on a locked phone (build 215, 1 Nov 2026).
///
/// Why: the owner on build 214, "App still doesnt pull live data on locked screens yet". On a locked iPhone the app's
/// code does not run, so the card it saves for the widgets ("liveCard" in the App Group) and sends to the Watch stops
/// changing. Up to build 214 the "Your trip" widget (home, Lock Screen, StandBy) and the Watch complications read only
/// that saved card during a trip, never the network: they held at "About 7:59pm · Updated 7:52pm" while the Lock Screen
/// card, pushed by the server, moved on. Now, when the kept card's live times are over a minute old, they ask the server
/// for the card its trip flow has (GET /api/live-card, the same reading the Lock Screen card is pushed from; no
/// Transport for NSW call) and use it when its times are newer. One small ask per reload, inside WidgetKit's budget:
/// every 3 minutes during a trip after a good answer, 5 after a failed one, never past the arrival.
///
/// Pure Foundation, the same file in the widget and the Watch complications: app/test/swift/livecardfetch/main.swift
/// compiles it on its own and checks it.
public enum LiveCardFetch {
    /// A kept card whose live times are newer than this is used as it is (the app is open, or an ask just answered).
    public static let freshFor: TimeInterval = 60
    /// The next reload during a trip after a good answer, and after a failed one.
    public static let liveEvery: TimeInterval = 3 * 60
    public static let failedEvery: TimeInterval = 5 * 60

    /// Whether to ask the server: the kept card's live times (updated, ms) are over `freshFor` old, or it has none.
    public static func needed(updatedMs: Double?, now: Date) -> Bool {
        guard let u = updatedMs, u > 0 else { return true }
        return now.timeIntervalSince1970 * 1000 - u >= freshFor * 1000
    }

    /// GET /api/live-card for this install's profile, picking the trip by its line and stop off. nil for a profile the
    /// server does not take (the widget before the app was ever opened says "none").
    public static func url(base: URL, profile: String, line: String, off: String) -> URL? {
        let p = profile.lowercased()
        guard p.count >= 12, p.count <= 40, p.allSatisfy({ $0.isLetter || $0.isNumber || "_.:-".contains($0) }) else { return nil }
        guard var c = URLComponents(url: base.appendingPathComponent("api/live-card"), resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = [URLQueryItem(name: "profile", value: p), URLQueryItem(name: "line", value: String(line.prefix(12))),
                        URLQueryItem(name: "off", value: String(off.prefix(80)))]
        return c.url
    }

    /// The server's answer: the card as JSON (the app's liveCard shape, written to the App Group as it is), whether the
    /// trip has ended, and the card's live times (updated, ms).
    public struct Answer: Equatable {
        public let card: Data?
        public let ended: Bool
        public let updatedMs: Double?
    }

    public static func parse(_ data: Data) -> Answer? {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let ended = o["ended"] as? Bool ?? false
        guard let card = o["card"] as? [String: Any] else { return Answer(card: nil, ended: ended, updatedMs: nil) }
        // the fields every reader needs (SharedLiveCard, WLiveCard)
        guard card["line"] is String, card["phase"] is String, card["getOffAt"] is String, card["arrival"] is NSNumber,
              card["until"] is NSNumber, let json = try? JSONSerialization.data(withJSONObject: card) else { return nil }
        return Answer(card: json, ended: ended, updatedMs: (card["updated"] as? NSNumber)?.doubleValue)
    }

    /// Whether the server's card replaces the kept one: an ended trip always does; otherwise its live times are newer.
    public static func replaces(_ a: Answer, keptUpdatedMs: Double?) -> Bool {
        guard a.card != nil else { return false }
        if a.ended { return true }
        guard let n = a.updatedMs, n > 0 else { return false }
        return n > (keptUpdatedMs ?? 0)
    }

    /// The next reload during a trip: after the answer (ok) or a failure, at least a minute away, never past the arrival.
    public static func next(now: Date, arrival: Date, ok: Bool) -> Date {
        let gap = ok ? liveEvery : failedEvery
        return min(now.addingTimeInterval(gap), max(arrival, now.addingTimeInterval(60)))
    }

    /// One ask, `timeout` seconds at most, no retry. nil when it did not answer.
    public static func load(base: URL, profile: String, line: String, off: String, timeout: TimeInterval) async -> Answer? {
        guard let u = url(base: base, profile: profile, line: line, off: off) else { return nil }
        var req = URLRequest(url: u)
        req.timeoutInterval = timeout
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        return await withCheckedContinuation { (k: CheckedContinuation<Answer?, Never>) in
            URLSession.shared.dataTask(with: req) { data, resp, _ in
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(code), let data else { k.resume(returning: nil); return }
                k.resume(returning: parse(data))
            }.resume()
        }
    }
}
