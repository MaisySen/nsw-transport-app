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
                .onChange(of: scenePhase) { _, phase in
                    store.isActive = (phase == .active)
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
        TabView(selection: $store.tab) {
            HomeView()
                .tabItem { Label("Trips", systemImage: "tram.fill") }
                .tag(AppTab.home)
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(AppTab.search)
            AskView()
                .tabItem { Label("Ask", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(AppTab.ask)
            WatchingView()
                .tabItem { Label("Watching", systemImage: "bell.badge.fill") }
                .badge(store.activeWatchCount)
                .tag(AppTab.watching)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(AppTab.settings)
        }
        .overlay(alignment: .top) { BannerOverlay() }
        .fullScreenCover(isPresented: $store.openLiveTrip) {
            LiveTripView()
                .environment(store)
                .overlay(alignment: .top) { BannerOverlay().environment(store) }
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
        .sensoryFeedback(.selection, trigger: store.tab)
    }
}

extension RootView {
    private var profilePrompt: Binding<Bool> {
        Binding(get: { store.pendingProfile != nil }, set: { shown in if !shown { store.pendingProfile = nil } })
    }
}

enum AppTab: Hashable {
    case home, search, ask, watching, settings
}
