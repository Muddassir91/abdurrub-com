import AppKit
import KalaamKit
import Observation

/// Mac-only UI state.
@MainActor
@Observable
final class MacState {
    /// False when another app already uses the chosen shortcut.
    var hotkeyAvailable = true
    var notice: String?
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store: AppStore
    let controller: DictationController
    let macState = MacState()

    private let hotkeys = HotkeyManager()
    private var gesture = HotkeyGesture()
    private var pill: PillController?

    override init() {
        let store = AppStore()
        self.store = store
        controller = DictationController(store: store)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        controller.contextProvider = {
            AppCategory.context(forBundleID: NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
        }
        controller.appNameProvider = { NSWorkspace.shared.frontmostApplication?.localizedName }
        controller.onResult = { [weak self] text in
            guard let self else { return }
            let restore = store.settings.restoreClipboard
            Task {
                let pasted = await Paster.insert(text, restoreClipboard: restore)
                if !pasted {
                    self.macState.notice = "Copied to clipboard. Allow pasting in Settings to have Kalaam type for you."
                }
            }
        }
        controller.onRecordingEnded = { [weak self] in
            self?.gesture.reset()
            self?.hotkeys.setEscapeEnabled(false)
        }

        hotkeys.onKeyDown = { [weak self] in
            guard let self else { return }
            perform(gesture.keyDown(at: ProcessInfo.processInfo.systemUptime))
        }
        hotkeys.onKeyUp = { [weak self] in
            guard let self else { return }
            perform(gesture.keyUp(at: ProcessInfo.processInfo.systemUptime))
        }
        hotkeys.onEscape = { [weak self] in
            guard let self else { return }
            perform(gesture.escape())
        }
        registerHotkey()
        observeHotkeySetting()

        pill = PillController(controller: controller, store: store) { [weak self] in
            self?.startHandsFree()
        }

        let languageID = store.settings.languageID
        Task {
            _ = await MicrophonePermission.request()
            // Fetch the on-device speech model ahead of the first dictation.
            try? await AppleSpeechEngine.prepareAssets(for: languageID)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false // keep listening for the hotkey from the menu bar
    }

    func startHandsFree() {
        controller.start(handsFree: true)
        if controller.isRecording {
            gesture.enterHandsFree()
            hotkeys.setEscapeEnabled(true)
        }
    }

    private func perform(_ action: HotkeyGesture.Action) {
        switch action {
        case .none:
            break
        case .start:
            controller.start(handsFree: false)
            if controller.isRecording {
                hotkeys.setEscapeEnabled(true)
            }
        case .enterHandsFree:
            controller.setHandsFree()
        case .stopAndInsert:
            Task { await controller.stopAndProcess() }
        case .cancel:
            controller.cancel()
        }
    }

    private func registerHotkey() {
        macState.hotkeyAvailable = hotkeys.register(HotkeyPreset.preset(id: store.settings.hotkeyID))
    }

    private func observeHotkeySetting() {
        withObservationTracking {
            _ = store.settings.hotkeyID
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.registerHotkey()
                self?.observeHotkeySetting()
            }
        }
    }
}
