import SwiftUI
import CoreLocation
import TransportKit

struct StopRow: View {
    var stop: StopRef

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Color(hex: tint), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(Naming.short(stop.name)).font(.body)
                Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
        }
        .contentShape(Rectangle())
    }

    private var modes: [Int] { stop.modes ?? [] }
    // Trip Planner mode numbers: 1 train, 2 metro, 4 light rail, 5 bus, 7 coach, 9 ferry, 11 school bus.
    private var icon: String {
        if modes.contains(1) { return Mode.train.symbol }
        if modes.contains(2) { return Mode.metro.symbol }
        if modes.contains(4) { return Mode.lightrail.symbol }
        if modes.contains(9) { return Mode.ferry.symbol }
        return Mode.bus.symbol
    }
    private var tint: String {
        if modes.contains(1) { return Mode.train.fallbackHex }
        if modes.contains(2) { return Mode.metro.fallbackHex }
        if modes.contains(4) { return Mode.lightrail.fallbackHex }
        if modes.contains(9) { return Mode.ferry.fallbackHex }
        return Mode.bus.fallbackHex
    }
    private var subtitle: String {
        var parts: [String] = []
        let title = Naming.short(stop.name)
        // Drop the suburb when the title already says it: "Platform 5, Burwood" under "Burwood Station".
        let rest = stop.name.split(separator: ",").dropFirst()
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !title.localizedCaseInsensitiveContains($0) }
        if !rest.isEmpty { parts.append(rest.joined(separator: ", ")) }
        if let d = stop.distance {
            parts.append(d < 1000 ? "\(Int(d)) m" : String(format: "%.1f km", d / 1000))
        } else if Int(stop.id) != nil && stop.id.count <= 8 {
            parts.append("Stop \(stop.id)")
        }
        return parts.joined(separator: " \u{00B7} ")
    }
}

/// The Plan tab: the one place to search. Find a stop by name or number, or plan a trip from
/// A to B. Recent trips and stops sit under the search, each list clearable.
struct SearchView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var results: [StopRef] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Section {
                        NavigationLink(value: HomeView.PlanRoute()) {
                            HStack(spacing: 14) {
                                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                                    .font(.title2)
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Plan a trip").font(.body.weight(.semibold))
                                    Text("Choose where from and where to").font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                        .accessibilityIdentifier("planTrip")
                    }

                    let trips = recentTripRows
                    if !trips.isEmpty {
                        Section {
                            ForEach(trips, id: \.self) { r in recentTripRow(r) }
                        } header: {
                            groupHeader("Recent trips", id: "clearRecentTrips") { store.clearRecentTrips() }
                        }
                    }

                    let stops = Array(store.recents.prefix(6))
                    if !stops.isEmpty {
                        Section {
                            ForEach(stops) { s in
                                NavigationLink(value: s) { StopRow(stop: s) }
                                    .accessibilityIdentifier("recentStop")
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) { store.forgetStop(s.id) } label: {
                                            Label("Remove", systemImage: "minus.circle")
                                        }
                                    }
                            }
                        } header: {
                            groupHeader("Recent stops", id: "clearRecentStops") { store.clearRecentStops() }
                        } footer: {
                            Text("Kept only on this phone. Swipe left to remove one.")
                        }
                    }
                } else {
                    if searching && results.isEmpty {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                    ForEach(results) { s in
                        NavigationLink(value: s) { StopRow(stop: s) }
                            .accessibilityIdentifier("stopResult")
                            .swipeActions(edge: .leading) {
                                Button { store.toggleStar(s) } label: { Label("Star", systemImage: "star.fill") }
                                    .tint(.yellow)
                            }
                    }
                    if !searching && results.isEmpty && query.count >= 2 {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(16))
            .navigationTitle("Plan")
            .navigationDestination(for: StopRef.self) { s in StopView(stop: s) }
            .navigationDestination(for: HomeView.PlanRoute.self) { _ in TripPlannerView() }
            .navigationDestination(for: JourneyLink.self) { l in JourneyDetailView(journey: l.journey, from: l.from, to: l.to, legs: l.legs) }
            .navigationDestination(for: ServiceKey.self) { k in ServiceView(key: k) }
            .navigationDestination(for: TripPair.self) { p in TripPlannerView(from: p.from, to: p.to, via: p.via, conn: p.conn ?? 5, legs: p.legs) }
            .overlay(alignment: .bottom) { UndoToast() }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a stop, station or stop number")
            .modifier(FocusSearchOnRequest())
            .autocorrectionDisabled()
            .task(id: query) { await search() }
        }
    }

    /// Up to 5 trips you looked at, each once.
    private var recentTripRows: [TripPair] {
        var out: [TripPair] = []
        for r in store.recentTrips where r.from.id != r.to.id {
            if !out.contains(where: { $0.from.id == r.from.id && $0.to.id == r.to.id }) { out.append(r) }
            if out.count == 5 { break }
        }
        return out
    }

    /// A group header with Clear on the right.
    private func groupHeader(_ title: String, id: String, clear: @escaping () -> Void) -> some View {
        HStack {
            Text(title)
            Spacer()
            Button("Clear") { clear() }
                .font(.subheadline)
                .textCase(nil)
                .accessibilityIdentifier(id)
                .accessibilityLabel("Clear \(title.lowercased())")
        }
    }

    private func recentTripRow(_ r: TripPair) -> some View {
        NavigationLink(value: TripPair(from: r.from, to: r.to)) {
            Label {
                Text("\(Naming.compact(Naming.short(r.from.name))) to \(Naming.compact(Naming.short(r.to.name)))")
                    .lineLimit(1)
            } icon: {
                Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("recentTrip")
        .contextMenu {
            Button {
                store.saveMyTrip(MyTrip(name: "\(Naming.compact(Naming.short(r.from.name))) to \(Naming.compact(Naming.short(r.to.name)))",
                                        from: r.from, to: r.to, via: nil, conn: nil, modes: nil))
            } label: { Label("Save trip", systemImage: "star") }
            Button(role: .destructive) { store.forgetTrip(from: r.from, to: r.to) } label: {
                Label("Remove from recent", systemImage: "minus.circle")
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { store.forgetTrip(from: r.from, to: r.to) } label: {
                Label("Remove", systemImage: "minus.circle")
            }
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        searching = true
        defer { searching = false }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        var r = (try? await store.api.search(q)) ?? []
        // A bare stop number goes straight to that stop even before search knows it.
        if Int(q) != nil && q.count >= 5 && !r.contains(where: { $0.id == q }) {
            r.insert(StopRef(id: q, name: "Stop \(q)"), at: 0)
        }
        results = r
    }
}

/// One shot location for "near me". Only asks when the person taps the button.
@Observable
final class LocationFinder: NSObject, CLLocationManagerDelegate {
    var coordinate: CLLocationCoordinate2D?
    @ObservationIgnored private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
