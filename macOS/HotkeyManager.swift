import AppKit
import Carbon.HIToolbox

struct HotkeyPreset: Identifiable, Hashable {
    let id: String
    let title: String
    let keyCode: UInt32
    let modifiers: UInt32

    static let all: [HotkeyPreset] = [
        HotkeyPreset(id: "ctrl-l", title: "⌃ L", keyCode: UInt32(kVK_ANSI_L), modifiers: UInt32(controlKey)),
        HotkeyPreset(id: "opt-space", title: "⌥ Space", keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey)),
        HotkeyPreset(id: "ctrl-opt-space", title: "⌃⌥ Space", keyCode: UInt32(kVK_Space), modifiers: UInt32(controlKey | optionKey)),
        HotkeyPreset(id: "cmd-shift-d", title: "⌘⇧ D", keyCode: UInt32(kVK_ANSI_D), modifiers: UInt32(cmdKey | shiftKey)),
        HotkeyPreset(id: "f5", title: "F5", keyCode: UInt32(kVK_F5), modifiers: 0),
    ]

    static func preset(id: String) -> HotkeyPreset {
        all.first { $0.id == id } ?? all[0]
    }
}

/// System-wide hotkey using Carbon's RegisterEventHotKey.
///
/// Unlike a global key-event monitor, this sees only the one registered shortcut — it can't
/// observe any other typing — and it needs no Input Monitoring or Accessibility permission.
@MainActor
final class HotkeyManager {
    var onKeyDown: (() -> Void)?
    var onKeyUp: (() -> Void)?
    var onEscape: (() -> Void)?

    private var mainRef: EventHotKeyRef?
    private var escapeRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?

    nonisolated fileprivate static let signature: OSType = 0x4B4C_4D4D // "KLMM"
    nonisolated fileprivate static let mainID: UInt32 = 1
    nonisolated fileprivate static let escapeID: UInt32 = 2

    init() {
        installHandler()
    }

    /// Returns false if another app already owns this shortcut.
    @discardableResult
    func register(_ preset: HotkeyPreset) -> Bool {
        if let mainRef {
            UnregisterEventHotKey(mainRef)
            self.mainRef = nil
        }
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(
            preset.keyCode,
            preset.modifiers,
            EventHotKeyID(signature: Self.signature, id: Self.mainID),
            GetApplicationEventTarget(),
            0,
            &ref
        )
        guard status == noErr else { return false }
        mainRef = ref
        return true
    }

    /// Esc is only grabbed while recording, so it keeps working normally the rest of the time.
    func setEscapeEnabled(_ enabled: Bool) {
        if enabled, escapeRef == nil {
            var ref: EventHotKeyRef?
            let status = RegisterEventHotKey(
                UInt32(kVK_Escape),
                0,
                EventHotKeyID(signature: Self.signature, id: Self.escapeID),
                GetApplicationEventTarget(),
                0,
                &ref
            )
            if status == noErr { escapeRef = ref }
        } else if !enabled, let escapeRef {
            UnregisterEventHotKey(escapeRef)
            self.escapeRef = nil
        }
    }

    fileprivate func handle(id: UInt32, pressed: Bool) {
        switch (id, pressed) {
        case (Self.mainID, true): onKeyDown?()
        case (Self.mainID, false): onKeyUp?()
        case (Self.escapeID, true): onEscape?()
        default: break
        }
    }

    private func installHandler() {
        var specs = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        // The manager lives for the whole app lifetime (owned by AppDelegate), so an
        // unretained pointer is safe here.
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), hotKeyCallback, specs.count, &specs, context, &handlerRef)
    }
}

private func hotKeyCallback(_: EventHandlerCallRef?, event: EventRef?, userData: UnsafeMutableRawPointer?) -> OSStatus {
    guard let event, let userData else { return OSStatus(eventNotHandledErr) }
    var hotKeyID = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    guard status == noErr, hotKeyID.signature == HotkeyManager.signature else { return OSStatus(eventNotHandledErr) }
    let pressed = GetEventKind(event) == UInt32(kEventHotKeyPressed)
    let id = hotKeyID.id
    // Carbon delivers application events on the main thread.
    MainActor.assumeIsolated {
        let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
        manager.handle(id: id, pressed: pressed)
    }
    return noErr
}
