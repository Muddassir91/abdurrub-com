import Foundation

/// Sanity-checks text returned by the on-device language model before it is used.
///
/// The model is asked only to tidy the transcript, but dictated text can itself look like an
/// instruction ("write me a poem about…"). If the output looks like the model answered or
/// chatted instead of editing, it is rejected and the deterministic cleanup is used instead.
public enum RewriteGuard {
    public static func accept(original: String, rewrite: String) -> String? {
        var result = rewrite.trimmingCharacters(in: .whitespacesAndNewlines)
        result = Rx.replace("^</?transcript>|</?transcript>$", in: result, with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if result.count >= 2, let first = result.first, let last = result.last,
           (first == "\"" && last == "\"") || (first == "“" && last == "”"),
           !original.trimmingCharacters(in: .whitespaces).hasPrefix(String(first)) {
            result = String(result.dropFirst().dropLast())
        }
        guard !result.isEmpty else { return nil }

        let originalWords = TextMetrics.wordCount(original)
        let newWords = TextMetrics.wordCount(result)
        guard originalWords > 0 else { return nil }
        if originalWords < 6 {
            guard newWords <= originalWords + 2, newWords >= 1 else { return nil }
        } else {
            let ratio = Double(newWords) / Double(originalWords)
            guard ratio >= 0.5, ratio <= 1.3 else { return nil }
        }

        let lowered = result.lowercased()
        let originalLowered = original.lowercased()
        let chatty = ["sure", "here is", "here's", "certainly", "i'm sorry", "i am sorry", "i cannot", "i can't", "as an ai", "cleaned"]
        for prefix in chatty where lowered.hasPrefix(prefix) && !originalLowered.hasPrefix(prefix) {
            return nil
        }
        return result
    }
}
