import AVFoundation
import Foundation
import KalaamKit
import Observation

enum MicrophonePermission {
    static var isGranted: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    static var isDenied: Bool {
        AVAudioApplication.shared.recordPermission == .denied
    }

    static func request() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        case .undetermined: return await AVAudioApplication.requestRecordPermission()
        @unknown default: return false
        }
    }
}

/// Runs one dictation at a time: microphone → on-device speech → cleanup → result.
/// Platform code decides what to do with the result (paste on Mac, clipboard on iPhone).
@MainActor
@Observable
final class DictationController {
    enum Phase: Equatable {
        case idle
        case recording(handsFree: Bool)
        case transcribing
        case failed(String)
    }

    static let barCount = 10
    /// Hard stop so a forgotten hands-free session can't record indefinitely.
    static let maxRecordingSeconds: TimeInterval = 10 * 60

    private(set) var phase: Phase = .idle
    private(set) var levels: [Float] = Array(repeating: 0, count: DictationController.barCount)
    private(set) var lastResult: String?

    var isRecording: Bool {
        if case .recording = phase { return true }
        return false
    }

    /// iOS: stop after ~2 s of silence once the user has spoken.
    @ObservationIgnored var autoStopOnSilence = false
    /// Where the text is going (used to pick a writing style).
    @ObservationIgnored var contextProvider: () -> StyleContext = { .other }
    @ObservationIgnored var appNameProvider: () -> String? = { nil }
    /// Called with the final text after a successful dictation.
    @ObservationIgnored var onResult: ((String) -> Void)?
    /// Called whenever recording ends for any reason (lets the hotkey state machine reset).
    @ObservationIgnored var onRecordingEnded: (() -> Void)?

    @ObservationIgnored private let store: AppStore
    @ObservationIgnored private let audio = AudioCapture()
    @ObservationIgnored private let engine = AppleSpeechEngine()
    @ObservationIgnored private var engineStart: Task<Void, Error>?
    @ObservationIgnored private var startedAt = Date()
    @ObservationIgnored private var peakLevel: Float = 0
    @ObservationIgnored private var lastSpeechAt: Date?
    @ObservationIgnored private var capturedContext: StyleContext = .other
    @ObservationIgnored private var capturedAppName: String?
    @ObservationIgnored private var failureResetTask: Task<Void, Never>?
    /// Bumped on every start/cancel so a cancelled session can never deliver a result.
    @ObservationIgnored private var session = 0

    init(store: AppStore) {
        self.store = store
    }

    // MARK: - Control

    /// Starts recording immediately (synchronously) so no early words are lost.
    func start(handsFree: Bool) {
        switch phase {
        case .idle, .failed: break
        case .recording, .transcribing: return
        }
        guard MicrophonePermission.isGranted else {
            fail(MicrophonePermission.isDenied
                 ? "Microphone access is off. Turn it on in System Settings."
                 : "Allow microphone access, then try again.")
            Task { _ = await MicrophonePermission.request() }
            return
        }

        capturedContext = contextProvider()
        capturedAppName = appNameProvider()
        let engine = self.engine
        engine.beginSession()
        audio.onBuffer = { buffer in engine.append(buffer) }
        audio.onLevel = { [weak self] level in
            Task { @MainActor in self?.receive(level: level) }
        }
        do {
            try audio.start()
        } catch {
            Task { await engine.cancel() }
            fail(error.localizedDescription)
            return
        }

        failureResetTask?.cancel()
        session += 1
        startedAt = Date()
        peakLevel = 0
        lastSpeechAt = nil
        levels = Array(repeating: 0, count: Self.barCount)
        phase = .recording(handsFree: handsFree)

        let languageID = store.settings.languageID
        engineStart = Task { try await engine.start(languageID: languageID) }
    }

    func setHandsFree() {
        guard case .recording = phase else { return }
        phase = .recording(handsFree: true)
    }

    func stopAndProcess() async {
        guard isRecording else { return }
        audio.stop()
        phase = .transcribing
        onRecordingEnded?()
        let duration = Date().timeIntervalSince(startedAt)
        let current = session

        do {
            try await engineStart?.value
            engineStart = nil
            let raw = try await engine.finish().trimmingCharacters(in: .whitespacesAndNewlines)
            guard current == session else { return }
            guard !raw.isEmpty else {
                fail(peakLevel < 0.2 ? "No audio detected. Check your microphone." : "Didn't catch that. Try again.")
                return
            }

            let pipeline = store.pipeline
            var text = pipeline.prepare(raw)
            if store.settings.cleanupLevel == .high, let polished = await AIPolisher.polish(text) {
                text = polished
            }
            text = pipeline.finish(text, context: capturedContext)
            guard current == session else { return }

            lastResult = text
            store.addHistory(HistoryItem(rawText: raw, finalText: text, durationSeconds: duration, appName: capturedAppName))
            phase = .idle
            onResult?(text)
        } catch {
            guard current == session else { return }
            engineStart = nil
            await engine.cancel()
            fail(error.localizedDescription)
        }
    }

    /// Discards the recording. Nothing is transcribed, saved or pasted.
    func cancel() {
        guard isRecording || phase == .transcribing else { return }
        session += 1
        audio.stop()
        engineStart?.cancel()
        engineStart = nil
        let engine = self.engine
        Task { await engine.cancel() }
        phase = .idle
        onRecordingEnded?()
    }

    // MARK: - Internals

    private func receive(level: Float) {
        guard isRecording else { return }
        levels.removeFirst()
        levels.append(level)
        peakLevel = max(peakLevel, level)

        let now = Date()
        if now.timeIntervalSince(startedAt) > Self.maxRecordingSeconds {
            Task { await stopAndProcess() }
            return
        }
        guard autoStopOnSilence else { return }
        if level > 0.35 {
            lastSpeechAt = now
        } else if let lastSpeechAt, now.timeIntervalSince(lastSpeechAt) > 2.0 {
            self.lastSpeechAt = nil
            Task { await stopAndProcess() }
        }
    }

    private func fail(_ message: String) {
        phase = .failed(message)
        onRecordingEnded?()
        failureResetTask?.cancel()
        failureResetTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self, case .failed = self.phase else { return }
            self.phase = .idle
        }
    }
}
