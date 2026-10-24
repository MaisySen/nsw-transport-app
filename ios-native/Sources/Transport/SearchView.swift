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

struct SearchView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var results: [StopRef] = []
    @State private var searching = false
    @State private var location = LocationFinder()
    @State private var nearby: [StopRef] = []

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Section {
                        NavigationLink {
                            TripPlannerView()
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Plan a trip").font(.body.weight(.semibold))
                                    Text("A to B with live leave in times").font(.footnote).foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill").foregroundStyle(.tint)
                            }
                        }
                        .accessibilityIdentifier("planTrip")
                    }
                    Section {
                        if nearby.isEmpty {
                            Button {
                                location.request()
                            } label: {
                                Label("Show stops near me", systemImage: "location.fill")
                            }
                        } else {
                            ForEach(nearby.prefix(6)) { s in
                                NavigationLink(value: s) { StopRow(stop: s) }
                            }
                        }
                    } header: { Text("Nearby") }
                    Section {
                        NavigationLink { ParkRideListView() } label: {
                            Label("Park and Ride spaces", systemImage: "car.fill")
                        }
                        .accessibilityIdentifier("parkRideList")
                        NavigationLink { OpalMachinesView() } label: {
                            Label("Opal top up machines", systemImage: "creditcard.fill")
                        }
                        .accessibilityIdentifier("opalMachines")
                    }
                    if !store.recents.isEmpty {
                        Section {
                            ForEach(store.recents) { s in
                                NavigationLink(value: s) { StopRow(stop: s) }
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) { store.forgetStop(s.id) } label: {
                                            Label("Remove", systemImage: "minus.circle")
                                        }
                                    }
                            }
                        } header: {
                            HStack {
                                Text("Recent")
                                Spacer()
                                Button("Clear") { store.clearRecentStops() }
                                    .font(.subheadline)
                                    .textCase(nil)
                                    .accessibilityLabel("Clear recent stops")
                            }
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
            .navigationTitle("Search")
            .navigationDestination(for: StopRef.self) { s in StopView(stop: s) }
            .overlay(alignment: .bottom) { UndoToast() }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Station, stop or stop number")
            .modifier(FocusSearchOnRequest())
            .autocorrectionDisabled()
            .task(id: query) { await search() }
            .onChange(of: location.coordinate?.latitude) { _, _ in
                Task { await loadNearby() }
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

    private func loadNearby() async {
        guard let c = location.coordinate else { return }
        if let r = try? await store.api.nearby(lat: c.latitude, lon: c.longitude) {
            withAnimation { nearby = r }
        }
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
