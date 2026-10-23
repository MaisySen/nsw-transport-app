import SwiftUI
import TransportKit

// Ask tab: chat with Transport Bot. Questions go to /api/ask on the server, answers come back
// as a short reply plus live cards. Tapping a card opens the stop board or trip through the
// app's own deep links (nswtransport://stop/ID, nswtransport://trip/FROM/TO).

struct AskLink: Codable, Hashable {
    var kind: String?
    var label: String?
    var href: String?
    var id: String?
    var name: String?
    var from: String?
    var to: String?
    var stop: String?
}
struct AskDep: Codable, Hashable {
    var line: String
    var color: String?
    var mode: String?
    var dest: String
    var platform: String?
    var planned: Date
    var estimated: Date?
    var realtime: Bool
    var delayMin: Double?
    var cancelled: Bool
    var link: AskLink?
}
struct AskLeg: Codable, Hashable {
    var kind: String
    var mode: String?
    var line: String?
    var color: String?
    var fromPlatform: String?
    var realtime: Bool
    var delayMin: Double?
    var cancelled: Bool
}
struct AskJourney: Codable, Hashable {
    var leave: Date
    var arrive: Date
    var durationMin: Int
    var changes: Int
    var legs: [AskLeg]
}
struct AskAlert: Codable, Hashable { var title: String; var url: String? }
struct AskPlace: Codable, Hashable { var id: String; var name: String }
struct AskCard: Codable, Hashable {
    var type: String
    var title: String?
    var link: AskLink?
    var from: AskPlace?
    var to: AskPlace?
    var journeys: [AskJourney]?
    var deps: [AskDep]?
    var alerts: [AskAlert]?

    enum CodingKeys: String, CodingKey { case type, title, link, from, to, journeys, items }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        link = try c.decodeIfPresent(AskLink.self, forKey: .link)
        from = try c.decodeIfPresent(AskPlace.self, forKey: .from)
        to = try c.decodeIfPresent(AskPlace.self, forKey: .to)
        journeys = try c.decodeIfPresent([AskJourney].self, forKey: .journeys)
        if type == "departures" { deps = try c.decodeIfPresent([AskDep].self, forKey: .items) }
        if type == "alerts" { alerts = try c.decodeIfPresent([AskAlert].self, forKey: .items) }
    }
    func encode(to e: Encoder) throws {
        var c = e.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(link, forKey: .link)
        try c.encodeIfPresent(from, forKey: .from)
        try c.encodeIfPresent(to, forKey: .to)
        try c.encodeIfPresent(journeys, forKey: .journeys)
        if let deps { try c.encode(deps, forKey: .items) }
        if let alerts { try c.encode(alerts, forKey: .items) }
    }
}
struct AskAnswer: Codable {
    var reply: String?
    var text: String?
    var cards: [AskCard]?
    var links: [AskLink]?
    var suggestions: [String]?
    var ask: String?
}
struct AskMessage: Codable, Identifiable, Hashable {
    var id = UUID()
    var mine: Bool
    var text: String
    var cards: [AskCard] = []
    var links: [AskLink] = []
    var suggestions: [String] = []
}

@MainActor @Observable
final class AskModel {
    var messages: [AskMessage] = []
    var busy = false
    private let key = "ask.chat.v1"
    static let starters = ["Next train Burwood to Central", "When's the 461 from Burwood", "Is the T1 late", "Departures Strathfield", "How do I get to Bondi Beach", "Last train home"]

    init() {
        if let data = UserDefaults.standard.data(forKey: key), let m = try? JSONDecoder().decode([AskMessage].self, from: data) { messages = m }
    }
    func save() {
        if let data = try? JSONEncoder().encode(Array(messages.suffix(40))) { UserDefaults.standard.set(data, forKey: key) }
    }
    func clear() { messages = []; save() }

    func ask(_ raw: String, home: AskPlace? = nil, work: AskPlace? = nil) async {
        let q = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        messages.append(AskMessage(mine: true, text: q))
        busy = true
        defer { busy = false; save() }
        var c = URLComponents(string: "https://nsw-transport-bot.sites.tab.bot/api/ask")!
        var items = [URLQueryItem(name: "q", value: q), URLQueryItem(name: "profile", value: TransportAPI.shared.profile)]
        if let home { items.append(URLQueryItem(name: "home", value: "\(home.id)|\(home.name)")) }
        if let work { items.append(URLQueryItem(name: "work", value: "\(work.id)|\(work.name)")) }
        c.queryItems = items
        do {
            var req = URLRequest(url: c.url!)
            req.timeoutInterval = 25
            let (data, _) = try await URLSession.shared.data(for: req)
            let dec = JSONDecoder()
            dec.dateDecodingStrategy = .custom { d in
                let s = try d.singleValueContainer().decode(String.self)
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let v = f.date(from: s) { return v }
                f.formatOptions = [.withInternetDateTime]
                return f.date(from: s) ?? .distantPast
            }
            let a = try dec.decode(AskAnswer.self, from: data)
            messages.append(AskMessage(mine: false, text: a.reply ?? a.text ?? "Sorry, I didn't get that.", cards: a.cards ?? [], links: a.links ?? [], suggestions: a.suggestions ?? []))
        } catch {
            messages.append(AskMessage(mine: false, text: "No connection right now. Check your signal and try again.", suggestions: [q]))
        }
    }
}

struct AskView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL
    @State private var model = AskModel()
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if model.messages.isEmpty { hello }
                        ForEach(model.messages) { m in
                            bubble(m).id(m.id)
                        }
                        if model.busy { typing.id("typing") }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.messages.count) { withAnimation { proxy.scrollTo(model.busy ? AnyHashable("typing") : AnyHashable(model.messages.last?.id), anchor: .bottom) } }
                .onChange(of: model.busy) { withAnimation { proxy.scrollTo(AnyHashable("typing"), anchor: .bottom) } }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Ask")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear", systemImage: "trash") { model.clear() }.disabled(model.messages.isEmpty)
                }
            }
            .safeAreaInset(edge: .bottom) { composer }
        }
    }

    private var hello: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.left.and.text.bubble.right.fill").font(.system(size: 40)).foregroundStyle(.tint).padding(.top, 24)
            Text("Ask Transport Bot").font(.title3.bold())
            Text("Live times for any train, bus, ferry or light rail in NSW.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            VStack(alignment: .trailing, spacing: 8) {
                ForEach(AskModel.starters, id: \.self) { s in chip(s) { send(s) }.accessibilityIdentifier("askStarter") }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.top, 12)
        }
        .frame(maxWidth: .infinity)
    }

    private var typing: some View {
        HStack(spacing: 4) { ForEach(0..<3) { _ in Circle().frame(width: 7, height: 7).foregroundStyle(.secondary) } }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(botFill, in: .rect(cornerRadius: 18))
            .accessibilityLabel("Transport Bot is typing")
    }

    private var botFill: Color { scheme == .dark ? Color(white: 0.15) : Color(white: 0.91) }

    @ViewBuilder private func bubble(_ m: AskMessage) -> some View {
        if m.mine {
            Text(m.text)
                .padding(.horizontal, 13).padding(.vertical, 8)
                .foregroundStyle(.white)
                .background(Color.accentColor, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 60)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(m.text)
                    .accessibilityIdentifier("askReply")
                    .padding(.horizontal, 13).padding(.vertical, 8)
                    .background(botFill, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 6, bottomTrailingRadius: 18, topTrailingRadius: 18))
                    .padding(.trailing, 50)
                ForEach(Array(m.cards.enumerated()), id: \.offset) { _, c in card(c) }
                if !m.links.isEmpty || (m.id == model.messages.last?.id && !m.suggestions.isEmpty) {
                    FlowChips(items: m.links.compactMap { $0.label } + (m.id == model.messages.last?.id ? m.suggestions : [])) { label in
                        if let l = m.links.first(where: { $0.label == label }) { open(l) } else { send(label) }
                    }
                }
            }
        }
    }

    private func card(_ c: AskCard) -> some View {
        VStack(spacing: 0) {
            if c.type == "departures" || c.type == "trip" {
                Button { open(c.link) } label: {
                    HStack {
                        Text(c.type == "trip" ? "\(c.title.map { $0 + ": " } ?? "")\(c.from?.name ?? "") to \(c.to?.name ?? "")" : (c.title ?? ""))
                            .font(.footnote.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        if c.link != nil { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
                    }
                    .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 8)
                }
                .buttonStyle(.plain)
            }
            ForEach(Array((c.deps ?? []).enumerated()), id: \.offset) { _, d in
                Divider().padding(.leading, 14)
                Button { open(d.link) } label: { depRow(d) }.buttonStyle(.plain)
            }
            ForEach(Array((c.journeys ?? []).enumerated()), id: \.offset) { _, j in
                Divider().padding(.leading, 14)
                Button { open(c.link) } label: { journeyRow(j) }.buttonStyle(.plain)
            }
            ForEach(Array((c.alerts ?? []).enumerated()), id: \.offset) { i, a in
                if i > 0 { Divider().padding(.leading, 14) }
                Button { if let u = a.url.flatMap(URL.init(string:)) { openURL(u) } } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        Text(a.title).font(.subheadline).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
                .buttonStyle(.plain)
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
        .frame(maxWidth: 380, alignment: .leading)
    }

    private func depRow(_ d: AskDep) -> some View {
        let t = d.estimated ?? d.planned
        return HStack(spacing: 10) {
            LineBadge(line: d.line, colorHex: d.color, mode: d.mode)
            VStack(alignment: .leading, spacing: 2) {
                Text(d.dest).font(.body.weight(.semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    if let p = d.platform { Text(p.replacingOccurrences(of: "Platform ", with: "Plat ")) }
                    Text(Clock.time(t))
                    statusText(realtime: d.realtime, delay: d.delayMin, cancelled: d.cancelled)
                }
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer(minLength: 4)
            countdown(t, live: d.realtime && !d.cancelled)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .opacity(d.cancelled ? 0.45 : 1)
        .contentShape(.rect)
    }

    private func journeyRow(_ j: AskJourney) -> some View {
        let tl = j.legs.filter { $0.kind == "transit" }
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(Clock.time(j.leave)) to \(Clock.time(j.arrive))").font(.body.weight(.semibold)).monospacedDigit()
                HStack(spacing: 4) {
                    ForEach(Array(tl.enumerated()), id: \.offset) { _, l in LineBadge(line: l.line ?? "", colorHex: l.color, mode: l.mode, compact: true) }
                    Text("\(j.durationMin) min, \(j.changes == 0 ? "Direct" : "\(j.changes) change\(j.changes > 1 ? "s" : "")")").font(.footnote).foregroundStyle(.secondary)
                }
                if let f = tl.first { statusText(realtime: f.realtime, delay: f.delayMin, cancelled: f.cancelled).font(.footnote) }
            }
            Spacer(minLength: 4)
            countdown(j.leave, live: tl.first?.realtime ?? false)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .contentShape(.rect)
    }

    private func statusText(realtime: Bool, delay: Double?, cancelled: Bool) -> Text {
        if cancelled { return Text("Cancelled").foregroundColor(.red).bold() }
        if !realtime { return Text("Scheduled").foregroundColor(.secondary) }
        let d = Int((delay ?? 0).rounded())
        if d >= 2 { return Text("\(d) min late").foregroundColor(.orange).bold() }
        if d <= -2 { return Text("\(-d) min early").foregroundColor(.green).bold() }
        return Text("On time").foregroundColor(.green).bold()
    }

    private func countdown(_ t: Date, live: Bool) -> some View {
        TimelineView(.periodic(from: .now, by: 15)) { ctx in
            let m = Int((t.timeIntervalSince(ctx.date) / 60).rounded())
            VStack(alignment: .trailing, spacing: 0) {
                if m <= 0 && m >= -1 {
                    Text("Now").font(.title3.bold())
                } else if m > 0 && m < 60 {
                    Text("\(m)").font(.title2.bold()).monospacedDigit()
                    Text("min").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                } else {
                    Text(Clock.time(t)).font(.callout.weight(.semibold)).monospacedDigit()
                }
            }
            .foregroundStyle(live ? Color.green : Color.primary)
            .frame(minWidth: 48, alignment: .trailing)
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask about a train, bus or trip", text: $draft)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { send(draft) }
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(Color(.systemBackground), in: .capsule)
                .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 0.5))
            Button { send(draft) } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32)).symbolRenderingMode(.hierarchical)
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || model.busy)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar)
    }

    private func chip(_ label: String, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.subheadline)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Color(.secondarySystemGroupedBackground), in: .capsule)
            .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 0.5))
    }

    private func send(_ text: String) {
        let q = text
        draft = ""
        let home = store.homePlace.map { AskPlace(id: $0.id, name: $0.name) }
        let work = store.workPlace.map { AskPlace(id: $0.id, name: $0.name) }
        Task { await model.ask(q, home: home, work: work) }
    }

    private func open(_ l: AskLink?) {
        guard let l else { return }
        var url: URL?
        switch l.kind {
        case "stop": url = l.id.flatMap { URL(string: "nswtransport://stop/\($0)") }
        case "trip": if let f = l.from, let t = l.to { url = URL(string: "nswtransport://trip/\(f)/\(t)") }
        case "service": url = l.stop.flatMap { URL(string: "nswtransport://track/\($0)") }
        default: url = l.href.flatMap { $0.hasPrefix("http") ? URL(string: $0) : nil }
        }
        guard let url else { return }
        if url.scheme == "nswtransport" { store.open(url) } else { openURL(url) }
    }
}

/// Wrapping row of tappable chips.
struct FlowChips: View {
    var items: [String]
    var action: (String) -> Void
    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { s in
                Button(s) { action(s) }
                    .font(.subheadline)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(Color(.secondarySystemGroupedBackground), in: .capsule)
                    .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 0.5))
            }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
        return CGSize(width: maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
