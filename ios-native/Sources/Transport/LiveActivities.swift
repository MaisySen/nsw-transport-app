import ActivityKit
import Foundation
import TransportKit

/// Starts, updates and ends the Lock Screen and Dynamic Island card for a followed service.
/// Without push (a free Apple ID cannot use it) the app updates the card itself while it runs,
/// on background refreshes, and the countdown on the card keeps ticking on its own in between.
@MainActor
final class LiveActivities {
    static let shared = LiveActivities()

    /// Which service each running activity follows, so refreshes know what to fetch.
    private var followed: [String: ServiceKey] = Persist.load([String: ServiceKey].self, "followed") ?? [:] {
        didSet { Persist.save(followed, "followed") }
    }

    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func start(departure d: Departure, stopName: String) async {
        let key = ServiceKey(d)
        let attrs = TripActivityAttributes(line: d.line, lineColorHex: d.color ?? Mode(raw: d.mode).fallbackHex,
                                           mode: d.mode ?? "bus", from: Naming.short(d.stopName ?? stopName),
                                           towards: Naming.short(d.dest ?? ""), to: nil)
        let state = TripActivityAttributes.ContentState(
            departs: d.bestTime ?? Date(), arrives: nil,
            status: Delay.text(delayMin: d.delayMin, live: d.isLive, cancelled: d.isCancelled),
            isLive: d.isLive, platform: d.platform, detail: d.stopsAway.map { $0 == 1 ? "1 stop away" : "\($0) stops away" },
            stopsAway: d.stopsAway)
        await request(attrs: attrs, state: state, key: key)
    }

    func start(key: ServiceKey, service s: ServiceResponse?) async {
        let mine = s?.stops.first { $0.mine == true }
        let attrs = TripActivityAttributes(line: key.line, lineColorHex: s?.color ?? key.color ?? Mode(raw: key.mode).fallbackHex,
                                           mode: key.mode ?? "bus", from: Naming.short(mine?.name ?? ""),
                                           towards: Naming.short(s?.dest?.isEmpty == false ? s!.dest! : (key.dest ?? "")), to: nil)
        let state = Self.state(key: key, service: s)
        await request(attrs: attrs, state: state, key: key)
    }

    func start(journey j: Journey, from: StopRef, to: StopRef) async {
        guard let first = j.firstTransit else { return }
        let key = ServiceKey(first)
        let attrs = TripActivityAttributes(line: first.line ?? "", lineColorHex: first.color ?? Mode(raw: first.mode).fallbackHex,
                                           mode: first.mode ?? "bus", from: Naming.short(first.from ?? from.name),
                                           towards: Naming.short(first.towards ?? ""), to: Naming.short(to.name))
        let state = TripActivityAttributes.ContentState(
            departs: first.departTime ?? Date(), arrives: j.arrive,
            status: Delay.text(delayMin: first.delayMin, live: first.isLive, cancelled: first.cancelled == true),
            isLive: first.isLive, platform: first.fromPlatform,
            detail: (j.changes ?? 0) > 0 ? "\(j.changes!) change\(j.changes! == 1 ? "" : "s")" : "No changes",
            stopsAway: nil)
        await request(attrs: attrs, state: state, key: key)
    }

    private func request(attrs: TripActivityAttributes, state: TripActivityAttributes.ContentState, key: ServiceKey) async {
        guard enabled else { return }
        // One card at a time keeps the Lock Screen calm: this replaces any other card.
        for a in Activity<TripActivityAttributes>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
        for a in Activity<LiveTripAttributes>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
        followed.removeAll()
        do {
            let content = ActivityContent(state: state, staleDate: state.departs.addingTimeInterval(20 * 60))
            let a = try Activity.request(attributes: attrs, content: content, pushType: nil)
            followed[a.id] = key
        } catch {
            // Activities may be off in Settings; the app still works without them.
        }
    }

    func update(key: ServiceKey, service s: ServiceResponse) async {
        for a in Activity<TripActivityAttributes>.activities where followed[a.id]?.id == key.id {
            await push(a, Self.state(key: key, service: s))
        }
    }

    func refreshAll(api: TransportAPI) async {
        for a in Activity<TripActivityAttributes>.activities {
            guard let key = followed[a.id] else { continue }
            if let s = try? await api.service(trip: key.tripId, line: key.line, stop: key.stopId,
                                              planned: key.planned, mode: key.mode, destId: key.destId) {
                let st = Self.state(key: key, service: s)
                if st.departs.addingTimeInterval(10 * 60) < Date() {
                    await a.end(ActivityContent(state: st, staleDate: nil), dismissalPolicy: .default)
                    followed[a.id] = nil
                } else {
                    await push(a, st)
                }
            }
        }
    }

    /// Forgets followed services after their cards were ended elsewhere.
    func forgetAll() { followed.removeAll() }

    func endAll() async {
        for a in Activity<TripActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        followed.removeAll()
    }

    private func push(_ a: Activity<TripActivityAttributes>, _ st: TripActivityAttributes.ContentState) async {
        await a.update(ActivityContent(state: st, staleDate: st.departs.addingTimeInterval(20 * 60)))
    }

    static func state(key: ServiceKey, service s: ServiceResponse?) -> TripActivityAttributes.ContentState {
        let mine = s?.stops.first { $0.mine == true }
        let departs = mine?.bestTime ?? key.departure?.bestTime ?? key.planned ?? Date()
        let live = s?.live == true
        var detail: String? = s?.where?.text
        if let n = s?.stopsAway, n > 0 { detail = n == 1 ? "1 stop away" : "\(n) stops away" }
        return TripActivityAttributes.ContentState(
            departs: departs, arrives: nil,
            status: Delay.text(delayMin: s?.delayMin, live: live, cancelled: s?.cancelled == true),
            isLive: live, platform: key.platform, detail: detail, stopsAway: s?.stopsAway)
    }
}
