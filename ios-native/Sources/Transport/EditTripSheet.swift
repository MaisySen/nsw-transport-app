import SwiftUI
import TransportKit

/// Which trip the Edit trip sheet changes: one made with New trip, or one saved on the server.
struct EditTarget: Identifiable {
    var mine: MyTrip?
    var saved: SavedTrip?
    var id: String { mine?.id ?? ("saved:" + (saved?.name ?? "")) }
}

/// Edit trip: rename, change time at the change stop, direct services only, or delete.
struct EditTripSheet: View {
    var target: EditTarget
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var conn = 5
    @State private var direct = true
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .accessibilityIdentifier("editTripName")
                } header: {
                    Text("Name")
                }
                Section {
                    Label(route, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                } header: {
                    Text("Trip")
                }
                if let m = target.mine, let via = m.via, (m.legs?.count ?? 2) <= 2 {
                    Section {
                        Stepper(value: $conn, in: 0...30) {
                            Text("Connection time: \(conn) min").monospacedDigit()
                        }
                        .accessibilityIdentifier("editTripConn")
                    } footer: {
                        Text("Minutes you need to change at \(Naming.compact(Naming.short(via.name))).")
                    }
                }
                if target.mine != nil {
                    Section {
                        Toggle("Direct services only", isOn: $direct)
                    } footer: {
                        Text("When on, only services that stop at both ends of each leg are shown.")
                    }
                }
                Section {
                    Button("Delete trip", role: .destructive) { confirmDelete = true }
                        .accessibilityIdentifier("deleteTrip")
                }
            }
            .navigationTitle("Edit trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("saveEditedTrip")
                }
            }
            .confirmationDialog("Delete this trip?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete trip", role: .destructive) {
                    if let m = target.mine {
                        store.removeMyTrip(m.id)
                    } else if let s = target.saved {
                        Task { await store.deleteSavedTrip(name: s.name) }
                    }
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("It goes from this phone and from the server.")
            }
            .onAppear {
                if let m = target.mine {
                    name = m.name
                    conn = m.conn ?? 5
                    direct = !store.showsAllServices(m.id)
                } else if let s = target.saved {
                    name = s.name
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var route: String {
        if let m = target.mine {
            if let legs = m.legs, legs.count > 2 {
                return ([legs[0].from] + legs.map(\.to)).map { Naming.compact(Naming.short($0.name)) }.joined(separator: " to ")
            }
            let stops = [m.from] + (m.via.map { [$0] } ?? []) + [m.to]
            return stops.map { Naming.compact(Naming.short($0.name)) }.joined(separator: " to ")
        }
        if let s = target.saved {
            return "\(Naming.compact(Naming.short(s.from.name))) to \(Naming.compact(Naming.short(s.to.name)))"
        }
        return ""
    }

    private func save() {
        let clean = name.trimmingCharacters(in: .whitespaces)
        if var m = target.mine {
            let oldKey = m.id
            m.name = clean
            if m.via != nil { m.conn = conn }
            store.updateMyTrip(oldKey: oldKey, m)
            store.setAllServices(m.id, !direct)
        } else if let s = target.saved {
            Task { await store.renameSavedTrip(s, to: clean) }
        }
        dismiss()
    }
}
