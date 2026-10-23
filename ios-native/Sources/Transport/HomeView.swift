import SwiftUI
import TransportKit

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let s = store.suggestion, let from = s.from, let to = s.to {
                    Section {
                        SuggestionCard(suggestion: s, from: from, to: to)
                    }
                }

                if !store.commutes.isEmpty {
                    Section("Your commute") {
                        ForEach(store.commutes.filter { $0.active != false }) { c in
                            NavigationLink {
                                TripPlannerView(from: c.from, to: c.to)
                            } label: {
                                LiveTripCard(title: c.name ?? "Commute", from: c.from, to: c.to, subtitle: "Weekdays around \(c.todText ?? Clock.todText(c.tod))")
                            }
                        }
                    }
                }

                if !store.saved.isEmpty {
                    Section("Saved trips") {
                        ForEach(store.saved) { t in
                            NavigationLink {
                                TripPlannerView(from: t.from, to: t.to)
                            } label: {
                                LiveTripCard(title: t.name.capitalizedFirst, from: t.from, to: t.to, subtitle: nil)
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { try? await store.api.deleteSaved(name: t.name); await store.loadSaved() }
                                } label: { Label("Delete", systemImage: "trash") }
                            }
                        }
                    }
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

                if !store.starred.isEmpty {
                    ForEach(store.starred) { s in
                        Section {
                            StarredStopCard(stop: s) { key in path.append(key) }
                        } header: {
                            HStack {
                                Label(Naming.short(s.name), systemImage: "star.fill")
                                Spacer()
                                Button("All") { path.append(s) }
                                    .font(.footnote.weight(.semibold))
                                    .textCase(nil)
                            }
                        }
                    }
                }

                if store.starred.isEmpty && store.saved.isEmpty && store.commutes.isEmpty && active.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("Your trips live here", systemImage: "tram.fill")
                        } description: {
                            Text("Star a stop, save a trip or watch a service and it shows up here with live times.")
                        } actions: {
                            Button("Find a stop") { store.tab = .search }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Home")
            .navigationDestination(for: StopRef.self) { s in StopView(stop: s) }
            .navigationDestination(for: ServiceKey.self) { k in ServiceView(key: k) }
            .refreshable {
                await store.loadSaved()
                await store.loadCommutes()
                await store.loadWatches(notify: false)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { TripPlannerView() } label: {
                        Image(systemName: "arrow.triangle.turn.up.right.diamond")
                    }
                    .accessibilityLabel("Plan a trip")
                }
            }
            .navigationDestination(for: TripPair.self) { p in TripPlannerView(from: p.from, to: p.to) }
            .onChange(of: store.pendingRoute) { _, route in follow(route) }
            .onAppear { follow(store.pendingRoute) }
            .appHaptics()
        }
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

struct TripPair: Hashable {
    var from: StopRef
    var to: StopRef
}

/// A saved trip or commute that shows its next live departure and keeps itself fresh.
struct LiveTripCard: View {
    var title: String
    var from: StopRef
    var to: StopRef
    var subtitle: String?
    @Environment(AppStore.self) private var store
    @State private var next: Journey?
    @State private var loaded = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text("\(Naming.short(from.name)) to \(Naming.short(to.name))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let j = next {
                    HStack(spacing: 6) {
                        LegChain(legs: j.legs)
                        if let f = j.firstTransit {
                            StatusText(delayMin: f.delayMin, isLive: f.isLive, cancelled: f.cancelled == true)
                                .font(.footnote)
                        }
                    }
                } else if loaded {
                    Text("No trips right now").font(.footnote).foregroundStyle(.secondary)
                }
                if let subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            if let l = next?.leave {
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Leave").font(.caption2).foregroundStyle(.secondary)
                    CountdownLabel(to: l, cancelled: next?.anyCancelled == true, isLive: next?.live == true)
                    LiveBadge(isLive: next?.live == true)
                }
            } else if !loaded {
                ProgressView()
            }
        }
        .padding(.vertical, 4)
        .autoRefresh(every: max(store.refreshSeconds, 20), active: store.isActive) { await load() }
    }

    private func load() async {
        if let r = try? await store.api.trip(from: from.id, to: to.id, count: 3) {
            let upcoming = r.journeys.first { ($0.leave ?? .distantPast) > Date().addingTimeInterval(-30) }
            withAnimation(.snappy) { next = upcoming ?? r.journeys.first }
        }
        loaded = true
    }
}

/// The next three departures from a starred stop, live.
struct StarredStopCard: View {
    var stop: StopRef
    var onSelect: (ServiceKey) -> Void
    @Environment(AppStore.self) private var store
    @State private var items: [Departure] = []
    @State private var loaded = false

    var body: some View {
        Group {
            if items.isEmpty {
                HStack {
                    Text(loaded ? "No services soon" : "Loading live times")
                        .foregroundStyle(.secondary)
                    Spacer()
                    if !loaded { ProgressView() }
                }
            } else {
                ForEach(items.prefix(3)) { d in
                    Button { onSelect(ServiceKey(d)) } label: { DepartureRow(d: d) }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button {
                                Task { await store.watch(d.watchRequest(device: store.device, profile: store.api.profile)) }
                            } label: { Label("Watch", systemImage: "bell.fill") }
                            .tint(.indigo)
                        }
                        .swipeActions(edge: .leading) {
                            Button { store.toggleStar(stop) } label: { Label("Unstar", systemImage: "star.slash") }
                                .tint(.yellow)
                        }
                }
            }
        }
        .autoRefresh(every: max(store.refreshSeconds, 20), active: store.isActive) { await load() }
    }

    private func load() async {
        if let r = try? await store.api.departures(stop: stop.id, device: store.device) {
            withAnimation(.snappy) { items = r.items.filter { ($0.bestTime ?? .distantPast) > Date().addingTimeInterval(-60) } }
        }
        loaded = true
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
