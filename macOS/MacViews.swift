import KalaamKit
import ServiceManagement
import SwiftUI

enum MacSection: String, CaseIterable, Identifiable {
    case home, dictionary, snippets, style, settings

    var id: String { rawValue }

    var title: String { rawValue.capitalized }

    var symbol: String {
        switch self {
        case .home: "house"
        case .dictionary: "character.book.closed"
        case .snippets: "scissors"
        case .style: "textformat"
        case .settings: "gearshape"
        }
    }
}

struct MacRootView: View {
    @State private var selection: MacSection? = .home

    var body: some View {
        NavigationSplitView {
            List(MacSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol).tag(section)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } detail: {
            switch selection ?? .home {
            case .home: MacHomeView()
            case .dictionary: DictionaryView()
            case .snippets: SnippetsView()
            case .style: StyleView()
            case .settings: MacSettingsView()
            }
        }
    }
}

struct MacHomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(MacState.self) private var macState
    @State private var micGranted = MicrophonePermission.isGranted
    @State private var pasteGranted = Paster.canPaste

    private var hotkey: String { HotkeyPreset.preset(id: store.settings.hotkeyID).title }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Get back into the flow with \(hotkey)")
                .font(.system(.title2, design: .serif))

            StorageErrorBanner(message: store.storageError)

            if let notice = macState.notice {
                HStack {
                    Label(notice, systemImage: "doc.on.clipboard")
                    Spacer()
                    Button("Dismiss") { macState.notice = nil }
                }
                .padding(10)
                .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 10))
            }

            if !micGranted || !pasteGranted {
                PermissionsCard(micGranted: micGranted, pasteGranted: pasteGranted)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Hold \(hotkey) to dictate").font(.system(.title3, design: .serif))
                    Text("Works in every app. Hold to talk and let go to paste, or tap once for hands-free and tap again to finish. Esc cancels.")
                        .font(.callout)
                }
                .foregroundStyle(.white)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(colors: [Color(red: 0.25, green: 0.18, blue: 0.35), Color(red: 0.12, green: 0.1, blue: 0.14)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 14)
                )
            }

            StatsRow(stats: store.stats)

            HistoryListView(copyAction: Paster.copy)
        }
        .padding()
        .navigationTitle("Home")
        .task {
            // Permissions can change in System Settings while we're open.
            while !Task.isCancelled {
                micGranted = MicrophonePermission.isGranted
                pasteGranted = Paster.canPaste
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
}

struct PermissionsCard: View {
    let micGranted: Bool
    let pasteGranted: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Finish setting up").font(.headline)
            permissionRow(
                "Microphone",
                detail: "Kalaam listens only while you hold the shortcut.",
                granted: micGranted
            ) {
                Task { _ = await MicrophonePermission.request() }
                if MicrophonePermission.isDenied,
                   let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                    NSWorkspace.shared.open(url)
                }
            }
            permissionRow(
                "Paste into apps",
                detail: "Lets Kalaam press ⌘V for you. Without it, text is copied and you paste yourself.",
                granted: pasteGranted
            ) {
                Paster.requestPermission()
            }
        }
        .padding(14)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
    }

    private func permissionRow(_ title: String, detail: String, granted: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(granted ? .green : .secondary)
            VStack(alignment: .leading) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if !granted {
                Button("Allow", action: action)
            }
        }
    }
}

struct MacSettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(MacState.self) private var macState
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    var body: some View {
        Form {
            StorageErrorBanner(message: store.storageError)

            Section("General") {
                Picker("Shortcut", selection: store.binding(\.hotkeyID)) {
                    ForEach(HotkeyPreset.all) { Text($0.title).tag($0.id) }
                }
                if !macState.hotkeyAvailable {
                    Label("Another app is using this shortcut. Pick a different one.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                Toggle("Show the pill above the Dock when idle", isOn: store.binding(\.showIdlePill))
                Toggle("Restore my clipboard after pasting", isOn: store.binding(\.restoreClipboard))
                Toggle("Open Kalaam at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in
                        do {
                            if enabled {
                                try SMAppService.mainApp.register()
                            } else {
                                try SMAppService.mainApp.unregister()
                            }
                            loginError = nil
                        } catch {
                            loginError = error.localizedDescription
                        }
                    }
                if let loginError {
                    Text(loginError).font(.caption).foregroundStyle(.red)
                }
            }

            LanguageSection()
            CleanupSection()
            PrivacySection()

            Section("About") {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                Text("Kalaam is sandboxed with no network access. Dictation, cleanup and AI polish all run on this Mac.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }
}
