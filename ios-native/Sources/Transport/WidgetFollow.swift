import Foundation
import TransportKit

/// The widget's Track button opens nswtransport://follow/STOP/LINE. The app opens the next
/// service at that stop on the live map and puts its countdown on the Lock Screen and in the Dynamic Island.
extension AppStore {
    func followNext(stopID: String, line: String?) async {
        guard let d = try? await api.departures(stop: stopID, device: device) else { return }
        let now = Date()
        let next = d.items.first { ($0.bestTime ?? .distantPast) > now && (line == nil || $0.line == line) }
            ?? d.items.first { ($0.bestTime ?? .distantPast) > now }
        guard let next else { return }
        await LiveActivities.shared.start(departure: next, stopName: d.stop?.name ?? next.stopName ?? "")
    }
}
