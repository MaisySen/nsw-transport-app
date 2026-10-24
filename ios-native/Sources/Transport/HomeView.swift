import SwiftUI
import CoreLocation
import TransportKit

/// Home is a live board: your trips with their next services, recent and starred stops with
/// their next departures, and stops nearby. It refreshes every 15 seconds while it is on screen.
struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var path = NavigationPath()
    @State private var board = HomeBoard()
    @State private var location = LocationFinder()
    @State private var addingTrip = false
    @State private var pickingPlace: PlaceKind?

    enum PlaceKind: String, Identifiable { case home, work; var id: String { rawValue } }
    struct PlanRoute: Hashable {}

    static let popular = [
        StopRef(id: "200060", name: "Central Station", modes: [1]),
        StopRef(id: "200070", name: "Town Hall Station", modes: [1]),
        StopRef(id: "213510", name: "Strathfield Station", modes: [1]),
    ]

    var body: some View {
        NavigationStack(path: $path) {
            List {
                searchSection

                if store.homePlace == nil || store.workPlace == nil {
                    placesSection
                }

                let trips = homeTrips
                let serious = seriousAlerts(trips)
                if !serious.isEmpty {
                    Section { alertsBanner(serious) }
                }
                if trips.isEmpty {
                    Section { addTripRow }
                }

                let active = store.watches.filter { $0.active == true }
                if !active.isEmpty {
                    Section {
                        ForEach(active.prefix(3)) { w in WatchRow(watch: w) }
                        if active.count > 3 {
                            Button("See all \(active.count)") { store.tab = .watching }
                        }
                    } header: {
                        Text("Watching")
                    }
                }

                if let s = store.suggestion, let from = s.from, let to = s.to {
                    Section {
                        SuggestionCard(suggestion: s, from: from, to: to)
                    }
                }

                if !trips.isEmpty {
                    let keys = orderKeys(trips)
                    ForEach(Array(trips.enumerated()), id: \.element.id) { i, t in
                        Section {
                            tripCard(t, keys: keys)
                        }
                    }
                }

                let stops = homeStops
                ForEach(Array(stops.enumerated()), id: \.element.id) { i, s in
                    Section {
                        stopCard(s, distance: nil)
                    } header: {
                        if i == 0 { Text("Recent stops") }
                    }
                }

                nearbySection

                if trips.isEmpty && stops.isEmpty {
                    ForEach(Array(Self.popular.enumerated()), id: \.element.id) { i, s in
                        Section {
                            stopCard(s, distance: nil)
                        } header: {
                            if i == 0 { Text("Popular stations") }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .navigationTitle("Trips")
            .navigationDestination(for: PlanRoute.self) { _ in TripPlannerView() }
            .navigationDestination(for: StopRef.self) { s in StopView(stop: s) }
            .navigationDestination(for: ServiceKey.self) { k in ServiceView(key: k) }
            .navigationDestination(for: TripPair.self) { p in TripPlannerView(from: p.from, to: p.to, via: p.via, conn: p.conn ?? 5) }
            .navigationDestination(for: JourneyLink.self) { l in JourneyDetailView(journey: l.journey, from: l.from, to: l.to) }
            .refreshable {
                async let a: Void = store.loadSaved()
                async let b: Void = store.loadCommutes()
                async let c: Void = store.loadWatches(notify: false)
                _ = await (a, b, c)
                if let c = location.coordinate {
                    await board.loadNearby(api: store.api, lat: c.latitude, lon: c.longitude)
                }
                await refresh()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { TripPlannerView() } label: {
                        Image(systemName: "arrow.triangle.turn.up.right.diamond")
                    }
                    .accessibilityLabel("Plan a trip")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { addingTrip = true } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add a trip")
                }
            }
            .sheet(isPresented: $addingTrip) {
                NewTripSheet()
                    .environment(store)
                    .presentationDetents([.large])
            }
            .sheet(item: $pickingPlace) { kind in
                StopPicker(title: kind == .home ? "Home" : "Work") { stop in
                    if kind == .home { store.homePlace = stop } else { store.workPlace = stop }
                    store.success()
                    pickingPlace = nil
                }
                .presentationDetents([.large])
                .environment(store)
            }
            .autoRefresh(every: max(store.refreshSeconds, 15), active: store.isActive && store.tab == .home) { await refresh() }
            .task(id: refreshKey) { await refresh() }
            .onChange(of: location.coordinate?.latitude) { _, _ in
                Task {
                    guard let c = location.coordinate else { return }
                    await board.loadNearby(api: store.api, lat: c.latitude, lon: c.longitude)
                    await refresh()
                }
            }
            .onAppear {
                let status = CLLocationManager().authorizationStatus
                if (status == .authorizedWhenInUse || status == .authorizedAlways) && board.nearby.isEmpty {
                    location.request()
                }
            }
            .onChange(of: store.pendingRoute) { _, route in follow(route) }
            .onAppear { follow(store.pendingRoute) }
            .appHaptics()
        }
    }

    // MARK: Sections

    private var searchSection: some View {
        Section {
            Button {
                store.tap()
                path.append(PlanRoute())
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                    Text("Where to?")
                    Spacer()
                }
                .font(.body)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .frame(minHeight: 38)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Where to?")
            .accessibilityIdentifier("homeSearch")
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        } footer: {
            HStack {
                Spacer()
                LiveStamp(updated: board.updated, loading: board.loading)
            }
            .padding(.top, 2)
        }
    }

    /// Add home and Add work, side by side, until both are set.
    private var placesSection: some View {
        Section {
            HStack(spacing: 10) {
                placeButton(.home, title: store.homePlace.map { Naming.short($0.name) } ?? "Add home", symbol: "house.fill", set: store.homePlace != nil)
                placeButton(.work, title: store.workPlace.map { Naming.short($0.name) } ?? "Add work", symbol: "briefcase.fill", set: store.workPlace != nil)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private func placeButton(_ kind: PlaceKind, title: String, symbol: String, set: Bool) -> some View {
        Button { pickingPlace = kind } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(kind == .home ? Color.blue : Color.brown, in: Circle())
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(set ? Color.primary : Color.accentColor)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 48)
            .frame(maxWidth: .infinity)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(kind == .home ? "addHome" : "addWork")
    }

    /// High priority alerts on the services shown in the trip cards, each once.
    private func seriousAlerts(_ trips: [HomeTrip]) -> [ServiceAlert] {
        var seen = Set<String>()
        var out: [ServiceAlert] = []
        let now = Date()
        for t in trips {
            let shown = (board.journeys[t.id] ?? []).filter { ($0.leave ?? .distantPast) > now.addingTimeInterval(-30) }.prefix(3)
            for a in shown.flatMap({ $0.transitLegs.flatMap { $0.alerts ?? [] } }) where a.isSerious && seen.insert(a.id).inserted {
                out.append(a)
            }
        }
        return out
    }

    private func alertsBanner(_ alerts: [ServiceAlert]) -> some View {
        NavigationLink { AlertsList(alerts: alerts) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(alerts.count == 1 ? "Service information" : "\(alerts.count) service alerts")
                        .font(.subheadline.weight(.semibold))
                    Text(alerts.first?.title ?? "")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .listRowBackground(Color.orange.opacity(0.14))
        .accessibilityIdentifier("alertsBanner")
    }

    private var addTripRow: some View {
        Button { addingTrip = true } label: {
            Label("Add a trip", systemImage: "plus.circle.fill")
                .font(.body.weight(.semibold))
                .foregroundStyle(.tint)
        }
        .accessibilityIdentifier("addTrip")
    }

    @ViewBuilder
    private var nearbySection: some View {
        if board.nearby.isEmpty {
            Section {
                Button { location.request() } label: {
                    Label("Show stops near me", systemImage: "location.fill")
                }
            } header: {
                Text("Nearby")
            }
        } else {
            ForEach(Array(board.nearby.enumerated()), id: \.element.id) { i, place in
                Section {
                    stopCard(place.stop, distance: place.distance)
                } header: {
                    if i == 0 { Text("Nearby") }
                }
            }
        }
    }

    // MARK: Trip card

    @ViewBuilder
    private func tripCard(_ t: HomeTrip, keys: [String]) -> some View {
        let now = Date()
        let all = board.journeys[t.id] ?? []
        let live = all.filter { ($0.leave ?? .distantPast) > now.addingTimeInterval(-30) }
        // Services that stop at both ends unless this trip shows all of them.
        let upcoming = TripPlan.directFilter(live, extended: t.via != nil, all: store.showsAllServices(t.id)).list
        let shown = Array(upcoming.prefix(3))
        let pos = keys.firstIndex(of: t.orderKey) ?? 0
        let alertCount = Set(shown.flatMap { $0.transitLegs.flatMap { $0.alerts ?? [] } }.map(\.id)).count
        let hex = shown.first?.firstTransit.map { $0.color ?? Mode(raw: $0.mode).fallbackHex }

        NavigationLink(value: TripPair(from: t.from, to: t.to, via: t.via, conn: t.via == nil ? nil : t.conn)) {
            TripHeader(trip: t, colorHex: hex, alertCount: alertCount)
        }
        // Long press and drag a trip onto another to reorder; the menu does the same one step at a time.
        .draggable(t.orderKey)
        .dropDestination(for: String.self) { items, _ in
            guard let k = items.first, k != t.orderKey else { return false }
            moveTrip(k, to: t.orderKey, keys: keys)
            return true
        }
        .contextMenu {
            if keys.count > 1 {
                Button { moveTrip(t.orderKey, by: -1, keys: keys) } label: { Label("Move up", systemImage: "arrow.up") }
                    .disabled(pos == 0)
                Button { moveTrip(t.orderKey, by: 1, keys: keys) } label: { Label("Move down", systemImage: "arrow.down") }
                    .disabled(pos >= keys.count - 1)
            }
        }
        .accessibilityAction(named: "Move up") { moveTrip(t.orderKey, by: -1, keys: keys) }
        .accessibilityAction(named: "Move down") { moveTrip(t.orderKey, by: 1, keys: keys) }
        .swipeActions(edge: .trailing) {
            switch t.kind {
            case .mine:
                Button(role: .destructive) {
                    store.removeMyTrip(t.id)
                } label: { Label("Delete", systemImage: "trash") }
            case .saved:
                Button(role: .destructive) {
                    Task { try? await store.api.deleteSaved(name: t.name ?? ""); await store.loadSaved() }
                } label: { Label("Delete", systemImage: "trash") }
            case .recent:
                Button(role: .destructive) {
                    store.forgetTrip(from: t.from, to: t.to)
                } label: { Label("Remove", systemImage: "minus.circle") }
            case .place:
                Button(role: .destructive) {
                    store.homePlace = nil
                    store.workPlace = nil
                } label: { Label("Clear", systemImage: "minus.circle") }
            case .commute:
                EmptyView()
            }
        }

        if shown.isEmpty {
            HStack {
                Text(board.loaded.contains("t:" + t.id) ? "No services soon" : "Loading live times")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                if !board.loaded.contains("t:" + t.id) { ProgressView() }
            }
        } else {
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, j in
                Button {
                    path.append(JourneyLink(journey: j, from: t.from, to: t.to))
                } label: {
                    ServiceRow(journey: j,
                               status: board.status(for: j, now: now),
                               dimmed: HomeBoard.isBeaten(j, among: upcoming),
                               first: i == 0)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tripService")
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button {
                        Task { await store.watch(j.watchRequest(device: store.device, profile: store.api.profile, from: t.from, to: t.to)) }
                    } label: { Label("Watch", systemImage: "bell.fill") }
                    .tint(.indigo)
                }
            }
        }
    }

    // MARK: Stop card

    @ViewBuilder
    private func stopCard(_ s: StopRef, distance: Double?) -> some View {
        NavigationLink(value: StopRef(id: s.id, name: s.name)) {
            HStack(spacing: 6) {
                if store.isStarred(s.id) {
                    Image(systemName: "star.fill")
                        .font(.footnote)
                        .foregroundStyle(.yellow)
                }
                Text(Naming.short(s.name))
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let d = distance {
                    Text(d < 1000 ? "\(Int(d)) m" : String(format: "%.1f km", d / 1000))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        }
        .accessibilityIdentifier("homeStop")

        let groups = HomeBoard.lineGroups(board.departures[s.id] ?? [], now: Date())
        if groups.isEmpty {
            HStack {
                Text(board.loaded.contains("s:" + s.id) ? "No services soon" : "Loading live times")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                if !board.loaded.contains("s:" + s.id) { ProgressView() }
            }
        } else {
            ForEach(groups, id: \.first!.id) { g in
                Button { path.append(ServiceKey(g[0])) } label: {
                    CompactDepartureRow(next: g[0], following: g.count > 1 ? g[1] : nil)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button {
                        Task { await store.watch(g[0].watchRequest(device: store.device, profile: store.api.profile)) }
                    } label: { Label("Watch", systemImage: "bell.fill") }
                    .tint(.indigo)
                }
            }
        }
    }

    // MARK: Data

    /// Commutes, saved trips, then up to 2 recently opened trips. At most 4.
    private var homeTrips: [HomeTrip] {
        var out: [HomeTrip] = []
        func add(_ t: HomeTrip) -> Bool {
            guard !out.contains(where: { $0.id == t.id }) else { return false }
            out.append(t)
            return true
        }
        if let h = store.homePlace, let w = store.workPlace, h.id != w.id {
            let toWork = HomeTrip(kind: .place, name: "To work", from: h, to: w)
            let toHome = HomeTrip(kind: .place, name: "To home", from: w, to: h)
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = Clock.sydney
            let morning = cal.component(.hour, from: Date()) < 12
            _ = add(morning ? toWork : toHome)
            _ = add(morning ? toHome : toWork)
        }
        for c in store.commutes where c.active != false {
            _ = add(HomeTrip(kind: .commute, name: c.name, from: c.from, to: c.to))
        }
        for m in store.myTrips {
            _ = add(HomeTrip(kind: .mine, name: m.name, from: m.from, to: m.to, via: m.via, conn: m.conn ?? 5))
        }
        for s in store.saved {
            _ = add(HomeTrip(kind: .saved, name: s.name, from: s.from, to: s.to))
        }
        var recent = 0
        for r in store.recentTrips where recent < 2 {
            if add(HomeTrip(kind: .recent, name: nil, from: r.from, to: r.to)) { recent += 1 }
        }
        // Your own order from dragging wins. Home and Work share one key, so they move together
        // and keep their morning and evening order.
        let order = store.tripOrder
        let sorted = out.enumerated().sorted { a, b in
            let pa = order.firstIndex(of: a.element.orderKey) ?? 1000 + a.offset
            let pb = order.firstIndex(of: b.element.orderKey) ?? 1000 + b.offset
            return pa != pb ? pa < pb : a.offset < b.offset
        }
        return Array(sorted.map(\.element).prefix(8))
    }

    /// Each order key once, in the order shown.
    private func orderKeys(_ trips: [HomeTrip]) -> [String] {
        var keys: [String] = []
        for t in trips where !keys.contains(t.orderKey) { keys.append(t.orderKey) }
        return keys
    }

    /// Drop a trip on another: it takes that trip's place.
    private func moveTrip(_ key: String, to target: String, keys: [String]) {
        var k = keys
        guard let a = k.firstIndex(of: key), let b = k.firstIndex(of: target), a != b else { return }
        let moved = k.remove(at: a)
        k.insert(moved, at: b)
        withAnimation(.snappy) { store.tripOrder = k }
        store.success()
    }

    private func moveTrip(_ key: String, by delta: Int, keys: [String]) {
        var k = keys
        guard let a = k.firstIndex(of: key), k.indices.contains(a + delta) else { return }
        k.swapAt(a, a + delta)
        withAnimation(.snappy) { store.tripOrder = k }
        store.tap()
    }

    /// Starred stops first, then stops opened recently. At most 4.
    private var homeStops: [StopRef] {
        var out: [StopRef] = []
        for s in store.starred + store.recents where !out.contains(where: { $0.id == s.id }) {
            out.append(s)
        }
        return Array(out.prefix(4))
    }

    private var stopIDs: [String] {
        var ids = homeStops.map(\.id) + board.nearby.map(\.stop.id)
        if homeTrips.isEmpty && homeStops.isEmpty { ids += Self.popular.map(\.id) }
        return ids
    }

    private var refreshKey: String {
        homeTrips.map(\.id).joined(separator: ",") + "|" + stopIDs.joined(separator: ",")
    }

    private func refresh() async {
        await board.refresh(api: store.api, device: store.device, trips: homeTrips, stops: stopIDs)
    }

    private func follow(_ route: DeepRoute?) {
        guard let route else { return }
        store.pendingRoute = nil
        switch route {
        case .stop(let s):
            path.append(s)
        case .trip(let from, let to):
            path.append(TripPair(from: from, to: to))
        case .track(let stopID):
            Task {
                // Opens the first live service at this stop on the map.
                guard let d = try? await store.api.departures(stop: stopID, device: store.device),
                      let first = d.items.first(where: { $0.isLive && $0.vehicle != nil }) ?? d.items.first else { return }
                path.append(ServiceKey(first))
            }
        }
    }
}

struct TripPair: Hashable, Codable {
    var from: StopRef
    var to: StopRef
    /// Set for an extended trip: change here, with `conn` minutes to connect.
    var via: StopRef? = nil
    var conn: Int? = nil
}

struct JourneyLink: Hashable {
    var journey: Journey
    var from: StopRef
    var to: StopRef
}

struct HomeTrip: Identifiable, Hashable {
    enum Kind: Hashable { case place, commute, saved, mine, recent }
    var kind: Kind
    var name: String?
    var from: StopRef
    var to: StopRef
    var via: StopRef? = nil
    var conn: Int = 5

    var id: String { TripKey.of(from: from, via: via, to: to) }
    /// The key for your order on Trips. Home and Work move together.
    var orderKey: String { kind == .place ? "places" : id }
    var route: String { "\(Naming.compact(Naming.short(from.name))) to \(Naming.compact(Naming.short(to.name)))" }

    /// The saved or commute name, when it says more than the route itself.
    var label: String? {
        guard let n = name?.trimmingCharacters(in: .whitespaces), !n.isEmpty,
              n.lowercased() != route.lowercased() else { return nil }
        return n.capitalizedFirst
    }
}

// MARK: Live data

/// Loads every trip and stop on Home at once, and remembers the last live delay of each
/// service so a dropped feed reads "Last reported 3 min late" for 10 minutes.
@MainActor
@Observable
final class HomeBoard {
    var journeys: [String: [Journey]] = [:]
    var departures: [String: [Departure]] = [:]
    var loaded: Set<String> = []
    var nearby: [NearbyPlace] = []
    var updated: Date?
    var loading = false

    struct LiveMemo { var delayMin: Int; var seen: Date }
    @ObservationIgnored private var memos: [String: LiveMemo] = [:]
    @ObservationIgnored private var parents: [String: StopRef] = [:]

    @ObservationIgnored private var queued: (trips: [HomeTrip], stops: [String])?

    /// A refresh asked for while one is running runs right after it, with the newer list.
    func refresh(api: TransportAPI, device: String, trips: [HomeTrip], stops: [String]) async {
        guard !loading else {
            queued = (trips, stops)
            return
        }
        loading = true
        await load(api: api, device: device, trips: trips, stops: stops)
        while let next = queued {
            queued = nil
            await load(api: api, device: device, trips: next.trips, stops: next.stops)
        }
        loading = false
    }

    private func load(api: TransportAPI, device: String, trips: [HomeTrip], stops: [String]) async {
        let tripJobs = trips.map { (key: $0.id, from: $0.from.id, to: $0.to.id, via: $0.via?.id, conn: $0.conn) }
        let stopJobs = Array(Set(stops))
        let now = Date()
        await withTaskGroup(of: HomeFetch.self) { group in
            for job in tripJobs {
                group.addTask {
                    let r = try? await TripPlan.plan(api: api, from: job.from, via: job.via, to: job.to, conn: job.conn, count: 5)
                    return HomeFetch.trip(job.key, r)
                }
            }
            for id in stopJobs {
                group.addTask {
                    let r = try? await api.departures(stop: id, device: device)
                    return HomeFetch.stop(id, r)
                }
            }
            // Each card fills in as soon as its own answer lands.
            for await r in group {
                withAnimation(.snappy) { apply(r, now: now) }
            }
        }
        updated = now
    }

    private func apply(_ r: HomeFetch, now: Date) {
        switch r {
        case .trip(let key, let resp):
            if let resp {
                journeys[key] = resp.journeys
                for j in resp.journeys { note(j, now: now) }
            }
            loaded.insert("t:" + key)
        case .stop(let id, let resp):
            if let resp { departures[id] = resp.items }
            loaded.insert("s:" + id)
        }
    }

    private static func key(_ j: Journey) -> String? {
        guard let f = j.firstTransit else { return nil }
        return "\(f.tripId ?? f.line ?? "")-\(f.planned?.timeIntervalSince1970 ?? 0)"
    }

    private func note(_ j: Journey, now: Date) {
        guard let f = j.firstTransit, f.isLive, let k = Self.key(j) else { return }
        memos[k] = LiveMemo(delayMin: f.delayMin ?? 0, seen: now)
    }

    func status(for j: Journey, now: Date) -> ServiceStatus {
        let f = j.firstTransit
        if j.anyCancelled == true || f?.cancelled == true { return ServiceStatus(text: "Cancelled", tone: .bad) }
        if let f, f.isLive {
            let d = f.delayMin ?? 0
            return ServiceStatus(text: Delay.text(delayMin: d, live: true, cancelled: false), tone: d > 0 ? .late : .good)
        }
        if let k = Self.key(j), let m = memos[k] {
            if now.timeIntervalSince(m.seen) < 600 {
                let d = m.delayMin
                let word = d == 0 ? "on time" : (d > 0 ? "\(d) min late" : "\(-d) min early")
                return ServiceStatus(text: "Last reported \(word)", tone: d > 0 ? .late : .good)
            }
            return ServiceStatus(text: "Live data unavailable", tone: .plain)
        }
        return ServiceStatus(text: "Scheduled", tone: .plain)
    }

    /// True when a later service in the list gets there sooner.
    static func isBeaten(_ j: Journey, among list: [Journey]) -> Bool {
        if j.beaten == true { return true }
        guard let i = list.firstIndex(of: j), let a = j.arrive else { return false }
        return list[(i + 1)...].contains { ($0.arrive ?? .distantFuture) < a }
    }

    /// Departures grouped by line and destination, cancelled ones skipped. At most 3 groups.
    static func lineGroups(_ items: [Departure], now: Date) -> [[Departure]] {
        var groups: [[Departure]] = []
        for d in items where !d.isCancelled && (d.bestTime ?? .distantPast) > now {
            let k = d.line + "|" + (d.dest ?? "")
            if let i = groups.firstIndex(where: { $0[0].line + "|" + ($0[0].dest ?? "") == k }) {
                groups[i].append(d)
            } else {
                groups.append([d])
            }
        }
        return Array(groups.prefix(3))
    }

    /// The closest 3 places. Platforms and stands of one station come back separately,
    /// so they are grouped by name and the station's own id is looked up once.
    func loadNearby(api: TransportAPI, lat: Double, lon: Double) async {
        guard let raw = try? await api.nearby(lat: lat, lon: lon), !raw.isEmpty else { return }
        var groups: [(name: String, members: [StopRef])] = []
        for s in raw {
            let n = Naming.short(s.name)
            if let i = groups.firstIndex(where: { $0.name == n }) {
                groups[i].members.append(s)
            } else {
                groups.append((n, [s]))
            }
        }
        var out: [NearbyPlace] = []
        for g in groups.prefix(3) {
            var stop = StopRef(id: g.members[0].id, name: g.name)
            if g.name.hasSuffix("Station") || g.name.hasSuffix("Wharf") || g.members.count > 1 {
                if let p = parents[g.name] {
                    stop = p
                } else if let r = try? await api.search(g.name), let first = r.first, first.name.hasPrefix(g.name) {
                    let p = StopRef(id: first.id, name: g.name, modes: first.modes)
                    parents[g.name] = p
                    stop = p
                }
            }
            out.append(NearbyPlace(stop: stop, distance: g.members.compactMap(\.distance).min()))
        }
        withAnimation(.snappy) { nearby = out }
    }
}

private enum HomeFetch: Sendable {
    case trip(String, TripResponse?)
    case stop(String, DeparturesResponse?)
}

struct NearbyPlace: Identifiable, Hashable {
    var stop: StopRef
    var distance: Double?
    var id: String { stop.id }
}

struct ServiceStatus: Hashable {
    enum Tone: Hashable { case good, late, bad, plain }
    var text: String
    var tone: Tone

    /// The status from the journey alone, without the remembered live delay Home keeps.
    static func of(_ j: Journey) -> ServiceStatus {
        let f = j.firstTransit
        if j.anyCancelled == true || f?.cancelled == true { return ServiceStatus(text: "Cancelled", tone: .bad) }
        guard let f, f.isLive else { return ServiceStatus(text: "Scheduled", tone: .plain) }
        let d = f.delayMin ?? 0
        return ServiceStatus(text: Delay.text(delayMin: d, live: true, cancelled: false), tone: d > 0 ? .late : .good)
    }

    var color: Color {
        switch tone {
        case .good: return .liveGreen
        case .late: return .orange
        case .bad: return .red
        case .plain: return Color(.systemGray)
        }
    }
}

// MARK: Rows

/// Trip header: a stripe in the line colour, "Burwood to Central", and an alerts line.
struct TripHeader: View {
    var trip: HomeTrip
    var colorHex: String?
    var alertCount: Int

    var body: some View {
        HStack(spacing: 10) {
            Capsule()
                .fill(colorHex.map { Color(hex: $0) } ?? Color(.systemGray3))
                .frame(width: 4)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    if trip.kind == .saved || trip.kind == .mine {
                        Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow)
                    } else if trip.kind == .place {
                        Image(systemName: trip.name == "To work" ? "briefcase.fill" : "house.fill").font(.caption).foregroundStyle(.blue)
                    } else if trip.kind == .commute {
                        Image(systemName: "clock.fill").font(.caption).foregroundStyle(.secondary)
                    }
                    Text(trip.route)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                }
                if let label = trip.label {
                    Text(label)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let via = trip.via {
                    Label("Change at \(Naming.compact(Naming.short(via.name))), \(trip.conn) min", systemImage: "arrow.triangle.swap")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("tripVia")
                }
                if alertCount > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill").imageScale(.small)
                        Text(alertCount == 1 ? "1 alert" : "\(alertCount) alerts")
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.orange)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 2)
    }
}

/// One service, TripView style: countdown in a block of the line colour, leave time with its
/// status, arrive time with the lines.
struct ServiceRow: View {
    var journey: Journey
    var status: ServiceStatus
    var dimmed = false
    var first = false
    /// Travel time mode: the chip shows the trip length instead of the countdown.
    var showDuration = false

    var body: some View {
        let f = journey.firstTransit
        let cancelled = status.tone == .bad
        let leave = journey.leave ?? f?.departTime
        HStack(spacing: 12) {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let secs = leave.map { $0.timeIntervalSince(ctx.date) } ?? 0
                let tone = showDuration ? ChipTone.duration : ChipTone.of(seconds: secs, cancelled: cancelled)
                VStack(spacing: 0) {
                    if showDuration, let d = journey.durationMin {
                        Text("\(d)")
                            .font((first ? Font.title2 : Font.title3).weight(.bold))
                            .monospacedDigit()
                        Text("min").font(.caption2.weight(.semibold))
                    } else if let leave {
                        let big = TransportKit.Countdown.big(until: leave, now: ctx.date)
                        let unit = TransportKit.Countdown.unit(until: leave, now: ctx.date)
                        Text(big)
                            .font((unit.isEmpty ? Font.subheadline : (first ? Font.title2 : Font.title3)).weight(.bold))
                            .monospacedDigit()
                            .contentTransition(.numericText(countsDown: true))
                        if !unit.isEmpty {
                            Text(unit).font(.caption2.weight(.semibold))
                        }
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(tone.text)
                .frame(width: 56)
                .frame(maxHeight: .infinity)
                .background(tone.fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .frame(width: 56)

            VStack(alignment: .leading, spacing: 1) {
                Text(boardLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(leave.map(Clock.time) ?? "")
                    .font((first ? Font.title2 : Font.title3).weight(.semibold))
                    .monospacedDigit()
                    .strikethrough(cancelled)
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(status.color)
                        .frame(width: 8, height: 8)
                    Text(status.text)
                        .font(.footnote)
                        .foregroundStyle(status.tone == .plain ? Color.secondary : status.color)
                        .lineLimit(1)
                }
            }
            .layoutPriority(1)

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 1) {
                Text(arriveLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(journey.arrive.map(Clock.time) ?? "")
                    .font((first ? Font.title2 : Font.title3).weight(.semibold))
                    .monospacedDigit()
                HStack(spacing: 4) {
                    ForEach(Array(journey.transitLegs.prefix(2).enumerated()), id: \.offset) { _, l in
                        LineBadge(line: l.line ?? "", colorHex: l.color, mode: l.mode, compact: true)
                    }
                    CrowdView(occupancy: journey.transitLegs.first?.occupancy)
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 2)
        .opacity(dimmed ? 0.45 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var boardLine: String {
        let f = journey.firstTransit
        let place = Naming.compact(Naming.short(f?.from ?? ""))
        guard let p = f?.fromPlatform, !p.isEmpty else { return place }
        let plat = p.replacingOccurrences(of: "Platform ", with: "Plat ")
        return place.isEmpty ? plat : "\(place), \(plat)"
    }

    private var arriveLine: String {
        Naming.compact(Naming.short(journey.transitLegs.last?.to ?? ""))
    }

    private var summary: String {
        var parts: [String] = []
        if let d = journey.durationMin { parts.append("\(d) min") }
        let c = journey.changes ?? max(0, journey.transitLegs.count - 1)
        if journey.transitLegs.count > 1 && c > 0 { parts.append(c == 1 ? "1 change" : "\(c) changes") }
        return parts.joined(separator: ", ")
    }
}

/// Countdown chip colour by time left, not the line colour: red at 3 min or less, amber
/// 4 to 9 min, green 10 min or more, grey when cancelled.
struct ChipTone: Sendable {
    var fill: Color
    var text: Color

    static let red = ChipTone(fill: Color(red: 0.86, green: 0.17, blue: 0.15), text: .white)
    static let amber = ChipTone(fill: Color(red: 0.98, green: 0.66, blue: 0.08), text: .black)
    static let green = ChipTone(fill: Color(red: 0.12, green: 0.6, blue: 0.3), text: .white)
    static let grey = ChipTone(fill: Color(.systemGray5), text: .secondary)
    static let duration = ChipTone(fill: Color(.systemIndigo), text: .white)

    static func of(seconds: Double, cancelled: Bool) -> ChipTone {
        if cancelled { return grey }
        let m = Int(seconds / 60)
        if m <= 3 { return red }
        if m <= 9 { return amber }
        return green
    }
}

/// One line at a stop: badge, destination, the next countdown and the one after.
struct CompactDepartureRow: View {
    var next: Departure
    var following: Departure?

    var body: some View {
        HStack(spacing: 10) {
            LineBadge(line: next.line, colorHex: next.color, mode: next.mode, compact: true)
                .frame(minWidth: 44, alignment: .leading)
            Text(Naming.short(next.dest ?? next.description ?? next.line))
                .font(.subheadline)
                .lineLimit(1)
            Spacer(minLength: 6)
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let t = next.bestTime {
                        Text(Self.long(t, now: ctx.date))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(next.isLive ? Color.liveGreen : Color.primary)
                    }
                    if let t = following?.bestTime {
                        Text(Self.short(t, now: ctx.date))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .monospacedDigit()
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    static func long(_ t: Date, now: Date) -> String {
        let s = t.timeIntervalSince(now)
        if s < 60 { return "Now" }
        let m = Int(s / 60)
        return m < 60 ? "\(m) min" : Clock.time(t)
    }

    static func short(_ t: Date, now: Date) -> String {
        let s = t.timeIntervalSince(now)
        if s < 60 { return "Now" }
        let m = Int(s / 60)
        return m < 60 ? "\(m)" : Clock.time(t)
    }
}

/// "Live 07:55": when Home last loaded, with a green dot.
struct LiveStamp: View {
    var updated: Date?
    var loading: Bool

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(updated == nil ? Color.orange : Color.liveGreen)
                .frame(width: 6, height: 6)
                .opacity(loading ? 0.4 : 1)
                .animation(.easeInOut(duration: 0.4), value: loading)
            Text(updated.map { "Live \(Self.format($0))" } ?? "Loading")
                .monospacedDigit()
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }

    static func format(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = Clock.sydney
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

// MARK: Add a trip

/// From and To, an optional name, then save it to saved trips.
struct AddTripSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var from: StopRef?
    @State private var to: StopRef?
    @State private var name = ""
    @State private var picking: TripPlannerView.PickTarget?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PlaceField(label: "From", place: from) { picking = .from }
                        .accessibilityIdentifier("addFrom")
                    PlaceField(label: "To", place: to) { picking = .to }
                        .accessibilityIdentifier("addTo")
                }
                Section {
                    TextField("Name (optional)", text: $name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                } footer: {
                    Text("Use the same name in WhatsApp, like \"work\".")
                }
            }
            .navigationTitle("Add a trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(from == nil || to == nil || saving)
                }
            }
            .sheet(item: $picking) { target in
                StopPicker(title: target == .from ? "From" : "To") { stop in
                    if target == .from { from = stop } else { to = stop }
                    picking = nil
                }
                .presentationDetents([.large])
                .environment(store)
            }
        }
    }

    private func save() async {
        guard let from, let to else { return }
        saving = true
        let typed = name.trimmingCharacters(in: .whitespaces)
        let route = "\(Naming.compact(Naming.short(from.name))) to \(Naming.compact(Naming.short(to.name)))"
        await store.saveTrip(name: typed.isEmpty ? route : typed, from: from, to: to)
        saving = false
        dismiss()
    }
}

/// Focuses the Search field when Home's search field was tapped.
struct FocusSearchOnRequest: ViewModifier {
    @Environment(AppStore.self) private var store
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
                .searchFocused($focused)
                .onChange(of: store.focusSearch) { _, wanted in
                    guard wanted else { return }
                    store.focusSearch = false
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        focused = true
                    }
                }
        } else {
            content
        }
    }
}

struct SuggestionCard: View {
    var suggestion: CommuteSuggestion
    var from: StopRef
    var to: StopRef
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Make this your \((suggestion.name ?? "morning trip").lowercased())?", systemImage: "sparkles")
                .font(.headline)
            Text("You often go \(Naming.short(from.name)) to \(Naming.short(to.name)) around \(suggestion.todText ?? "this time"). I can tap you when it is time to leave each weekday.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                Button("Yes, set it") {
                    Task { await store.makeCommute(from: from, to: to, tod: suggestion.tod ?? Clock.minuteOfDay(Date()), name: suggestion.name) }
                }
                .buttonStyle(.borderedProminent)
                Button("Not now") {
                    if let k = suggestion.key { Task { try? await store.api.dismissSuggestion(key: k); await store.loadCommutes() } }
                    store.suggestion = nil
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 6)
    }
}
