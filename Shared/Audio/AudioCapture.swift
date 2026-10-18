import AVFoundation

enum AudioCaptureError: LocalizedError {
    case noInputDevice

    var errorDescription: String? {
        "No microphone found. Check your input device in System Settings."
    }
}

/// Captures microphone audio. Audio stays in memory only: it is streamed straight to the
/// on-device speech engine and never written to disk.
final class AudioCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var isRunning = false

    /// Both callbacks run on the real-time audio thread.
    var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?
    var onLevel: (@Sendable (Float) -> Void)?

    func start() throws {
        guard !isRunning else { return }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        #endif

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw AudioCaptureError.noInputDevice }

        let onBuffer = self.onBuffer
        let onLevel = self.onLevel
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            onLevel?(Self.level(of: buffer))
            onBuffer?(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw error
        }
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// Loudness of a buffer mapped to 0...1 (roughly -50 dB...0 dB).
    static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0] else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<count {
            sum += samples[i] * samples[i]
        }
        let rms = (sum / Float(count)).squareRoot()
        let decibels = 20 * log10(max(rms, 0.000_001))
        return max(0, min(1, (decibels + 50) / 50))
    }
}
