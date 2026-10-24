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
    @State private var editingTrip: EditTarget?
    @State private var editingCommute: Commute?

    enum PlaceKind: String, Identifiable { case home, work; var id: String { rawValue } }
    struct PlanRoute: Hashable {}

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let live = store.liveTrip {
                    Section {
                        LiveTripBar(record: live, state: store.liveState) { store.openLiveTrip = true }
                    }
                }

                let trips = homeTrips
                if trips.isEmpty && store.starred.isEmpty {
                    welcomeSection
                }

                if store.homePlace == nil || store.workPlace == nil {
                    placesSection
                }

                let serious = seriousAlerts(trips)
                if !serious.isEmpty {
                    Section { alertsBanner(serious) }
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
                        } header: {
                            if i == 0 { Text("Your trips") }
                        }
                    }
                }

                let starredStops = Array(store.starred.prefix(4))
                ForEach(Array(starredStops.enumerated()), id: \.element.id) { i, s in
                    Section {
                        stopCard(s, distance: nil, kind: .starred)
                    } header: {
                        if i == 0 { Text("Starred stops") }
                    }
                }

                if store.config.isOn("nearby") {
                    nearbySection
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(16))
            .navigationTitle("Home")
            .navigationDestination(for: PlanRoute.self) { _ in TripPlannerView() }
            .navigationDestination(for: StopRef.self) { s in StopView(stop: s) }
            .navigationDestination(for: ServiceKey.self) { k in ServiceView(key: k) }
            .navigationDestination(for: TripPair.self) { p in
                TripPlannerView(from: p.from, to: p.to, via: p.via, conn: p.conn ?? 5, legs: p.legs,
                                openAt: p.at.map { Date(timeIntervalSince1970: $0) })
            }
            .navigationDestination(for: TripAlertsKey.self) { k in TripAlertsView(from: k.from, to: k.to) }
            .navigationDestination(for: JourneyLink.self) { l in JourneyDetailView(journey: l.journey, from: l.from, to: l.to, legs: l.legs) }
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
                ToolbarItem(placement: .topBarLeading) {
                    LiveStamp(updated: board.updated, loading: board.loading)
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
            .sheet(item: $editingTrip) { target in
                EditTripSheet(target: target)
                    .environment(store)
            }
            .sheet(item: $editingCommute) { c in
                CommuteEditor(commute: c).environment(store)
            }
            .overlay(alignment: .bottom) { UndoToast() }
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

    /// First launch: what each tab is for and one clear next step. It goes away once a trip
    /// is saved or a stop is starred.
    private var welcomeSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                Text(store.config.text("welcomeTitle", "Live times for the trips you take"))
                    .font(.title3.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                welcomeLine("magnifyingglass", "Plan", "Find a stop or plan a trip from A to B.")
                welcomeLine("star.fill", "Save", "Save a trip or star a stop and it shows here with live times.")
                welcomeLine("bell.badge.fill", "Watch", "Swipe left on a service to get alerts when it runs late.")
                Button {
                    store.tap()
                    store.tab = .plan
                } label: {
                    Text("Plan a trip")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("welcomePlan")
            }
            .padding(.vertical, 8)
        }
        .accessibilityIdentifier("welcome")
    }

    private func welcomeLine(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.tint)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
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
        let upcoming = TripPlan.directFilter(live, extended: t.via != nil, all: store.showsAllServices(t.id) || (t.legs?.count ?? 0) > 2).list
        let shown = Array(upcoming.prefix(3))
        let pos = keys.firstIndex(of: t.orderKey) ?? 0
        let alertCount = Set(shown.flatMap { $0.transitLegs.flatMap { $0.alerts ?? [] } }.map(\.id)).count
        let hex = shown.first?.firstTransit.map { $0.color ?? Mode(raw: $0.mode).fallbackHex }
        // A lift outage usually hits every service on the trip: say it once, not on each row.
        let lifts = Array(Set(shown.compactMap(\.liftOutage))).sorted()

        NavigationLink(value: TripPair(from: t.from, to: t.to, via: t.via, conn: t.via == nil ? nil : t.conn, legs: t.legs)) {
            TripHeader(trip: t, colorHex: hex, alertCount: alertCount, fare: shown.first?.fare)
        }
        // Long press and drag a trip onto another to reorder; the menu does the same one step at a time.
        .draggable(t.orderKey)
        .dropDestination(for: String.self) { items, _ in
            guard let k = items.first, k != t.orderKey else { return false }
            moveTrip(k, to: t.orderKey, keys: keys)
            return true
        }
        .contextMenu {
            tripMenu(t)
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
                Button { editTrip(t) } label: { Label("Edit", systemImage: "pencil") }
                    .tint(.gray)
            case .saved:
                Button(role: .destructive) {
                    Task { await store.deleteSavedTrip(name: t.name ?? "") }
                } label: { Label("Delete", systemImage: "trash") }
                Button { editTrip(t) } label: { Label("Edit", systemImage: "pencil") }
                    .tint(.gray)
            case .recent:
                Button(role: .destructive) {
                    store.forgetTrip(from: t.from, to: t.to)
                } label: { Label("Remove", systemImage: "minus.circle") }
            case .place:
                Button(role: .destructive) {
                    store.homePlace = nil
                    store.workPlace = nil
                } label: { Label("Remove", systemImage: "minus.circle") }
            case .commute:
                Button(role: .destructive) {
                    if let c = commute(for: t) { Task { await store.deleteCommute(c) } }
                } label: { Label("Delete", systemImage: "trash") }
                Button { if let c = commute(for: t) { editingCommute = c } } label: { Label("Edit", systemImage: "pencil") }
                    .tint(.gray)
            }
        }

        ForEach(lifts, id: \.self) { out in
            Label("Lift out: \(out)", systemImage: "figure.roll")
                .font(.footnote)
                .foregroundStyle(.red)
                .lineLimit(2)
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
                               first: i == 0,
                               showLift: false)
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

    enum StopKind { case starred, recent, nearby }

    @ViewBuilder
    private func stopCard(_ s: StopRef, distance: Double?, kind: StopKind = .nearby) -> some View {
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
        .contextMenu {
            switch kind {
            case .starred:
                Button { store.toggleStar(s) } label: { Label("Unstar stop", systemImage: "star.slash") }
            case .recent:
                Button { store.toggleStar(s) } label: { Label("Star stop", systemImage: "star") }
                Button(role: .destructive) { store.forgetStop(s.id) } label: { Label("Remove from Recent", systemImage: "minus.circle") }
            case .nearby:
                Button { store.toggleStar(s) } label: {
                    Label(store.isStarred(s.id) ? "Unstar stop" : "Star stop", systemImage: store.isStarred(s.id) ? "star.slash" : "star")
                }
            }
        }
        .swipeActions(edge: .trailing) {
            switch kind {
            case .starred:
                Button { store.toggleStar(s) } label: { Label("Unstar", systemImage: "star.slash") }
                    .tint(.yellow)
            case .recent:
                Button(role: .destructive) { store.forgetStop(s.id) } label: { Label("Remove", systemImage: "minus.circle") }
            case .nearby:
                EmptyView()
            }
        }

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
            _ = add(HomeTrip(kind: .mine, name: m.name, from: m.from, to: m.to, via: m.via, conn: m.conn ?? 5, legs: m.legs, modes: m.modes))
        }
        // A trip saved from Ask lives on this phone and on the server: show it once.
        let mine = Set(store.myTrips.map { $0.name.lowercased() })
        for s in store.saved where !mine.contains(s.name.lowercased()) {
            _ = add(HomeTrip(kind: .saved, name: s.name, from: s.from, to: s.to))
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

    /// The long press menu on a trip card.
    @ViewBuilder
    private func tripMenu(_ t: HomeTrip) -> some View {
        switch t.kind {
        case .mine, .saved:
            Button { editTrip(t) } label: { Label("Edit trip", systemImage: "pencil") }
            Button(role: .destructive) {
                if t.kind == .mine { store.removeMyTrip(t.id) } else { Task { await store.deleteSavedTrip(name: t.name ?? "") } }
            } label: { Label("Delete trip", systemImage: "trash") }
        case .place:
            Button { pickingPlace = .home } label: { Label("Change home", systemImage: "house") }
            Button { pickingPlace = .work } label: { Label("Change work", systemImage: "briefcase") }
            Button(role: .destructive) {
                store.homePlace = nil
                store.workPlace = nil
            } label: { Label("Remove home and work", systemImage: "minus.circle") }
        case .commute:
            if let c = commute(for: t) {
                Button { editingCommute = c } label: { Label("Edit reminder", systemImage: "pencil") }
                Button(role: .destructive) { Task { await store.deleteCommute(c) } } label: { Label("Delete reminder", systemImage: "trash") }
            }
        case .recent:
            Button(role: .destructive) { store.forgetTrip(from: t.from, to: t.to) } label: { Label("Remove from Recent", systemImage: "minus.circle") }
        }
    }

    private func editTrip(_ t: HomeTrip) {
        if t.kind == .mine, let m = store.myTrips.first(where: { $0.id == t.id }) {
            editingTrip = EditTarget(mine: m, saved: nil)
        } else if t.kind == .saved, let s = store.saved.first(where: { $0.name == t.name }) {
            editingTrip = EditTarget(mine: nil, saved: s)
        }
    }

    private func commute(for t: HomeTrip) -> Commute? {
        store.commutes.first { $0.from.id == t.from.id && $0.to.id == t.to.id }
    }

    private var stopIDs: [String] {
        Array(store.starred.prefix(4)).map(\.id) + board.nearby.map(\.stop.id)
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
        case .trip(let from, let to, let at):
            path.append(TripPair(from: from, to: to, at: at?.timeIntervalSince1970))
        case .alerts(let from, let to):
            path.append(TripAlertsKey(from: from, to: to))
        case .legs(let legs):
            if let first = legs.first, let last = legs.last {
                path.append(TripPair(from: first.from, to: last.to, via: legs.count == 2 ? first.to : nil,
                                     conn: legs.count == 2 ? (legs[1].conn ?? 5) : nil, legs: legs.count > 2 ? legs : nil))
            }
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
    /// Set for a trip of 3 or more legs.
    var legs: [TripLeg]? = nil
    /// Set by a widget row: open the service leaving at this time (seconds since 1970).
    var at: Double? = nil
}

/// The alerts for a trip, opened from the alert line on a widget.
struct TripAlertsKey: Hashable {
    var from: StopRef
    var to: StopRef
}

struct JourneyLink: Hashable {
    var journey: Journey
    var from: StopRef
    var to: StopRef
    var legs: [TripLeg]? = nil
}

struct HomeTrip: Identifiable, Hashable {
    enum Kind: Hashable { case place, commute, saved, mine, recent }
    var kind: Kind
    var name: String?
    var from: StopRef
    var to: StopRef
    var via: StopRef? = nil
    var conn: Int = 5
    var legs: [TripLeg]? = nil
    var modes: [String]? = nil

    var id: String { legs.map { TripLeg.key($0) } ?? TripKey.of(from: from, via: via, to: to) }
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
        let tripJobs = trips.map { t in
            (key: t.id, from: t.from.id, to: t.to.id, via: t.via?.id, conn: t.conn,
             legs: TripPlan.legs(from: t.from, via: t.via, to: t.to, conn: t.conn, legs: t.legs, modes: t.modes))
        }
        let stopJobs = Array(Set(stops))
        let now = Date()
        await withTaskGroup(of: HomeFetch.self) { group in
            for job in tripJobs {
                group.addTask {
                    let r = try? await TripPlan.plan(api: api, from: job.from, via: job.via, to: job.to, conn: job.conn, count: 5, legs: job.legs)
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
    var fare: Fare? = nil

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
                if let legs = trip.legs, legs.count > 2 {
                    Label("\(legs.count) legs via \(legs.dropLast().map { Naming.compact(Naming.short($0.to.name)) }.joined(separator: ", "))", systemImage: "arrow.triangle.swap")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("tripVia")
                } else if let via = trip.via {
                    Label("Change at \(Naming.compact(Naming.short(via.name))), \(trip.conn) min", systemImage: "arrow.triangle.swap")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("tripVia")
                }
                if let total = fare?.total {
                    HStack(spacing: 6) {
                        FareChip(total: total)
                        if let nudge = fare?.offPeakText {
                            Text(nudge).font(.caption).foregroundStyle(.green).lineLimit(1)
                        }
                    }
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
    /// Off where the list says the lift outage once above the services.
    var showLift = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            mainRow
            if let w = journey.warn, !w.isEmpty {
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(journey.risk == "tight" ? Color.orange : Color.red)
                    .accessibilityIdentifier("tripWarn")
            }
            if showLift, let out = journey.liftOutage {
                Label("Lift out: \(out)", systemImage: "figure.roll")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
        .opacity(dimmed ? 0.45 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var mainRow: some View {
        let f = journey.firstTransit
        let cancelled = status.tone == .bad
        let leave = journey.leave ?? f?.departTime
        return HStack(spacing: 12) {
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
                if let total = journey.fare?.total {
                    FareChip(total: total)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 2)
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
