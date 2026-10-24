import SwiftUI
import TransportKit

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var editing: Commute?
    @State private var confirmHistory = false
    @State private var confirmAll = false

    var body: some View {
        @Bindable var store = store
        Group {
            Form {
                Section("Live times") {
                    Picker("Refresh every", selection: $store.refreshSeconds) {
                        Text("15 seconds").tag(15)
                        Text("20 seconds").tag(20)
                        Text("30 seconds").tag(30)
                    }
                    Toggle("Haptics", isOn: $store.hapticsOn)
                }

                Section {
                    Button("Allow notifications") { Task { await Notifier.requestPermission() } }
                    Button("End Lock Screen activities", role: .destructive) {
                        Task { await LiveActivities.shared.endAll() }
                    }
                } header: { Text("Notifications") }

                Section {
                    Picker("Fare type", selection: $store.fareType) {
                        ForEach(FareType.allCases) { t in
                            Text(t.longTitle).tag(t.rawValue)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Opal fare estimates")
                } footer: {
                    Text("Trips show an Opal fare estimate for this fare type, worked out from the Opal fare tables: peak or off peak, transfer discount, airport station fee and daily cap. It is not your card's charge.")
                }

                Section {
                    Toggle(isOn: $store.accessibleTrips) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Accessible trips")
                            Text("Step free trips only, from the Trip Planner").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("accessibleTrips")
                    Toggle(isOn: liftAlertsBinding) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Lift outage alerts")
                            Text("For stations on your saved trips").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("liftAlerts")

                } header: {
                    Text("Accessibility")
                }

                Section {

                    Button("Delete my trip history on server", role: .destructive) { confirmHistory = true }
                        .accessibilityIdentifier("deleteServerHistory")
                    Button("Delete all my data", role: .destructive) { confirmAll = true }
                        .accessibilityIdentifier("deleteAllData")
                } header: {
                    Text("Clear history")
                } footer: {
                    Text("The server keeps the trips you search for 90 days, under this app's private id, to suggest weekday reminders. Recent stops and trips stay only on this phone; clear them on the Plan tab.")
                }

            }
            .navigationTitle("Settings")
            .sheet(item: $editing) { c in
                CommuteEditor(commute: c).environment(store)
            }
            .confirmationDialog("Delete your trip history?", isPresented: $confirmHistory, titleVisibility: .visible) {
                Button("Delete trip history", role: .destructive) { Task { await store.deleteServerHistory() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This deletes the trips you searched for that the server keeps, and the commute suggestions made from them. Saved trips, commutes and watches stay. This cannot be undone.")
            }
            .confirmationDialog("Delete all your data?", isPresented: $confirmAll, titleVisibility: .visible) {
                Button("Delete all my data", role: .destructive) { Task { await store.deleteAllData() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This deletes your saved trips, starred stops, commutes, watched trips, alerts and trip history, on this phone and on the server. Alerts on this phone turn off. This cannot be undone.")
            }
        }
    }
}

extension SettingsView {
    private var liftAlertsBinding: Binding<Bool> {
        Binding(get: { store.liftAlerts }, set: { on in Task { await store.setLiftAlerts(on) } })
    }
}

struct CommuteEditor: View {
    var commute: Commute
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var time = Date()
    @State private var days: Set<Int> = [1, 2, 3, 4, 5]
    @State private var active = true
    @State private var name = ""

    private let dayNames = [(1, "M"), (2, "T"), (3, "W"), (4, "T"), (5, "F"), (6, "S"), (7, "S")]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    Toggle("On", isOn: $active)
                    DatePicker("Usual time", selection: $time, displayedComponents: .hourAndMinute)
                }
                Section("Days") {
                    HStack(spacing: 8) {
                        ForEach(0..<dayNames.count, id: \.self) { i in
                            let d = dayNames[i]
                            let on = days.contains(d.0)
                            Button {
                                if on { days.remove(d.0) } else { days.insert(d.0) }
                            } label: {
                                Text(d.1)
                                    .font(.subheadline.weight(.semibold))
                                    .frame(width: 36, height: 36)
                                    .background(on ? Color.accentColor : Color(.tertiarySystemFill), in: Circle())
                                    .foregroundStyle(on ? Color.white : Color.primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section {
                    Button("Delete reminder", role: .destructive) {
                        Task {
                            try? await store.api.deleteCommute(id: commute.id)
                            await store.loadCommutes()
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("\(Naming.short(commute.from.name)) to \(Naming.short(commute.to.name))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let tod = minuteOfDayLocal(time)
                            let d = days.sorted().map(String.init).joined()
                            try? await store.api.saveCommute(id: commute.id, from: commute.from, to: commute.to, tod: tod,
                                                             days: d.isEmpty ? "12345" : d, name: name, active: active)
                            await store.loadCommutes()
                            store.success()
                            dismiss()
                        }
                    }
                }
            }
            .onAppear {
                name = commute.name ?? ""
                active = commute.active != false
                days = Set((commute.days ?? "12345").compactMap { Int(String($0)) })
                var c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
                c.hour = commute.tod / 60
                c.minute = commute.tod % 60
                time = Calendar.current.date(from: c) ?? Date()
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func minuteOfDayLocal(_ d: Date) -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}
