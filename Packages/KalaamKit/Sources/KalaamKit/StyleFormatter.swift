import Foundation

public struct StyleFormatter: Sendable {
    public init() {}

    public func apply(_ text: String, style: WritingStyle) -> String {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return t }
        switch style {
        case .formal:
            return ensureTerminalPunctuation(t)
        case .casual:
            return dropTrailingPeriod(t)
        case .veryCasual:
            return dropTrailingPeriod(lowercasePreservingAcronyms(t))
        case .excited:
            return exclaim(t)
        }
    }

    func ensureTerminalPunctuation(_ text: String) -> String {
        guard let last = text.last, last.isLetter || last.isNumber else { return text }
        return text + "."
    }

    func dropTrailingPeriod(_ text: String) -> String {
        guard text.hasSuffix("."), !text.hasSuffix("..") else { return text }
        return String(text.dropLast())
    }

    func exclaim(_ text: String) -> String {
        if text.hasSuffix("..") { return text }
        if text.hasSuffix(".") { return String(text.dropLast()) + "!" }
        if let last = text.last, last.isLetter || last.isNumber { return text + "!" }
        return text
    }

    /// Lowercases words but keeps acronyms like "NASA" or "PDF" (two or more capitals).
    func lowercasePreservingAcronyms(_ text: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "\\p{L}[\\p{L}'’]*") else { return text.lowercased() }
        let ns = text as NSString
        var result = text
        // Replace from the end so earlier ranges stay valid.
        for match in re.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            let word = ns.substring(with: match.range)
            let isAcronym = word.count >= 2 && word == word.uppercased() && word != word.lowercased()
            guard !isAcronym, let range = Range(match.range, in: result) else { continue }
            result.replaceSubrange(range, with: word.lowercased())
        }
        return result
    }
}
