import Foundation

/// Small wrapper around NSRegularExpression. Regexes are built per call so nothing
/// non-Sendable is shared between threads. User-supplied text is always escaped
/// before it becomes part of a pattern or template.
enum Rx {
    static func replace(
        _ pattern: String,
        in text: String,
        with template: String,
        caseInsensitive: Bool = true
    ) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else {
            return text
        }
        return re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    static func firstMatch(_ pattern: String, in text: String) -> NSTextCheckingResult? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        return re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    }

    static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        return re.matches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    /// Matches `phrase` as a whole word/phrase, case-insensitively.
    static func wholePhrasePattern(_ phrase: String) -> String {
        "(?<![\\p{L}\\p{N}])" + NSRegularExpression.escapedPattern(for: phrase) + "(?![\\p{L}\\p{N}])"
    }

    static func replacePhrase(_ phrase: String, in text: String, with replacement: String) -> String {
        replace(wholePhrasePattern(phrase), in: text, with: NSRegularExpression.escapedTemplate(for: replacement))
    }
}
