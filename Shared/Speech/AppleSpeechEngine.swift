import AVFoundation
import Speech

enum SpeechEngineError: LocalizedError {
    case unsupportedLanguage(String)
    case noAudioFormat
    case notStarted

    var errorDescription: String? {
        switch self {
        case .unsupportedLanguage(let id):
            "On-device dictation doesn't support \(Locale.current.localizedString(forIdentifier: id) ?? id) yet. Pick another language in Settings."
        case .noAudioFormat:
            "The speech engine couldn't start. Try again."
        case .notStarted:
            "Recording didn't start. Try again."
        }
    }
}

/// On-device transcription with Apple's SpeechAnalyzer (iOS 26 / macOS 26).
///
/// Everything runs locally on the Neural Engine. The language model is downloaded once by the
/// operating system (not by this app) and shared with other apps. No audio leaves the device.
final class AppleSpeechEngine: @unchecked Sendable {
    private let lock = NSLock()
    private var analyzer: SpeechAnalyzer?
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<String, Error>?
    private var analyzerFormat: AVAudioFormat?
    private let converter = BufferConverter()

    /// Audio captured before the analyzer finished starting (~40 s cap at 48 kHz).
    private var pending: [AVAudioPCMBuffer] = []
    private var acceptingAudio = false
    private static let maxPendingBuffers = 2_000

    // MARK: - Languages & assets

    static func supportedLocales() async -> [Locale] {
        await SpeechTranscriber.supportedLocales
    }

    static func resolveLocale(_ identifier: String) async -> Locale? {
        let wanted = Locale(identifier: identifier)
        let supported = await SpeechTranscriber.supportedLocales
        return supported.first { $0.identifier(.bcp47) == wanted.identifier(.bcp47) }
            ?? supported.first { $0.language.languageCode == wanted.language.languageCode }
    }

    /// Asks the OS to download the on-device model for a language if it isn't installed yet.
    static func prepareAssets(for identifier: String) async throws {
        guard let locale = await resolveLocale(identifier) else {
            throw SpeechEngineError.unsupportedLanguage(identifier)
        }
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [makeTranscriber(locale)]) {
            try await request.downloadAndInstall()
        }
    }

    private static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
    }

    // MARK: - Session

    /// Call right before the microphone starts so early audio is kept.
    func beginSession() {
        lock.withLock {
            pending.removeAll()
            acceptingAudio = true
        }
    }

    func start(languageID: String) async throws {
        guard let locale = await Self.resolveLocale(languageID) else {
            throw SpeechEngineError.unsupportedLanguage(languageID)
        }
        try await Self.prepareAssets(for: languageID)

        let transcriber = Self.makeTranscriber(locale)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw SpeechEngineError.noAudioFormat
        }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let results = Task { () throws -> String in
            var text = ""
            for try await result in transcriber.results where result.isFinal {
                text += String(result.text.characters)
            }
            return text
        }

        try await analyzer.start(inputSequence: stream)

        lock.withLock {
            self.analyzer = analyzer
            self.continuation = continuation
            self.resultsTask = results
            self.analyzerFormat = format
            flushPendingLocked()
        }
    }

    /// Called on the audio thread for every captured buffer.
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.withLock {
            guard acceptingAudio else { return }
            guard let continuation, let analyzerFormat else {
                if pending.count < Self.maxPendingBuffers, let copy = BufferConverter.copy(buffer) {
                    pending.append(copy)
                }
                return
            }
            flushPendingLocked()
            if let converted = try? converter.convert(buffer, to: analyzerFormat) {
                continuation.yield(AnalyzerInput(buffer: converted))
            }
        }
    }

    func finish() async throws -> String {
        let (analyzer, continuation, results) = lock.withLock {
            flushPendingLocked()
            acceptingAudio = false
            let parts = (self.analyzer, self.continuation, self.resultsTask)
            self.continuation = nil
            return parts
        }
        defer { reset() }
        guard let analyzer, let results else { throw SpeechEngineError.notStarted }
        continuation?.finish()
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await results.value
    }

    func cancel() async {
        let (analyzer, continuation, results) = lock.withLock {
            acceptingAudio = false
            pending.removeAll()
            let parts = (self.analyzer, self.continuation, self.resultsTask)
            self.continuation = nil
            return parts
        }
        continuation?.finish()
        results?.cancel()
        await analyzer?.cancelAndFinishNow()
        reset()
    }

    private func reset() {
        lock.withLock {
            analyzer = nil
            resultsTask = nil
            analyzerFormat = nil
            pending.removeAll()
        }
    }

    /// Must be called with `lock` held.
    private func flushPendingLocked() {
        guard !pending.isEmpty, let continuation, let analyzerFormat else { return }
        for buffer in pending {
            if let converted = try? converter.convert(buffer, to: analyzerFormat) {
                continuation.yield(AnalyzerInput(buffer: converted))
            }
        }
        pending.removeAll()
    }
}
