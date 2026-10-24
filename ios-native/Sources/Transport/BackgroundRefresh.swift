import BackgroundTasks
import Foundation
import TransportKit

/// iOS wakes the app now and then (it decides how often). Each wake checks watched trips,
/// posts any new alert as a local notification and refreshes the Live Activity.
enum BackgroundRefresh {
    static let identifier = "com.maisysen.nswtransport.refresh"

    static func schedule() {
        let req = BGAppRefreshTaskRequest(identifier: identifier)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    static func run() async {
        schedule()
        let d = UserDefaults.standard
        guard let device = d.string(forKey: "device") else { return }
        let api = TransportAPI.shared
        if let r = try? await api.watches(device: device) {
            var seen = Set(d.stringArray(forKey: "seenNotes") ?? [])
            for n in (r.notes ?? []) where !seen.contains(n.id.value) {
                seen.insert(n.id.value)
                if PhoneTripWatches.owns(n.watch_id?.value) { continue }
                Notifier.post(title: n.title ?? "Trip update", body: n.body ?? "", id: n.id.value)
            }
            d.set(Array(seen.suffix(200)), forKey: "seenNotes")
        }
        await LiveActivities.shared.refreshAll(api: api)
    }
}
