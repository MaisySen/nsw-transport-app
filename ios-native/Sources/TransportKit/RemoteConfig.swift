import Foundation

/// Settings the app reads from the server (GET /api/app/config?platform=ios) at launch and each
/// time it comes to the front. App Store rules do not allow new native code over the air, so this
/// changes only what the app already has: which features show, a kill switch per feature (with
/// the words to show instead), copy, alert timings and the tab order. Anything missing or bad
/// falls back to the defaults below, and the last good copy is kept for offline launches.
public struct RemoteConfig: Codable, Equatable, Sendable {
    public var version: Int
    /// Feature name to shown or hidden. Missing means shown.
    public var flags: [String: Bool]
    /// Feature name to the words shown in its place while it is switched off.
    public var kill: [String: String]
    /// Copy key to text. Missing or empty uses the built in text.
    public var copy: [String: String]
    /// Tab keys in order: home, plan, watching, more.
    public var tabs: [String]
    /// Timing name to a number (seconds or minutes, as the name says).
    public var timing: [String: Double]
    /// "api_base": moves the app to another server address without a build. Taken only when it
    /// passes APIBase.accept (https, and a host under fintex.au or the current host).
    public var apiBase: String?

    enum CodingKeys: String, CodingKey {
        case version, flags, kill, copy, tabs, timing
        case apiBase = "api_base"
    }

    public static let knownTabs = ["home", "plan", "watching", "more"]

    public static let defaults = RemoteConfig(
        version: 1,
        flags: ["ask": true, "parkRide": true, "opalMachines": true, "liveTrip": true, "shareTrip": true,
                "weekdayReminder": true, "nearby": true],
        kill: [:], copy: [:], tabs: knownTabs,
        timing: ["liveRefreshSec": 15, "alertRepeatWindowMin": 15, "arriveLeadSec": 150, "sameRunToleranceSec": 120, "configRefreshMin": 30])

    public init(version: Int, flags: [String: Bool], kill: [String: String], copy: [String: String], tabs: [String], timing: [String: Double]) {
        self.version = version; self.flags = flags; self.kill = kill; self.copy = copy; self.tabs = tabs; self.timing = timing
    }

    /// Tolerant: each part is merged over the defaults, and a part that does not decode is ignored.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Self.defaults
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? d.version
        flags = d.flags.merging(((try? c.decodeIfPresent([String: Bool].self, forKey: .flags)) ?? nil) ?? [:]) { _, new in new }
        kill = ((try? c.decodeIfPresent([String: String].self, forKey: .kill)) ?? nil) ?? [:]
        copy = ((try? c.decodeIfPresent([String: String].self, forKey: .copy)) ?? nil) ?? [:]
        tabs = ((try? c.decodeIfPresent([String].self, forKey: .tabs)) ?? nil) ?? d.tabs
        timing = d.timing.merging(((try? c.decodeIfPresent([String: Double].self, forKey: .timing)) ?? nil) ?? [:]) { _, new in new }
        // Top level "api_base", or "copy.api_base" (the server passes the copy section through as is).
        apiBase = ((try? c.decodeIfPresent(String.self, forKey: .apiBase)) ?? nil) ?? copy["api_base"]
    }

    /// Shown unless hidden by a flag or switched off by the kill switch.
    public func isOn(_ feature: String) -> Bool {
        kill[feature] == nil && (flags[feature] ?? true)
    }

    /// The words to show while a feature is switched off, if any.
    public func killMessage(_ feature: String) -> String? {
        guard let m = kill[feature], !m.isEmpty else { return nil }
        return m
    }

    public func text(_ key: String, _ fallback: String) -> String {
        guard let t = copy[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return fallback }
        return t
    }

    /// A timing, kept inside sane bounds so a typo on the server cannot break the app.
    public func number(_ key: String, _ fallback: Double, min lo: Double, max hi: Double) -> Double {
        guard let v = timing[key], v.isFinite else { return fallback }
        return Swift.min(Swift.max(v, lo), hi)
    }

    /// The tab order: known tabs in the order given, then any the server left out. A tab is never
    /// hidden, so nothing becomes unreachable.
    public var tabOrder: [String] {
        var out: [String] = []
        for t in tabs where Self.knownTabs.contains(t) && !out.contains(t) { out.append(t) }
        for t in Self.knownTabs where !out.contains(t) { out.append(t) }
        return out
    }
}

/// The last good config, kept on the phone.
public enum RemoteConfigCache {
    static let key = "remoteConfig.v1"

    public static func load(_ d: UserDefaults = .standard) -> RemoteConfig {
        guard let data = d.data(forKey: key), let c = try? JSONDecoder().decode(RemoteConfig.self, from: data) else { return .defaults }
        return c
    }

    public static func save(_ c: RemoteConfig, _ d: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(c) { d.set(data, forKey: key) }
    }
}

extension TransportAPI {
    public func appConfig() async throws -> RemoteConfig {
        try await send(RemoteConfig.self, "api/app/config", query: ["platform": "ios"])
    }
}
