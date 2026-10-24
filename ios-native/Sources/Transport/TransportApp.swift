import SwiftUI
import TransportKit

@main
struct TransportApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .task { await store.start() }
                .task { store.applyConfig(); await store.refreshConfig(force: true) }
                .onChange(of: scenePhase) { _, phase in
                    store.isActive = (phase == .active)
                    if phase == .active {
                        Task { await store.refreshConfig() }
                        // No stale travel updates left on screen once a trip is over.
                        if store.liveTrip == nil { Task { await Notifier.clearTravel(started: nil, keepArrived: false) } }
                    }
                    if phase == .background { BackgroundRefresh.schedule() }
                }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
            await BackgroundRefresh.run()
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        // The order comes from the server config; every tab is always there.
        TabView(selection: $store.tab) {
            ForEach(store.config.tabOrder.compactMap(AppTab.init(key:)), id: \.self) { t in
                tabContent(t)
            }
        }
        .overlay(alignment: .top) { BannerOverlay() }
        .overlay(alignment: .top) { ReplayOverlay().padding(.top, 52) }
        .fullScreenCover(isPresented: $store.openLiveTrip) {
            LiveTripView()
                .environment(store)
                .overlay(alignment: .top) { BannerOverlay().environment(store) }
                .overlay(alignment: .top) { ReplayOverlay().padding(.top, 52) }
        }
        .onOpenURL { url in store.open(url) }
        .confirmationDialog("Switch to this profile?", isPresented: profilePrompt, titleVisibility: .visible) {
            let p = store.pendingProfile
            Button("Switch profile") { Task { await store.adoptProfile(p) } }
                .accessibilityIdentifier("switchProfile")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Transport will load the saved trips, commutes and alerts kept under this private profile. Only open profile links you made yourself.")
        }
        .task { store.openLaunchScreen() }
        .task { if UserDefaults.standard.bool(forKey: "liveReplayDemo") { await store.startReplayDemo() } }
        .sensoryFeedback(.selection, trigger: store.tab)
    }

    @ViewBuilder
    private func tabContent(_ t: AppTab) -> some View {
        switch t {
        case .home:
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(AppTab.home)
        case .plan:
            SearchView()
                .tabItem { Label("Plan", systemImage: "magnifyingglass") }
                .tag(AppTab.plan)
        case .watching:
            WatchingView()
                .tabItem { Label("Watching", systemImage: "bell.badge.fill") }
                .badge(store.activeWatchCount)
                .tag(AppTab.watching)
        case .more:
            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle.fill") }
                .tag(AppTab.more)
        }
    }
}

extension RootView {
    private var profilePrompt: Binding<Bool> {
        Binding(get: { store.pendingProfile != nil }, set: { shown in if !shown { store.pendingProfile = nil } })
    }
}

/// Four tabs, one job each: Home is your live board, Plan finds a stop or plans a trip,
/// Watching lists the services you follow, More holds Ask, station tools, Settings and About.
enum AppTab: Hashable {
    case home, plan, watching, more

    init?(key: String) {
        switch key {
        case "home": self = .home
        case "plan": self = .plan
        case "watching": self = .watching
        case "more": self = .more
        default: return nil
        }
    }
}
