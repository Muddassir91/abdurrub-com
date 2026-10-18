import KalaamKit
import SwiftUI

struct IOSRootView: View {
    @Environment(AppStore.self) private var store
    @Environment(DictationController.self) private var controller
    @Environment(\.scenePhase) private var scenePhase
    private let launch = DictationLaunchRequest.shared

    var body: some View {
        TabView {
            Tab("Dictate", systemImage: "mic.fill") {
                NavigationStack { DictateView() }
            }
            Tab("History", systemImage: "clock") {
                NavigationStack {
                    HistoryListView(copyAction: { Clipboard.copy($0, expiresAfter: store.settings.clipboardExpirySeconds) })
                        .navigationTitle("History")
                }
            }
            Tab("Snippets", systemImage: "scissors") {
                NavigationStack { SnippetsView() }
            }
            Tab("Dictionary", systemImage: "character.book.closed") {
                NavigationStack { DictionaryView() }
            }
            Tab("Settings", systemImage: "gearshape") {
                NavigationStack { IOSSettingsView() }
            }
        }
        .tint(Theme.accent)
        .onChange(of: scenePhase) { startIfRequested() }
        .onChange(of: launch.pending) { startIfRequested() }
        .onChange(of: store.settings.autoStopOnSilence) { _, value in controller.autoStopOnSilence = value }
        .onAppear { startIfRequested() }
        .task {
            _ = await MicrophonePermission.request()
            try? await AppleSpeechEngine.prepareAssets(for: store.settings.languageID)
        }
    }

    private func startIfRequested() {
        guard launch.pending, scenePhase == .active else { return }
        launch.pending = false
        controller.start(handsFree: true)
    }
}

struct DictateView: View {
    @Environment(AppStore.self) private var store
    @Environment(DictationController.self) private var controller
    @State private var copiedFlash = false

    var body: some View {
        VStack(spacing: 24) {
            StorageErrorBanner(message: store.storageError)
            StatsRow(stats: store.stats)

            Spacer()

            statusText
            levelBars
            recordButton

            Spacer()

            if let result = controller.lastResult {
                VStack(alignment: .leading, spacing: 10) {
                    Text(result)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HStack {
                        Button("Copy", systemImage: "doc.on.doc") {
                            Clipboard.copy(result, expiresAfter: store.settings.clipboardExpirySeconds)
                            flash()
                        }
                        Spacer()
                        ShareLink(item: result)
                    }
                    .font(.callout)
                }
                .padding()
                .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding()
        .navigationTitle("Kalaam")
        .overlay(alignment: .top) {
            if copiedFlash {
                Text("Copied — paste anywhere")
                    .font(.callout.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .onChange(of: controller.lastResult) { _, newValue in
            if newValue != nil { flash() }
        }
    }

    @ViewBuilder
    private var statusText: some View {
        switch controller.phase {
        case .idle:
            Text("Tap to dictate").foregroundStyle(.secondary)
        case .recording:
            Text(store.settings.autoStopOnSilence ? "Listening… pause to finish" : "Listening… tap to finish")
        case .transcribing:
            Text("Writing it out…").foregroundStyle(.secondary)
        case .failed(let message):
            Text(message).foregroundStyle(.red).multilineTextAlignment(.center)
        }
    }

    private var levelBars: some View {
        HStack(spacing: 4) {
            ForEach(controller.levels.indices, id: \.self) { index in
                Capsule()
                    .fill(Theme.accent)
                    .frame(width: 4, height: 6 + CGFloat(controller.levels[index]) * 40)
            }
        }
        .frame(height: 46)
        .opacity(controller.isRecording ? 1 : 0.25)
        .animation(.linear(duration: 0.08), value: controller.levels)
    }

    private var recordButton: some View {
        Button {
            if controller.isRecording {
                Task { await controller.stopAndProcess() }
            } else {
                controller.start(handsFree: true)
            }
        } label: {
            ZStack {
                Circle()
                    .fill(controller.isRecording ? Color.red : Theme.accent)
                    .frame(width: 120, height: 120)
                if controller.phase == .transcribing {
                    ProgressView().tint(.white).controlSize(.large)
                } else {
                    Image(systemName: controller.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(controller.phase == .transcribing)
        .accessibilityLabel(controller.isRecording ? "Stop and copy" : "Start dictating")
        .sensoryFeedback(.impact, trigger: controller.isRecording)
        .contextMenu {
            if controller.isRecording {
                Button("Cancel", systemImage: "xmark", role: .destructive) { controller.cancel() }
            }
        }
    }

    private func flash() {
        withAnimation { copiedFlash = true }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation { copiedFlash = false }
        }
    }
}

struct IOSSettingsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Form {
            StorageErrorBanner(message: store.storageError)

            Section {
                Toggle("Stop when I pause", isOn: store.binding(\.autoStopOnSilence))
                Picker("Clear copied text after", selection: store.binding(\.clipboardExpirySeconds)) {
                    Text("1 minute").tag(60)
                    Text("5 minutes").tag(300)
                    Text("15 minutes").tag(900)
                    Text("1 hour").tag(3_600)
                    Text("Never").tag(0)
                }
            } header: {
                Text("Dictation")
            } footer: {
                Text("Copied text stays on this iPhone (it isn't shared to your Mac via Universal Clipboard).")
            }

            Section {
                NavigationLink("Writing style") { StyleView() }
            }

            LanguageSection()
            CleanupSection()

            Section {
                Text("Settings → Action Button → Shortcut → Kalaam → Start Dictation. Or say \"Dictate with Kalaam\" to Siri. Kalaam opens, listens, and copies the text when you pause.")
                    .font(.callout)
            } header: {
                Text("Dictate in one press")
            }

            PrivacySection()
        }
        .navigationTitle("Settings")
    }
}
