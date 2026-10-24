import SwiftUI
import TransportKit

/// The More tab: everything you need now and then, one row each. Ask, the station tools,
/// Settings and About live here so the other tabs stay about your trips.
struct MoreView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                // Each row can be hidden or paused from the server config.
                if store.config.isOn("ask") {
                    Section {
                        NavigationLink { AskView() } label: {
                            moreRow("Ask", detail: "Type a question, like next train to Central", symbol: "bubble.left.and.bubble.right.fill", tint: .indigo)
                        }
                        .accessibilityIdentifier("moreAsk")
                    }
                } else if let m = store.config.killMessage("ask") {
                    Section { pausedRow("Ask", m) }
                }

                if store.config.isOn("parkRide") || store.config.isOn("opalMachines") {
                    Section("Stations") {
                        if store.config.isOn("parkRide") {
                            NavigationLink { ParkRideListView() } label: {
                                moreRow("Park and Ride", detail: "Live free spaces", symbol: "car.fill", tint: .blue)
                            }
                            .accessibilityIdentifier("parkRideList")
                        }
                        if store.config.isOn("opalMachines") {
                            NavigationLink { OpalMachinesView() } label: {
                                moreRow("Opal top up machines", detail: "Nearest machines to you", symbol: "creditcard.fill", tint: .orange)
                            }
                            .accessibilityIdentifier("opalMachines")
                        }
                    }
                }

                Section {
                    NavigationLink { SettingsView() } label: {
                        moreRow("Settings", detail: nil, symbol: "gearshape.fill", tint: .gray)
                    }
                    .accessibilityIdentifier("moreSettings")
                    NavigationLink { AboutView() } label: {
                        moreRow("About", detail: nil, symbol: "info.circle.fill", tint: .gray)
                    }
                    .accessibilityIdentifier("moreAbout")
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(16))
            .navigationTitle("More")
        }
    }

    private func pausedRow(_ title: String, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.body)
            Text(message).font(.footnote).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func moreRow(_ title: String, detail: String?, symbol: String, tint: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(tint, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body)
                if let detail {
                    Text(detail).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Version, data source, publisher and the support and privacy links.
struct AboutView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: "\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""))")
                LabeledContent("Live data", value: "Transport for NSW")
                LabeledContent("Publisher", value: "Fintex Australia Pty Ltd")
            }
            Section {
                Link("Help and support", destination: URL(string: "https://nsw-transport-bot.sites.tab.bot/support/")!)
                Link("Privacy policy", destination: URL(string: "https://nsw-transport-bot.sites.tab.bot/privacy/")!)
                Link("Terms of use", destination: URL(string: "https://nsw-transport-bot.sites.tab.bot/terms/")!)
                Link("Open the web version", destination: TransportAPI.defaultBase)
            } footer: {
                Text("Transport: Sydney Live is provided by Fintex Australia Pty Ltd (ABN 60 688 406 108), New South Wales, Australia. Contact: contact@fintex.au. \u{00A9} 2026 Fintex Australia Pty Ltd.\n\nContains transport data from Transport for NSW, licensed under Creative Commons Attribution 4.0. This is an independent app and is not made or endorsed by Transport for NSW. Install ID \(store.device).")
            }
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
    }
}
