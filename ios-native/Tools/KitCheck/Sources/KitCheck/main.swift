import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import TransportKit

// Decodes saved fixtures, then calls the live backend with the same client the app uses.
let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Fixtures")
let dec = TransportAPI.makeDecoder()
var failures = 0

func check<T: Decodable>(_ name: String, _ type: T.Type, _ describe: (T) -> String) {
    do {
        let data = try Data(contentsOf: dir.appendingPathComponent(name + ".json"))
        let v = try dec.decode(T.self, from: data)
        print("fixture \(name): ok, \(describe(v))")
    } catch {
        failures += 1
        print("fixture \(name): FAILED \(error)")
    }
}

check("dep", DeparturesResponse.self) { r in
    let live = r.items.filter { $0.isLive }.count
    let first = r.items.first.map { "\($0.line) to \($0.dest ?? "") \(Delay.text(delayMin: $0.delayMin, live: $0.isLive, cancelled: $0.isCancelled))" } ?? "none"
    return "\(r.items.count) departures, \(live) live, first \(first)"
}
check("trip", TripResponse.self) { r in "\(r.journeys.count) journeys, first has \(r.journeys.first?.legs.count ?? 0) legs" }
check("service", ServiceResponse.self) { r in "\(r.line ?? "") with \(r.stops.count) stops, vehicle \(r.vehicle != nil), path \(r.path?.count ?? 0)" }
check("search", SearchResponse.self) { r in "\(r.items.count) stops" }
check("nearby", NearbyResponse.self) { r in "\(r.stops?.count ?? 0) stops" }
check("saved", SavedResponse.self) { r in "\(r.items.count) saved" }
check("commutes", CommutesResponse.self) { r in "\(r.items.count) commutes" }
check("watches", WatchesResponse.self) { r in "\(r.items.count) watches" }

// Live round trip through the real client.
let api = TransportAPI.shared
let sem = DispatchSemaphore(value: 0)
Task {
    do {
        let stops = try await api.search("Central")
        print("live search Central: \(stops.prefix(3).map { "\($0.id) \($0.name)" })")
        let d = try await api.departures(stop: "213516", device: "kitcheck")
        let rows = d.items.prefix(5).map { dep -> String in
            let t = dep.bestTime.map(Clock.time) ?? "?"
            return "\(dep.line) to \(Naming.short(dep.dest ?? "")) \(t) \(dep.isLive ? "Live" : "Scheduled") \(Delay.text(delayMin: dep.delayMin, live: dep.isLive, cancelled: dep.isCancelled))"
        }
        print("live 213516 \(d.stop?.name ?? ""):"); rows.forEach { print("  " + $0) }
        if let first = d.items.first(where: { $0.tripId != nil }) {
            let s = try await api.service(trip: first.tripId, line: first.line, stop: first.stopId, planned: first.planned, mode: first.mode, destId: first.destId)
            print("live service \(s.line ?? ""): \(s.stops.count) stops, where: \(s.where?.text ?? "unknown"), vehicle: \(s.vehicle.map { "\($0.lat),\($0.lon)" } ?? "none")")
            let req = first.watchRequest(device: "kitcheck", profile: "bidur")
            let body = String(data: try TransportAPI.makeEncoder().encode(req), encoding: .utf8) ?? ""
            print("watch body sample: \(body.prefix(300))")
        }
        let t = try await api.trip(from: "213410", to: "10101100", count: 3)
        for j in t.journeys {
            let legs = j.transitLegs.map { "\($0.line ?? "") \($0.from ?? "") \($0.fromPlatform ?? "")" }.joined(separator: " then ")
            print("live trip Burwood to Central: leave \(j.leave.map(Clock.time) ?? "?") arrive \(j.arrive.map(Clock.time) ?? "?") \(j.live == true ? "Live" : "Scheduled"): \(legs)")
        }
    } catch {
        failures += 1
        print("live FAILED: \(error)")
    }
    sem.signal()
}
sem.wait()
print(failures == 0 ? "ALL OK" : "FAILURES: \(failures)")
exit(failures == 0 ? 0 : 1)
