import SwiftUI
import TransportKit

/// A to B planner with live leave in countdowns.
struct TripPlannerView: View {
    @Environment(AppStore.self) private var store
    @State var from: StopRef? = nil
    @State var to: StopRef? = nil
    @State private var picking: PickTarget?
    @State private var data: TripResponse?
    @State private var updated: Date?
    @State private var loading = false
    @State private var error: String?

    enum PickTarget: String, Identifiable { case from, to; var id: String { rawValue } }

    var body: some View {
        List {
            Section {
                PlaceField(label: "From", place: from) { picking = .from }
                    .accessibilityIdentifier("fromField")
                PlaceField(label: "To", place: to) { picking = .to }
                    .accessibilityIdentifier("toField")
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
                Section {
                    UpdatedLine(updated: updated, isLoading: loading, liveCount: nil)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                }
                if let error, data == nil {
                    Section { ContentUnavailableView("No trips found", systemImage: "point.topleft.down.to.point.bottomright.curvepath", description: Text(error)) }
                }
                if let journeys = data?.journeys {
                    Section(data?.tomorrow == true ? "Tomorrow" : "Next trips") {
                        ForEach(journeys) { j in
                            NavigationLink {
                                JourneyDetailView(journey: j, from: from!, to: to!)
                            } label: {
                                JourneyRow(journey: j)
                            }
                            .accessibilityIdentifier("journey")
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    Task { await store.watch(j.watchRequest(device: store.device, profile: store.api.profile, from: from!, to: to!)) }
                                } label: { Label("Watch", systemImage: "bell.fill") }
                                .tint(.indigo)
                            }
                        }
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
        .onChange(of: from) { _, _ in data = nil; Task { await load() } }
        .onChange(of: to) { _, _ in data = nil; Task { await load() } }
        .appHaptics()
    }

    private func load() async {
        guard let from, let to else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await store.api.trip(from: from.id, to: to.id, count: 5)
            withAnimation(.snappy) { data = r }
            updated = Date()
            if !r.journeys.isEmpty { store.rememberTrip(from: from, to: to) }
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
    @Environment(AppStore.self) private var store
    @State private var selected: ServiceKey?
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

            Section {
                HStack(spacing: 10) {
                    Button {
                        Task { await store.watch(journey.watchRequest(device: store.device, profile: store.api.profile, from: from, to: to)) }
                    } label: { Label("Watch trip", systemImage: "bell.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    Button {
                        Task { await LiveActivities.shared.start(journey: journey, from: from, to: to) }
                        store.success()
                    } label: { Label("Lock Screen", systemImage: "platter.filled.bottom.iphone").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                }
                .controlSize(.large)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section("Your trip") {
                ForEach(Array(journey.legs.enumerated()), id: \.offset) { i, leg in
                    if leg.isWalk {
                        Label(walkText(leg), systemImage: "figure.walk")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        Button { selected = ServiceKey(leg) } label: {
                            LegCard(leg: leg, changeMinutes: changeMinutes(before: i))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Section {
                Button { naming = true } label: { Label("Save as a named trip", systemImage: "bookmark") }
                Button {
                    let tod = Clock.minuteOfDay(journey.leave ?? Date())
                    Task { await store.makeCommute(from: from, to: to, tod: tod, name: nil) }
                } label: { Label("Make this my commute", systemImage: "clock.arrow.circlepath") }
            } footer: {
                Text("A named trip like home works here and in WhatsApp. A commute gets a leave now alert every weekday.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("\(Naming.short(from.name)) to \(Naming.short(to.name))")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $selected) { key in ServiceView(key: key) }
        .alert("Name this trip", isPresented: $naming) {
            TextField("home", text: $name)
            Button("Save") { Task { await store.saveTrip(name: name.lowercased(), from: from, to: to) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Then type the name to get the next live services.")
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
                LiveBadge(isLive: leg.isLive, cancelled: leg.cancelled == true)
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
                Label("Track", systemImage: "map").labelStyle(.titleAndIcon).foregroundStyle(.tint)
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
