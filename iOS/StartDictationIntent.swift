import AppIntents

/// "Start Dictation" — assign it to the Action Button, Back Tap, or say
/// "Dictate with Kalaam" to Siri. Opens Kalaam and starts listening right away.
struct StartDictationIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Dictation"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        DictationLaunchRequest.shared.pending = true
        return .result()
    }
}

struct KalaamShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartDictationIntent(),
            phrases: [
                "Dictate with \(.applicationName)",
                "Start \(.applicationName)",
            ],
            shortTitle: "Dictate",
            systemImageName: "mic.fill"
        )
    }
}
