import SwiftUI
import TransportKit

struct WatchingView: View {
    @Environment(AppStore.self) private var store
    @State private var permission: String = ""

    var body: some View {
        NavigationStack {
            List {
                let active = store.watches.filter { $0.active == true }
                let ended = store.watches.filter { $0.active != true }
                if active.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("Nothing watched yet", systemImage: "bell.slash")
                        } description: {
                            Text("Swipe left on any service, or tap Watch on a trip. I follow it live and tell you when to leave, if it runs late, changes platform or your connection is at risk.")
                        }
                    }
                } else {
                    Section("Now") {
                        ForEach(active) { w in
                            WatchRow(watch: w)
                                .swipeActions {
                                    Button(role: .destructive) { Task { await store.unwatch(w) } } label: {
                                        Label("Stop", systemImage: "bell.slash.fill")
                                    }
                                }
                        }
                    }
                }
                if !store.notes.isEmpty {
                    Section("Recent alerts") {
                        ForEach(store.notes) { n in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(n.title ?? "Update").font(.subheadline.weight(.semibold))
                                    Spacer()
                                    if let at = n.at {
                                        Text(Clock.time(Date(timeIntervalSince1970: at / 1000)))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                if let b = n.body { Text(b).font(.subheadline).foregroundStyle(.secondary) }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if !ended.isEmpty {
                    Section("Finished") {
                        ForEach(ended) { w in WatchRow(watch: w).opacity(0.6) }
                    }
                }
                Section {
                    Label(permission, systemImage: "app.badge")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } footer: {
                    Text("Alerts reach you as notifications while the app runs and when iPhone gives it a background refresh. Turn on Lock Screen for a service to keep a live countdown there.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Watching")
            .refreshable { await store.loadWatches(notify: true) }
            .autoRefresh(every: 20, active: store.isActive) { await store.loadWatches(notify: true) }
            .task { await readPermission() }
            .appHaptics()
        }
    }

    private func readPermission() async {
        switch await Notifier.status() {
        case .authorized, .provisional, .ephemeral: permission = "Notifications are on"
        case .denied: permission = "Notifications are off. Turn them on in Settings, Transport."
        default: permission = "You will be asked to allow notifications when you watch your first trip"
        }
    }
}

struct WatchRow: View {
    var watch: Watch

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let l = watch.legs?.first {
                LineBadge(line: l.line ?? "", colorHex: l.color, mode: l.mode)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(Naming.compact(watch.title ?? "Trip")).font(.body.weight(.semibold)).lineLimit(1)
                Text(phaseText).font(.footnote).foregroundStyle(.secondary)
                if let snap = watch.snap?.legs?.first {
                    HStack(spacing: 6) {
                        StatusText(delayMin: snap.delay, isLive: snap.depLive == true, cancelled: snap.cancelled == true)
                        if let p = snap.platform, !p.isEmpty { Text(p).foregroundStyle(.secondary) }
                        if let pf = snap.platformFrom, !pf.isEmpty {
                            Text("was \(pf)").foregroundStyle(.orange)
                        }
                    }
                    .font(.footnote)
                }
            }
            Spacer(minLength: 4)
            if let dep = departure, watch.active == true {
                CountdownLabel(to: dep, cancelled: watch.snap?.legs?.first?.cancelled == true,
                               isLive: watch.snap?.legs?.first?.depLive == true)
            }
        }
        .padding(.vertical, 4)
    }

    private var departure: Date? {
        if let ms = watch.snap?.legs?.first?.dep { return Date(timeIntervalSince1970: ms / 1000) }
        return watch.legs?.first?.estimated ?? watch.legs?.first?.planned
    }

    private var phaseText: String {
        if let e = watch.ended, !e.isEmpty { return e.capitalizedFirst }
        switch watch.snap?.phase ?? "" {
        case "before": return "Following live until you leave"
        case "between": return "Following your connection"
        case "riding": return "On board, I will tell you before your stop"
        case "done": return "Trip ended"
        case "": return "Following live"
        default: return (watch.snap?.phase ?? "").capitalizedFirst
        }
    }
}
