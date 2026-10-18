import Foundation

/// Applies personal dictionary fixes ("cloud code" → "Claude Code").
public struct DictionaryApplier: Sendable {
    public let entries: [DictionaryEntry]

    public init(entries: [DictionaryEntry]) {
        self.entries = entries
    }

    public func apply(_ text: String) -> String {
        // Longest phrases first so "new york city" wins over "new york".
        entries
            .filter { !$0.heard.trimmingCharacters(in: .whitespaces).isEmpty }
            .sorted { $0.heard.count > $1.heard.count }
            .reduce(text) { partial, entry in
                Rx.replacePhrase(entry.heard, in: partial, with: entry.replacement)
            }
    }
}

/// Expands spoken snippet triggers ("my email" → "me@example.com").
public struct SnippetExpander: Sendable {
    public let snippets: [Snippet]

    public init(snippets: [Snippet]) {
        self.snippets = snippets
    }

    public func expand(_ text: String) -> String {
        let usable = snippets
            .filter { !$0.trigger.trimmingCharacters(in: .whitespaces).isEmpty }
            .sorted { $0.trigger.count > $1.trigger.count }

        // If the whole utterance is a trigger ("My email."), return just the expansion,
        // without the punctuation the speech engine added.
        let bare = text.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
        if let exact = usable.first(where: { $0.trigger.lowercased() == bare }) {
            return exact.expansion
        }

        return usable.reduce(text) { partial, snippet in
            Rx.replacePhrase(snippet.trigger, in: partial, with: snippet.expansion)
        }
    }
}
