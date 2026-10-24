import SwiftUI
import MapKit
import CoreLocation
import TransportKit

// MARK: Opal fare estimates

/// A small grey chip with the fare estimate, after the trip length.
struct FareChip: View {
    var total: Double

    var body: some View {
        Text(Money.text(total))
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color(.tertiarySystemFill)))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .fixedSize()
            .accessibilityLabel("Opal fare estimate \(Money.text(total))")
    }
}

/// "Opal fare estimate" card on the trip details, one row per leg.
struct FareCard: View {
    var fare: Fare

    var body: some View {
        Section {
            HStack {
                Label(fare.typeName ?? FareType.current.title, systemImage: "creditcard.fill")
                Spacer()
                Text(fare.total.map(Money.text) ?? "Not known")
                    .font(.title3.weight(.bold))
                    .monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("fareTotal")
            ForEach(Array((fare.legs ?? []).enumerated()), id: \.offset) { _, l in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(legTitle(l)).font(.subheadline.weight(.semibold))
                        Text(legDetail(l)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(legAmount(l))
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(l.amount == nil || l.joined == true ? Color.secondary : Color.primary)
                }
                .accessibilityElement(children: .combine)
            }
            if let t = fare.transfer, t > 0 {
                LabeledContent("Transfer discount", value: "-\(Money.text(t))")
                    .font(.subheadline)
            }
            if let a = fare.airportFee, a > 0 {
                LabeledContent("Airport station access fee", value: Money.text(a))
                    .font(.subheadline)
            }
            if fare.capped == true {
                Label("Daily cap reached", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            }
            if let nudge = fare.offPeakText {
                Label(nudge, systemImage: "leaf.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                    .accessibilityIdentifier("offPeakNudge")
            }
        } header: {
            Text("Opal fare estimate")
        } footer: {
            Text("\(fare.peak == true ? "Peak fare" : "Off peak fare"). An estimate from the Opal fare tables, not your card's charge. Change the fare type in Settings.")
        }
    }

    private func legTitle(_ l: FareLeg) -> String {
        let mode = Mode(raw: l.mode).title
        if let line = l.line, !line.isEmpty { return "\(line) \(mode.lowercased())" }
        return mode
    }

    private func legDetail(_ l: FareLeg) -> String {
        if l.joined == true { return "Same journey, no extra fare" }
        var parts: [String] = []
        if let km = l.km { parts.append(String(format: "%.1f km", km)) }
        parts.append(l.peak == true ? "Peak" : "Off peak")
        return parts.joined(separator: ", ")
    }

    private func legAmount(_ l: FareLeg) -> String {
        if l.joined == true { return "Included" }
        guard let a = l.amount else { return "Not an Opal fare" }
        return Money.text(a)
    }
}

/// The bar at the top of a trip: the peak nudge, or the fare of the next journey.
struct FareBar: View {
    var fare: Fare

    var body: some View {
        HStack(spacing: 8) {
            if let nudge = fare.offPeakText {
                Text("Peak")
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.orange.opacity(0.2)))
                    .foregroundStyle(.orange)
                Text(nudge).font(.subheadline)
            } else {
                Image(systemName: "creditcard.fill").foregroundStyle(.secondary)
                Text("Opal fare estimate \(fare.total.map(Money.text) ?? "") \(fare.summary)")
                    .font(.subheadline)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("fareBar")
    }
}

/// Stop boards in peak: off peak is 30 percent off train, metro, bus and light rail fares.
struct PeakNudge: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Peak")
                .font(.caption.weight(.bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.orange.opacity(0.2)))
                .foregroundStyle(.orange)
            Text("Off peak from \(Peak.offPeakFrom()): 30 percent off train, metro, bus and light rail fares")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("peakNudge")
    }
}

extension Journey {
    /// The first lift outage at a station where you board or get off.
    var liftOutage: String? {
        for l in transitLegs {
            if let o = l.access?.from?.outage, !o.isEmpty { return o }
            if let o = l.access?.to?.outage, !o.isEmpty { return o }
        }
        return nil
    }
}

/// Two small capsules on a leg: step free or lift out where you board and get off.
struct LegAccessChips: View {
    var leg: Leg

    var body: some View {
        let items: [(String, AccessPoint)] = [(leg.from ?? "", leg.access?.from), (leg.to ?? "", leg.access?.to)]
            .compactMap { p in p.1.map { (p.0, $0) } }
        if !items.isEmpty {
            HStack(spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    let out = (it.1.outage ?? "").isEmpty == false
                    let name = Naming.compact(Naming.short(it.0))
                    Label(out ? "\(name): lift out" : "\(name): \(AccessText.chip(it.1.level))", systemImage: "figure.roll")
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(chipColor(it.1).opacity(0.15)))
                        .foregroundStyle(chipColor(it.1))
                }
            }
        }
    }

    private func chipColor(_ a: AccessPoint) -> Color {
        if (a.outage ?? "").isEmpty == false { return .red }
        switch a.level {
        case "independent": return .green
        case "assisted": return .orange
        default: return .secondary
        }
    }
}

// MARK: Park and Ride

struct CarParkRow: View {
    var park: CarPark
    var station: String?
    var onWatch: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "car.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Color.blue, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(station == nil ? (park.name ?? "Car park") : park.shortName(station: station))
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                    Text(park.badge)
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(tint.opacity(0.18)))
                        .foregroundStyle(tint)
                }
                Text(countLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                ProgressView(value: park.stale == true ? 0 : park.freeShare)
                    .tint(tint)
            }
            if let onWatch {
                Button(action: onWatch) {
                    Image(systemName: "bell.badge")
                        .font(.body)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Alert me if \(park.shortName(station: station)) gets nearly full")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("carPark")
    }

    private var tint: Color {
        if park.stale == true { return .gray }
        switch park.status {
        case "ok": return .green
        case "nearly": return .orange
        case "full": return .red
        default: return .gray
        }
    }

    private var countLine: String {
        guard park.stale != true, let free = park.free, let spots = park.spots else { return "No live count" }
        let time = park.updatedDate.map { " · \(Clock.time($0))" } ?? ""
        return "\(free) of \(spots) free\(time)"
    }
}

// MARK: Station access and facilities

/// Below a stop's departures: Park and Ride live spaces, access, lifts and the Opal machine.
/// Station sections for a stop screen. The stop screen loads `info` (an empty view never runs a task).
struct StationSections: View {
    var info: StationInfo?
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if let info {
                if let parks = info.parking, !parks.isEmpty {
                    Section {
                        ForEach(parks) { p in
                            CarParkRow(park: p, station: info.name) {
                                Task { await watch(p) }
                            }
                        }
                    } header: {
                        Text("Park and Ride")
                    } footer: {
                        Text("Live spaces from the Transport for NSW Car Park API, live.")
                    }
                }
                Section {
                    if let a = info.access {
                        Label {
                            Text(AccessText.level(a.level))
                        } icon: {
                            Image(systemName: "figure.roll").foregroundStyle(accessColor(a.level))
                        }
                        .accessibilityIdentifier("stationAccess")
                    }
                    let outages = info.outages ?? []
                    if outages.isEmpty {
                        if info.access?.lift == true {
                            Label("Lifts working", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    } else {
                        ForEach(outages, id: \.identity) { o in
                            outageRow(o, station: info.name)
                        }
                    }
                    if let t = info.ticket {
                        Label(TicketText.machine(t.kind), systemImage: "creditcard.fill")
                    }
                    if info.shortPlatform == true {
                        Label("Short platform", systemImage: "exclamationmark.circle")
                    }
                    if let f = info.facilities, !f.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(f, id: \.self) { name in
                                Text(name)
                                    .font(.caption)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Capsule().fill(Color(.tertiarySystemFill)))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Access and facilities")
                } footer: {
                    Text("Facilities from Transport for NSW open data (station facilities)\(info.read.map { ", read \($0)" } ?? ""). Lift status from Transport for NSW service alerts, live.")
                }
            }
        }
    }

    private func outageTitle(_ o: LiftOutage, station: String?) -> String {
        let st = Naming.short(station ?? "")
        let title = o.title ?? "Lift out of service"
        guard !st.isEmpty, title.hasPrefix(st) else { return title }
        return title.dropFirst(st.count).trimmingCharacters(in: .whitespaces)
    }

    @ViewBuilder
    private func outageRow(_ o: LiftOutage, station: String?) -> some View {
        let title = outageTitle(o, station: station)
        let label = Label {
            VStack(alignment: .leading, spacing: 2) {
                Text("Lift out of service").font(.subheadline.weight(.semibold))
                Text(title).font(.footnote).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
        if let s = o.url, s.hasPrefix("https://"), let u = URL(string: s) {
            Link(destination: u) { label }
        } else {
            label
        }
    }

    private func accessColor(_ l: String?) -> Color {
        switch l {
        case "independent": return .green
        case "assisted": return .orange
        default: return .secondary
        }
    }

    private func watch(_ p: CarPark) async {
        await Notifier.requestPermission()
        do {
            try await store.api.watchParking(facility: p.id.value, device: store.device)
            store.show(Banner(title: "Alert set", detail: "You get a notification if \(p.shortName(station: info?.name)) gets nearly full in the next 3 hours.", symbol: "bell.badge.fill"))
            store.success()
        } catch {
            store.show(Banner(title: "Could not set the alert", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }
}

/// Every Park and Ride car park, closest first when your location is known.
struct ParkRideListView: View {
    @Environment(AppStore.self) private var store
    @State private var parks: [CarPark] = []
    @State private var loading = true
    @State private var location = LocationFinder()

    var body: some View {
        List {
            if loading && parks.isEmpty {
                ForEach(0..<6, id: \.self) { _ in
                    HStack { Text("Tallawong P1 car park").redacted(reason: .placeholder); Spacer() }
                }
            }
            Section {
                ForEach(sorted) { p in
                    CarParkRow(park: p, station: nil)
                }
            } footer: {
                if !parks.isEmpty { Text("Live spaces from the Transport for NSW Car Park API, live.") }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Park and Ride")
        .refreshable { await load() }
        .task {
            location.request()
            await load()
        }
    }

    private var sorted: [CarPark] {
        guard let c = location.coordinate else { return parks }
        let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
        return parks.sorted { a, b in
            let da = a.lat.flatMap { la in a.lon.map { CLLocation(latitude: la, longitude: $0).distance(from: me) } } ?? .greatestFiniteMagnitude
            let db = b.lat.flatMap { lb in b.lon.map { CLLocation(latitude: lb, longitude: $0).distance(from: me) } } ?? .greatestFiniteMagnitude
            return da < db
        }
    }

    private func load() async {
        loading = true
        if let p = try? await store.api.parking() { parks = p }
        loading = false
    }
}

/// Stations with an Opal top up or ticket machine, on a map and in a list, closest first.
struct OpalMachinesView: View {
    @Environment(AppStore.self) private var store
    @State private var items: [TopupPlace] = []
    @State private var cashOnly = false
    @State private var location = LocationFinder()
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: -33.8688, longitude: 151.2093),
        span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)))

    var body: some View {
        List {
            Section {
                Map(position: $camera) {
                    UserAnnotation()
                    ForEach(pins) { p in
                        Annotation(Naming.compact(Naming.short(p.name)), coordinate: CLLocationCoordinate2D(latitude: p.lat ?? 0, longitude: p.lon ?? 0)) {
                            Image(systemName: "creditcard.fill")
                                .font(.caption)
                                .foregroundStyle(.white)
                                .padding(5)
                                .background(Circle().fill(p.cash == true ? Color.green : Color.blue))
                        }
                    }
                }
                .frame(height: 240)
                .listRowInsets(EdgeInsets())
                Picker("Machines", selection: $cashOnly) {
                    Text("All machines").tag(false)
                    Text("Takes cash").tag(true)
                }
                .pickerStyle(.segmented)
            }
            Section {
                ForEach(shown) { p in
                    NavigationLink {
                        StopView(stop: StopRef(id: p.id, name: p.name))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(Naming.short(p.name)).font(.body.weight(.semibold))
                                Spacer()
                                if let d = p.distance {
                                    Text(d < 1000 ? "\(Int(d)) m" : String(format: "%.1f km", d / 1000))
                                        .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                                }
                            }
                            Text(TicketText.machine(p.kind)).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("opalMachine")
                }
            } footer: {
                Text("Opal retailers are not in the open data. You can also top up in the Opal Travel app.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Opal machines")
        .task {
            location.request()
            await load()
        }
        .onChange(of: location.coordinate?.latitude) { _, _ in
            Task { await load() }
        }
    }

    private var shown: [TopupPlace] { cashOnly ? items.filter { $0.cash == true } : items }
    private var pins: [TopupPlace] { shown.filter { $0.lat != nil && $0.lon != nil } }

    private func load() async {
        let c = location.coordinate
        let lat = c?.latitude ?? -33.8832
        let lon = c?.longitude ?? 151.2070
        if let r = try? await store.api.topup(lat: lat, lon: lon, limit: 25) {
            items = r
            if let c {
                camera = .region(MKCoordinateRegion(center: c, span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)))
            }
        }
    }
}
