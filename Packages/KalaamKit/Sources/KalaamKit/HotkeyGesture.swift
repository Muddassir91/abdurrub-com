import Foundation

/// Turns raw hotkey down/up events into dictation actions.
///
/// - Hold longer than `holdThreshold`, then release → push-to-talk: stop and insert on release.
/// - Tap (release sooner)                          → hands-free: keeps recording until the next press.
/// - Escape while recording                         → cancel, nothing is inserted.
public struct HotkeyGesture: Sendable {
    public enum Action: Equatable, Sendable {
        case none
        case start
        case enterHandsFree
        case stopAndInsert
        case cancel
    }

    public enum State: Equatable, Sendable {
        case idle
        case holding(pressedAt: TimeInterval)
        case handsFree
        /// Key went down to finish hands-free mode; waiting for its release.
        case finishing
    }

    public static let defaultHoldThreshold: TimeInterval = 0.5

    public private(set) var state: State = .idle
    public let holdThreshold: TimeInterval

    public init(holdThreshold: TimeInterval = HotkeyGesture.defaultHoldThreshold) {
        self.holdThreshold = holdThreshold
    }

    public var isRecording: Bool {
        switch state {
        case .holding, .handsFree: true
        case .idle, .finishing: false
        }
    }

    public mutating func keyDown(at time: TimeInterval) -> Action {
        switch state {
        case .idle:
            state = .holding(pressedAt: time)
            return .start
        case .handsFree:
            state = .finishing
            return .stopAndInsert
        case .holding, .finishing:
            return .none // key auto-repeat
        }
    }

    public mutating func keyUp(at time: TimeInterval) -> Action {
        switch state {
        case .holding(let pressedAt):
            if time - pressedAt >= holdThreshold {
                state = .idle
                return .stopAndInsert
            }
            state = .handsFree
            return .enterHandsFree
        case .finishing:
            state = .idle
            return .none
        case .idle, .handsFree:
            return .none
        }
    }

    public mutating func escape() -> Action {
        guard isRecording else { return .none }
        state = .idle
        return .cancel
    }

    /// Call when recording was started some other way (e.g. clicking the pill), so the next
    /// key press finishes it.
    public mutating func enterHandsFree() {
        state = .handsFree
    }

    /// Call when recording ends for another reason (pill buttons, errors, silence).
    public mutating func reset() {
        state = .idle
    }
}
