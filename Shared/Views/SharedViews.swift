import KalaamKit
import SwiftUI

extension AppStore {
    /// Two-way binding to one setting, for use in forms.
    func binding<T>(_ keyPath: WritableKeyPath<AppSettings, T>) -> Binding<T> {
        Binding(
            get: { self.settings[keyPath: keyPath] },
            set: { value in self.updateSettings { $0[keyPath: keyPath] = value } }
        )
    }
}

enum Theme {
    static let accent = Color(red: 0.42, green: 0.28, blue: 0.75)
    static let cardBackground = Color.secondary.opacity(0.08)
}

// MARK: - Stats

struct StatsRow: View {
    let stats: UsageStats

    var body: some View {
        HStack(spacing: 12) {
            stat("\(stats.totalWords)", "total words")
            stat("\(stats.wordsPerMinute)", "wpm")
            stat("\(stats.streakDays)", "day streak")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(.title, design: .serif))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct StorageErrorBanner: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "lock.trianglebadge.exclamationmark")
                .font(.callout)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

// MARK: - History

struct HistoryListView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    var copyAction: @MainActor (String) -> Void

    private var filtered: [HistoryItem] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return store.history }
        return store.history.filter { $0.finalText.localizedCaseInsensitiveContains(q) }
    }

    private var grouped: [(title: String, items: [HistoryItem])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: filtered) { calendar.startOfDay(for: $0.date) }
        return groups.keys.sorted(by: >).map { day in
            let title: String
            if calendar.isDateInToday(day) {
                title = "Today"
            } else if calendar.isDateInYesterday(day) {
                title = "Yesterday"
            } else {
                title = day.formatted(date: .abbreviated, time: .omitted)
            }
            return (title, groups[day]?.sorted { $0.date > $1.date } ?? [])
        }
    }

    var body: some View {
        List {
            if store.history.isEmpty {
                ContentUnavailableView(
                    "No dictations yet",
                    systemImage: "waveform",
                    description: Text(store.settings.historyRetentionDays == 0
                                      ? "History is turned off in Privacy settings."
                                      : "Your recent dictations will appear here.")
                )
            }
            ForEach(grouped, id: \.title) { group in
                Section(group.title) {
                    ForEach(group.items) { item in
                        HistoryRow(item: item)
                            .contextMenu {
                                Button("Copy") { copyAction(item.finalText) }
                                Button("Delete", role: .destructive) { store.deleteHistory(item.id) }
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) { store.deleteHistory(item.id) }
                                Button("Copy") { copyAction(item.finalText) }.tint(Theme.accent)
                            }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Search past transcripts")
    }
}

struct HistoryRow: View {
    let item: HistoryItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(item.date.formatted(date: .omitted, time: .shortened))
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.finalText).textSelection(.enabled)
                if let app = item.appName {
                    Text(app).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Snippets

struct SnippetsView: View {
    @Environment(AppStore.self) private var store
    @State private var editing: SnippetDraft?
    @State private var starredOnly = false

    private var visible: [Snippet] {
        starredOnly ? store.snippets.filter(\.isStarred) : store.snippets
    }

    var body: some View {
        List {
            Section {
                Text("The stuff you shouldn't have to re-type. Say the trigger phrase while dictating and it's replaced with the full text.")
                    .foregroundStyle(.secondary)
                Picker("Show", selection: $starredOnly) {
                    Text("All").tag(false)
                    Text("Starred").tag(true)
                }
                .pickerStyle(.segmented)
            }
            ForEach(visible) { snippet in
                Button {
                    editing = SnippetDraft(id: snippet.id, trigger: snippet.trigger, expansion: snippet.expansion)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(snippet.trigger).font(.headline)
                            Text(snippet.expansion).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer()
                        Image(systemName: snippet.isStarred ? "star.fill" : "star")
                            .foregroundStyle(snippet.isStarred ? .yellow : .secondary)
                            .onTapGesture { store.toggleStar(snippet.id) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions {
                    Button("Delete", role: .destructive) { store.deleteSnippet(snippet.id) }
                }
                .contextMenu {
                    Button("Delete", role: .destructive) { store.deleteSnippet(snippet.id) }
                }
            }
        }
        .navigationTitle("Snippets")
        .toolbar {
            Button("Add new", systemImage: "plus") { editing = SnippetDraft() }
        }
        .sheet(item: $editing) { draft in
            EntryEditor(
                title: draft.id == nil ? "New snippet" : "Edit snippet",
                firstLabel: "When I say",
                firstPrompt: "my email",
                secondLabel: "Type",
                secondPrompt: "me@example.com",
                first: draft.trigger,
                second: draft.expansion
            ) { trigger, expansion in
                if let id = draft.id {
                    try store.updateSnippet(id, trigger: trigger, expansion: expansion)
                } else {
                    try store.addSnippet(trigger: trigger, expansion: expansion)
                }
            }
        }
    }
}

/// `id` is nil for a new snippet, or the snippet being edited.
struct SnippetDraft: Identifiable {
    var id: UUID?
    var trigger = ""
    var expansion = ""
}

// MARK: - Dictionary

struct DictionaryView: View {
    @Environment(AppStore.self) private var store
    @State private var adding = false

    var body: some View {
        List {
            Section {
                Text("Teach Kalaam names and words it gets wrong. When it hears the first, it writes the second.")
                    .foregroundStyle(.secondary)
            }
            ForEach(store.dictionary) { entry in
                HStack {
                    Text(entry.heard)
                    Image(systemName: "arrow.right").foregroundStyle(.secondary)
                    Text(entry.replacement).bold()
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { store.deleteDictionaryEntry(entry.id) }
                }
                .contextMenu {
                    Button("Delete", role: .destructive) { store.deleteDictionaryEntry(entry.id) }
                }
            }
        }
        .navigationTitle("Dictionary")
        .toolbar {
            Button("Add word", systemImage: "plus") { adding = true }
        }
        .sheet(isPresented: $adding) {
            EntryEditor(
                title: "New word",
                firstLabel: "When it hears",
                firstPrompt: "cloud code",
                secondLabel: "Write",
                secondPrompt: "Claude Code",
                first: "",
                second: ""
            ) { heard, replacement in
                try store.addDictionaryEntry(heard: heard, replacement: replacement)
            }
        }
    }
}

/// Small two-field form used for snippets and dictionary words. Shows validation errors inline.
struct EntryEditor: View {
    let title: String
    let firstLabel: String
    let firstPrompt: String
    let secondLabel: String
    let secondPrompt: String
    @State var first: String
    @State var second: String
    let save: (String, String) throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField(firstLabel, text: $first, prompt: Text(firstPrompt))
                TextField(secondLabel, text: $second, prompt: Text(secondPrompt), axis: .vertical)
                    .lineLimit(1...6)
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do {
                            try save(first, second)
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 240)
        #endif
    }
}

// MARK: - Style

struct StyleView: View {
    @Environment(AppStore.self) private var store
    @State private var context: StyleContext = .personal

    private let sample = "Hey, are you free for lunch tomorrow? Let's do 12 if that works for you."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Applies to", selection: $context) {
                    ForEach(StyleContext.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                Text(contextHint).font(.callout).foregroundStyle(.secondary)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                    ForEach(WritingStyle.allCases) { style in
                        styleCard(style)
                    }
                }

                Text("Styles apply in English. Snippets are always inserted exactly as you saved them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("Style")
    }

    private var contextHint: String {
        switch context {
        case .personal: "Used in Messages, WhatsApp, Telegram, Signal and Discord on Mac."
        case .work: "Used in Slack, Teams, Notion and Linear on Mac."
        case .email: "Used in Mail, Outlook, Superhuman and Spark on Mac."
        case .other: "Used everywhere else, and always on iPhone."
        }
    }

    private func styleCard(_ style: WritingStyle) -> some View {
        let selected = store.settings.style(for: context) == style
        return Button {
            store.updateSettings { $0.styles[context] = style }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(style.title).font(.system(.title3, design: .serif))
                Text(style.detail).font(.caption).foregroundStyle(.secondary)
                Text(StyleFormatter().apply(sample, style: style))
                    .font(.caption)
                    .padding(8)
                    .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            .frame(maxWidth: .infinity, minHeight: 170, alignment: .topLeading)
            .padding(12)
            .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.accent : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Cleanup & language

struct CleanupSection: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Section {
            Picker("Cleanup", selection: store.binding(\.cleanupLevel)) {
                ForEach(CleanupLevel.allCases) { Text($0.title).tag($0) }
            }
            Text(store.settings.cleanupLevel.detail).font(.caption).foregroundStyle(.secondary)
            if store.settings.cleanupLevel == .high, let reason = AIPolisher.unavailableReason {
                Label(reason + " Medium cleanup is used until then.", systemImage: "info.circle")
                    .font(.caption)
            }
        } header: {
            Text("Cleanup")
        } footer: {
            Text("AI polish runs on-device with Apple Intelligence. Nothing is sent anywhere, and there's no API key or cost.")
        }
    }
}

struct LanguageSection: View {
    @Environment(AppStore.self) private var store
    @State private var locales: [Locale] = []
    @State private var status: String?
    @State private var downloading = false

    var body: some View {
        Section {
            Picker("Language", selection: store.binding(\.languageID)) {
                if locales.isEmpty {
                    Text(name(for: store.settings.languageID)).tag(store.settings.languageID)
                }
                ForEach(locales, id: \.self) { locale in
                    let id = locale.identifier(.bcp47)
                    Text(name(for: id)).tag(id)
                }
            }
            HStack {
                Button(downloading ? "Downloading…" : "Download language for offline use") {
                    Task { await download() }
                }
                .disabled(downloading)
                if let status {
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Language")
        } footer: {
            Text("The speech model is downloaded once by Apple and runs fully on this device.")
        }
        .task {
            let all = await AppleSpeechEngine.supportedLocales()
            locales = all.sorted { name(for: $0.identifier(.bcp47)) < name(for: $1.identifier(.bcp47)) }
        }
        .onChange(of: store.settings.languageID) {
            Task { await download() }
        }
    }

    private func name(for id: String) -> String {
        Locale.current.localizedString(forIdentifier: id) ?? id
    }

    private func download() async {
        downloading = true
        defer { downloading = false }
        do {
            try await AppleSpeechEngine.prepareAssets(for: store.settings.languageID)
            status = "Ready"
        } catch {
            status = error.localizedDescription
        }
    }
}

// MARK: - Privacy

struct PrivacySection: View {
    @Environment(AppStore.self) private var store
    @State private var confirmErase = false

    var body: some View {
        Section {
            Picker("Keep history", selection: store.binding(\.historyRetentionDays)) {
                ForEach(AppSettings.retentionChoices, id: \.self) { days in
                    Text(label(days)).tag(days)
                }
            }
            Button("Clear history", role: .destructive) { store.clearHistory() }
                .disabled(store.history.isEmpty)
            Button("Erase all data…", role: .destructive) { confirmErase = true }
        } header: {
            Text("Data and privacy")
        } footer: {
            Text("""
                Your voice never leaves this device. Audio is processed in memory and never saved. \
                History, snippets and your dictionary are encrypted (AES-256) with a key that \
                stays in this device's Keychain. Kalaam has no accounts, analytics or servers.
                """)
        }
        .confirmationDialog("Erase all Kalaam data?", isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Erase everything", role: .destructive) { store.eraseAllData() }
        } message: {
            Text("History, snippets, dictionary, settings and the encryption key are deleted. This can't be undone.")
        }
    }

    private func label(_ days: Int) -> String {
        switch days {
        case 0: "Don't save"
        case 1: "1 day"
        case 365: "1 year"
        default: "\(days) days"
        }
    }
}
