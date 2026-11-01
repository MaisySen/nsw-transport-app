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
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
    @StateObject private var model = WatchModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .onChange(of: phase, initial: true) { _, p in
            model.setForeground(p == .active)
            // Build 213: the watch app opens straight to the trip screen while a trip runs.
            if p == .active { model.openTrip() }
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
    /// Live times load every minute while the app is on screen, and on watchOS's background refresh when it is not
    /// (build 210); the complications also load the commute themselves.
    private var foreground = false
    /// Build 213: the trip moments already felt on the wrist (heads-up, Get off now, arrived), kept across launches so
    /// each one taps once per trip. Before, one tap a minute before the stop (watch.tapped).
    private var felt: [String] {
        get { UserDefaults.standard.stringArray(forKey: "watch.felt") ?? [] }
        set { UserDefaults.standard.set(Array(newValue.suffix(30)), forKey: "watch.felt") }
    }
    /// Build 213: the trip ended from the wrist, hidden here until the phone sends another trip.
    private var endedTrip: String? {
        get { UserDefaults.standard.string(forKey: "watch.endedTrip") }
        set { UserDefaults.standard.set(newValue, forKey: "watch.endedTrip") }
    }
    /// Build 213: opened from a complication or the Smart Stack trip card: the trip screen opens first (once).
    @Published var openTripPending = false
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

    /// The trip card while the trip runs (not one ended from the wrist).
    var live: WLiveCard? {
        guard let l = context?.live, l.isActive(now: now) else { return nil }
        if let e = endedTrip, e == tripKey(l) { return nil }
        return l
    }

    /// The trip's id from the phone (build 213), else its title and stop, for the one-tap memory.
    func tripKey(_ l: WLiveCard) -> String {
        context?.trip ?? "\(l.title ?? "")|\(l.getOffAt)|\(Clock.halfDayKey(l.getOffTime))"
    }

    /// End trip shows only when the phone said which trip it is (iPhone app from build 213).
    var canEndTrip: Bool { live != nil && (context?.trip ?? "").isEmpty == false }

    /// Build 213: End trip from the wrist. The phone ends it exactly like its own End trip (server alerts, share link,
    /// Lock Screen card): straight away when it is in reach, else when it next is (queued by watchOS). False when the
    /// watch has no session with the phone at all.
    @discardableResult
    func endTrip() -> Bool {
        guard let l = live, let id = context?.trip, !id.isEmpty else { return false }
        let s = WCSession.default
        guard s.activationState == .activated else { return false }
        let msg: [String: Any] = ["do": "endTrip", "trip": id, "at": Date().timeIntervalSince1970]
        if s.isReachable {
            s.sendMessage(msg, replyHandler: { _ in }, errorHandler: { _ in WCSession.default.transferUserInfo(msg) })
        } else {
            s.transferUserInfo(msg)
        }
        endedTrip = tripKey(l)
        WatchHaptics.ended()
        objectWillChange.send()
        reloadComplicationsIfChanged()
        return true
    }

    /// From a complication or the Smart Stack: go to the trip when one runs.
    func openTrip() {
        now = Date()
        if live != nil { openTripPending = true }
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
        } else {
            // Leaving the screen: the next times load in the background (build 210).
            scheduleBackgroundRefresh()
        }
    }

    func refresh(ifOlderThan seconds: TimeInterval = 0) {
        guard foreground else { return }
        if seconds > 0, let l = lastRefresh, Date().timeIntervalSince(l) < seconds { return }
        guard !loading, let c = context, WatchAPI(c) != nil else { return }
        loading = true
        lastRefresh = Date()
        Task {
            // Stops no longer starred are not kept (WatchRefresh.load).
            let (snap, failed) = await WatchRefresh.load(c, into: self.snapshot, stops: true)
            self.snapshot = snap
            self.offline = failed
            self.loading = false
            self.now = Date()
            WatchStore.save(snap)
            self.reloadComplicationsIfChanged()
        }
    }

    /// A background refresh from watchOS (build 210): the same load as on screen, with the app closed, then the next
    /// one asked for on WatchRefresh's clock. Before, the watch app loaded only while on screen.
    func backgroundRefresh() async {
        context = WatchStore.loadContext() ?? context
        var failed = false
        let live = context?.live?.isActive(now: Date()) == true
        if !loading, let c = context, !live {
            loading = true
            let (snap, f) = await WatchRefresh.load(c, into: WatchStore.loadSnapshot(), stops: true)
            failed = f
            snapshot = snap
            offline = f
            loading = false
            lastRefresh = Date()
            WatchStore.save(snap)
        }
        now = Date()
        reloadComplicationsIfChanged()
        scheduleBackgroundRefresh(failed: failed)
    }

    /// Asks watchOS for the next background refresh. watchOS decides the moment (about four an hour at most for an
    /// app on the watch face); this only says the earliest that is useful.
    func scheduleBackgroundRefresh(failed: Bool = false) {
        let live = context?.live?.isActive(now: Date()) == true
        let at = WatchRefresh.next(Date(), live: live, failed: failed)
        WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: at, userInfo: nil) { _ in }
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

    /// Runs every 5 seconds while the app is open (the clock moves on every 15 without a trip): moves the clock on and taps
    /// the wrist at the trip's moments, the same moments as the phone's card (WTripMoments).
    /// Build 213: your stop next (2 min before): one "up" tap; Get off now (30 s before): three strong taps, one tap
    /// when the live times are old (never a strong Get off now from old times); at the stop: a "success" tap. Each once
    /// per stop per trip, however the live times move; nothing for a moment already gone when the app opens.
    func tick() {
        let t = Date()
        if live == nil, t.timeIntervalSince(now) < 14 { return }
        now = t
        guard let l = live else { return }
        let m = WTripMoments.list(l, now: t)[0]
        let key = tripKey(l) + "|" + l.getOffAt
        let off = l.getOffTime
        switch m.kind {
        case .next:
            feel("next|" + key) { WatchHaptics.headsUp() }
        case .getOff:
            let fresh = WTripMoments.ageStep(l, at: t) == 0
            feel("off|" + key) { fresh ? WatchHaptics.getOffNow() : WatchHaptics.headsUp() }
        case .arrived:
            if t.timeIntervalSince(off) < 90 { feel("arr|" + key) { WatchHaptics.arrived() } }
        case .wait, .due, .ride:
            break
        }
    }

    private func feel(_ key: String, _ play: () -> Void) {
        var f = felt
        guard !f.contains(key) else { return }
        f.append(key)
        felt = f
        play()
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

// MARK: Background refresh

/// Hands watchOS's background refresh to the model (build 210). Every other task is completed at once.
@MainActor
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        WatchModel.shared.scheduleBackgroundRefresh()
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let refresh = task as? WKApplicationRefreshBackgroundTask {
                Task { @MainActor in
                    await WatchModel.shared.backgroundRefresh()
                    refresh.setTaskCompletedWithSnapshot(false)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}

// MARK: Screens

struct ContentView: View {
    @EnvironmentObject var model: WatchModel
    @State private var path = NavigationPath()
    // Build 213: every 5 s so the trip's wrist taps come on time (the model moves the clock every 15 s without a trip).
    private let timer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()
    private let reload = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let c = model.context {
                    List {
                        // Build 213: the trip is a button to its own screen (big countdown, Get off now, End trip).
                        if let l = model.live {
                            Section("Trip") {
                                NavigationLink(value: WatchRoute.trip) { LiveTripRow(card: l, now: model.now) }
                                    .accessibilityHint("Opens the trip")
                            }
                        }
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
                    .navigationDestination(for: WService.self) { s in ServiceView(service: s) }
                    .navigationDestination(for: WatchRoute.self) { _ in LiveTripView() }
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
        .onAppear { model.refresh(ifOlderThan: 30); openTripIfLive() }
        .onReceive(timer) { _ in model.tick() }
        .onReceive(reload) { _ in model.refresh(ifOlderThan: 55) }
        // Build 213: a complication or the Smart Stack trip card opens the trip screen when a trip runs.
        .onOpenURL { _ in model.openTrip() }
        .onChange(of: model.openTripPending) { _, on in if on { openTripIfLive() } }
        // Build 213: a trip the phone starts while the watch app is on its first screen opens the trip screen.
        .onChange(of: model.live != nil) { _, has in if has { model.openTrip() } }
    }

    private func openTripIfLive() {
        guard model.openTripPending else { return }
        model.openTripPending = false
        if model.live != nil, path.isEmpty { path.append(WatchRoute.trip) }
    }
}

/// Build 213: the screens the watch app opens besides stops and services.
enum WatchRoute: Hashable { case trip }

// MARK: Haptics (build 213)

/// The wrist taps for a trip, played while the watch app is on screen. With the app closed the phone's own trip alerts
/// (heads-up, Get off now, arrived) reach the wrist as notifications, whatever the iPhone's Silent switch says.
enum WatchHaptics {
    static func headsUp() { WKInterfaceDevice.current().play(.directionUp) }
    /// Three strong taps 0.8 s apart, so one tap missed on a moving train is not the only one.
    static func getOffNow() {
        WKInterfaceDevice.current().play(.notification)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { WKInterfaceDevice.current().play(.notification) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { WKInterfaceDevice.current().play(.notification) }
    }
    static func arrived() { WKInterfaceDevice.current().play(.success) }
    static func ended() { WKInterfaceDevice.current().play(.stop) }
}

/// Build 213: the trip on its own screen. Big words that read at a glance on the 40 mm watch, the stop, the next stop,
/// the status, and End trip with a confirm. Moves through the same moments as the phone's card.
struct LiveTripView: View {
    @EnvironmentObject var model: WatchModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmEnd = false
    @State private var endFailed = false

    var body: some View {
        ScrollView {
            if let l = model.live {
                VStack(alignment: .leading, spacing: 10) {
                    LiveTripPanel(card: l, now: model.now)
                    if model.canEndTrip {
                        Button(role: .destructive) { confirmEnd = true } label: {
                            Label("End trip", systemImage: "stop.circle")
                        }
                        .accessibilityHint("Ends the trip on your iPhone too")
                    }
                }
            } else {
                Text("No trip in progress.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .navigationTitle("Trip")
        .confirmationDialog("End trip?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End trip", role: .destructive) {
                if model.endTrip() { dismiss() } else { endFailed = true }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Live alerts for this trip stop.")
        }
        .alert("Couldn't reach your iPhone", isPresented: $endFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("End the trip in Transport on your iPhone.")
        }
    }
}

/// The trip panel, a plain view so the native audit renders exactly this (no model).
struct LiveTripPanel: View {
    let card: WLiveCard
    let now: Date

    var body: some View {
        let m = WTripMoments.list(card, now: now)[0]
        let big = WTripMoments.big(card, m, at: now)
        let detail = WTripMoments.detail(card, m, at: now)
        let old = WTripMoments.ageStep(card, at: now) >= 1
        let stop = WText.short(card.getOffAt)
        let alert = m.kind == .getOff
        return VStack(alignment: .leading, spacing: 4) {
            LineBadge(line: card.line, colorHex: card.lineColorHex)
            Text(big)
                .font(.system(.title, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(alert ? Color.orange : Color.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.5)
            ViewThatFits(in: .horizontal) {
                Text(m.kind == .arrived ? WText.short(card.destination ?? card.getOffAt) : "Get off at \(stop)").lineLimit(2)
                Text(m.kind == .arrived ? WText.short(card.destination ?? card.getOffAt) : "Off at \(stop)").lineLimit(2)
                Text(stop).lineLimit(2).minimumScaleFactor(0.7)
            }
            .font(.headline)
            if let d = detail, !d.isEmpty {
                let color: Color = !old && (card.delayMin ?? 0) > 0 && d.hasSuffix("late") ? .orange : .secondary
                Text(d).font(.footnote).foregroundStyle(color).lineLimit(2)
            }
            if m.kind == .ride, let n = card.stopsLeft, n > 1 {
                Text("\(n) stops to go").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            // Build 213 audit: once only ("Plat 16" was on the detail and on its own line).
            if card.phase == "wait", m.kind != .arrived, let p = WText.platform(card.platform), !(detail ?? "").contains(p) {
                Text(p).font(.footnote.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
            }
            if let w = card.warning, !w.isEmpty, card.isRisk {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Build 213: one service on its own screen (from the commute list or a starred stop): when it leaves, the platform,
/// where it goes, when it gets in, and whether the time is live or the timetable.
struct ServiceView: View {
    @EnvironmentObject var model: WatchModel
    let service: WService

    var body: some View {
        ScrollView { ServicePanel(service: service, now: model.now) }
            .navigationTitle(service.line)
    }
}

/// The service panel, a plain view for the native audit.
struct ServicePanel: View {
    let service: WService
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                LineBadge(line: service.line, colorHex: service.colorHex)
                // Build 213 audit: the whole destination, on as many lines as it needs ("Emu Plains via Parramatta an...").
                if let d = service.dest, !d.isEmpty { Text(WText.short(d)).font(.footnote).lineLimit(nil).fixedSize(horizontal: false, vertical: true) }
            }
            Text(service.cancelled ? "Cancelled" : Clock.countdown(service.time, from: now))
                .font(.system(.title2, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(service.cancelled ? Color.red : Color.primary)
                .strikethrough(service.cancelled)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text("Leaves \(Clock.hhmm(service.time))").font(.footnote).foregroundStyle(.secondary)
            if let p = WText.platform(service.platform) { Text(p).font(.footnote.weight(.medium)).lineLimit(1) }
            if let a = service.arrive { Text("Gets in \(Clock.hhmm(a))").font(.footnote).foregroundStyle(.secondary) }
            Label(service.live ? "Live" : "Timetable", systemImage: service.live ? "dot.radiowaves.left.and.right" : "calendar")
                .font(.caption)
                .foregroundStyle(service.live ? Color.green : Color.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
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
                    // Build 213: each service opens its own screen.
                    ForEach(list) { s in NavigationLink(value: s) { ServiceRow(service: s, now: model.now) } }
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
                // never wraps ("Plat / 2"), the destination gives way whole (native audit, 30 Oct).
                Text(service.cancelled ? "Cancelled" : Clock.countdown(service.time, from: now))
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .foregroundStyle(service.cancelled ? Color.red : Color.primary)
                    .strikethrough(service.cancelled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                ViewThatFits(in: .horizontal) {
                    serviceDetail(dest: true)
                    serviceDetail(dest: false)
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

    /// The platform shrinks a little rather than wrap; the destination shows when at least 40 pt is left for it,
    /// never as a one letter sliver (native audit, 30 Oct).
    private func serviceDetail(dest: Bool) -> some View {
        HStack(spacing: 4) {
            if let p = WText.platform(service.platform) {
                Text(p).fontWeight(.medium).lineLimit(1).minimumScaleFactor(0.8).layoutPriority(1)
            }
            if dest, let d = service.dest, !d.isEmpty {
                Text(WText.short(d)).lineLimit(1).frame(minWidth: 40, idealWidth: 40, maxWidth: .infinity, alignment: .leading)
            }
        }
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
                ForEach(list) { s in NavigationLink(value: s) { ServiceRow(service: s, now: model.now) } }
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
        // Build 212 (G27): the same moments as the phone's card and widget (WTripMoments): "Due" at the live departure,
        // never "Leaves now" early or a timer counting up past it; "Get off now", then "Arrived".
        let m = WTripMoments.list(card, now: now)[0]
        let big = WTripMoments.big(card, m, at: now)
        let detail = WTripMoments.detail(card, m, at: now)
        let old = WTripMoments.ageStep(card, at: now) >= 1
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                LineBadge(line: card.line, colorHex: card.lineColorHex)
                Text(big)
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            // Build 212 (native audit, 40 mm): "Get off at Sydney O…" and "No live data since…" were cut. The whole
            // words when they fit, then shorter words ("Off at", "No live data"), then a little smaller.
            let stop = WText.short(card.getOffAt)
            ViewThatFits(in: .horizontal) {
                Text(m.kind == .arrived ? WText.short(card.destination ?? card.getOffAt) : "Get off at \(stop)").font(.headline).lineLimit(1).fixedSize()
                Text(m.kind == .arrived ? WText.short(card.destination ?? card.getOffAt) : "Off at \(stop)").font(.headline).lineLimit(1).fixedSize()
                Text(m.kind == .arrived ? WText.short(card.destination ?? card.getOffAt) : stop).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
            }
            if let d = detail, !d.isEmpty {
                let color: Color = !old && (card.delayMin ?? 0) > 0 && d.hasSuffix("late") ? .orange : .secondary
                let short = d.hasPrefix("No live data since") ? "No live data" : d
                ViewThatFits(in: .horizontal) {
                    Text(d).font(.caption2).foregroundStyle(color).lineLimit(1).fixedSize()
                    Text(short).font(.caption2).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            if card.phase == "wait", m.kind != .arrived, !old, card.delayMin != nil, let p = WText.platform(card.platform) {
                Text(p).font(.caption2).foregroundStyle(.secondary)
            }
            if let w = card.warning, !w.isEmpty, card.isRisk {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(Color.red)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
