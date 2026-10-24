import SwiftUI
import TransportKit

/// Identifies one service so the live map can find it.
struct ServiceKey: Hashable, Identifiable, Codable {
    var tripId: String?
    var line: String
    var stopId: String?
    var planned: Date?
    var mode: String?
    var destId: String?
    var color: String?
    var dest: String?
    var platform: String?
    var departure: Departure?

    var id: String { "\(tripId ?? line)-\(stopId ?? "")-\(planned?.timeIntervalSince1970 ?? 0)" }

    init(_ d: Departure) {
        tripId = d.tripId; line = d.line; stopId = d.stopId; planned = d.planned; mode = d.mode
        destId = d.destId; color = d.color; dest = d.dest; platform = d.platform; departure = d
    }

    init(_ l: Leg) {
        tripId = l.tripId; line = l.line ?? ""; stopId = l.stopId; planned = l.planned; mode = l.mode
        destId = l.destId; color = l.color; dest = l.towards; platform = l.fromPlatform; departure = nil
    }
}

struct DepartureRow: View {
    var d: Departure
    var alerts: [ServiceAlert] = []

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            LineBadge(line: d.line, colorHex: d.color, mode: d.mode)
                .frame(minWidth: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(Naming.short(d.dest ?? d.description ?? d.line))
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    TimePair(planned: d.planned, estimated: d.estimated, isLive: d.isLive)
                        .fixedSize()
                    if let p = d.platform, !p.isEmpty {
                        Text(p).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .font(.subheadline)
                .lineLimit(1)
                HStack(spacing: 6) {
                    StatusText(delayMin: d.delayMin, isLive: d.isLive, cancelled: d.isCancelled)
                    if let n = d.stopsAway, d.isLive, n > 0 {
                        Text(n == 1 ? "1 stop away" : "\(n) stops away")
                            .foregroundStyle(.secondary)
                            .layoutPriority(-1)
                    }
                    CrowdView(occupancy: d.occupancy ?? d.vehicle?.occupancy)
                }
                .font(.footnote)
                .lineLimit(1)
                if let from = d.platformChangedFrom, !from.isEmpty {
                    Label("Platform changed from \(from)", systemImage: "arrow.triangle.swap")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.orange)
                }
                if let pred = d.pred?.short ?? d.pred?.text, !d.isLive {
                    Label(pred, systemImage: "chart.line.uptrend.xyaxis")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let a = alerts.first {
                    Label(a.title ?? "Service alert", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                if let t = d.bestTime {
                    CountdownLabel(to: t, cancelled: d.isCancelled, isLive: d.isLive)
                }
                LiveBadge(isLive: d.isLive, cancelled: d.isCancelled)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct StopView: View {
    var stop: StopRef
    @Environment(AppStore.self) private var store
    @State private var data: DeparturesResponse?
    @State private var updated: Date?
    @State private var loading = false
    @State private var error: String?
    @State private var mode: String = "all"
    @State private var selected: ServiceKey?
    @State private var recentName: String?
    @State private var station: StationInfo?

    var body: some View {
        List {
            Section {
                UpdatedLine(updated: updated, isLoading: loading, liveCount: data?.live?.liveCount)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                if modes.count > 1 {
                    Picker("Mode", selection: $mode) {
                        Text("All").tag("all")
                        ForEach(modes, id: \.self) { m in
                            if modes.count > 2 {
                                Image(systemName: Mode(raw: m).symbol)
                                    .accessibilityLabel(Mode(raw: m).title)
                                    .tag(m)
                            } else {
                                Text(Mode(raw: m).title).tag(m)
                            }
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
            }

            if let error, data == nil {
                Section {
                    ContentUnavailableView {
                        Label("Could not load", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try Again") { Task { await load() } }
                            .buttonStyle(.bordered)
                    }
                }
            }

            if let first = seriousAlerts.first {
                Section {
                    if seriousAlerts.count == 1 {
                        AlertRow(alert: first)
                    } else {
                        NavigationLink {
                            AlertsList(alerts: Array(seriousAlerts))
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(seriousAlerts.count) service alerts").font(.subheadline.weight(.semibold))
                                    Text(first.title ?? "").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                }
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }

            if Peak.isPeak() && rows.contains(where: { Mode(raw: $0.mode) != .ferry }) {
                Section { PeakNudge() }
            }

            Section {
                ForEach(rows) { d in
                    Button { selected = ServiceKey(d) } label: {
                        DepartureRow(d: d, alerts: data?.alerts(for: d) ?? [])
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("departure")
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            Task { await store.watch(d.watchRequest(device: store.device, profile: store.api.profile)) }
                        } label: { Label("Watch", systemImage: "bell.fill") }
                        .tint(.indigo)
                    }
                    .swipeActions(edge: .leading) {
                        Button { store.toggleStar(stop) } label: {
                            Label(store.isStarred(stop.id) ? "Unstar" : "Star", systemImage: store.isStarred(stop.id) ? "star.slash" : "star.fill")
                        }
                        .tint(.yellow)
                    }
                    .contextMenu {
                        Button { Task { await store.watch(d.watchRequest(device: store.device, profile: store.api.profile)) } } label: {
                            Label("Watch this service", systemImage: "bell")
                        }
                        Button { Task { await LiveActivities.shared.start(departure: d, stopName: stop.name) } } label: {
                            Label("Follow on Lock Screen", systemImage: "platter.filled.bottom.iphone")
                        }
                        Button { selected = ServiceKey(d) } label: { Label("Show on map", systemImage: "map") }
                    }
                }
            } footer: {
                if data != nil && rows.isEmpty {
                    Text("No services in the next while.")
                } else {
                    Text("Swipe left to watch a service. Swipe right to star this stop.")
                }
            }

            if station != nil {
                StationSections(info: station)
            }
        }
        .listStyle(.insetGrouped)
        .task(id: stop.id) {
            // Park and Ride, access, lifts and facilities for stations, every 2 minutes.
            guard stop.id.allSatisfy(\.isNumber) else { return }
            while !Task.isCancelled {
                if let i = try? await store.api.station(id: stop.id) { station = i }
                try? await Task.sleep(for: .seconds(120))
            }
        }
        .navigationTitle(Naming.short(data?.stop?.name ?? stop.name))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { store.toggleStar(stop) } label: {
                    Image(systemName: store.isStarred(stop.id) ? "star.fill" : "star")
                }
                .accessibilityLabel(store.isStarred(stop.id) ? "Unstar stop" : "Star stop")
            }
        }
        .refreshable { await load() }
        .autoRefresh(every: store.refreshSeconds, active: store.isActive) { await load() }
        .onAppear { store.remember(stop) }
        .navigationDestination(item: $selected) { key in ServiceView(key: key) }
        .appHaptics()
    }

    private var modes: [String] {
        var seen: [String] = []
        for d in data?.items ?? [] {
            let m = Mode(raw: d.mode).rawValue
            if !seen.contains(m) { seen.append(m) }
        }
        return seen
    }

    private var seriousAlerts: [ServiceAlert] {
        let lines = Set(rows.map(\.line))
        return (data?.alerts ?? []).filter { a in
            a.isSerious || (a.lines ?? []).contains(where: { lines.contains($0) })
        }
    }

    private var rows: [Departure] {
        let all = data?.items ?? []
        return mode == "all" ? all : all.filter { Mode(raw: $0.mode).rawValue == mode }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let d = try await store.api.departures(stop: stop.id, device: store.device)
            withAnimation(.snappy) { data = d }
            updated = Date()
            error = nil
            if let name = d.stop?.name, !name.isEmpty, recentName != name {
                recentName = name
                store.remember(StopRef(id: stop.id, name: Naming.short(name)))
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct AlertRow: View {
    var alert: ServiceAlert

    var body: some View {
        if let s = alert.url, let url = URL(string: s) {
            Link(destination: url) {
                HStack {
                    content
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .tint(.primary)
        } else {
            content
        }
    }

    private var content: some View {
        Label {
            Text(alert.title ?? "Service alert")
                .font(.subheadline)
                .foregroundStyle(.primary)
        } icon: {
            Image(systemName: alert.isSerious ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(alert.isSerious ? .red : .orange)
        }
    }
}

struct AlertsList: View {
    var alerts: [ServiceAlert]

    var body: some View {
        List {
            ForEach(alerts) { AlertRow(alert: $0) }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Alerts")
        .navigationBarTitleDisplayMode(.inline)
    }
}
