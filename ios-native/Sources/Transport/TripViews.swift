import SwiftUI
import TransportKit

/// A to B planner with live leave in countdowns.
struct TripPlannerView: View {
    @Environment(AppStore.self) private var store
    @State var from: StopRef? = nil
    @State var to: StopRef? = nil
    /// Set for an extended trip: the connection stop, and the minutes needed to change there.
    var via: StopRef? = nil
    var conn: Int = 5
    /// Set for a trip of 3 or more legs, from Ask or a saved trip.
    var legs: [TripLeg]? = nil
    @State private var picking: PickTarget?
    @State private var data: TripResponse?
    @State private var updated: Date?
    @State private var loading = false
    @State private var error: String?
    @State private var extra: [Journey] = []
    @State private var showDuration = false
    @State private var loadingMore = false

    enum PickTarget: String, Identifiable { case from, to; var id: String { rawValue } }

    var body: some View {
        List {
            Section {
                PlaceField(label: "From", place: from) { picking = .from }
                    .accessibilityIdentifier("fromField")
                PlaceField(label: "To", place: to) { picking = .to }
                    .accessibilityIdentifier("toField")
                if let legs, legs.count > 2 {
                    HStack {
                        Text("Via")
                            .foregroundStyle(.secondary)
                            .frame(width: 48, alignment: .leading)
                        Text(legs.dropLast().map { Naming.compact(Naming.short($0.to.name)) }.joined(separator: ", "))
                        Spacer()
                        Text("\(legs.count) legs")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("viaRow")
                } else if let via {
                    HStack {
                        Text("Via")
                            .foregroundStyle(.secondary)
                            .frame(width: 48, alignment: .leading)
                        Text(Naming.short(via.name))
                        Spacer()
                        Text("\(conn) min to change")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("viaRow")
                }
            } footer: {
                HStack {
                    Spacer()
                    Button {
                        let a = from
                        from = to
                        to = a
                        store.tap()
                    } label: { Label("Swap", systemImage: "arrow.up.arrow.down") }
                    .font(.footnote.weight(.semibold))
                    .disabled(from == nil && to == nil)
                }
            }

            if from != nil && to != nil {
                if let error, data == nil {
                    Section { ContentUnavailableView("No trips found", systemImage: "point.topleft.down.to.point.bottomright.curvepath", description: Text(error)) }
                }
                if data != nil {
                    let picked = TripPlan.directFilter(merged, extended: via != nil, all: showAll || (legs?.count ?? 0) > 2)
                    let journeys = picked.list
                    let alerts = Self.uniqueAlerts(journeys)
                    let lifts = Array(Set(journeys.compactMap(\.liftOutage))).sorted()
                    if !alerts.isEmpty || !lifts.isEmpty {
                        Section {
                            ForEach(lifts, id: \.self) { out in
                                Label("Lift out: \(out)", systemImage: "figure.roll")
                                    .font(.subheadline)
                                    .foregroundStyle(.red)
                            }
                            if !alerts.isEmpty {
                            NavigationLink { AlertsList(alerts: alerts) } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Service information").font(.body.weight(.semibold))
                                        Text(alerts.count == 1 ? "1 alert. Tap for details." : "\(alerts.count) alerts. Tap for details.")
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                                }
                            }
                            }
                        }
                    }
                    if let f = journeys.first?.fare {
                        Section { FareBar(fare: f) }
                    }
                    if let p = data?.parking, let parks = p.carparks, !parks.isEmpty {
                        Section {
                            ForEach(parks) { c in CarParkRow(park: c, station: p.station?.name) }
                        } header: {
                            Text("Park and Ride at \(Naming.compact(Naming.short(p.station?.name ?? from?.name ?? "")))")
                        } footer: {
                            Text("Live spaces from the Transport for NSW Car Park API, live.")
                        }
                    }
                    if store.accessibleTrips {
                        Section {
                            Label(journeys.isEmpty ? "Step free trips only. None found for this trip." : "Step free trips only.", systemImage: "figure.roll")
                                .font(.subheadline)
                                .accessibilityIdentifier("accessibleNotice")
                        }
                    }
                    Section {
                        Picker("Show", selection: $showDuration) {
                            Text("Departs in").tag(false)
                            Text("Travel time").tag(true)
                        }
                        .pickerStyle(.segmented)
                        Toggle("All services", isOn: allServicesBinding)
                            .accessibilityIdentifier("allServices")
                    } footer: {
                        Text(showAll
                             ? "Every service, including ones with a change on the way."
                             : picked.fellBack
                                ? "Nothing runs direct right now, so every service is shown."
                                : (via == nil ? "Only services that stop at both ends." : "Only services that stop at both ends of each leg."))
                    }
                    Section {
                        moreButton("Earlier services", direction: -1)
                        ForEach(journeys) { j in
                            NavigationLink(value: JourneyLink(journey: j, from: from!, to: to!, legs: legs)) {
                                ServiceRow(journey: j, status: ServiceStatus.of(j), dimmed: HomeBoard.isBeaten(j, among: journeys), showDuration: showDuration, showLift: false)
                            }
                            .accessibilityIdentifier("journey")
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    Task { await store.watch(j.watchRequest(device: store.device, profile: store.api.profile, from: from!, to: to!)) }
                                } label: { Label("Watch", systemImage: "bell.fill") }
                                .tint(.indigo)
                            }
                        }
                        moreButton("Later services", direction: 1)
                    } header: {
                        Text(data?.tomorrow == true ? "Tomorrow" : "Next trips")
                    } footer: {
                        UpdatedLine(updated: updated, isLoading: loading, liveCount: nil)
                    }
                }
            } else {
                Section {
                    ContentUnavailableView("Where to?", systemImage: "map", description: Text("Pick where you are starting and where you are going."))
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Plan a trip")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $picking) { target in
            StopPicker(title: target == .from ? "From" : "To") { stop in
                if target == .from { from = stop } else { to = stop }
                picking = nil
            }
            .presentationDetents([.large])
            .environment(store)
        }
        .refreshable { await load() }
        .autoRefresh(every: max(store.refreshSeconds, 20), active: store.isActive && from != nil && to != nil) { await load() }
        .onChange(of: from) { _, _ in data = nil; extra = []; Task { await load() } }
        .onChange(of: to) { _, _ in data = nil; extra = []; Task { await load() } }
        .onChange(of: showAll) { _, _ in if via != nil || legs != nil { extra = []; Task { await load() } } }
        .onChange(of: store.fareType) { _, _ in Task { await load() } }
        .onChange(of: store.accessibleTrips) { _, _ in data = nil; extra = []; Task { await load() } }
        .appHaptics()
    }

    private var tripKey: String? {
        guard let from, let to else { return nil }
        if let legs, legs.count > 2 { return TripLeg.key(legs) }
        return TripKey.of(from: from, via: via, to: to)
    }

    private var showAll: Bool { tripKey.map { store.showsAllServices($0) } ?? false }

    /// Saved per trip, like the web and Android apps.
    private var allServicesBinding: Binding<Bool> {
        Binding(get: { showAll }, set: { on in
            if let k = tripKey { withAnimation(.snappy) { store.setAllServices(k, on) } }
        })
    }

    /// The loaded journeys plus any earlier or later ones, each once, in leave order.
    private var merged: [Journey] {
        var seen = Set<String>()
        var out: [Journey] = []
        for j in (data?.journeys ?? []) + extra where seen.insert(j.id).inserted {
            out.append(j)
        }
        let cutoff = Date().addingTimeInterval(-30 * 60)
        return out
            .filter { ($0.leave ?? .distantFuture) > cutoff }
            .sorted { ($0.leave ?? .distantFuture) < ($1.leave ?? .distantFuture) }
    }

    private func moreButton(_ title: String, direction: Int) -> some View {
        Button {
            store.tap()
            Task { await more(direction) }
        } label: {
            HStack {
                Spacer()
                if loadingMore { ProgressView().controlSize(.small) }
                Text(title).font(.subheadline.weight(.semibold))
                Spacer()
            }
        }
        .disabled(loadingMore || merged.isEmpty)
        .accessibilityIdentifier(direction < 0 ? "earlierServices" : "laterServices")
    }

    /// Loads services before the first one shown, or after the last one.
    private func more(_ direction: Int) async {
        guard let from, let to else { return }
        let cur = merged
        guard let firstLeave = cur.first?.leave, let lastLeave = cur.last?.leave else { return }
        let t = direction < 0
            ? max(Date().addingTimeInterval(-25 * 60), firstLeave.addingTimeInterval(-40 * 60))
            : lastLeave.addingTimeInterval(60)
        let f = DateFormatter()
        f.dateFormat = "HHmm"
        f.timeZone = Clock.sydney
        f.locale = Locale(identifier: "en_AU_POSIX")
        loadingMore = true
        defer { loadingMore = false }
        if let r = try? await TripPlan.plan(api: store.api, from: from.id, via: via?.id, to: to.id, conn: conn, count: 5, time: f.string(from: t),
                                            legs: planLegs(from: from, to: to), all: showAll) {
            withAnimation(.snappy) { extra += r.journeys }
        }
    }

    /// The legs for /api/plan, or nil for a plain A to B trip.
    private func planLegs(from: StopRef, to: StopRef) -> [TripLeg]? {
        TripPlan.legs(from: from, via: via, to: to, conn: conn, legs: legs)
    }

    /// Alerts across all journeys, each once.
    static func uniqueAlerts(_ journeys: [Journey]) -> [ServiceAlert] {
        var seen = Set<String>()
        var out: [ServiceAlert] = []
        for a in journeys.flatMap({ $0.transitLegs.flatMap { $0.alerts ?? [] } }) where seen.insert(a.id).inserted {
            out.append(a)
        }
        return out
    }

    private func load() async {
        guard let from, let to else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await TripPlan.plan(api: store.api, from: from.id, via: via?.id, to: to.id, conn: conn, count: 5,
                                            legs: planLegs(from: from, to: to), all: showAll)
            withAnimation(.snappy) { data = r }
            updated = Date()
            if !r.journeys.isEmpty && via == nil && legs == nil { store.rememberTrip(from: from, to: to) }
            // A trip opened from a link only knows stop numbers; name them from the first journey.
            if from.name.hasPrefix("Stop "), let n = r.journeys.first?.legs.first?.from {
                self.from = StopRef(id: from.id, name: n)
            }
            if to.name.hasPrefix("Stop "), let n = r.journeys.first?.legs.last?.to {
                self.to = StopRef(id: to.id, name: n)
            }
            error = r.journeys.isEmpty ? "Nothing runs between these two right now." : nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct PlaceField: View {
    var label: String
    var place: StopRef?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .foregroundStyle(.secondary)
                    .frame(width: 48, alignment: .leading)
                Text(place.map { Naming.short($0.name) } ?? "Choose a stop")
                    .foregroundStyle(place == nil ? .tertiary : .primary)
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
    }
}

/// A search sheet that returns one stop.
struct StopPicker: View {
    var title: String
    var onPick: (StopRef) -> Void
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [StopRef] = []

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    if !store.starred.isEmpty {
                        Section("Starred") { ForEach(store.starred) { s in row(s) } }
                    }
                    if !store.recents.isEmpty {
                        Section("Recent") { ForEach(store.recents) { s in row(s) } }
                    }
                } else {
                    ForEach(results) { s in row(s) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Station, stop or number")
            .task(id: query) {
                let q = query.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2 else { results = []; return }
                try? await Task.sleep(for: .milliseconds(250))
                if let r = try? await store.api.search(q) { results = r }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func row(_ s: StopRef) -> some View {
        Button { onPick(s) } label: { StopRow(stop: s) }
            .accessibilityIdentifier("pickResult")
            .buttonStyle(.plain)
    }
}

struct JourneyRow: View {
    var journey: Journey

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                LegChain(legs: journey.legs)
                HStack(spacing: 6) {
                    if let l = journey.leave, let a = journey.arrive {
                        Text("\(Clock.time(l)) to \(Clock.time(a))").monospacedDigit()
                    }
                    if let d = journey.durationMin { Text("\(d) min").foregroundStyle(.secondary) }
                }
                .font(.subheadline)
                HStack(spacing: 6) {
                    if let f = journey.firstTransit {
                        StatusText(delayMin: f.delayMin, isLive: f.isLive, cancelled: f.cancelled == true)
                        if let p = f.fromPlatform, !p.isEmpty { Text(p).foregroundStyle(.secondary) }
                    }
                    if journey.risk == "tight" || journey.risk == "risk" || journey.risk == "miss" {
                        Label("Tight change", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                }
                .font(.footnote)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                if let l = journey.leave {
                    Text("Leave").font(.caption2).foregroundStyle(.secondary)
                    CountdownLabel(to: l, cancelled: journey.anyCancelled == true, isLive: journey.live == true)
                }
                LiveBadge(isLive: journey.live == true, cancelled: journey.anyCancelled == true)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Line badges joined by walking glyphs: [T1] > walk > [415].
struct LegChain: View {
    var legs: [Leg]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(legs.enumerated()), id: \.offset) { i, l in
                if i > 0 {
                    Image(systemName: "chevron.compact.right").font(.caption).foregroundStyle(.tertiary)
                }
                if l.isWalk {
                    HStack(spacing: 1) {
                        Image(systemName: "figure.walk")
                        if let d = l.durationMin, d > 0 { Text("\(d)").font(.caption2) }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    LineBadge(line: l.line ?? "", colorHex: l.color, mode: l.mode, compact: true)
                }
            }
        }
    }
}

struct JourneyDetailView: View {
    var journey: Journey
    var from: StopRef
    var to: StopRef
    var legs: [TripLeg]? = nil
    @Environment(AppStore.self) private var store
    @State private var naming = false
    @State private var name = "home"

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Leave").font(.subheadline).foregroundStyle(.secondary)
                            if let l = journey.leave {
                                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                                    Text(Countdown.phrase(until: l, now: ctx.date).capitalizedFirst)
                                        .font(.largeTitle.weight(.bold))
                                        .monospacedDigit()
                                        .contentTransition(.numericText(countsDown: true))
                                }
                            }
                        }
                        Spacer()
                        LiveBadge(isLive: journey.live == true, cancelled: journey.anyCancelled == true)
                    }
                    if let l = journey.leave, let a = journey.arrive {
                        Text("\(Clock.time(l)) to \(Clock.time(a)), \(journey.durationMin ?? 0) min, \(changesText)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            if !store.config.isOn("liveTrip") {
                // Paused from the server config: say so instead of a button that cannot work.
                Section {
                    Label(store.config.killMessage("liveTrip") ?? "Start trip is not available right now.", systemImage: "pause.circle")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("startTripPaused")
                }
            } else {
            Section {
                Button {
                    Task { await store.startLiveTrip(journey, from: from, to: to) }
                } label: {
                    Label("Start trip", systemImage: "location.north.line.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.large)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("startTrip")
                .accessibilityHint("Live map, next stop, alerts on the way and a Lock Screen countdown")
            } footer: {
                Text(store.config.text("startTripFooter", "Live map, next stop and alerts on the way, with a countdown on the Lock Screen. It ends when you arrive."))
            }
            }

            Section("Your trip") {
                ForEach(Array(journey.legs.enumerated()), id: \.offset) { i, leg in
                    if leg.isWalk {
                        Label(walkText(leg), systemImage: "figure.walk")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        // A value link: every stack that shows a trip knows how to open a service map.
                        NavigationLink(value: ServiceKey(leg)) {
                            LegCard(leg: leg, changeMinutes: changeMinutes(before: i))
                        }
                        .accessibilityIdentifier("legMap")
                        if leg.liftOutAtEnds {
                            LegAccessChips(leg: leg)
                        }
                    }
                }
                if let w = journey.warn, !w.isEmpty {
                    Label(w, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(journey.risk == "tight" ? Color.orange : Color.red)
                }
            }


            Section {
                Button { naming = true } label: { Label("Save trip", systemImage: "star") }
                    .accessibilityIdentifier("saveNamedTrip")
                if store.config.isOn("weekdayReminder") {
                    Button {
                        let tod = Clock.minuteOfDay(journey.leave ?? Date())
                        Task { await store.makeCommute(from: from, to: to, tod: tod, name: nil) }
                    } label: { Label("Remind me every weekday", systemImage: "clock.arrow.circlepath") }
                        .accessibilityIdentifier("makeCommute")
                }
            } footer: {
                Text("Saved trips show on Home with live times. A weekday reminder tells you when to leave, at this time.")
            }

            if let f = journey.fare {
                FareCard(fare: f)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("\(Naming.short(from.name)) to \(Naming.short(to.name))")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Save trip", isPresented: $naming) {
            TextField("home", text: $name)
            Button("Save") { Task { await store.saveTrip(name: name.lowercased(), from: from, to: to) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Give it a short name. Type the name in Ask to get the next services.")
        }
        .appHaptics()
    }

    private var changesText: String {
        let c = journey.changes ?? 0
        return c == 0 ? "no changes" : (c == 1 ? "1 change" : "\(c) changes")
    }

    private func walkText(_ l: Leg) -> String {
        let d = l.durationMin ?? 0
        return d <= 0 ? "Short walk" : "Walk \(d) min"
    }

    /// Minutes between the previous transit leg arriving and this one leaving.
    private func changeMinutes(before index: Int) -> Int? {
        let prev = journey.legs[..<index].last { !$0.isWalk }
        guard let p = prev?.arriveTime, let n = journey.legs[index].departTime else { return nil }
        return Int(n.timeIntervalSince(p) / 60)
    }
}

struct LegCard: View {
    var leg: Leg
    var changeMinutes: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let c = changeMinutes {
                Label(c <= 2 ? "Only \(max(c, 0)) min to change" : "\(c) min to change",
                      systemImage: c <= 2 ? "exclamationmark.triangle.fill" : "arrow.triangle.branch")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(c <= 2 ? Color.orange : Color.secondary)
            }
            HStack(spacing: 10) {
                LineBadge(line: leg.line ?? "", colorHex: leg.color, mode: leg.mode)
                Text("towards \(Naming.short(leg.towards ?? ""))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Naming.short(leg.from ?? "")).font(.body.weight(.semibold))
                    if let p = leg.fromPlatform, !p.isEmpty { Text(p).font(.footnote).foregroundStyle(.secondary) }
                }
                Spacer()
                TimePair(planned: leg.planned, estimated: leg.estimated, isLive: leg.isLive).font(.body)
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Naming.short(leg.to ?? "")).font(.body)
                    if let p = leg.toPlatform, !p.isEmpty { Text(p).font(.footnote).foregroundStyle(.secondary) }
                }
                Spacer()
                TimePair(planned: leg.arrPlanned, estimated: leg.arrEstimated, isLive: leg.realtime == true).font(.body)
            }
            HStack(spacing: 8) {
                StatusText(delayMin: leg.delayMin, isLive: leg.isLive, cancelled: leg.cancelled == true)
                if let n = leg.stops, n > 0 { Text("\(n) stops").foregroundStyle(.secondary) }
                CrowdView(occupancy: leg.occupancy)
                Spacer()
                Label("Map", systemImage: "map").labelStyle(.titleAndIcon).foregroundStyle(.tint)
            }
            .font(.footnote)
            if let from = leg.platformChangedFrom, !from.isEmpty {
                Label("Platform changed from \(from)", systemImage: "arrow.triangle.swap")
                    .font(.footnote.weight(.semibold)).foregroundStyle(.orange)
            }
            ForEach(leg.alerts ?? []) { a in
                Label(a.title ?? "Alert", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange).lineLimit(2)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
