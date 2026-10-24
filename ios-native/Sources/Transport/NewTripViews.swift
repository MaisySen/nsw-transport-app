import SwiftUI
import MapKit
import CoreLocation
import TransportKit

// MARK: Trips you make with New trip

/// A trip made with New trip. With `via` it is two legs: from to via, then via to to,
/// with at least `conn` minutes to change.
struct MyTrip: Codable, Hashable, Identifiable {
    var name: String
    var from: StopRef
    var to: StopRef
    var via: StopRef?
    var conn: Int?
    var modes: [String]?

    var id: String { TripKey.of(from: from, via: via, to: to) }
}

/// The key a trip is stored under: "from>to", or "from>via>to" for an extended trip.
enum TripKey {
    static func of(from: StopRef, via: StopRef?, to: StopRef) -> String {
        "\(from.id)>\(via.map { $0.id + ">" } ?? "")\(to.id)"
    }
}

/// Plans extended trips and picks the direct services.
enum TripPlan {
    /// Stops at both ends: one service, or two for an extended trip (the change at the via stop).
    static func isDirect(_ j: Journey, extended: Bool) -> Bool {
        let n = j.transitLegs.count
        return n >= 1 && n <= (extended ? 2 : 1)
    }

    /// Direct services by default. When none are direct, all of them, and `fellBack` says so.
    static func directFilter(_ list: [Journey], extended: Bool, all: Bool) -> (list: [Journey], fellBack: Bool) {
        if all { return (list, false) }
        let d = list.filter { isDirect($0, extended: extended) }
        if d.isEmpty && !list.isEmpty { return (list, true) }
        return (d, false)
    }

    static func arrival(_ j: Journey) -> Date? { j.transitLegs.last?.arriveTime ?? j.arrive }
    static func departure(_ j: Journey) -> Date? { j.firstTransit?.departTime ?? j.leave }

    /// When you have to leave: the first service less any walk before it.
    static func leaveTime(_ j: Journey) -> Date? {
        guard let dep = departure(j) else { return nil }
        var walk = 0
        for l in j.legs {
            if !l.isWalk { break }
            walk += l.durationMin ?? 0
        }
        return dep.addingTimeInterval(TimeInterval(-walk * 60))
    }

    static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HHmm"
        f.timeZone = Clock.sydney
        f.locale = Locale(identifier: "en_AU_POSIX")
        return f.string(from: d)
    }

    /// A plain trip is one request. An extended trip pairs each first leg with the first
    /// second leg that leaves at least `conn` minutes after it arrives.
    static func plan(api: TransportAPI, from: String, via: String?, to: String, conn: Int,
                     count: Int = 5, time: String? = nil) async throws -> TripResponse {
        guard let via, !via.isEmpty else {
            return try await api.trip(from: from, to: to, count: count, time: time)
        }
        let gap = TimeInterval(max(0, conn) * 60)
        var first = try await api.trip(from: from, to: via, count: count, time: time)
        let legs1 = first.journeys.filter { isDirect($0, extended: false) }
        guard let firstArrival = legs1.compactMap(arrival).min() else {
            first.journeys = []
            return first
        }
        let second = try await api.trip(from: via, to: to, count: 8, time: hhmm(firstArrival.addingTimeInterval(gap)))
        let legs2 = second.journeys
            .filter { isDirect($0, extended: false) }
            .compactMap { j -> (journey: Journey, leave: Date)? in
                guard let l = leaveTime(j) else { return nil }
                return (j, l)
            }
            .sorted { $0.leave < $1.leave }
        var out: [Journey] = []
        for a in legs1 {
            guard let arr = arrival(a),
                  let b = legs2.first(where: { $0.leave >= arr.addingTimeInterval(gap) }) else { continue }
            var j = a
            j.legs = a.legs + b.journey.legs
            j.arrive = b.journey.arrive ?? arrival(b.journey)
            j.changes = (a.changes ?? 0) + (b.journey.changes ?? 0) + 1
            if let start = a.leave ?? a.board, let end = j.arrive {
                j.durationMin = Int(end.timeIntervalSince(start) / 60)
            }
            j.anyCancelled = (a.anyCancelled == true || b.journey.anyCancelled == true)
            out.append(j)
        }
        first.to = second.to ?? first.to
        first.journeys = out
        return first
    }
}

// MARK: Station lists

/// One station or stop from /api/stations: [id, name, lat, lon].
struct Station: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var lat: Double
    var lon: Double

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        if let s = try? c.decode(String.self) {
            id = s
        } else {
            id = String(try c.decode(Int.self))
        }
        name = try c.decode(String.self)
        lat = (try? c.decode(Double.self)) ?? 0
        lon = (try? c.decode(Double.self)) ?? 0
    }

    /// "Burwood Station" reads "Burwood" in the lists.
    var short: String {
        name.replacingOccurrences(of: " (Station|Light Rail|Wharf)$", with: "", options: [.regularExpression, .caseInsensitive])
    }
    var ref: StopRef { StopRef(id: id, name: name) }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    var location: CLLocation { CLLocation(latitude: lat, longitude: lon) }
}

struct BusDirection: Decodable, Hashable {
    var to: String
    var stops: [Station]
}

struct BusRoute: Identifiable, Hashable {
    var id: String
    var name: String
}

/// Loads and keeps the station lists for the session.
@MainActor
enum StationLists {
    private static var cache: [String: Data] = [:]

    private static func get(_ query: [String: String]) async throws -> Data {
        let key = query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        if let d = cache[key] { return d }
        var comps = URLComponents(url: TransportAPI.defaultBase.appendingPathComponent("api/stations"), resolvingAgainstBaseURL: false)
        comps?.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = comps?.url else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let code = (resp as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else {
            throw URLError(.badServerResponse)
        }
        cache[key] = data
        return data
    }

    static func stations(_ mode: String) async throws -> [Station] {
        let list = try JSONDecoder().decode([Station].self, from: try await get(["mode": mode]))
        return list.sorted { $0.short.localizedCaseInsensitiveCompare($1.short) == .orderedAscending }
    }

    static func busRoutes() async throws -> [BusRoute] {
        let map = try JSONDecoder().decode([String: String].self, from: try await get(["mode": "bus"]))
        return map.map { BusRoute(id: $0.key, name: $0.value) }.sorted { natural($0.id, $1.id) }
    }

    static func busRoute(_ route: String) async throws -> [BusDirection] {
        try JSONDecoder().decode([BusDirection].self, from: try await get(["mode": "bus", "route": route]))
    }

    /// Route numbers in number order: 2, 10, 461, 461X, M50.
    nonisolated static func natural(_ a: String, _ b: String) -> Bool {
        let na = Int(a.prefix { $0.isNumber }), nb = Int(b.prefix { $0.isNumber })
        switch (na, nb) {
        case let (x?, y?) where x != y: return x < y
        case (_?, nil): return true
        case (nil, _?): return false
        default: return a.localizedStandardCompare(b) == .orderedAscending
        }
    }
}

enum Distance {
    static func text(_ m: Double) -> String {
        m < 1000 ? "\(Int(m.rounded())) m" : String(format: "%.1f km", m / 1000)
    }
}

// MARK: New trip

enum NewTripMode: String, CaseIterable, Identifiable, Hashable {
    case train, metro, bus, ferry, lightrail, search

    var id: String { rawValue }

    var title: String {
        switch self {
        case .train: "Train"
        case .metro: "Metro"
        case .bus: "Bus"
        case .ferry: "Ferry"
        case .lightrail: "Light rail"
        case .search: "Search any stop"
        }
    }

    var subtitle: String {
        switch self {
        case .train: "Sydney Trains and NSW TrainLink"
        case .metro: "Sydney Metro"
        case .bus: "Route number, then direction and stops"
        case .ferry: "Every wharf"
        case .lightrail: "Sydney, Parramatta and Newcastle"
        case .search: "Any station, stop or wharf by name"
        }
    }

    var symbol: String {
        switch self {
        case .train: "train.side.front.car"
        case .metro: "tram.fill.tunnel"
        case .bus: "bus.fill"
        case .ferry: "ferry.fill"
        case .lightrail: "lightrail.fill"
        case .search: "magnifyingglass"
        }
    }

    var tint: Color {
        switch self {
        case .train: Color(hex: "F6891F")
        case .metro: Color(hex: "168388")
        case .bus: Color(hex: "00A6E2")
        case .ferry: Color(hex: "5AB031")
        case .lightrail: Color(hex: "E4022D")
        case .search: Color(.systemGray)
        }
    }

    var listsStations: Bool { self == .train || self == .metro || self == .ferry || self == .lightrail }
}

/// The + button on Trips: pick a mode, then From and To, then confirm. With `extendFrom`
/// it asks only for the To of a connection leg and hands it back.
struct NewTripSheet: View {
    var extendFrom: StopRef? = nil
    var onExtend: ((StopRef, String) -> Void)? = nil

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Route] = []

    enum Route: Hashable {
        case mode(NewTripMode)
        case busRoute(BusRoute)
        case confirm(from: StopRef, to: StopRef, mode: NewTripMode)
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    ForEach(NewTripMode.allCases) { m in
                        NavigationLink(value: Route.mode(m)) { ModeRow(mode: m) }
                            .accessibilityIdentifier("mode-\(m.rawValue)")
                    }
                } footer: {
                    if let extendFrom {
                        Text("The connection leaves from \(Naming.short(extendFrom.name)).")
                    } else {
                        Text("Pick how you travel, then where you get on and where you get off.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(extendFrom == nil ? "New trip" : "Extend trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .mode(let m):
                    switch m {
                    case .bus:
                        BusRoutesView()
                    case .search:
                        SearchStopsStep(fixedFrom: extendFrom) { f, t in finish(f, t, m) }
                    default:
                        StationPickerView(mode: m, fixedFrom: extendFrom) { f, t in finish(f, t, m) }
                    }
                case .busRoute(let route):
                    BusStopsView(route: route, fixedFrom: extendFrom) { f, t in finish(f, t, .bus) }
                case .confirm(let f, let t, let m):
                    ConfirmTripView(from: f, to: t, mode: m) { dismiss() }
                }
            }
        }
        .environment(store)
    }

    private func finish(_ from: StopRef, _ to: StopRef, _ mode: NewTripMode) {
        store.tap()
        if let onExtend {
            onExtend(to, mode.rawValue)
            dismiss()
        } else {
            path.append(.confirm(from: from, to: to, mode: mode))
        }
    }
}

private struct ModeRow: View {
    var mode: NewTripMode

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: mode.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(mode.tint, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(mode.title).font(.body.weight(.semibold))
                Text(mode.subtitle).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// "From Burwood" above the list once the first stop is picked.
private struct FromBar: View {
    var from: StopRef?
    var tint: Color
    var canChange: Bool
    var onChange: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: from == nil ? "1.circle.fill" : "2.circle.fill")
                .foregroundStyle(tint)
            if let from {
                Text("From ").foregroundStyle(.secondary) + Text(Naming.short(from.name)).fontWeight(.semibold)
                Spacer(minLength: 4)
                if canChange {
                    Button("Change", action: onChange)
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("changeFrom")
                }
            } else {
                Text("Where do you get on?").foregroundStyle(.secondary)
                Spacer(minLength: 4)
            }
        }
        .font(.subheadline)
        .lineLimit(1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("fromBar")
    }
}

/// Train, Metro, Ferry and Light rail: every station A to Z with a side index, by distance, or on a map.
struct StationPickerView: View {
    let mode: NewTripMode
    let fixedFrom: StopRef?
    let onDone: (StopRef, StopRef) -> Void

    @Environment(AppStore.self) private var store
    @State private var stations: [Station] = []
    @State private var failed = false
    @State private var from: StopRef?
    @State private var view: ListKind = .az
    @State private var filter = ""
    @State private var location = LocationFinder()
    @State private var mapPick: Station?
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: -33.87, longitude: 151.13),
        span: MKCoordinateSpan(latitudeDelta: 0.3, longitudeDelta: 0.3)))
    @State private var centred = false

    enum ListKind: String, CaseIterable, Identifiable {
        case az = "A to Z", distance = "By distance", map = "By map"
        var id: String { rawValue }
    }

    init(mode: NewTripMode, fixedFrom: StopRef?, onDone: @escaping (StopRef, StopRef) -> Void) {
        self.mode = mode
        self.fixedFrom = fixedFrom
        self.onDone = onDone
        _from = State(initialValue: fixedFrom)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                Picker("List", selection: $view) {
                    ForEach(ListKind.allCases) { k in Text(k.rawValue).tag(k) }
                }
                .pickerStyle(.segmented)
                FromBar(from: from, tint: mode.tint, canChange: fixedFrom == nil) {
                    from = nil
                    store.tap()
                }
            }
            .padding(.horizontal)
            .padding(.top, 6)
            .padding(.bottom, 8)

            Divider()

            if stations.isEmpty {
                if failed {
                    ContentUnavailableView {
                        Label("Could not load stations", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection and try again.")
                    } actions: {
                        Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    ProgressView().frame(maxHeight: .infinity)
                }
            } else {
                switch view {
                case .az: azList
                case .distance: distanceList
                case .map: mapView
                }
            }
        }
        .navigationTitle(from == nil ? "From" : "To")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .always), prompt: "Filter \(mode.title.lowercased()) stations")
        .task { await load() }
        .onChange(of: view) { _, v in
            if v != .az && location.coordinate == nil { location.request() }
        }
        .onChange(of: location.coordinate?.latitude) { _, _ in centreOnUser() }
        .animation(.snappy, value: from)
    }

    private var filtered: [Station] {
        let q = filter.trimmingCharacters(in: .whitespaces)
        let list = q.isEmpty ? stations : stations.filter { $0.short.localizedCaseInsensitiveContains(q) }
        return list.filter { $0.id != fixedFrom?.id }
    }

    private struct LetterGroup: Identifiable {
        var letter: String
        var items: [Station]
        var id: String { letter }
    }

    private var groups: [LetterGroup] {
        var out: [LetterGroup] = []
        for s in filtered {
            let c = s.short.first.map { String($0).uppercased() } ?? "#"
            let letter = c.rangeOfCharacter(from: .letters) == nil ? "#" : c
            if out.last?.letter == letter {
                out[out.count - 1].items.append(s)
            } else {
                out.append(LetterGroup(letter: letter, items: [s]))
            }
        }
        return out
    }

    private var azList: some View {
        let g = groups
        return ScrollViewReader { proxy in
            List {
                ForEach(g) { group in
                    Section {
                        ForEach(group.items) { s in
                            row(s, distance: nil).id(s.id)
                        }
                    } header: {
                        Text(group.letter)
                    }
                }
            }
            .listStyle(.plain)
            .overlay(alignment: .trailing) {
                if g.count > 3 {
                    SectionIndexBar(letters: g.map(\.letter)) { letter in
                        if let first = g.first(where: { $0.letter == letter })?.items.first {
                            proxy.scrollTo(first.id, anchor: .top)
                        }
                    }
                }
            }
        }
    }

    private struct Near: Identifiable {
        var station: Station
        var metres: Double
        var id: String { station.id }
    }

    @ViewBuilder
    private var distanceList: some View {
        if let c = location.coordinate {
            let here = CLLocation(latitude: c.latitude, longitude: c.longitude)
            let near = filtered
                .map { Near(station: $0, metres: here.distance(from: $0.location)) }
                .sorted { $0.metres < $1.metres }
                .prefix(60)
            List {
                ForEach(Array(near)) { n in row(n.station, distance: n.metres) }
            }
            .listStyle(.plain)
        } else {
            ContentUnavailableView {
                Label("Closest stations first", systemImage: "location.circle")
            } description: {
                Text("Allow your location to sort stations by how far away they are.")
            } actions: {
                Button("Use my location") { location.request() }.buttonStyle(.borderedProminent)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var mapView: some View {
        ZStack(alignment: .bottom) {
            Map(position: $camera) {
                UserAnnotation()
                ForEach(filtered) { s in
                    Annotation(s.short, coordinate: s.coordinate) {
                        Button {
                            withAnimation(.snappy) { mapPick = s }
                            store.tap()
                        } label: {
                            let picked = mapPick?.id == s.id || from?.id == s.id
                            Circle()
                                .fill(picked ? Color.accentColor : mode.tint)
                                .frame(width: picked ? 20 : 13, height: picked ? 20 : 13)
                                .overlay(Circle().stroke(.white, lineWidth: 2))
                                .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                                .padding(6)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(s.short)
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
            }

            if let p = mapPick {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.short).font(.headline).lineLimit(1)
                        if let c = location.coordinate {
                            Text(Distance.text(CLLocation(latitude: c.latitude, longitude: c.longitude).distance(from: p.location)) + " away")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Button(from == nil ? "Get on here" : "Get off here") {
                        let s = p
                        mapPick = nil
                        pick(s)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(from?.id == p.id)
                    .accessibilityIdentifier("mapChoose")
                }
                .padding(14)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear { centreOnUser() }
    }

    private func row(_ s: Station, distance: Double?) -> some View {
        Button { pick(s) } label: {
            HStack(spacing: 8) {
                Text(s.short)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let d = distance {
                    Text(Distance.text(d))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                if from?.id == s.id {
                    Image(systemName: "checkmark").font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
                }
            }
            .padding(.trailing, view == .az ? 18 : 0)
            .contentShape(Rectangle())
        }
        .disabled(from?.id == s.id)
    }

    private func pick(_ s: Station) {
        if let f = from {
            guard f.id != s.id else { return }
            onDone(f, s.ref)
        } else {
            from = s.ref
            filter = ""
            store.tap()
        }
    }

    private func centreOnUser() {
        guard !centred, let c = location.coordinate else { return }
        centred = true
        camera = .region(MKCoordinateRegion(center: c, span: MKCoordinateSpan(latitudeDelta: 0.06, longitudeDelta: 0.06)))
    }

    private func load() async {
        failed = false
        do {
            stations = try await StationLists.stations(mode.rawValue)
        } catch {
            failed = true
        }
    }
}

/// The letter strip on the right of A to Z. Tap or drag along it to jump.
struct SectionIndexBar: View {
    let letters: [String]
    let onPick: (String) -> Void
    @State private var current: String?
    private let rowHeight: CGFloat = 15

    var body: some View {
        VStack(spacing: 0) {
            ForEach(letters, id: \.self) { l in
                Text(l)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 22, height: rowHeight)
                    .accessibilityIdentifier("index-\(l)")
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { onPick(l) }
            }
        }
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill(Color(.tertiarySystemFill))
                .opacity(current == nil ? 0 : 1)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { v in
                    let i = Int((v.location.y - 4) / rowHeight)
                    let l = letters[min(max(i, 0), letters.count - 1)]
                    if l != current {
                        current = l
                        onPick(l)
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
                }
                .onEnded { _ in current = nil }
        )
        .padding(.trailing, 2)
        .frame(maxHeight: .infinity)
    }
}

/// Bus: the route number first.
struct BusRoutesView: View {
    @State private var routes: [BusRoute] = []
    @State private var query = ""
    @State private var failed = false

    var body: some View {
        List {
            if routes.isEmpty {
                if failed {
                    ContentUnavailableView {
                        Label("Could not load routes", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection and try again.")
                    } actions: {
                        Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            } else {
                Section {
                    ForEach(shown) { r in
                        NavigationLink(value: NewTripSheet.Route.busRoute(r)) {
                            HStack(spacing: 10) {
                                Text(r.id)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7)
                                    .frame(minWidth: 48, minHeight: 26)
                                    .background(NewTripMode.bus.tint, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                Text(r.name)
                                    .font(.subheadline)
                                    .lineLimit(2)
                            }
                        }
                        .accessibilityIdentifier("busRoute")
                    }
                } footer: {
                    if !query.isEmpty && shown.isEmpty {
                        Text("No route \(query). Try Search any stop.")
                    }
                }
                Section {
                    NavigationLink(value: NewTripSheet.Route.mode(.search)) {
                        Label("Search a stop by name instead", systemImage: "magnifyingglass")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Bus route")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Route number, like 461")
        .task { await load() }
    }

    private var shown: [BusRoute] {
        let q = query.trimmingCharacters(in: .whitespaces).uppercased()
        if q.isEmpty { return Array(routes.prefix(80)) }
        let starts = routes.filter { $0.id.uppercased().hasPrefix(q) }
        let named = routes.filter { !$0.id.uppercased().hasPrefix(q) && $0.name.localizedCaseInsensitiveContains(q) }
        return Array((starts + named).prefix(100))
    }

    private func load() async {
        failed = false
        do { routes = try await StationLists.busRoutes() } catch { failed = true }
    }
}

/// Bus: a direction, then the stop you get on at and a later stop you get off at.
struct BusStopsView: View {
    let route: BusRoute
    let fixedFrom: StopRef?
    let onDone: (StopRef, StopRef) -> Void

    @Environment(AppStore.self) private var store
    @State private var dirs: [BusDirection] = []
    @State private var dir = 0
    @State private var from: StopRef?
    @State private var failed = false

    init(route: BusRoute, fixedFrom: StopRef?, onDone: @escaping (StopRef, StopRef) -> Void) {
        self.route = route
        self.fixedFrom = fixedFrom
        self.onDone = onDone
        _from = State(initialValue: fixedFrom)
    }

    var body: some View {
        List {
            Section {
                FromBar(from: from, tint: NewTripMode.bus.tint, canChange: fixedFrom == nil) { from = nil }
            }
            if dirs.isEmpty {
                if failed {
                    Section { Button("Try again") { Task { await load() } } } footer: { Text("Could not load this route.") }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            } else {
                if dirs.count > 1 {
                    Section("Direction") {
                        ForEach(dirs.indices, id: \.self) { i in
                            Button {
                                dir = i
                                from = fixedFrom
                                store.tap()
                            } label: {
                                HStack {
                                    Text("To \(Naming.short(dirs[i].to))").foregroundStyle(.primary)
                                    Spacer()
                                    if dir == i { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .accessibilityIdentifier("busDirection")
                        }
                    }
                }
                Section {
                    let list = stops
                    ForEach(Array(list.enumerated()), id: \.offset) { i, s in
                        Button {
                            pick(s)
                        } label: {
                            HStack(spacing: 12) {
                                RouteStopDot(first: i == 0, last: i == list.count - 1, tint: NewTripMode.bus.tint)
                                Text(Naming.short(s.name)).foregroundStyle(.primary).lineLimit(2)
                                Spacer(minLength: 0)
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        .accessibilityIdentifier("busStop")
                    }
                } header: {
                    Text(from == nil ? "Where do you get on?" : "Where do you get off?")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(route.id)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .animation(.snappy, value: from)
    }

    /// Stops in this direction; after the boarding stop once it is picked.
    private var stops: [Station] {
        guard dirs.indices.contains(dir) else { return [] }
        let all = dirs[dir].stops
        if let f = from, fixedFrom == nil, let i = all.firstIndex(where: { $0.id == f.id }) {
            return Array(all[(i + 1)...])
        }
        return all
    }

    private func pick(_ s: Station) {
        if let f = from {
            guard f.id != s.id else { return }
            onDone(f, s.ref)
        } else {
            from = s.ref
            store.tap()
        }
    }

    private func load() async {
        failed = false
        do { dirs = try await StationLists.busRoute(route.id) } catch { failed = true }
    }
}

private struct RouteStopDot: View {
    var first: Bool
    var last: Bool
    var tint: Color

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                Rectangle().fill(first ? Color.clear : tint).frame(width: 3)
                Rectangle().fill(last ? Color.clear : tint).frame(width: 3)
            }
            Circle()
                .fill(Color(.systemBackground))
                .frame(width: 11, height: 11)
                .overlay(Circle().stroke(tint, lineWidth: 3))
        }
        .frame(width: 14)
        .frame(minHeight: 44)
    }
}

/// Search any stop by name: From, then To.
struct SearchStopsStep: View {
    let fixedFrom: StopRef?
    let onDone: (StopRef, StopRef) -> Void

    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var results: [StopRef] = []
    @State private var from: StopRef?

    init(fixedFrom: StopRef?, onDone: @escaping (StopRef, StopRef) -> Void) {
        self.fixedFrom = fixedFrom
        self.onDone = onDone
        _from = State(initialValue: fixedFrom)
    }

    var body: some View {
        List {
            Section {
                FromBar(from: from, tint: .accentColor, canChange: fixedFrom == nil) { from = nil }
            }
            if query.trimmingCharacters(in: .whitespaces).count < 2 {
                if !store.starred.isEmpty {
                    Section("Starred") { ForEach(store.starred) { s in row(s) } }
                }
                if !store.recents.isEmpty {
                    Section("Recent") { ForEach(store.recents) { s in row(s) } }
                }
            } else {
                Section { ForEach(results) { s in row(s) } }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(from == nil ? "From" : "To")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Station, stop or number")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            if let r = try? await store.api.search(q) { results = r }
        }
    }

    private func row(_ s: StopRef) -> some View {
        Button {
            if let f = from {
                guard f.id != s.id else { return }
                onDone(f, s)
            } else {
                from = StopRef(id: s.id, name: s.name)
                query = ""
                store.tap()
            }
        } label: { StopRow(stop: s) }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pickResult")
    }
}

// MARK: Confirm trip

/// Name the trip, optionally add a connection leg and its change time, then save it.
struct ConfirmTripView: View {
    let from: StopRef
    let to: StopRef
    let mode: NewTripMode
    let onSaved: () -> Void

    @Environment(AppStore.self) private var store
    @State private var name: String
    @State private var finalTo: StopRef?
    @State private var leg2Mode: String?
    @State private var conn = 5
    @State private var extending = false

    init(from: StopRef, to: StopRef, mode: NewTripMode, onSaved: @escaping () -> Void) {
        self.from = from
        self.to = to
        self.mode = mode
        self.onSaved = onSaved
        _name = State(initialValue: Self.defaultName(from, to))
    }

    static func defaultName(_ a: StopRef, _ b: StopRef) -> String {
        "\(Naming.compact(Naming.short(a.name))) to \(Naming.compact(Naming.short(b.name)))"
    }

    var body: some View {
        Form {
            Section("Name") {
                TextField("Trip name", text: $name)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .accessibilityIdentifier("tripName")
            }

            Section {
                legRow(number: 1, modeKey: mode.rawValue, a: from, b: to)
                if let finalTo {
                    legRow(number: 2, modeKey: leg2Mode, a: to, b: finalTo)
                }
            } header: {
                Text(finalTo == nil ? "Trip" : "Legs")
            }

            if finalTo != nil {
                Section {
                    Stepper(value: $conn, in: 0...30) {
                        HStack {
                            Text("Connection time")
                            Spacer()
                            Text("\(conn) min")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                    .accessibilityIdentifier("connStepper")
                    Button("Remove connection", role: .destructive) {
                        if name == Self.defaultName(from, finalTo ?? to) { name = Self.defaultName(from, to) }
                        withAnimation { finalTo = nil; leg2Mode = nil }
                    }
                } footer: {
                    Text("Shows connections that leave \(Naming.compact(Naming.short(to.name))) at least \(conn) min after you arrive.")
                }
            } else {
                Section {
                    Button { extending = true } label: {
                        Label("Extend trip", systemImage: "plus.circle.fill")
                    }
                    .accessibilityIdentifier("extendTrip")
                } footer: {
                    Text("Add a connection from \(Naming.compact(Naming.short(to.name))), like a bus or light rail after your train.")
                }
            }
        }
        .navigationTitle("Confirm trip")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .fontWeight(.semibold)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("saveTrip")
            }
        }
        .sheet(isPresented: $extending) {
            NewTripSheet(extendFrom: to) { t, m in
                if name == Self.defaultName(from, finalTo ?? to) { name = Self.defaultName(from, t) }
                withAnimation {
                    finalTo = t
                    leg2Mode = m
                }
            }
            .environment(store)
            .presentationDetents([.large])
        }
    }

    private func legRow(number: Int, modeKey: String?, a: StopRef, b: StopRef) -> some View {
        let m = modeKey.flatMap { NewTripMode(rawValue: $0) } ?? .search
        return HStack(spacing: 12) {
            Image(systemName: m.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(m.tint, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Naming.compact(Naming.short(a.name))) to \(Naming.compact(Naming.short(b.name)))")
                    .font(.body.weight(.semibold))
                    .lineLimit(2)
                Text(m == .search ? "Leg \(number), any service" : "Leg \(number), \(m.title.lowercased())")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("leg\(number)")
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let trip = MyTrip(
            name: trimmed,
            from: StopRef(id: from.id, name: from.name),
            to: StopRef(id: (finalTo ?? to).id, name: (finalTo ?? to).name),
            via: finalTo == nil ? nil : StopRef(id: to.id, name: to.name),
            conn: finalTo == nil ? nil : conn,
            modes: [mode.rawValue] + (leg2Mode.map { [$0] } ?? []))
        store.saveMyTrip(trip)
        onSaved()
    }
}
