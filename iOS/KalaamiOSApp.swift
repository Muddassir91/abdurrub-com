import KalaamKit
import Observation
import SwiftUI

@main
struct KalaamiOSApp: App {
    @State private var store: AppStore
    @State private var controller: DictationController

    init() {
        let store = AppStore()
        let controller = DictationController(store: store)
        controller.autoStopOnSilence = store.settings.autoStopOnSilence
        controller.onResult = { text in
            Clipboard.copy(text, expiresAfter: store.settings.clipboardExpirySeconds)
        }
        _store = State(initialValue: store)
        _controller = State(initialValue: controller)
    }

    var body: some Scene {
        WindowGroup {
            IOSRootView()
                .environment(store)
                .environment(controller)
        }
    }
}

/// Lets the "Start Dictation" shortcut (Action Button, Siri, Back Tap) ask the app to record.
/// Recording only begins once the app is in the foreground, which iOS requires for the mic.
@MainActor
@Observable
final class DictationLaunchRequest {
    static let shared = DictationLaunchRequest()
    var pending = false
}
