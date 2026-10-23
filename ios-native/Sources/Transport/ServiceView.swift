import SwiftUI
import MapKit
import TransportKit

/// Live tracking for one service: full screen Apple Map with the route and the moving vehicle,
/// and a pull up sheet with where it is, the stop list and the watch buttons.
struct ServiceView: View {
    var key: ServiceKey
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var data: ServiceResponse?
    @State private var updated: Date?
    @State private var loading = false
    @State private var error: String?
    @State private var camera: MapCameraPosition = .automatic
    @State private var following = true
    @State private var showSheet = false
    @State private var detent: PresentationDetent = .fraction(0.38)

    var body: some View {
        Map(position: $camera, interactionModes: .all) {
            if route.count > 1 {
                MapPolyline(coordinates: route)
                    .stroke(lineColor, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
            }
            ForEach(stopsWithCoords) { s in
                Annotation(s.mine == true ? Naming.short(s.name) : "", coordinate: coord(s), anchor: .center) {
                    StopDot(color: lineColor, passed: s.passed == true, mine: s.mine == true)
                }
            }
            if let v = data?.vehicle {
                Annotation(key.line, coordinate: CLLocationCoordinate2D(latitude: v.lat, longitude: v.lon), anchor: .center) {
                    VehicleMarker(mode: key.mode, colorHex: data?.color ?? key.color, bearing: v.bearing)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onMapCameraChange(frequency: .onEnd) { ctx in
            // A pan by the user stops the camera following the vehicle.
            if let v = data?.vehicle {
                let d = CLLocation(latitude: ctx.region.center.latitude, longitude: ctx.region.center.longitude)
                    .distance(from: CLLocation(latitude: v.lat, longitude: v.lon))
                if d > 1500 { following = false }
            }
        }
        .overlay(alignment: .topTrailing) {
            if data?.vehicle != nil {
                Button {
                    following = true
                    centreOnVehicle(animated: true)
                    store.tap()
                } label: {
                    Image(systemName: following ? "location.fill" : "location")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .padding(.trailing, 12)
                .padding(.top, 60)
                .accessibilityLabel("Follow vehicle")
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(.regularMaterial, for: .navigationBar)
        .onAppear { showSheet = true }
        .onDisappear { showSheet = false }
        .sheet(isPresented: $showSheet) {
            ServiceSheet(key: key, data: data, updated: updated, loading: loading, error: error)
                .presentationDetents([.height(170), .fraction(0.38), .large], selection: $detent)
                .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.38)))
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(22)
                .interactiveDismissDisabled()
                .environment(store)
        }
        .autoRefresh(every: store.refreshSeconds, active: store.isActive) { await load() }
        .appHaptics()
    }

    private var title: String {
        let dest = Naming.short(data?.dest?.isEmpty == false ? data!.dest! : (key.dest ?? ""))
        return dest.isEmpty ? key.line : "\(key.line) to \(dest)"
    }

    private var lineColor: Color { Color(hex: data?.color ?? key.color ?? Mode(raw: key.mode).fallbackHex) }

    private var stopsWithCoords: [ServiceStop] { (data?.stops ?? []).filter { $0.lat != nil && $0.lon != nil } }

    private func coord(_ s: ServiceStop) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: s.lat ?? 0, longitude: s.lon ?? 0)
    }

    private var route: [CLLocationCoordinate2D] {
        let p = (data?.path ?? []).compactMap { pair -> CLLocationCoordinate2D? in
            pair.count >= 2 ? CLLocationCoordinate2D(latitude: pair[0], longitude: pair[1]) : nil
        }
        return p.count > 1 ? p : stopsWithCoords.map(coord)
    }

    private func centreOnVehicle(animated: Bool) {
        guard let v = data?.vehicle else { return }
        let cam = MapCamera(centerCoordinate: CLLocationCoordinate2D(latitude: v.lat, longitude: v.lon), distance: 3500)
        if animated {
            withAnimation(.easeInOut(duration: 0.8)) { camera = .camera(cam) }
        } else {
            camera = .camera(cam)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let first = data == nil
            let r = try await store.api.service(trip: key.tripId, line: key.line, stop: key.stopId,
                                                planned: key.planned, mode: key.mode, destId: key.destId)
            withAnimation(.easeInOut(duration: 1.2)) { data = r }
            updated = Date()
            error = nil
            if r.vehicle != nil && (first || following) { centreOnVehicle(animated: !first) }
            await LiveActivities.shared.update(key: key, service: r)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct StopDot: View {
    var color: Color
    var passed: Bool
    var mine: Bool

    var body: some View {
        Circle()
            .fill(Color(.systemBackground))
            .frame(width: mine ? 14 : 9, height: mine ? 14 : 9)
            .overlay(Circle().stroke(passed ? Color.secondary : color, lineWidth: mine ? 4 : 2.5))
    }
}

struct VehicleMarker: View {
    var mode: String?
    var colorHex: String?
    var bearing: Double?

    var body: some View {
        let m = Mode(raw: mode)
        ZStack {
            if let b = bearing {
                Image(systemName: "location.north.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: colorHex ?? m.fallbackHex))
                    .offset(y: -24)
                    .rotationEffect(.degrees(b))
            }
            Circle()
                .fill(Color(hex: colorHex ?? m.fallbackHex))
                .frame(width: 34, height: 34)
                .overlay(Circle().stroke(.white, lineWidth: 3))
                .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
            Image(systemName: m.symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: 60, height: 60)
        .accessibilityLabel("\(m.title) position")
    }
}

/// The pull up sheet over the map.
struct ServiceSheet: View {
    var key: ServiceKey
    var data: ServiceResponse?
    var updated: Date?
    var loading: Bool
    var error: String?
    @Environment(AppStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                    UpdatedLine(updated: updated, isLoading: loading, liveCount: nil)
                }
                Section {
                    HStack(spacing: 12) {
                        Button {
                            if let d = key.departure {
                                Task { await store.watch(d.watchRequest(device: store.device, profile: store.api.profile)) }
                            }
                        } label: {
                            Label("Watch", systemImage: "bell.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(key.departure == nil)
                        Button {
                            Task { await LiveActivities.shared.start(key: key, service: data) }
                            store.success()
                        } label: {
                            Label("Lock Screen", systemImage: "platter.filled.bottom.iphone").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                    .controlSize(.large)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if let alerts = data?.alerts, !alerts.isEmpty {
                    Section("Alerts") {
                        ForEach(alerts) { AlertRow(alert: $0) }
                    }
                }
                if let error, data == nil {
                    Section { Text(error).foregroundStyle(.secondary) }
                }
                Section("Stops") {
                    ForEach(Array((data?.stops ?? []).enumerated()), id: \.element.id) { i, s in
                        StopTimelineRow(stop: s, color: Color(hex: data?.color ?? key.color),
                                        isNext: i == data?.nextIndex, isFirst: i == 0,
                                        isLast: i == (data?.stops.count ?? 0) - 1)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                            .listRowSeparator(.hidden)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                LineBadge(line: key.line, colorHex: data?.color ?? key.color, mode: key.mode)
                Text(Naming.short(data?.dest?.isEmpty == false ? data!.dest! : (key.dest ?? "")))
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                LiveBadge(isLive: data?.live == true, cancelled: data?.cancelled == true)
            }
            if let w = data?.where?.text {
                Label(w, systemImage: "location.fill")
                    .font(.subheadline)
            } else if data != nil && data?.vehicle == nil {
                Label("No live position for this service right now", systemImage: "location.slash")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                StatusText(delayMin: data?.delayMin, isLive: data?.live == true, cancelled: data?.cancelled == true)
                if let n = data?.stopsAway, n > 0 {
                    Text(n == 1 ? "1 stop from you" : "\(n) stops from you").foregroundStyle(.secondary)
                }
                CrowdView(occupancy: data?.vehicle?.occupancy)
                if let o = data?.vehicle?.occupancy?.text { Text(o).foregroundStyle(.secondary) }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}

struct StopTimelineRow: View {
    var stop: ServiceStop
    var color: Color
    var isNext: Bool
    var isFirst: Bool
    var isLast: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                VStack(spacing: 0) {
                    Rectangle().fill(isFirst ? .clear : lineTint).frame(width: 4)
                    Rectangle().fill(isLast ? .clear : lineTint).frame(width: 4)
                }
                Circle()
                    .fill(Color(.systemBackground))
                    .frame(width: stop.mine == true ? 16 : 12, height: stop.mine == true ? 16 : 12)
                    .overlay(Circle().stroke(lineTint, lineWidth: stop.mine == true ? 4 : 3))
                if isNext {
                    Circle().fill(color).frame(width: 6, height: 6)
                }
            }
            .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(Naming.short(stop.name))
                    .font(stop.mine == true ? .body.weight(.semibold) : .body)
                    .foregroundStyle(stop.passed == true ? .secondary : .primary)
                    .lineLimit(1)
                if stop.mine == true {
                    Text("Your stop").font(.caption.weight(.semibold)).foregroundStyle(.tint)
                } else if isNext {
                    Text("Next stop").font(.caption.weight(.semibold)).foregroundStyle(Color.liveGreen)
                }
            }
            Spacer()
            TimePair(planned: stop.planned, estimated: stop.estimated, isLive: stop.estimated != nil)
                .font(.subheadline)
                .foregroundStyle(stop.passed == true ? .secondary : .primary)
        }
        .frame(minHeight: 46)
    }

    private var lineTint: Color { stop.passed == true ? Color.secondary.opacity(0.4) : color }
}
