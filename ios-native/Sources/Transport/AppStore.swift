import SwiftUI
import Observation
import TransportKit
import UserNotifications

/// App wide state: identity, starred stops, recent stops, saved trips, commutes and watches.
@MainActor
@Observable
final class AppStore {
    let api = TransportAPI.shared
    let device: String

    var tab: AppTab = .home
    var isActive = true

    var starred: [StopRef] = [] { didSet { Persist.save(starred, "starred") } }
    var recents: [StopRef] = [] { didSet { Persist.save(recents, "recents") } }
    var recentTrips: [TripPair] = [] { didSet { Persist.save(recentTrips, "recentTrips") } }
    /// Home and work stops set with Add home and Add work. Siri reads home too.
    var homePlace: StopRef? { didSet { Persist.save(homePlace, "placeHome") } }
    var workPlace: StopRef? { didSet { Persist.save(workPlace, "placeWork") } }
    /// Set by Home's search field so the Search tab opens with its field focused.
    var focusSearch = false
    var hapticsOn: Bool = true { didSet { UserDefaults.standard.set(hapticsOn, forKey: "haptics") } }
    var refreshSeconds: Int = 15 { didSet { UserDefaults.standard.set(refreshSeconds, forKey: "refresh") } }

    var saved: [SavedTrip] = []
    var commutes: [Commute] = []
    var suggestion: CommuteSuggestion?
    var watches: [Watch] = []
    var notes: [WatchNote] = []
    var banner: Banner?
    var lastError: String?

    /// Bumped on every user action that deserves a light tap.
    var hapticTick = 0
    var successTick = 0

    private var seenNoteIDs: Set<String> = []
    private var started = false

    var activeWatchCount: Int { watches.filter { $0.active == true }.count }

    init() {
        let d = UserDefaults.standard
        if let id = d.string(forKey: "device") {
            device = id
        } else {
            let id = "ios-" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)).lowercased()
            d.set(id, forKey: "device")
            device = id
        }
        if d.bool(forKey: "uiTestReset") {
            // UI tests start from a clean device.
            for k in ["starred", "recents", "recentTrips", "haptics", "refresh", "seenNotes", "placeHome", "placeWork"] { d.removeObject(forKey: k) }
        }
        starred = Persist.load([StopRef].self, "starred") ?? []
        recents = Persist.load([StopRef].self, "recents") ?? []
        recentTrips = Persist.load([TripPair].self, "recentTrips") ?? []
        homePlace = Persist.load(StopRef.self, "placeHome")
        workPlace = Persist.load(StopRef.self, "placeWork")
        hapticsOn = d.object(forKey: "haptics") as? Bool ?? true
        let r = d.integer(forKey: "refresh")
        refreshSeconds = r == 0 ? 15 : r
        seenNoteIDs = Set(d.stringArray(forKey: "seenNotes") ?? [])
    }

    func start() async {
        guard !started else { return }
        started = true
        async let a: Void = loadSaved()
        async let b: Void = loadCommutes()
        async let c: Void = loadWatches(notify: false)
        _ = await (a, b, c)
        // Keep watches and Live Activities moving while the app is open.
        Task { await watchLoop() }
    }

    private func watchLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(20))
            guard isActive else { continue }
            await loadWatches(notify: true)
            await LiveActivities.shared.refreshAll(api: api)
        }
    }

    // MARK: Deep links

    /// A stop, trip or service the app was asked to open, read by the Home tab.
    var pendingRoute: DeepRoute?

    /// nswtransport://stop/213516, nswtransport://trip/213410/10101100, nswtransport://track/213516,
    /// nswtransport://tab/watching. Widgets and Live Activities open these too.
    func open(_ url: URL) {
        guard url.scheme == "nswtransport" else { return }
        let parts = [url.host ?? ""] + url.pathComponents.filter { $0 != "/" }
        switch parts.first ?? "" {
        case "stop" where parts.count > 1:
            tab = .home
            pendingRoute = .stop(StopRef(id: parts[1], name: "Stop \(parts[1])"))
        case "track" where parts.count > 1:
            tab = .home
            pendingRoute = .track(stopID: parts[1])
        case "follow" where parts.count > 1:
            // The widget's Track button: open the next service on the map and start its Lock Screen countdown.
            tab = .home
            pendingRoute = .track(stopID: parts[1])
            let stopID = parts[1], line = parts.count > 2 ? parts[2] : nil
            Task { await followNext(stopID: stopID, line: line) }
        case "trip" where parts.count > 2:
            tab = .home
            pendingRoute = .trip(from: StopRef(id: parts[1], name: "Stop \(parts[1])"), to: StopRef(id: parts[2], name: "Stop \(parts[2])"))
        case "tab":
            switch parts.count > 1 ? parts[1] : "" {
            case "search": tab = .search
            case "watching": tab = .watching
            case "settings": tab = .settings
            default: tab = .home
            }
        default:
            break
        }
    }

    /// Test and screenshot hook: launching with `-screen stop/213516` opens that screen,
    /// the same as the nswtransport://stop/213516 link but without the system prompt.
    func openLaunchScreen() {
        guard let s = UserDefaults.standard.string(forKey: "screen"),
              let url = URL(string: "nswtransport://\(s)") else { return }
        open(url)
    }

    // MARK: Stars and recents

    func isStarred(_ id: String) -> Bool { starred.contains { $0.id == id } }

    func toggleStar(_ stop: StopRef) {
        if let i = starred.firstIndex(where: { $0.id == stop.id }) {
            starred.remove(at: i)
            show(Banner(title: "Removed from Home", symbol: "star.slash"))
        } else {
            starred.append(StopRef(id: stop.id, name: Naming.short(stop.name)))
            show(Banner(title: "Added to Home", symbol: "star.fill"))
        }
        tap()
    }

    func remember(_ stop: StopRef) {
        recents.removeAll { $0.id == stop.id }
        recents.insert(StopRef(id: stop.id, name: stop.name), at: 0)
        if recents.count > 8 { recents = Array(recents.prefix(8)) }
    }

    /// A to B trips opened lately, newest first. Home shows up to 2 of them.
    func rememberTrip(from: StopRef, to: StopRef) {
        if let top = recentTrips.first, top.from.id == from.id, top.to.id == to.id { return }
        recentTrips.removeAll { $0.from.id == from.id && $0.to.id == to.id }
        recentTrips.insert(TripPair(from: StopRef(id: from.id, name: from.name), to: StopRef(id: to.id, name: to.name)), at: 0)
        if recentTrips.count > 6 { recentTrips = Array(recentTrips.prefix(6)) }
    }

    func forgetTrip(from: StopRef, to: StopRef) {
        recentTrips.removeAll { $0.from.id == from.id && $0.to.id == to.id }
        tap()
    }

    // MARK: Server state

    func loadSaved() async {
        if let s = try? await api.saved() { saved = s }
    }

    func loadCommutes() async {
        if let c = try? await api.commutes(device: device) {
            commutes = c.items
            suggestion = c.suggestion
        }
    }

    func loadWatches(notify: Bool) async {
        guard let r = try? await api.watches(device: device) else { return }
        watches = r.items
        notes = r.notes ?? []
        let fresh = notes.filter { !seenNoteIDs.contains($0.id.value) }
        for n in fresh { seenNoteIDs.insert(n.id.value) }
        UserDefaults.standard.set(Array(seenNoteIDs.suffix(200)), forKey: "seenNotes")
        guard notify, let newest = fresh.first else { return }
        show(Banner(title: newest.title ?? "Trip update", detail: newest.body, symbol: "bell.fill"))
        Notifier.post(title: newest.title ?? "Trip update", body: newest.body ?? "", id: newest.id.value)
        success()
    }

    func watch(_ request: WatchRequest) async {
        do {
            let created = try await api.watch(request)
            await Notifier.requestPermission()
            let first = created.watch?.sent?.first
            show(Banner(title: "Watching \(Naming.compact(request.title))",
                        detail: first?.body ?? "You get an alert when it is time to go or anything changes.",
                        symbol: "bell.fill"))
            success()
            await loadWatches(notify: false)
        } catch {
            show(Banner(title: "Could not watch that", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }

    func unwatch(_ w: Watch) async {
        watches.removeAll { $0.id == w.id }
        try? await api.unwatch(id: w.id, device: device)
        tap()
        await loadWatches(notify: false)
    }

    func saveTrip(name: String, from: StopRef, to: StopRef) async {
        do {
            try await api.saveTrip(name: name, from: from, to: to)
            await loadSaved()
            show(Banner(title: "Saved as \(name)", detail: "Type \(name) in WhatsApp too.", symbol: "bookmark.fill"))
            success()
        } catch {
            show(Banner(title: "Could not save", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }

    func makeCommute(from: StopRef, to: StopRef, tod: Int, name: String?) async {
        do {
            try await api.saveCommute(id: nil, from: from, to: to, tod: tod, days: "12345", name: name, active: true)
            await loadCommutes()
            show(Banner(title: "Commute set", detail: "Weekdays around \(Clock.todText(tod)).", symbol: "clock.badge.checkmark"))
            success()
        } catch {
            show(Banner(title: "Could not set commute", detail: error.localizedDescription, symbol: "exclamationmark.triangle.fill"))
        }
    }

    // MARK: Feedback

    func show(_ b: Banner) {
        withAnimation(.spring(duration: 0.35)) { banner = b }
        let id = b.id
        Task {
            try? await Task.sleep(for: .seconds(3.5))
            if banner?.id == id { withAnimation(.easeOut(duration: 0.25)) { banner = nil } }
        }
    }

    func tap() { if hapticsOn { hapticTick += 1 } }
    func success() { if hapticsOn { successTick += 1 } }
}

enum DeepRoute: Hashable {
    case stop(StopRef)
    case track(stopID: String)
    case trip(from: StopRef, to: StopRef)
}

struct Banner: Identifiable, Equatable {
    let id = UUID()
    var title: String
    var detail: String? = nil
    var symbol: String = "checkmark.circle.fill"
}

enum Persist {
    static func save<T: Encodable>(_ v: T, _ key: String) {
        if let d = try? JSONEncoder().encode(v) { UserDefaults.standard.set(d, forKey: key) }
    }
    static func load<T: Decodable>(_ t: T.Type, _ key: String) -> T? {
        guard let d = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
}

enum Notifier {
    static func requestPermission() async {
        let c = UNUserNotificationCenter.current()
        let s = await c.notificationSettings()
        if s.authorizationStatus == .notDetermined {
            _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge])
        }
    }

    static func status() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// A local notification. Works with a free Apple ID: no push entitlement needed.
    static func post(title: String, body: String, id: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .active
        let req = UNNotificationRequest(identifier: "note-\(id)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
