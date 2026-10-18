import Foundation

/// Deterministic, offline cleanup of raw speech-to-text output.
public struct TextCleaner: Sendable {
    public init() {}

    public func clean(_ input: String, level: CleanupLevel) -> String {
        var text = normalizeWhitespace(String(input.prefix(Limits.maxTranscriptLength)))
        guard level > .none else { return text }

        text = removeFillers(text)
        if level >= .medium {
            text = applySelfCorrections(text)
            text = applySpokenCommands(text)
        }
        text = fixPunctuationSpacing(text)
        text = capitalizeStandaloneI(text)
        text = capitalizeSentences(text)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Steps

    func normalizeWhitespace(_ text: String) -> String {
        Rx.replace("[ \\t]+", in: text, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Removes um, uh, erm, ah, hmm and the comma that usually surrounds them.
    func removeFillers(_ text: String) -> String {
        let filler = "(?:u+h*m+|u+h+|e+r+m*|a+h+|h+m+|m{2,})"
        let pattern = ",?\\s*(?<![\\p{L}\\p{N}'’])" + filler + "(?![\\p{L}\\p{N}'’-]),?"
        return normalizeWhitespace(Rx.replace(pattern, in: text, with: ""))
    }

    /// "new line" and "new paragraph" become real line breaks.
    func applySpokenCommands(_ text: String) -> String {
        var t = Rx.replace("[,.]?\\s*(?<![\\p{L}])new paragraph(?![\\p{L}])[,.]?\\s*", in: text, with: "\n\n")
        t = Rx.replace("[,.]?\\s*(?<![\\p{L}])new line(?![\\p{L}])[,.]?\\s*", in: t, with: "\n")
        return t
    }

    /// Handles "meet at 3, no wait, 4" → "meet at 4" and "...scratch that" → drops the last clause.
    /// Correction cues only count when set off by punctuation, so "there's no wait time" is left alone.
    func applySelfCorrections(_ text: String) -> String {
        let cues = "(no wait|wait no|no sorry|scratch that|delete that)"
        let pattern = "([,.]\\s*)?(?<![\\p{L}])" + cues + "(?![\\p{L}])([,.!])?\\s*"

        var t = text
        // Bounded loop: each pass removes one cue, so it always terminates.
        for _ in 0..<20 {
            let candidates = Rx.matches(pattern, in: t)
            guard let match = candidates.first(where: { m in
                      let cue = Range(m.range(at: 2), in: t).map { t[$0].lowercased() } ?? ""
                      let punctuated = m.range(at: 1).location != NSNotFound || m.range(at: 3).location != NSNotFound
                      return punctuated || cue.hasPrefix("scratch") || cue.hasPrefix("delete")
                  }),
                  let whole = Range(match.range, in: t),
                  let cueRange = Range(match.range(at: 2), in: t) else { break }

            let cue = t[cueRange].lowercased()
            let before = String(t[..<whole.lowerBound])
            let after = String(t[whole.upperBound...])

            if cue.hasPrefix("scratch") || cue.hasPrefix("delete") {
                let kept = dropLastClause(before)
                t = kept.isEmpty ? after : kept + " " + after
                continue
            }

            let correction = after.split(separator: " ").map(String.init)
            guard let firstCorrection = correction.first.map(normalizedWord), !firstCorrection.isEmpty else {
                t = before
                continue
            }

            var words = before.split(separator: " ").map(String.init)
            let windowStart = max(0, words.count - 6)
            if let idx = words[windowStart...].lastIndex(where: { normalizedWord($0) == firstCorrection }) {
                words.removeSubrange(idx...)
            } else if !words.isEmpty {
                words.removeLast()
            }
            t = words.isEmpty ? after : words.joined(separator: " ") + " " + after
        }
        return normalizeWhitespace(t)
    }

    /// Drops the clause being spoken. If nothing meaningful was said since the last full stop
    /// (e.g. "Send it today. Scratch that."), the previous sentence is dropped instead.
    func dropLastClause(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let terminators: Set<Character> = [".", "!", "?", "\n"]
        guard let lastStop = trimmed.lastIndex(where: { terminators.contains($0) }) else { return "" }

        let discourseWords: Set<String> = ["actually", "oh", "okay", "ok", "so", "wait", "hmm"]
        let tail = trimmed[trimmed.index(after: lastStop)...]
            .split(separator: " ")
            .map { normalizedWord(String($0)) }
            .filter { !$0.isEmpty && !discourseWords.contains($0) }
        if !tail.isEmpty {
            return String(trimmed[...lastStop])
        }
        let head = trimmed[..<lastStop]
        guard let previousStop = head.lastIndex(where: { terminators.contains($0) }) else { return "" }
        return String(head[...previousStop])
    }

    func normalizedWord(_ word: String) -> String {
        word.lowercased().trimmingCharacters(in: .punctuationCharacters)
    }

    func fixPunctuationSpacing(_ text: String) -> String {
        var t = text
        t = Rx.replace("[ \\t]+([,.!?;:])", in: t, with: "$1")
        t = Rx.replace(",{2,}", in: t, with: ",")
        t = Rx.replace(",\\s*([.!?])", in: t, with: "$1")
        t = Rx.replace("([.!?]),", in: t, with: "$1")
        t = Rx.replace("^[\\s,.;:]+", in: t, with: "")
        t = Rx.replace("\\n[ \\t]+", in: t, with: "\n")
        t = Rx.replace("[ \\t]+\\n", in: t, with: "\n")
        t = Rx.replace("[ \\t]{2,}", in: t, with: " ")
        return t
    }

    func capitalizeStandaloneI(_ text: String) -> String {
        Rx.replace("(?<![\\p{L}\\p{N}.@])i(?=['’]|(?![\\p{L}\\p{N}.@-]))", in: text, with: "I", caseInsensitive: false)
    }

    /// Capitalizes the first letter of the text and of each sentence. A full stop only
    /// starts a sentence when followed by whitespace, so "example.com" and "3.5" are safe.
    func capitalizeSentences(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        var capitalizeNext = true
        var afterTerminator = false
        for ch in text {
            if afterTerminator {
                afterTerminator = false
                if ch.isWhitespace { capitalizeNext = true }
            }
            if capitalizeNext, ch.isLetter || ch.isNumber {
                result += ch.isLetter ? ch.uppercased() : String(ch)
                capitalizeNext = false
                continue
            }
            result.append(ch)
            if ch == "\n" {
                capitalizeNext = true
            } else if ch == "." || ch == "!" || ch == "?" {
                afterTerminator = true
            }
        }
        return result
    }
}
