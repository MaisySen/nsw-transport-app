import Foundation

/// Something that runs Lock Screen cards (Live Activities): the app's ActivityKit wrapper, or a
/// fake in tests. `cardIDs` lists every running card of every kind (trip and followed service).
@MainActor
public protocol LiveCardHost: AnyObject {
    var cardIDs: [String] { get }
    func endCard(_ id: String) async
    func requestCard() throws -> String
}

/// Exactly one Lock Screen card at a time.
@MainActor
public enum LiveCardRule {
    /// Ends every running card, including ones left from earlier trips or a followed service,
    /// then asks for one. Starting twice leaves one card.
    @discardableResult
    public static func startOne(on host: LiveCardHost) async -> String? {
        for id in host.cardIDs { await host.endCard(id) }
        return try? host.requestCard()
    }

    /// Ends every card after the first, in case two were ever started.
    public static func trimToOne(on host: LiveCardHost) async {
        for id in host.cardIDs.dropFirst() { await host.endCard(id) }
    }
}

/// Words for the trip card, worked out here so the widget and the tests agree.
public enum LiveCardText {
    /// "Strathfield Station, Platform 2" becomes "Strathfield".
    public static func place(_ s: String?) -> String {
        Naming.compact(Naming.short(s ?? ""))
    }

    /// Whole minutes until a time: "Now", "1 min", "26 min", "1 hr 5 min". Never seconds.
    public static func minutes(until date: Date, now: Date = Date()) -> String {
        let m = Int((date.timeIntervalSince(now) / 60).rounded(.up))
        if m <= 0 { return "Now" }
        if m < 60 { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) hr" : "\(m / 60) hr \(m % 60) min"
    }
}


extension LiveCardText {
    /// The card's phase: "wait", "ride", or "arrived" once the trip is done.
    public static func phase(_ st: LiveTripState?) -> String {
        guard let st else { return "wait" }
        return st.done ? "arrived" : st.phase
    }
}

/// A point on the map, kept free of MapKit so it can be tested anywhere.
public struct GeoPoint: Equatable, Sendable {
    public var lat: Double
    public var lon: Double
    public init(_ lat: Double, _ lon: Double) { self.lat = lat; self.lon = lon }
}

/// What the live trip map draws and frames: only the part of each service you ride.
public enum LegMap {
    /// The ridden part of a service: from the path point nearest your boarding stop to the one
    /// nearest your stop to get off. Without a path, the stops in between.
    public static func ridden(_ s: ServiceResponse) -> [GeoPoint] {
        let stops = s.stops
        guard let m = s.mineIndex, let a = s.alightIndex, stops.indices.contains(m), stops.indices.contains(a), m < a else {
            return []
        }
        let stopPts = stops[m...a].compactMap { st -> GeoPoint? in
            guard let la = st.lat, let lo = st.lon else { return nil }
            return GeoPoint(la, lo)
        }
        let path = (s.path ?? []).compactMap { p in p.count >= 2 ? GeoPoint(p[0], p[1]) : nil }
        guard path.count > 1, let from = stopPts.first, let to = stopPts.last, stopPts.count >= 2 else { return stopPts }
        let i = nearest(path, to: from, from: 0)
        let j = nearest(path, to: to, from: i)
        guard j > i else { return stopPts }
        return Array(path[i...j])
    }

    static func nearest(_ path: [GeoPoint], to p: GeoPoint, from start: Int) -> Int {
        var best = start, bestD = Double.infinity
        for k in start..<path.count {
            let d = (path[k].lat - p.lat) * (path[k].lat - p.lat) + (path[k].lon - p.lon) * (path[k].lon - p.lon)
            if d < bestD { bestD = d; best = k }
        }
        return best
    }

    /// The map frame around the points: centre and span in degrees, padded on every side, never
    /// smaller than about 1 km.
    public static func frame(_ pts: [GeoPoint], padding: Double = 0.3, minSpan: Double = 0.01) -> (center: GeoPoint, latSpan: Double, lonSpan: Double)? {
        guard let f = pts.first else { return nil }
        var lo = f, hi = f
        for p in pts {
            lo.lat = min(lo.lat, p.lat); lo.lon = min(lo.lon, p.lon)
            hi.lat = max(hi.lat, p.lat); hi.lon = max(hi.lon, p.lon)
        }
        let latSpan = max((hi.lat - lo.lat) * (1 + 2 * padding), minSpan)
        let lonSpan = max((hi.lon - lo.lon) * (1 + 2 * padding), minSpan)
        return (GeoPoint((lo.lat + hi.lat) / 2, (lo.lon + hi.lon) / 2), latSpan, lonSpan)
    }

    /// Rough size of a span in kilometres (north to south, east to west) around a latitude.
    public static func km(latSpan: Double, lonSpan: Double, at lat: Double) -> (ns: Double, ew: Double) {
        (latSpan * 111.0, lonSpan * 111.0 * cos(lat * .pi / 180))
    }
}
