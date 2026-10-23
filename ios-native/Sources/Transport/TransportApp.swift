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
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(AppTab.home)
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(AppTab.search)
            WatchingView()
                .tabItem { Label("Watching", systemImage: "bell.badge.fill") }
                .badge(store.activeWatchCount)
                .tag(AppTab.watching)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(AppTab.settings)
        }
        .overlay(alignment: .top) { BannerOverlay() }
        .onOpenURL { url in store.open(url) }
        .task { store.openLaunchScreen() }
        .sensoryFeedback(.selection, trigger: store.tab)
    }
}

enum AppTab: Hashable {
    case home, search, watching, settings
}
