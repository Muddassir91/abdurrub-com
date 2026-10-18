import AVFoundation

enum BufferConverterError: Error {
    case cannotCreateConverter
    case cannotCreateBuffer
    case conversionFailed(NSError?)
}

/// Converts microphone buffers to the format the speech analyzer wants. Not thread-safe;
/// the owner serialises access.
final class BufferConverter {
    private var converter: AVAudioConverter?

    func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        if buffer.format == format { return buffer }

        if converter == nil || converter?.inputFormat != buffer.format || converter?.outputFormat != format {
            converter = AVAudioConverter(from: buffer.format, to: format)
            converter?.primeMethod = .none
        }
        guard let converter else { throw BufferConverterError.cannotCreateConverter }

        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw BufferConverterError.cannotCreateBuffer
        }

        var error: NSError?
        var consumed = false
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error { throw BufferConverterError.conversionFailed(error) }
        return output
    }

    /// Deep copy, used when audio has to be held briefly before the analyzer is ready.
    static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        copy.frameLength = buffer.frameLength
        let source = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let destination = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for (src, dst) in zip(source, destination) {
            guard let from = src.mData, let to = dst.mData else { continue }
            memcpy(to, from, Int(min(src.mDataByteSize, dst.mDataByteSize)))
        }
        return copy
    }
}
