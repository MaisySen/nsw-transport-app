import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum APIError: LocalizedError, Sendable {
    case http(Int, String)
    case badURL

    public var errorDescription: String? {
        switch self {
        case .http(let code, let body):
            if code == 404 { return "Not found." }
            return body.isEmpty ? "The server answered \(code)." : body
        case .badURL:
            return "That request could not be built."
        }
    }
}

/// Which server profile holds this install's saved trips, commutes and watches.
/// Every install gets its own random profile on first launch, shared with the widget through the app group.
/// There is no account and nothing personal in it.
public enum AppIdentity {
    public static let appGroup = "group.com.maisysen.nswtransport"

    public static var groupDefaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    /// Read from the shared defaults each time, so a profile switch takes effect at once.
    public static var profile: String { resolveProfile() }

    static func resolveProfile() -> String {
        let std = UserDefaults.standard
        let group = groupDefaults
        // The UI tests pass -apiProfile, which lands in the standard defaults.
        if let p = std.string(forKey: "apiProfile"), !p.isEmpty {
            if group.string(forKey: "apiProfile") == nil { group.set(p, forKey: "apiProfile") }
            return p
        }
        if let p = group.string(forKey: "apiProfile"), !p.isEmpty { return p }
        // The widget never creates a profile; it waits for the app to be opened once.
        if Bundle.main.bundlePath.hasSuffix(".appex") { return "none" }
        let p = "u" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)).lowercased()
        std.set(p, forKey: "apiProfile")
        group.set(p, forKey: "apiProfile")
        return p
    }

    /// Profiles that were shared by several people in early test builds.
    public static let sharedProfiles: Set<String> = ["bidur"]

    /// A fresh private profile id.
    public static func newProfileID() -> String {
        "u" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)).lowercased()
    }

    /// Moves this install to another profile (for example the one used on a previous phone).
    /// Takes effect the next time the app starts.
    public static func adopt(_ p: String) -> Bool {
        // The server takes 6 to 40 of a to z, 0 to 9, _ . : and -.
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789_.:-")
        let clean = p.lowercased().filter { allowed.contains($0) }
        // The old shared profile is never adopted: everyone gets a private one.
        guard clean.count >= 6, clean.count <= 40, !sharedProfiles.contains(clean) else { return false }
        UserDefaults.standard.set(clean, forKey: "apiProfile")
        groupDefaults.set(clean, forKey: "apiProfile")
        return true
    }
}

/// Talks to the live Transport Bot backend. No keys live in the app: the server holds them.
public struct TransportAPI: Sendable {
    /// Read each time, so a new address from remote config applies at once (see APIBase).
    public static var defaultBase: URL {
        #if DEBUG
        // UI tests point the app at an address that does not answer, to prove it starts without a network.
        if let s = UserDefaults.standard.string(forKey: "apiBase"), let u = URL(string: s) { return u }
        #endif
        return APIBase.current()
    }
    public static var shared: TransportAPI { TransportAPI(profile: AppIdentity.profile) }

    public var base: URL
    public var profile: String

    public init(base: URL = TransportAPI.defaultBase, profile: String = AppIdentity.profile) {
        self.base = base
        self.profile = profile
    }

    // MARK: Decoding

    public static func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            if let n = try? c.decode(Double.self) {
                return Date(timeIntervalSince1970: n > 100_000_000_000 ? n / 1000 : n)
            }
            let s = try c.decode(String.self)
            if let date = ISODates.parse(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unreadable date \(s)")
        }
        return d
    }

    public static func makeEncoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(ISODates.format(date))
        }
        return e
    }

    // MARK: Requests

    func url(_ path: String, _ query: [String: String?]) throws -> URL {
        guard var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.badURL
        }
        var items = [URLQueryItem(name: "profile", value: profile)]
        for (k, v) in query.sorted(by: { $0.key < $1.key }) {
            if let v, !v.isEmpty { items.append(URLQueryItem(name: k, value: v)) }
        }
        comps.queryItems = items
        guard let u = comps.url else { throw APIError.badURL }
        return u
    }

    func send<T: Decodable>(_ type: T.Type, _ path: String, query: [String: String?] = [:],
                            method: String = "GET", body: Data? = nil) async throws -> T {
        var req = URLRequest(url: try url(path, query))
        req.httpMethod = method
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await Self.fetch(req, retry: method == "GET")
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let text = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.http(code, text ?? "")
        }
        return try Self.makeDecoder().decode(T.self, from: data)
    }

    /// One quiet retry for reads; the live feed sometimes stalls for a moment.
    static func fetch(_ req: URLRequest, retry: Bool) async throws -> (Data, URLResponse) {
        do {
            return try await URLSession.shared.data(for: req)
        } catch let e as URLError where retry && (e.code == .timedOut || e.code == .networkConnectionLost) {
            return try await URLSession.shared.data(for: req)
        }
    }

    // MARK: Endpoints

    public func search(_ q: String) async throws -> [StopRef] {
        try await send(SearchResponse.self, "api/search", query: ["q": q]).items
    }

    public func nearby(lat: Double, lon: Double) async throws -> [StopRef] {
        try await send(NearbyResponse.self, "api/nearby", query: ["lat": String(lat), "lon": String(lon)]).stops ?? []
    }

    public func departures(stop: String, device: String?) async throws -> DeparturesResponse {
        try await send(DeparturesResponse.self, "api/departures", query: ["stop": stop, "device": device])
    }

    /// `time` is HHmm Sydney time, for earlier or later services.
    public func trip(from: String, to: String, count: Int = 5, time: String? = nil) async throws -> TripResponse {
        var q: [String: String?] = ["from": from, "to": to, "count": String(count), "time": time]
        for (k, v) in TripPrefs.query { q[k] = v }
        return try await send(TripResponse.self, "api/trip", query: q)
    }

    public func service(trip: String?, line: String?, stop: String?, planned: Date?, mode: String?, destId: String?) async throws -> ServiceResponse {
        try await send(ServiceResponse.self, "api/service", query: [
            "trip": trip, "line": line, "stop": stop,
            "planned": planned.map(ISODates.format), "mode": mode, "destId": destId,
        ])
    }

    public func saved() async throws -> [SavedTrip] {
        try await send(SavedResponse.self, "api/saved").items
    }

    public func saveTrip(name: String, from: StopRef, to: StopRef) async throws {
        struct Body: Encodable { let profile: String; let name: String; let from: StopRef; let to: StopRef }
        let body = try Self.makeEncoder().encode(Body(profile: profile, name: name, from: from, to: to))
        _ = try await send(Ignored.self, "api/saved", method: "POST", body: body)
    }

    public func deleteSaved(name: String) async throws {
        _ = try await send(Ignored.self, "api/saved", query: ["name": name], method: "DELETE")
    }

    public func next(name: String, count: Int = 5) async throws -> TripResponse {
        var q: [String: String?] = ["name": name, "count": String(count)]
        for (k, v) in TripPrefs.query { q[k] = v }
        return try await send(TripResponse.self, "api/next", query: q)
    }

    public func commutes(device: String?) async throws -> CommutesResponse {
        try await send(CommutesResponse.self, "api/commutes", query: ["device": device])
    }

    public func saveCommute(id: FlexID?, from: StopRef, to: StopRef, tod: Int, days: String, name: String?, active: Bool) async throws {
        struct Body: Encodable { let id: FlexID?; let from: StopRef; let to: StopRef; let tod: Int; let days: String; let name: String?; let active: Bool }
        let body = try Self.makeEncoder().encode(Body(id: id, from: from, to: to, tod: tod, days: days, name: name, active: active))
        _ = try await send(Ignored.self, "api/commutes", method: "POST", body: body)
    }

    public func deleteCommute(id: FlexID) async throws {
        _ = try await send(Ignored.self, "api/commutes", query: ["id": id.value], method: "DELETE")
    }

    public func dismissSuggestion(key: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["key": key])
        _ = try await send(Ignored.self, "api/commutes/dismiss", method: "POST", body: body)
    }

    public func watches(device: String) async throws -> WatchesResponse {
        try await send(WatchesResponse.self, "api/watches", query: ["device": device])
    }

    @discardableResult
    public func watch(_ request: WatchRequest) async throws -> WatchCreated {
        let body = try Self.makeEncoder().encode(request)
        return try await send(WatchCreated.self, "api/watch", method: "POST", body: body)
    }

    public func unwatch(id: FlexID, device: String) async throws {
        _ = try await send(Ignored.self, "api/watch", query: ["id": id.value, "device": device], method: "DELETE")
    }

    public func alerts() async throws -> [ServiceAlert] {
        struct R: Decodable { var items: [ServiceAlert]?; var alerts: [ServiceAlert]? }
        let r = try await send(R.self, "api/alerts")
        return r.items ?? r.alerts ?? []
    }
}

/// Accepts any JSON body.
public struct Ignored: Decodable, Sendable {
    public init(from decoder: Decoder) throws {}
}

public enum ISODates {
    public static func parse(_ s: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: s) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        return f2.date(from: s)
    }

    public static func format(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }
}
