import SwiftUI
import MapKit
import CoreLocation
import ActivityKit
import TransportKit

// MARK: Live trip state

extension AppStore {
    /// Start trip on a journey: one trip at a time, saved on this phone until you end it.
    func startLiveTrip(_ j: Journey, from: StopRef, to: StopRef) async {
        if liveTrip != nil { await endLiveTrip(silent: true) }
        let req = j.watchRequest(device: device, profile: api.profile, from: from, to: to)
        guard !req.legs.isEmpty else { return }
        var record = LiveTripRecord(title: req.title, from: StopRef(id: from.id, name: from.name),
                                    to: StopRef(id: to.id, name: to.name), legs: req.legs, fare: j.fare, started: Date())
        liveTrip = record
        liveServices = Array(repeating: nil, count: req.legs.count)
        liveState = LiveTripLogic.compute(legs: req.legs, services: liveServices)
        liveAlerted = []
        travelLedger = TravelUpdateLedger()
        // Present again even if an earlier live trip screen left the flag set.
        if openLiveTrip {
            openLiveTrip = false
            try? await Task.sleep(for: .milliseconds(350))
        }
        openLiveTrip = true
        success()
        if LiveReplay.enabled {
            startReplay(for: record)
            return
        }
        LiveTripActivities.start(record: record, state: liveState)
        startLiveLoop()
        // Start trip also watches it: the server follows the trip, so alerts arrive with the app closed.
        if await Notifier.status() == .notDetermined { await Notifier.requestPermission() }
        if await Notifier.status() == .authorized {
            if let created = try? await api.trackWatch(req), let id = created.watch?.id?.value {
                record.watchID = id
                if liveTrip?.started == record.started { liveTrip?.watchID = id }
                PhoneTripWatches.add(id)
            }
        }
    }

    func startLiveLoop() {
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.liveTrip != nil else { return }
                if self.isActive { await self.refreshLive() }
                try? await Task.sleep(for: .seconds(self.liveRefreshSeconds))
            }
        }
    }

    func refreshLive() async {
        guard let trip = liveTrip else { return }
        let api = self.api
        var services = liveServices.count == trip.legs.count ? liveServices : Array(repeating: nil, count: trip.legs.count)
        let replay = LiveReplay.current
        if let replay {
            services = replay.services()
        } else {
            await withTaskGroup(of: (Int, ServiceResponse?).self) { group in
                for (i, l) in trip.legs.enumerated() where l.tripId != nil || l.stopId != nil {
                    group.addTask { (i, try? await api.liveService(l)) }
                }
                for await (i, r) in group where r != nil { services[i] = r }
            }
        }
        guard liveTrip?.started == trip.started else { return }
        liveServices = services
        let st = LiveTripLogic.compute(legs: trip.legs, services: services, now: replay?.now ?? Date())
        liveState = st
        guard let st else { return }
        if let replay {
            var words = st.done ? "arrived" : "leg \(st.current + 1) \(st.phase == "ride" ? "on board" : "waiting")"
            if let n = st.nextStop, !st.done { words += ", next \(n)" }
            if let n = st.stopsLeft, !st.done { words += ", \(n) stops left" }
            words += ", arrive \(Clock.time(st.eta))"
            ReplayLog.shared.state(words)
            replay.lockScreen(st.done ? "Arrived at \(Naming.short(trip.to.name))" : "\(st.nextStop.map { "Next stop: \($0)" } ?? "Leg \(st.current + 1)"), arrive \(Clock.time(st.eta))")
        }
        travelUpdates(trip: trip, state: st, services: services, now: replay?.now ?? Date(), replay: replay != nil)
        liveAlerts(trip: trip, state: st)
        LiveTripActivities.update(record: trip, state: st, services: services)
        if let share = trip.share {
            try? await api.updateShare(share, leg: st.current, phase: st.phase, next: st.nextStop, stopsLeft: st.stopsLeft, eta: st.eta)
        }
        // Arrived: the trip ends here, once. It never rolls on to the next service.
        if st.done {
            await arriveLiveTrip(trip)
        }
    }

    /// The final step of a live trip: one "You've arrived" alert, then the Lock Screen card, the
    /// share link and the app's own following all stop.
    func arriveLiveTrip(_ trip: LiveTripRecord) async {
        guard liveTrip?.started == trip.started else { return }
        let place = Naming.short(trip.to.name)
        if liveAlerted.insert("arrived").inserted {
            // The alert itself is the travel update "arrived" (said once, see travelUpdates).
            show(Banner(title: "You've arrived at \(place)", symbol: "checkmark.circle.fill"))
            success()
        }
        await LiveTripActivities.finish(record: trip, state: liveState)
        await endLiveTrip(silent: true, keepServerWatch: trip.watchID != nil, cardFinished: true)
    }

    /// Travel updates: Leave now, Board, Next stop (get off or change here), Change and Arrived,
    /// each once. Steps still to come are scheduled with the system so they arrive on time with
    /// the app closed; each refresh moves them to the latest live time under the same identifier.
    /// The iPhone has no push from the server, so the phone is the one source of these alerts
    /// and the server watch's own notes for this trip are never shown (see loadWatches).
    func travelUpdates(trip: LiveTripRecord, state st: LiveTripState, services: [ServiceResponse?], now: Date, replay: Bool) {
        let steps = TravelUpdates.steps(record: trip, state: st, services: services, now: now)
        var ledger = travelLedger
        let a = ledger.update(steps, now: now, canSchedule: !replay)
        travelLedger = ledger
        let id = { (k: String) in TravelUpdateLedger.identifier(started: trip.started, key: k) }
        Notifier.cancelTravel(ids: a.cancel.map(id))
        for k in a.skipped { ReplayLog.shared.add("step passed while away, not said late: " + k) }
        for s in a.schedule { Notifier.travel(s, id: id(s.key), at: s.at, now: now) }
        for s in a.post { Notifier.travel(s, id: id(s.key), at: nil, now: now) }
        // With the app in front the system shows nothing, so show the step here too.
        if isActive {
            for s in a.shown + a.post where s.kind != .arrived {
                show(Banner(title: s.title, detail: s.body, symbol: s.kind == .change ? "arrow.triangle.swap" : "bell.fill"))
                success()
            }
        }
    }

    /// Connection warnings, once per change: in app, and as an alert.
    private func liveAlerts(trip: LiveTripRecord, state st: LiveTripState) {
        for c in st.connections {
            if c.risk == "miss", liveAlerted.insert("miss\(c.index)").inserted {
                let body = "Live times leave \(abs(c.spare)) min too little to catch the \(c.nextLine) at \(Naming.short(c.at))."
                Notifier.post(title: "Connection at risk", body: body, id: "live-miss\(c.index)-\(trip.started.timeIntervalSince1970)")
                show(Banner(title: "Connection at risk", detail: body, symbol: "exclamationmark.triangle.fill"))
            } else if c.risk == "tight", liveAlerted.insert("tight\(c.index)").inserted {
                let body = "\(max(0, c.spare)) min to catch the \(c.nextLine)."
                Notifier.post(title: "Tight change at \(Naming.short(c.at))", body: body, id: "live-tight\(c.index)-\(trip.started.timeIntervalSince1970)")
            }
        }
    }

    /// The share link for the live trip, made the first time you share.
    func liveShareURL() async -> URL? {
        guard let trip = liveTrip else { return nil }
        if let s = trip.share { return URL(string: s.url) }
        do {
            let s = try await api.share(device: device, title: trip.title, from: trip.from, to: trip.to, legs: trip.legs)
            if liveTrip?.started == trip.started { liveTrip?.share = s }
            if let st = liveState {
                try? await api.updateShare(s, leg: st.current, phase: st.phase, next: st.nextStop, stopsLeft: st.stopsLeft, eta: st.eta)
            }
            return URL(string: s.url)
        } catch {
            show(Banner(title: "Could not share the trip", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
            return nil
        }
    }

    func stopSharing() async {
        guard let s = liveTrip?.share else { return }
        liveTrip?.share = nil
        try? await api.endShare(s)
        show(Banner(title: "Sharing stopped", detail: "The link no longer works.", symbol: "link"))
    }

    /// End trip: deletes the share link and the server watch, and ends the Lock Screen card.
    /// On arrival the server watch is left to finish by itself, so it can say "arrived" once.
    func endLiveTrip(silent: Bool = false, keepServerWatch: Bool = false, cardFinished: Bool = false) async {
        guard let trip = liveTrip else { return }
        liveTask?.cancel()
        liveTask = nil
        liveTrip = nil
        liveState = nil
        liveServices = []
        if let s = trip.share { try? await api.endShare(s) }
        if !keepServerWatch, let id = trip.watchID { try? await api.unwatch(id: FlexID(id), device: device) }
        // Nothing more is said for this trip: take back what is scheduled and clear the old
        // steps off the Lock Screen (You've arrived stays when the trip ended by arriving).
        var ledger = travelLedger
        Notifier.cancelTravel(ids: ledger.end().map { TravelUpdateLedger.identifier(started: trip.started, key: $0) })
        travelLedger = ledger
        await Notifier.clearTravel(started: trip.started, keepArrived: cardFinished)
        ReplayLog.shared.add(cardFinished ? "trip ended, Lock Screen card says You've arrived and leaves in 2 min" : "trip ended, Lock Screen card ended")
        if !cardFinished { await LiveTripActivities.endAll() }
        if !silent {
            show(Banner(title: "Trip ended", symbol: "checkmark.circle.fill"))
            tap()
        }
    }
}

// MARK: Live Activity

@MainActor
enum LiveTripActivities {
    static func content(record: LiveTripRecord, state st: LiveTripState?, services: [ServiceResponse?] = []) -> LiveTripAttributes.ContentState {
        let i = min(max(st?.current ?? 0, 0), record.legs.count - 1)
        let leg = record.legs[i]
        var warning: String?
        if let c = st?.connections.first(where: { $0.risk != "ok" }) {
            warning = c.risk == "miss"
                ? "You'll likely miss the \(c.nextLine) at \(Naming.short(c.at))"
                : "Tight change at \(Naming.short(c.at)): \(max(0, c.spare)) min"
        }
        var progress = 0.0
        if i < services.count, let s = services[i], let m = s.mineIndex, let a = s.alightIndex, a > m {
            let n = s.nextIndex ?? m
            progress = Double(max(0, min(n, a) - m)) / Double(a - m)
        }
        let times = (st?.times.count ?? 0) > i ? st?.times[i] : nil
        return LiveTripAttributes.ContentState(
            line: leg.line ?? "", lineColorHex: leg.color ?? Mode(raw: leg.mode).fallbackHex, mode: leg.mode ?? "train",
            nextStop: st?.phase == "wait" ? Optional(LiveCardText.place(leg.from)) : st?.nextStop.map { LiveCardText.place($0) },
            stopsLeft: st?.stopsLeft, getOffAt: LiveCardText.place(leg.to ?? record.to.name),
            arrival: st?.eta ?? record.legs.last?.arrPlanned ?? Date().addingTimeInterval(1800),
            phase: LiveCardText.phase(st), warning: warning, progress: progress, fareLine: nil,
            towards: LiveCardText.place(leg.towards ?? leg.to), platform: leg.fromPlatform,
            departs: times?.dep ?? leg.planned, legArrives: times?.arr ?? leg.arrPlanned,
            destination: LiveCardText.place(record.to.name))
    }

    /// True while a card is being asked for, so a refresh cannot ask for a second one.
    private static var requesting = false

    /// Starts the one Lock Screen card for this trip. Every other card (an earlier trip, a
    /// followed service) is ended first.
    static func start(record: LiveTripRecord, state st: LiveTripState?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, !requesting else { return }
        requesting = true
        let c = content(record: record, state: st)
        let host = ActivityCardHost(attributes: LiveTripAttributes(title: record.title, legsCount: record.legs.count), content: c)
        Task { @MainActor in
            await LiveCardRule.startOne(on: host)
            LiveActivities.shared.forgetAll()
            requesting = false
        }
    }

    static func update(record: LiveTripRecord, state st: LiveTripState, services: [ServiceResponse?]) {
        let c = content(record: record, state: st, services: services)
        let cards = Activity<LiveTripAttributes>.activities
        // Never two cards for one trip.
        for extra in cards.dropFirst() { Task { await extra.end(nil, dismissalPolicy: .immediate) } }
        if let a = cards.first {
            Task { await a.update(ActivityContent(state: c, staleDate: c.arrival.addingTimeInterval(30))) }
        } else if !st.done && !requesting && Activity<TripActivityAttributes>.activities.isEmpty {
            start(record: record, state: st)
        }
    }

    static func endAll() async {
        for a in Activity<LiveTripAttributes>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// At arrival: the card says "You've arrived at X" and leaves the Lock Screen 2 minutes later.
    static func finish(record: LiveTripRecord, state st: LiveTripState?) async {
        var c = content(record: record, state: st)
        c.phase = "arrived"
        for a in Activity<LiveTripAttributes>.activities {
            await a.end(ActivityContent(state: c, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(120)))
        }
    }
}

/// ActivityKit behind LiveCardRule: every trip and service card, and a trip card to ask for.
@MainActor
final class ActivityCardHost: LiveCardHost {
    let attributes: LiveTripAttributes
    let content: LiveTripAttributes.ContentState

    init(attributes: LiveTripAttributes, content: LiveTripAttributes.ContentState) {
        self.attributes = attributes
        self.content = content
    }

    var cardIDs: [String] {
        Activity<LiveTripAttributes>.activities.map(\.id) + Activity<TripActivityAttributes>.activities.map(\.id)
    }

    func endCard(_ id: String) async {
        for a in Activity<LiveTripAttributes>.activities where a.id == id { await a.end(nil, dismissalPolicy: .immediate) }
        for a in Activity<TripActivityAttributes>.activities where a.id == id { await a.end(nil, dismissalPolicy: .immediate) }
    }

    func requestCard() throws -> String {
        try Activity.request(attributes: attributes,
                             content: ActivityContent(state: content, staleDate: content.arrival.addingTimeInterval(30)),
                             pushType: nil).id
    }
}

// MARK: Home bar

/// "Trip in progress" on Home: tap to open the live trip.
struct LiveTripBar: View {
    var record: LiveTripRecord
    var state: LiveTripState?
    var open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: "location.north.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.green, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Trip in progress").font(.subheadline.weight(.semibold))
                    Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if let eta = state?.eta {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("Arrive").font(.caption2).foregroundStyle(.secondary)
                        Text(Clock.time(eta)).font(.headline).monospacedDigit()
                    }
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Trip in progress, \(detail)")
        .accessibilityIdentifier("tripInProgress")
    }

    private var detail: String {
        guard let st = state else { return record.title }
        if st.done { return "Arrived at \(Naming.short(record.to.name))" }
        if st.phase == "wait" { return "Board at \(Naming.short(record.legs[min(st.current, record.legs.count - 1)].from ?? ""))" }
        if let n = st.nextStop { return "Next stop: \(n)" }
        return record.title
    }
}

// MARK: Live trip screen

struct LiveTripView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var camera: MapCameraPosition = .automatic
    @State private var location = LocationFinder()
    @State private var askLocation = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                map
                VStack(spacing: 0) {
                    Capsule()
                        .fill(Color(.tertiaryLabel))
                        .frame(width: 36, height: 5)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                        .accessibilityHidden(true)
                    LiveTripSheet(onEnd: { dismiss() }, askLocation: { askLocation = true })
                        .environment(store)
                }
                .frame(height: geo.size.height * 0.56)
                .background(Color(.systemGroupedBackground))
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 12, y: -2)
            }
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .top) {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.down")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(.regularMaterial, in: Circle())
                    }
                    .accessibilityLabel("Hide live trip")
                    .accessibilityIdentifier("hideLiveTrip")
                    Spacer()
                    Button { frameTrip() } label: {
                        Image(systemName: "location.fill")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(.regularMaterial, in: Circle())
                    }
                    .accessibilityLabel("Show the whole trip")
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
        }
        .alert("Show where you are?", isPresented: $askLocation) {
            Button("Continue") { location.request() }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("Your location stays on this iPhone. It is only used to show you on the map.")
        }
        .onChange(of: store.liveTrip == nil) { _, ended in
            if ended { dismiss() }
        }
        .task {
            if store.liveTrip != nil { await store.refreshLive() }
            frameTrip()
        }
        .onChange(of: frameKey) { _, _ in frameTrip() }
    }

    private var map: some View {
        Map(position: $camera) {
            UserAnnotation()
            ForEach(lines, id: \.index) { line in
                MapPolyline(coordinates: line.coords)
                    .stroke(colorFor(line.index), lineWidth: 5)
            }
            ForEach(vehicles, id: \.index) { v in
                Annotation(v.line, coordinate: v.coordinate) {
                    Text(v.line)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(Circle().fill(colorFor(v.index)))
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
            ForEach(stopPins, id: \.id) { p in
                Annotation(p.name, coordinate: p.coordinate) {
                    Circle().fill(.white).frame(width: 10, height: 10)
                        .overlay(Circle().stroke(colorFor(p.leg), lineWidth: 3))
                }
            }
        }
        .ignoresSafeArea()
    }

    private struct VehiclePin { var index: Int; var line: String; var coordinate: CLLocationCoordinate2D }
    private struct LinePath { var index: Int; var coords: [CLLocationCoordinate2D] }

    /// Only the part of each service you ride, boarding stop to the stop you get off at, not the
    /// whole line out to Penrith.
    private var lines: [LinePath] {
        var out: [LinePath] = []
        for (i, s) in store.liveServices.enumerated() {
            guard let s else { continue }
            let pts = LegMap.ridden(s)
            guard pts.count > 1 else { continue }
            out.append(LinePath(index: i, coords: pts.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }))
        }
        return out
    }

    /// The trip's frame: the ridden parts plus where you are, with padding.
    private var tripRegion: MKCoordinateRegion? {
        var pts = store.liveServices.compactMap { $0 }.flatMap { LegMap.ridden($0) }
        // You are added when you are near the trip, so a far away phone does not zoom out to the state.
        if let c = location.coordinate, let base = LegMap.frame(pts),
           abs(c.latitude - base.center.lat) < max(base.latSpan, 0.05), abs(c.longitude - base.center.lon) < max(base.lonSpan, 0.05) {
            pts.append(GeoPoint(c.latitude, c.longitude))
        }
        guard let f = LegMap.frame(pts) else { return nil }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: f.center.lat, longitude: f.center.lon),
                                  span: MKCoordinateSpan(latitudeDelta: f.latSpan, longitudeDelta: f.lonSpan))
    }

    /// Changes when the first service answers arrive, so the map frames itself once they do.
    private var frameKey: Int {
        store.liveServices.compactMap { $0 }.count
    }

    private func frameTrip() {
        if let r = tripRegion { camera = .region(r) } else { camera = .automatic }
    }
    private struct StopPin { var id: String; var leg: Int; var name: String; var coordinate: CLLocationCoordinate2D }

    private var vehicles: [VehiclePin] {
        var out: [VehiclePin] = []
        for (i, s) in store.liveServices.enumerated() {
            guard let s, let v = s.vehicle else { continue }
            out.append(VehiclePin(index: i, line: s.line ?? store.liveTrip?.legs[safe: i]?.line ?? "", coordinate: CLLocationCoordinate2D(latitude: v.lat, longitude: v.lon)))
        }
        return out
    }

    private var stopPins: [StopPin] {
        var out: [StopPin] = []
        for (i, s) in store.liveServices.enumerated() {
            guard let s else { continue }
            for idx in [s.mineIndex, s.alightIndex].compactMap({ $0 }) where s.stops.indices.contains(idx) {
                let st = s.stops[idx]
                if let la = st.lat, let lo = st.lon {
                    out.append(StopPin(id: "\(i)-\(idx)", leg: i, name: Naming.short(st.name), coordinate: CLLocationCoordinate2D(latitude: la, longitude: lo)))
                }
            }
        }
        return out
    }

    private func colorFor(_ i: Int) -> Color {
        let leg = store.liveTrip?.legs[safe: i]
        return Color(hex: leg?.color ?? Mode(raw: leg?.mode).fallbackHex)
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// The bottom sheet: arrival, countdown, the current step, warnings, stops left, Share and End trip.
struct LiveTripSheet: View {
    var onEnd: () -> Void
    var askLocation: () -> Void
    @Environment(AppStore.self) private var store
    @State private var confirmEnd = false
    @State private var sharing = false

    var body: some View {
            List {
                if let trip = store.liveTrip {
                    let st = store.liveState
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(trip.title)
                                .font(.headline)
                                .lineLimit(1)
                            Text("Arrive at \(Naming.short(trip.to.name))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            HStack(alignment: .firstTextBaseline) {
                                Text(st.map { Clock.time($0.eta) } ?? "")
                                    .font(.largeTitle.weight(.bold))
                                    .monospacedDigit()
                                    .accessibilityIdentifier("liveArrival")
                                Spacer()
                                if let eta = st?.eta {
                                    TimelineView(.periodic(from: .now, by: 15)) { ctx in
                                        Text(Countdown.phrase(until: eta, now: ctx.date).capitalizedFirst)
                                            .font(.title3.weight(.semibold))
                                            .monospacedDigit()
                                    }
                                }
                            }
                            LiveBadge(isLive: st?.live == true, cancelled: false)
                        }
                        .accessibilityElement(children: .combine)
                    }

                    if let st {
                        Section {
                            stepCard(trip: trip, st: st)
                            ForEach(st.connections.filter { $0.risk != "ok" }, id: \.index) { c in
                                warning(c, trip: trip)
                            }
                        }
                        stopsSection(trip: trip, st: st)
                    }

                    Section {
                        if trip.share != nil {
                            Button("Stop sharing") { Task { await store.stopSharing() } }
                        }
                        Button { askLocation() } label: {
                            Label("Show where I am", systemImage: "location")
                        }
                    } footer: {
                        Text("A shared link shows your progress and arrival time, not your location. It stops working when the trip ends.")
                    }

                    Section("Your trip") {
                        ForEach(Array(trip.legs.enumerated()), id: \.offset) { i, l in
                            HStack(spacing: 10) {
                                LineBadge(line: l.line ?? "", colorHex: l.color, mode: l.mode, compact: true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(Naming.compact(Naming.short(l.from ?? ""))) to \(Naming.compact(Naming.short(l.to ?? "")))")
                                        .font(.subheadline.weight(.semibold))
                                    if let t = st?.times[safe: i] {
                                        Text("\(Clock.time(t.dep)) to \(Clock.time(t.arr))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .monospacedDigit()
                                    }
                                }
                                Spacer()
                                if i == st?.current && st?.done == false {
                                    Text("Now").font(.caption.weight(.bold)).foregroundStyle(.green)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .contentMargins(.top, 4, for: .scrollContent)
            .safeAreaInset(edge: .bottom) {
                if let trip = store.liveTrip {
                    HStack(spacing: 12) {
                        if store.config.isOn("shareTrip") {
                            Button {
                                Task {
                                    if let url = await store.liveShareURL() { shareURL = url; sharing = true }
                                }
                            } label: {
                                Label(trip.share == nil ? "Share trip" : "Share link", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("shareTrip")
                        }
                        Button(role: .destructive) { confirmEnd = true } label: {
                            Label("End trip", systemImage: "stop.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .accessibilityIdentifier("endTrip")
                    }
                    .controlSize(.large)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                    .background(.bar)
                }
            }
            .sheet(isPresented: $sharing) {
                if let url = shareURL {
                    ShareSheet(items: [url])
                }
            }
            .confirmationDialog("End this trip?", isPresented: $confirmEnd, titleVisibility: .visible) {
                Button("End trip", role: .destructive) {
                    Task {
                        await store.endLiveTrip()
                        onEnd()
                    }
                }
                .accessibilityIdentifier("confirmEndTrip")
                Button("Keep going", role: .cancel) {}
            } message: {
                Text("Alerts for this trip stop and any shared link stops working.")
            }
    }

    @State private var shareURL: URL?

    @ViewBuilder
    private func stepCard(trip: LiveTripRecord, st: LiveTripState) -> some View {
        let leg = trip.legs[min(st.current, trip.legs.count - 1)]
        HStack(alignment: .top, spacing: 12) {
            LineBadge(line: leg.line ?? "", colorHex: leg.color, mode: leg.mode, compact: false)
            VStack(alignment: .leading, spacing: 4) {
                if st.done {
                    Text("You have arrived").font(.headline)
                } else if st.phase == "wait" {
                    Text("Board the \(leg.line ?? "") at \(Naming.short(leg.from ?? ""))").font(.headline)
                    Text("Leaves \(Clock.time(st.times[st.current].dep))\(leg.fromPlatform.map { ", \($0)" } ?? "")")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Text(st.nextStop.map { "Next stop: \($0)" } ?? "On the \(leg.line ?? "")").font(.headline)
                        .accessibilityIdentifier("liveNextStop")
                    Text(stopsText(st, leg: leg)).font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func stopsText(_ st: LiveTripState, leg: WatchLeg) -> String {
        let to = Naming.short(leg.to ?? "")
        guard let n = st.stopsLeft else { return "Get off at \(to)" }
        if n <= 1 { return "Get off at \(to)" }
        return "\(n) stops to \(to)"
    }

    private func warning(_ c: LiveTripState.Connection, trip: LiveTripRecord) -> some View {
        let miss = c.risk == "miss"
        return Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(miss ? "You'll likely miss the \(c.nextPlanned.map(Clock.time).map { "\($0) " } ?? "")\(c.nextLine) at \(Naming.short(c.at))" : "Tight change at \(Naming.short(c.at))")
                    .font(.subheadline.weight(.semibold))
                Text(miss ? "Live times leave \(abs(c.spare)) min too little." : "\(max(0, c.spare)) min to catch the \(c.nextLine).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(miss ? Color.red : Color.orange)
        }
        .accessibilityIdentifier("liveWarning")
    }

    @ViewBuilder
    private func stopsSection(trip: LiveTripRecord, st: LiveTripState) -> some View {
        let list = stopsLeft(st)
        if !list.isEmpty {
                Section("Stops") {
                    ForEach(list) { stop in
                        HStack {
                            Circle()
                                .fill(stop.alight == true ? Color.red : Color(.systemGray3))
                                .frame(width: 8, height: 8)
                            Text(Naming.short(stop.name))
                                .font(stop.alight == true ? .subheadline.weight(.semibold) : .subheadline)
                            Spacer()
                            if let t = stop.bestTime {
                                Text(Clock.time(t)).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
        }
    }

    /// The stops still to come on this leg, up to where you get off.
    private func stopsLeft(_ st: LiveTripState) -> [ServiceStop] {
        guard let s = store.liveServices[safe: st.current] ?? nil, let a = s.alightIndex, a >= 0, a < s.stops.count else { return [] }
        let start = max(s.mineIndex ?? 0, min(s.nextIndex ?? 0, a))
        guard start <= a else { return [] }
        return Array(s.stops[start...a]).filter { ($0.planned != nil || $0.estimated != nil) && $0.skipped != true }
    }
}

/// The system share sheet for the trip link.
struct ShareSheet: UIViewControllerRepresentable {
    var items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
