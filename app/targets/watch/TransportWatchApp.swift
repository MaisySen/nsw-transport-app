// Transport on Apple Watch: Home to Work (or back) by time of day, starred stops with their next departures, and the
// trip in progress from the iPhone. The phone sends the person's own places and the server address
// (WatchConnectivity); the watch loads live times itself and keeps the last ones for when there is no signal.
import Combine
import SwiftUI
import WatchConnectivity
import WatchKit
import WidgetKit

#if !SNAPSHOT_TESTS
@main
struct TransportWatchApp: App {
    @StateObject private var model = WatchModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .onChange(of: phase, initial: true) { _, p in
            model.setForeground(p == .active)
        }
    }
}
#endif

// MARK: Model

@MainActor
final class WatchModel: NSObject, ObservableObject {
    static let shared = WatchModel()

    @Published private(set) var context: WatchContext?
    @Published private(set) var snapshot: WatchSnapshot
    @Published private(set) var loading = false
    /// True when the last refresh could not reach the server, so the times on screen are the kept ones.
    @Published private(set) var offline = false
    @Published var now = Date()

    private var lastRefresh: Date?
    /// Live times load only while the app is on screen; the complications draw what is kept.
    private var foreground = false
    /// The get off moment last tapped on the wrist, kept across launches so each one taps once.
    private var tapped: String? {
        get { UserDefaults.standard.string(forKey: "watch.tapped") }
        set { UserDefaults.standard.set(newValue, forKey: "watch.tapped") }
    }
    /// What the complications showed when last reloaded, so they reload only when that changes.
    private var complicationKey: String? {
        get { UserDefaults.standard.string(forKey: "watch.complicationKey") }
        set { UserDefaults.standard.set(newValue, forKey: "watch.complicationKey") }
    }

    override init() {
        context = WatchStore.loadContext()
        snapshot = WatchStore.loadSnapshot()
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    var commute: Commute? { context?.commute(now: now) }

    /// The trip card while the trip runs.
    var live: WLiveCard? {
        guard let l = context?.live, l.isActive(now: now) else { return nil }
        return l
    }

    var commuteServices: [WService] {
        guard let c = commute, snapshot.commuteKey == c.key else { return [] }
        return WatchSnapshot.upcoming(snapshot.commute, now: now)
    }

    func services(for stop: WStop) -> [WService] {
        WatchSnapshot.upcoming(snapshot.stops[stop.id] ?? [], now: now)
    }

    /// When the times on screen were loaded: the oldest of the parts shown.
    var updatedAt: Date? {
        var dates: [Date] = []
        if let d = snapshot.commuteAt { dates.append(d) }
        for s in context?.starred ?? [] { if let d = snapshot.stopsAt[s.id] { dates.append(d) } }
        return dates.min()
    }

    // MARK: Context from the phone

    fileprivate func apply(json: String) {
        guard let c = WatchContext.decode(json), c.v >= 1 else { return }
        let old = context
        if old == c { return }
        context = c
        WatchStore.save(c)
        reloadComplicationsIfChanged()
        tick()
        if old?.base != c.base || old?.home != c.home || old?.work != c.work || old?.starred != c.starred || old?.flip != c.flip {
            refresh()
        }
    }

    /// Asks the phone for its last context when the watch has none, or when the app opens.
    fileprivate func askPhone() {
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        if let json = s.receivedApplicationContext["json"] as? String { apply(json: json) }
        guard s.isReachable else { return }
        s.sendMessage(["want": "context"], replyHandler: { reply in
            if let json = reply["json"] as? String {
                Task { @MainActor in WatchModel.shared.apply(json: json) }
            }
        }, errorHandler: nil)
    }

    // MARK: Live times

    func setForeground(_ on: Bool) {
        foreground = on
        if on {
            now = Date()
            askPhone()
            refresh(ifOlderThan: 30)
        }
    }

    func refresh(ifOlderThan seconds: TimeInterval = 0) {
        guard foreground else { return }
        if seconds > 0, let l = lastRefresh, Date().timeIntervalSince(l) < seconds { return }
        guard !loading, let c = context, let api = WatchAPI(c) else { return }
        loading = true
        lastRefresh = Date()
        let commute = c.commute(now: Date())
        let stops = c.starred
        Task {
            var snap = self.snapshot
            var failed = false
            if let m = commute {
                if let s = try? await api.trip(from: m.from.id, to: m.to.id, count: 6) {
                    snap.commuteKey = m.key; snap.commute = s; snap.commuteAt = Date()
                } else { failed = true }
            }
            await withTaskGroup(of: (String, [WService]?).self) { g in
                for st in stops {
                    g.addTask { (st.id, try? await api.departures(stop: st.id)) }
                }
                for await (id, s) in g {
                    if let s { snap.stops[id] = s; snap.stopsAt[id] = Date() } else { failed = true }
                }
            }
            // Stops no longer starred are not kept.
            let ids = Set(stops.map(\.id))
            snap.stops = snap.stops.filter { ids.contains($0.key) }
            snap.stopsAt = snap.stopsAt.filter { ids.contains($0.key) }
            self.snapshot = snap
            self.offline = failed
            self.loading = false
            self.now = Date()
            WatchStore.save(snap)
            self.reloadComplicationsIfChanged()
        }
    }

    /// Reloads the complications only when the service or trip they show changed (WidgetKit limits reloads).
    private func reloadComplicationsIfChanged() {
        var key = "none"
        if let l = live {
            key = ["live", l.line, l.phase, l.getOffAt, l.platform ?? "", String(Int(l.target.timeIntervalSince1970 / 60)), l.warning ?? ""].joined(separator: "|")
        } else if let c = commute {
            key = c.key + "|" + commuteServices.prefix(3).map { "\($0.line)@\(Int($0.time.timeIntervalSince1970 / 60))@\($0.platform ?? "")" }.joined(separator: ",")
        }
        guard key != complicationKey else { return }
        complicationKey = key
        WidgetCenter.shared.reloadTimelines(ofKind: "NextTrain")
    }

    /// Runs every few seconds while the app is open: moves the clock on and taps the wrist when it is time to get off.
    func tick() {
        now = Date()
        guard let l = live, l.phase == "ride" else { return }
        let off = l.getOffTime
        // One tap per stop you get off at on this trip, however the live times move.
        let key = "\(l.title ?? "")|\(l.getOffAt)|\(Clock.halfDayKey(now))"
        // About a minute before the train gets in, and not for a stop already passed.
        if now >= off.addingTimeInterval(-60), now < off.addingTimeInterval(120), tapped != key {
            tapped = key
            WKInterfaceDevice.current().play(.notification)
        }
    }
}

extension WatchModel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in WatchModel.shared.askPhone() }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let json = applicationContext["json"] as? String else { return }
        Task { @MainActor in WatchModel.shared.apply(json: json) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let json = message["json"] as? String else { return }
        Task { @MainActor in WatchModel.shared.apply(json: json) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        if session.isReachable { Task { @MainActor in WatchModel.shared.askPhone() } }
    }
}

// MARK: Screens

struct ContentView: View {
    @EnvironmentObject var model: WatchModel
    private let timer = Timer.publish(every: 15, on: .main, in: .common).autoconnect()
    private let reload = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            Group {
                if let c = model.context {
                    List {
                        if let l = model.live { Section("Trip") { LiveTripRow(card: l, now: model.now) } }
                        CommuteSection(context: c)
                        if !c.starred.isEmpty {
                            Section("Starred") {
                                ForEach(c.starred) { s in
                                    NavigationLink(value: s) { StopRow(stop: s, next: model.services(for: s).first, now: model.now) }
                                }
                            }
                        }
                        if let u = model.updatedAt {
                            Section {
                                Text(model.offline ? "Offline. Updated \(Clock.hhmm(u))" : "Updated \(Clock.hhmm(u))")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .listRowBackground(Color.clear)
                            }
                        }
                    }
                    .navigationDestination(for: WStop.self) { s in StopView(stop: s) }
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            Image(systemName: "iphone")
                                .font(.title2)
                                .foregroundStyle(.secondary)
                            Text("Open Transport on your iPhone to share Home, Work and your starred stops.")
                                .multilineTextAlignment(.center)
                                .font(.footnote)
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Transport")
        }
        .onAppear { model.refresh(ifOlderThan: 30) }
        .onReceive(timer) { _ in model.tick() }
        .onReceive(reload) { _ in model.refresh(ifOlderThan: 55) }
    }
}

struct CommuteSection: View {
    @EnvironmentObject var model: WatchModel
    let context: WatchContext

    var body: some View {
        if let c = model.commute {
            Section {
                let list = model.commuteServices
                if list.isEmpty {
                    Text(model.loading ? "Loading" : "No services found right now.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(list) { s in ServiceRow(service: s, now: model.now) }
                }
            } header: {
                Text("\(c.title): \(WText.short(c.from.name)) to \(WText.short(c.to.name))")
                    .lineLimit(3)
            }
        } else {
            Section("Commute") {
                Text(context.commuteHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct LineBadge: View {
    @Environment(\.isLuminanceReduced) private var dimmed
    let line: String
    let colorHex: String?

    var body: some View {
        Text(line.isEmpty ? " " : line)
            .font(.footnote.weight(.bold))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color(hexString: colorHex).opacity(dimmed ? 0.5 : 1)))
            .accessibilityHidden(true)
    }
}

struct ServiceRow: View {
    let service: WService
    let now: Date

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            LineBadge(line: service.line, colorHex: service.colorHex)
            VStack(alignment: .leading, spacing: 1) {
                // One line each: "Cancelled" and "4:50pm" shrink a little instead of wrapping ("Can-celled"), the platform
                // never wraps ("Plat / 2"), the destination gives way (native audit, 30 Oct).
                Text(service.cancelled ? "Cancelled" : Clock.countdown(service.time, from: now))
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .foregroundStyle(service.cancelled ? Color.red : Color.primary)
                    .strikethrough(service.cancelled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                HStack(spacing: 4) {
                    if let p = WText.platform(service.platform) { Text(p).fontWeight(.medium).lineLimit(1).fixedSize() }
                    if let d = service.dest, !d.isEmpty { Text(WText.short(d)).lineLimit(1) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if service.live {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.caption2)
                    .foregroundStyle(Color.green)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// "T1 to Central, 4 min, Plat 2, live" for VoiceOver.
    private var spoken: String {
        var parts = [service.line]
        if let d = service.dest, !d.isEmpty { parts[0] += " to \(WText.short(d))" }
        parts.append(service.cancelled ? "cancelled" : Clock.countdown(service.time, from: now))
        if let p = WText.platform(service.platform) { parts.append(p) }
        parts.append(service.live ? "live" : "timetable")
        return parts.joined(separator: ", ")
    }
}

struct StopRow: View {
    let stop: WStop
    let next: WService?
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(WText.short(stop.name).isEmpty ? stop.name : WText.short(stop.name))
                .font(.headline)
                .lineLimit(2)
            if let n = next {
                Text(WText.line(n.line, n.time, platform: n.platform, now: now))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Tap for departures")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the next 3 departures")
    }
}

struct StopView: View {
    @EnvironmentObject var model: WatchModel
    let stop: WStop

    var body: some View {
        List {
            let list = Array(model.services(for: stop).prefix(3))
            if list.isEmpty {
                Text(model.loading ? "Loading" : "No departures found right now.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(list) { s in ServiceRow(service: s, now: model.now) }
            }
            if let u = model.snapshot.stopsAt[stop.id] {
                Text("Updated \(Clock.hhmm(u))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(WText.short(stop.name))
        .onAppear { model.refresh(ifOlderThan: 30) }
    }
}

struct LiveTripRow: View {
    let card: WLiveCard
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                LineBadge(line: card.line, colorHex: card.lineColorHex)
                Text(card.phase == "wait" ? WText.leaves(card.target, now: now) : Clock.countdown(card.target, from: now))
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .minimumScaleFactor(0.7)
            }
            Text("Get off at \(WText.short(card.getOffAt))")
                .font(.headline)
            if card.phase == "wait", let p = WText.platform(card.platform) {
                Text(p).font(.caption2).foregroundStyle(.secondary)
            } else if let n = card.nextStop, !n.isEmpty {
                Text("Next: \(WText.short(n))").font(.caption2).foregroundStyle(.secondary)
            }
            if let w = card.warning, !w.isEmpty {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(card.isRisk ? Color.red : Color.orange)
            }
            if let u = card.updatedAt, now.timeIntervalSince(u) > 120 {
                Text("Updated \(Clock.hhmm(u))").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
