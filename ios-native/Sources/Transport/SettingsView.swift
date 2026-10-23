import SwiftUI
import TransportKit

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var editing: Commute?

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section {
                    if store.commutes.isEmpty {
                        Text("No commute yet. Open a trip and tap Make this my commute.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(store.commutes) { c in
                        Button { editing = c } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.name ?? "Commute").foregroundStyle(.primary)
                                    Text("\(Naming.short(c.from.name)) to \(Naming.short(c.to.name))")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(c.active == false ? "Off" : (c.todText ?? Clock.todText(c.tod)))
                                    .foregroundStyle(.secondary)
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                        }
                    }
                } header: { Text("Commutes") } footer: {
                    Text("A heads up about 30 minutes before when something is wrong, then a leave now alert.")
                }

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
                } header: { Text("Alerts") }

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                    LabeledContent("Live data", value: "Transport for NSW")
                    LabeledContent("Device", value: store.device)
                    Link("Open the web version", destination: TransportAPI.defaultBase)
                }
            }
            .navigationTitle("Settings")
            .sheet(item: $editing) { c in
                CommuteEditor(commute: c).environment(store)
            }
        }
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
                    Button("Delete commute", role: .destructive) {
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
