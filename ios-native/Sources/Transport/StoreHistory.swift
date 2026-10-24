import SwiftUI
import WidgetKit
import TransportKit

/// The last Clear, with a way to put it back.
struct UndoAction: Identifiable {
    let id = UUID()
    var title: String
    var undo: () -> Void
}

// Build 9: your history, your control; fares, access and lift alerts; profile links.
extension AppStore {
    // MARK: Recents

    func forgetStop(_ id: String) {
        recents.removeAll { $0.id == id }
        tap()
    }

    func clearRecentTrips() {
        let old = recentTrips
        guard !old.isEmpty else { return }
        recentTrips = []
        offerUndo("Recent trips cleared") { [weak self] in self?.recentTrips = old }
    }

    func clearRecentStops() {
        let old = recents
        guard !old.isEmpty else { return }
        recents = []
        offerUndo("Recent stops cleared") { [weak self] in self?.recents = old }
    }

    func offerUndo(_ title: String, undo: @escaping () -> Void) {
        let u = UndoAction(title: title, undo: undo)
        withAnimation(.snappy) { self.undo = u }
        tap()
        let id = u.id
        Task {
            try? await Task.sleep(for: .seconds(5))
            if self.undo?.id == id { withAnimation(.easeOut(duration: 0.25)) { self.undo = nil } }
        }
    }

    // MARK: Saved trips and commutes

    func deleteSavedTrip(name: String) async {
        saved.removeAll { $0.name == name }
        tap()
        try? await api.deleteSaved(name: name)
        await loadSaved()
        if liftAlerts { await syncLiftAlerts(announce: false) }
    }

    /// Saving under a new name replaces the old trip on the server too.
    func renameSavedTrip(_ old: SavedTrip, to name: String) async {
        let clean = name.trimmingCharacters(in: .whitespaces).lowercased()
        guard !clean.isEmpty, clean != old.name else { return }
        do {
            try await api.saveTrip(name: clean, from: old.from, to: old.to)
            try? await api.deleteSaved(name: old.name)
            await loadSaved()
            show(Banner(title: "Saved as \(clean)", symbol: "bookmark.fill"))
            success()
        } catch {
            show(Banner(title: "Could not save", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }

    /// Replaces a trip made with New trip, keeping its place in your order.
    func updateMyTrip(oldKey: String, _ t: MyTrip) {
        var list = myTrips
        if let i = list.firstIndex(where: { $0.id == oldKey }) { list[i] = t } else { list.insert(t, at: 0) }
        myTrips = list
        if oldKey != t.id { tripOrder = tripOrder.map { $0 == oldKey ? t.id : $0 } }
        show(Banner(title: "Saved \(t.name)", symbol: "bookmark.fill"))
        success()
    }

    func deleteCommute(_ c: Commute) async {
        commutes.removeAll { $0.id == c.id }
        tap()
        try? await api.deleteCommute(id: c.id)
        await loadCommutes()
    }

    // MARK: Multi leg trips from Ask

    /// Opens a multi leg trip on the Trips tab.
    func openTrip(legs: [TripLeg]) {
        guard !legs.isEmpty else { return }
        tab = .home
        pendingRoute = .legs(legs)
    }

    /// Saves a trip from Ask on this phone, and on the server so /api/next, Siri and WhatsApp plan the whole trip.
    func saveTrip(legs: [TripLeg]) async {
        guard let first = legs.first, let last = legs.last else { return }
        let name = "\(Naming.compact(Naming.short(first.from.name))) to \(Naming.compact(Naming.short(last.to.name)))"
        let trip = MyTrip(name: name, from: first.from, to: last.to,
                          via: legs.count == 2 ? first.to : nil,
                          conn: legs.count == 2 ? (legs[1].conn ?? 5) : nil,
                          modes: legs.map { ($0.mode ?? "").isEmpty ? "search" : $0.mode! },
                          legs: legs.count > 2 ? legs : nil)
        saveMyTrip(trip)
        try? await api.saveTrip(name: name.lowercased(), legs: legs)
        await loadSaved()
        if liftAlerts { await syncLiftAlerts(announce: false) }
    }

    // MARK: Delete history

    /// Deletes the trip searches the server keeps for this install.
    func deleteServerHistory() async {
        do {
            let r = try await api.deleteHistory(scope: "history", device: device)
            let n = r.deleted?.searches ?? 0
            show(Banner(title: n == 1 ? "Deleted 1 trip search" : "Deleted \(n) trip searches", symbol: "trash.fill"))
            suggestion = nil
            success()
        } catch {
            show(Banner(title: "Could not delete", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }

    /// Deletes everything on this phone and on the server, except this install's ids.
    func deleteAllData() async {
        do {
            _ = try await api.deleteHistory(scope: "all", device: device)
        } catch {
            show(Banner(title: "Could not delete from the server", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
            return
        }
        await endLiveTrip(silent: true)
        await LiveActivities.shared.endAll()
        let keep: Set<String> = ["device", "apiProfile"]
        let std = UserDefaults.standard
        for k in std.dictionaryRepresentation().keys where !keep.contains(k) { std.removeObject(forKey: k) }
        let group = AppIdentity.groupDefaults
        for k in group.dictionaryRepresentation().keys where !keep.contains(k) { group.removeObject(forKey: k) }
        starred = []
        recents = []
        recentTrips = []
        homePlace = nil
        workPlace = nil
        myTrips = []
        tripOrder = []
        allServices = []
        saved = []
        commutes = []
        suggestion = nil
        watches = []
        notes = []
        fareType = "adult"
        accessibleTrips = false
        liftAlerts = false
        WidgetCenter.shared.reloadAllTimelines()
        show(Banner(title: "All your data is deleted", detail: "On this phone and on the server.", symbol: "trash.fill"))
        success()
    }

    // MARK: Profile links

    /// Switches this install to the profile from a link you confirmed, then reloads your trips.
    func adoptProfile(_ profile: String?) async {
        guard let p = profile else { return }
        pendingProfile = nil
        guard AppIdentity.adopt(p) else {
            show(Banner(title: "That profile link is not valid", symbol: "exclamationmark.triangle.fill"))
            return
        }
        async let a: Void = loadSaved()
        async let b: Void = loadCommutes()
        async let c: Void = loadWatches(notify: false)
        _ = await (a, b, c)
        WidgetCenter.shared.reloadAllTimelines()
        show(Banner(title: "Profile switched", detail: "Your saved trips are loaded.", symbol: "person.crop.circle.badge.checkmark"))
        success()
    }

    /// An install still on the old shared test profile moves to a fresh private id and saves its trips again.
    func moveOffSharedProfile() async {
        guard AppIdentity.sharedProfiles.contains(AppIdentity.profile) else { return }
        let old = (try? await api.saved()) ?? []
        let fresh = AppIdentity.newProfileID()
        UserDefaults.standard.set(fresh, forKey: "apiProfile")
        AppIdentity.groupDefaults.set(fresh, forKey: "apiProfile")
        for s in old { try? await api.saveTrip(name: s.name, from: s.from, to: s.to) }
        await loadSaved()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Lift alerts

    /// Every station id on your trips: from, to, each change and home and work. Digits only, at most 40.
    var tripStationIDs: [String] {
        var ids: [String] = []
        func add(_ s: StopRef?) {
            guard let s, !s.id.isEmpty, s.id.allSatisfy(\.isNumber), !ids.contains(s.id) else { return }
            ids.append(s.id)
        }
        for t in myTrips {
            add(t.from); add(t.via); add(t.to)
            for l in t.legs ?? [] { add(l.from); add(l.to) }
        }
        for s in saved { add(s.from); add(s.to) }
        for c in commutes { add(c.from); add(c.to) }
        add(homePlace); add(workPlace)
        return Array(ids.prefix(40))
    }

    func setLiftAlerts(_ on: Bool) async {
        liftAlerts = on
        if on { await Notifier.requestPermission() }
        await syncLiftAlerts(announce: on)
    }

    func syncLiftAlerts(announce: Bool) async {
        do {
            let now = try await api.liftAlerts(on: liftAlerts, stations: tripStationIDs, device: device)
            if announce, liftAlerts {
                if let first = now.first {
                    show(Banner(title: now.count == 1 ? "1 lift out on your trips" : "\(now.count) lifts out on your trips", detail: first, symbol: "figure.roll"))
                } else {
                    show(Banner(title: "Lift outage alerts on", detail: "For stations on your saved trips.", symbol: "figure.roll"))
                }
            }
        } catch {
            if announce {
                show(Banner(title: "Could not turn on lift alerts", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
            }
        }
    }
}

/// The small bar with Undo after a Clear.
struct UndoToast: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        if let u = store.undo {
            HStack(spacing: 12) {
                Text(u.title).font(.subheadline.weight(.semibold))
                Spacer()
                Button("Undo") {
                    u.undo()
                    withAnimation(.snappy) { store.undo = nil }
                    store.tap()
                }
                .font(.subheadline.weight(.bold))
                .accessibilityIdentifier("undoClear")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .contain)
        }
    }
}
