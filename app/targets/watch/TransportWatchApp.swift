// Transport on Apple Watch: your saved trips as cards you scroll with the Digital Crown, each with a big countdown to
// the next service, the platform, the lines and the two after it. Tap a card for the next 6 services, tap a service
// for its legs, swap the direction from the trip screen (or swipe a card). Home to Work (or back) comes first when
// both are set, then the trips in the order of Your trips on the iPhone; the trip in progress and starred stops too.
//
// The phone sends the trips and the server address (WatchConnectivity). The watch loads live times itself, only
// while it is on screen: when it opens or the wrist comes up, then every 30 seconds, and it stops when the screen
// goes. The last times are kept, so opening shows them at once; with no signal it shows the times the phone sent.
import Combine
import SwiftUI
import WatchConnectivity
import WatchKit
import WidgetKit

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

enum Haptic {
    /// A light click for a button that does something in place (refresh, swap). Navigation needs none.
    static func click() { WKInterfaceDevice.current().play(.click) }
}

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
    /// Trips opened the other way round (Swap) and when they were last loaded.
    private var extra: [String: WCard] = [:]
    private var extraLoaded: [String: Date] = [:]
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

    /// The trip cards in the phone's order, Home to Work (or back) first.
    var cards: [WCard] { context?.cards(now: now) ?? [] }

    /// The trip card while the trip runs.
    var live: WLiveCard? {
        guard let l = context?.live, l.isActive(now: now) else { return nil }
        return l
    }

    func services(for card: WCard) -> (list: [WService], fromPhone: Bool, at: Date?) {
        snapshot.services(for: card, context: context, now: now)
    }

    func services(for stop: WStop) -> [WService] {
        WatchSnapshot.upcoming(snapshot.stops[stop.id] ?? [], now: now)
    }

    /// When the times on screen were loaded: the oldest of the parts shown.
    var updatedAt: Date? {
        var dates: [Date] = []
        for c in cards { if let d = snapshot.tripsAt[c.key] { dates.append(d) } }
        for s in context?.starred ?? [] { if let d = snapshot.stopsAt[s.id] { dates.append(d) } }
        return dates.min()
    }

    /// True when a card shows the times the phone sent because the watch could not load its own.
    var showsPhoneTimes: Bool { cards.contains { services(for: $0).fromPhone } }

    // MARK: Context from the phone

    fileprivate func apply(json: String) {
        guard let c = WatchContext.decode(json), c.v >= 1 else { return }
        let old = context
        if old == c { return }
        context = c
        WatchStore.save(c)
        reloadComplicationsIfChanged()
        tick()
        if old?.base != c.base || old?.home != c.home || old?.work != c.work || old?.starred != c.starred
            || old?.flip != c.flip || old?.trips != c.trips {
            refresh()
        }
    }

    /// Asks the phone for its last context: when the app opens, and from the Try Again button.
    func askPhone() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated else { s.activate(); return }
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
            refresh(ifOlderThan: 28)
        }
    }

    /// Starts a load unless one ran in the last `seconds`.
    func refresh(ifOlderThan seconds: TimeInterval = 0) {
        Task { await load(ifOlderThan: seconds) }
    }

    /// Loads every card's next services and the starred stops' departures, at the same time.
    func load(ifOlderThan seconds: TimeInterval = 0) async {
        guard foreground else { return }
        if seconds > 0, let l = lastRefresh, Date().timeIntervalSince(l) < seconds { return }
        guard !loading, let c = context, let api = WatchAPI(c) else { return }
        loading = true
        lastRefresh = Date()
        let cards = c.cards(now: Date()) + Array(extra.values)
        let stops = c.starred
        var snap = self.snapshot
        var failed = false
        await withTaskGroup(of: (String, [WService]?).self) { g in
            for card in cards {
                g.addTask { (card.key, try? await api.load(card, count: 6)) }
            }
            for await (key, s) in g {
                if let s { snap.trips[key] = s; snap.tripsAt[key] = Date() } else { failed = true }
            }
        }
        await withTaskGroup(of: (String, [WService]?).self) { g in
            for st in stops {
                g.addTask { (st.id, try? await api.departures(stop: st.id)) }
            }
            for await (id, s) in g {
                if let s { snap.stops[id] = s; snap.stopsAt[id] = Date() } else { failed = true }
            }
        }
        for k in extra.keys { extraLoaded[k] = Date() }
        // Only trips and stops still shown are kept.
        let keys = Set(cards.map(\.key))
        snap.trips = snap.trips.filter { keys.contains($0.key) }
        snap.tripsAt = snap.tripsAt.filter { keys.contains($0.key) }
        let ids = Set(stops.map(\.id))
        snap.stops = snap.stops.filter { ids.contains($0.key) }
        snap.stopsAt = snap.stopsAt.filter { ids.contains($0.key) }
        // The build 206 complications read the commute list; keep it filled for a watch face not yet reloaded.
        if let m = c.commute(now: Date()), let s = snap.trips[m.key] {
            snap.commuteKey = m.key; snap.commute = s; snap.commuteAt = snap.tripsAt[m.key]
        }
        self.snapshot = snap
        self.offline = failed
        self.loading = false
        self.now = Date()
        WatchStore.save(snap)
        reloadComplicationsIfChanged()
    }

    /// A trip the other way round (Swap): loaded at once when it has no times or old ones, and kept loading with
    /// the rest while it is open.
    func show(_ card: WCard) async {
        let known = cards.contains { $0.key == card.key }
        if !known { extra[card.key] = card }
        if !services(for: card).list.isEmpty, let at = snapshot.tripsAt[card.key], Date().timeIntervalSince(at) < 28 { return }
        guard foreground, let c = context, let api = WatchAPI(c) else { return }
        if let s = try? await api.load(card, count: 6) {
            snapshot.trips[card.key] = s
            snapshot.tripsAt[card.key] = Date()
            extraLoaded[card.key] = Date()
            offline = false
        } else {
            offline = true
        }
        now = Date()
    }

    /// The trip screen closed: a trip the other way round stops loading.
    func close(_ card: WCard) {
        extra[card.key] = nil
        extraLoaded[card.key] = nil
    }

    /// Reloads the complications only when the service or trip they show changed (WidgetKit limits reloads).
    private func reloadComplicationsIfChanged() {
        var key = "none"
        if let l = live {
            key = ["live", l.line, l.phase, l.getOffAt, l.platform ?? "", String(Int(l.target.timeIntervalSince1970 / 60)), l.warning ?? ""].joined(separator: "|")
        } else if let c = cards.first {
            key = c.key + "|" + services(for: c).list.prefix(3).map { "\($0.line)@\(Int($0.time.timeIntervalSince1970 / 60))@\($0.platform ?? "")@\($0.delay ?? 0)" }.joined(separator: ",")
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

enum Route: Hashable {
    case trip(WCard)
    case service(WCard, WService)
    case stop(WStop)
}

struct ContentView: View {
    @EnvironmentObject var model: WatchModel
    @Environment(\.scenePhase) private var phase
    @State private var path: [Route] = []
    /// The trip a complication tap asked for, until it is on screen.
    @State private var openKey: String?

    private func open() {
        guard let key = openKey else { return }
        if let card = model.cards.first(where: { $0.key == key }) {
            path = [.trip(card)]
            openKey = nil
        } else if model.context != nil, !model.cards.isEmpty {
            // The trip is no longer saved: stay on the list.
            path = []
            openKey = nil
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let c = model.context {
                    TripListView(context: c, path: $path)
                } else {
                    EmptyWatchView(hasContext: false)
                }
            }
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .trip(let card): TripDetailView(card: card, path: $path)
                case .service(let card, let s): ServiceDetailView(card: card, service: s)
                case .stop(let s): StopView(stop: s)
                }
            }
        }
        // A complication tap opens that trip's screen, over the list so Back returns to it.
        .onOpenURL { url in
            guard let key = WatchLinks.tripKey(url) else { return }
            openKey = key
            open()
        }
        // On a cold start the trips may arrive a moment after the link.
        .onChange(of: model.cards) { _, _ in open() }
        // Screenshots (tools/watch-shots.sh, simulator only): "-shotRoute trip" or "service" opens the first trip, or
        // its first service, once the times are in. Without that launch argument nothing happens here.
        .task {
            guard let r = UserDefaults.standard.string(forKey: "shotRoute"), r != "list" else { return }
            for _ in 0..<30 {
                if let card = model.cards.first, let s = model.services(for: card).list.first {
                    path = r == "service" ? [.trip(card), .service(card, s)] : [.trip(card)]
                    return
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
        // While the screen is on and the app is in front: the countdowns move every 10 seconds and the times load
        // every 30. The loop ends when the wrist goes down or the app leaves the screen.
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                model.tick()
                await model.load(ifOlderThan: 28)
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }
}

struct TripListView: View {
    @EnvironmentObject var model: WatchModel
    let context: WatchContext
    @Binding var path: [Route]

    var body: some View {
        List {
            if let l = model.live {
                Section {
                    LiveTripRow(card: l, now: model.now)
                } header: {
                    Text("Your trip")
                }
            }
            let cards = model.cards
            if cards.isEmpty {
                EmptyWatchView(hasContext: true)
                    .listRowBackground(Color.clear)
            }
            ForEach(cards) { card in
                let s = model.services(for: card)
                NavigationLink(value: Route.trip(card)) {
                    TripRowView(card: card, services: s.list, now: model.now)
                }
                .swipeActions(edge: .trailing) {
                    Button {
                        Haptic.click()
                        path.append(.trip(card.reversed()))
                    } label: {
                        Label("Swap direction", systemImage: "arrow.left.arrow.right")
                    }
                    .tint(.blue)
                }
                .accessibilityAction(named: "Swap direction") {
                    path.append(.trip(card.reversed()))
                }
            }
            if !context.starred.isEmpty {
                Section("Stops") {
                    ForEach(context.starred) { s in
                        NavigationLink(value: Route.stop(s)) { StopRow(stop: s, next: model.services(for: s).first, now: model.now) }
                    }
                }
            }
            Section {
                RefreshRow()
            }
        }
        .refreshable { await model.load() }
        .navigationTitle("Transport")
    }
}

/// "Updated 2:41pm" and a Refresh button at the end of the list.
struct RefreshRow: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        Button {
            Haptic.click()
            Task { await model.load() }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Label(model.loading ? "Updating" : "Refresh", systemImage: "arrow.clockwise")
                    .font(.body.weight(.medium))
                if let line = statusLine {
                    Text(line)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .disabled(model.loading)
        .accessibilityHint("Loads the latest times")
    }

    private var statusLine: String? {
        if model.showsPhoneTimes { return "No connection. Times from your iPhone." }
        guard let u = model.updatedAt else { return nil }
        return model.offline ? "No connection. Updated \(Clock.hhmm(u))" : "Updated \(Clock.hhmm(u))"
    }
}

struct EmptyWatchView: View {
    @EnvironmentObject var model: WatchModel
    /// False when the phone has never sent anything.
    let hasContext: Bool

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "tram.fill")
                .font(.title2)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Save a trip on your iPhone to see it here.")
                .font(.body)
                .multilineTextAlignment(.center)
            if !hasContext {
                Text("Then open Transport on your iPhone once.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Try Again") {
                    Haptic.click()
                    model.askPhone()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

/// The bar on the left of a card in the line colours: one colour, or one stripe per line.
struct LineBar: View {
    @Environment(\.isLuminanceReduced) private var dimmed
    let colors: [String?]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(colors.enumerated()), id: \.offset) { _, c in
                Rectangle().fill(Color(hexString: c).opacity(dimmed ? 0.6 : 1))
            }
        }
        .frame(width: 5)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

extension WStatus {
    /// Green on time, amber a little late, red very late or cancelled.
    var color: Color {
        switch self {
        case .onTime: return .green
        case .slightlyLate: return .orange
        case .late, .cancelled: return .red
        }
    }
}

/// One trip on the list, as in TripView: the line colour bar and the route on two lines. Times are on the trip screen.
struct TripRowView: View {
    let card: WCard
    let services: [WService]
    let now: Date

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            LineBar(colors: services.first?.barColors ?? [nil])
                .frame(minHeight: 36)
            VStack(alignment: .leading, spacing: 1) {
                if let tag = WText.tag(card) {
                    Text(tag)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(card.title)
                    .font(.headline)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(WText.spokenCard(title: card.title, services: services, now: now))
        .accessibilityHint("Shows the next 6 services")
    }
}

/// One service on the trip screen, as in TripView: the line colour bar, a big countdown, the platform, the lines,
/// "11:56 to 12:18" and how late it runs. The top card also says where it goes and the two after it.
struct ServiceCardView: View {
    let service: WService
    let now: Date
    /// "To Strathfield" on the top card.
    var caption: String? = nil
    /// The services after this one, for "Next: 16, 18 mins" on the top card.
    var rest: [WService] = []
    var fromPhone = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            LineBar(colors: service.barColors)
            VStack(alignment: .leading, spacing: 1) {
                if let c = caption {
                    Text(c)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(service.cancelled ? "Cancelled" : WText.mins(service.time, now: now))
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(service.status.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let p = WText.platformFull(service.platform) {
                    Text(p).font(.body)
                }
                if let l = WText.lines(service) {
                    Text(l).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(WText.span(service))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                if let late = WText.late(service) {
                    Text(late)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(service.status.color)
                }
                if let n = WText.nextLine(rest, now: now) {
                    Text(n).font(.footnote).foregroundStyle(.secondary)
                }
                if fromPhone {
                    Label("From iPhone", systemImage: "iphone")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityHint("Shows the legs of this trip")
    }

    private var spoken: String {
        var parts: [String] = []
        if let c = caption { parts.append(c) }
        parts.append(WText.spokenCard(title: Clock.hhmm(service.time), services: [service] + rest, now: now))
        if let a = service.arrive { parts.append("arrives \(Clock.hhmm(a))") }
        return parts.joined(separator: ", ")
    }
}

/// A trip's next 6 services as cards, titled with the stop you leave from, with Swap direction and Refresh at the
/// bottom.
struct TripDetailView: View {
    @EnvironmentObject var model: WatchModel
    @State private var shown: WCard
    @Binding var path: [Route]

    init(card: WCard, path: Binding<[Route]>) {
        _shown = State(initialValue: card)
        _path = path
    }

    var body: some View {
        let s = model.services(for: shown)
        let list = Array(s.list.prefix(6))
        List {
            if list.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("To \(WText.short(shown.to.name))").font(.headline)
                    Text(model.loading ? "Loading" : "No services found right now.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(Array(list.enumerated()), id: \.element.id) { i, svc in
                NavigationLink(value: Route.service(shown, svc)) {
                    if i == 0 {
                        ServiceCardView(service: svc, now: model.now, caption: "To \(WText.short(shown.to.name))",
                                        rest: Array(list.dropFirst()), fromPhone: s.fromPhone)
                    } else {
                        ServiceCardView(service: svc, now: model.now)
                    }
                }
            }
            if let at = s.at {
                Text(s.fromPhone ? "Times from your iPhone, \(Clock.hhmm(at))" : "Updated \(Clock.hhmm(at))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(WText.short(shown.from.name))
        .refreshable { await reload() }
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    Haptic.click()
                    let old = shown
                    shown = shown.reversed()
                    model.close(old)
                } label: {
                    Image(systemName: "arrow.left.arrow.right")
                }
                .accessibilityLabel("Swap direction")
                Spacer()
                Button {
                    Haptic.click()
                    Task { await reload() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(model.loading)
                .accessibilityLabel("Refresh")
            }
        }
        .task(id: shown.key) { await model.show(shown) }
        .onDisappear { model.close(shown) }
    }

    private func reload() async {
        await model.load()
        await model.show(shown)
    }
}

/// One service: when it leaves, how late, and each leg with its platforms and times.
struct ServiceDetailView: View {
    @EnvironmentObject var model: WatchModel
    let card: WCard
    let service: WService

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text(service.cancelled ? "Cancelled" : WText.mins(service.time, now: model.now))
                        .font(.system(.title, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(service.status.color)
                    Text("Leaves \(Clock.hhmm(service.time))").font(.body)
                    Text(WText.delay(service)).font(.footnote).foregroundStyle(.secondary)
                    if let a = service.arrive {
                        Text("Arrives \(Clock.hhmm(a))").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            let legs = service.legs ?? []
            if legs.isEmpty {
                LegRow(leg: WLeg(line: service.line, colorHex: service.colorHex, mode: service.mode, from: card.from.name,
                                 fromPlatform: service.platform, to: card.to.name, toPlatform: nil, dep: service.time,
                                 arr: service.arrive, delay: service.delay))
            } else {
                ForEach(Array(legs.enumerated()), id: \.offset) { _, l in LegRow(leg: l) }
            }
        }
        .navigationTitle(service.allLines.joined(separator: ", "))
    }
}

struct LegRow: View {
    let leg: WLeg

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                LineBadge(line: leg.line, colorHex: leg.colorHex)
                if let d = leg.dep { Text(Clock.hhmm(d)).font(.headline.monospacedDigit()) }
            }
            Text(place(leg.from, leg.fromPlatform)).font(.footnote)
            Text("to " + place(leg.to, leg.toPlatform)).font(.footnote).foregroundStyle(.secondary)
            if let a = leg.arr {
                Text("Arrives \(Clock.hhmm(a))").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private func place(_ name: String?, _ platform: String?) -> String {
        [WText.short(name).isEmpty ? nil : WText.short(name), WText.platformFull(platform)].compactMap { $0 }.joined(separator: ", ")
    }

    private var spoken: String {
        var parts = [leg.line]
        if let d = leg.dep { parts.append("leaves \(Clock.hhmm(d))") }
        parts.append("from " + place(leg.from, leg.fromPlatform))
        parts.append("to " + place(leg.to, leg.toPlatform))
        if let a = leg.arr { parts.append("arrives \(Clock.hhmm(a))") }
        return parts.joined(separator: ", ")
    }
}

struct LineBadge: View {
    @Environment(\.isLuminanceReduced) private var dimmed
    let line: String
    let colorHex: String?

    var body: some View {
        Text(line.isEmpty ? " " : line)
            .font(.footnote.weight(.bold))
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
                Text(service.cancelled ? "Cancelled" : Clock.countdown(service.time, from: now))
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .foregroundStyle(service.cancelled ? Color.red : Color.primary)
                    .strikethrough(service.cancelled)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 4) {
                    if let p = WText.platform(service.platform) { Text(p).fontWeight(.medium) }
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
