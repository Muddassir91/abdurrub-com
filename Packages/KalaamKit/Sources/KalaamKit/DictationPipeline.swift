import Foundation

/// The text-processing pipeline, split in two so the platform layer can run an optional
/// (async, on-device) AI polish step in between:
///
///     raw → prepare (dictionary + cleanup) → [AI polish] → finish (style + snippets)
///
/// Snippets run last so a style (e.g. "very casual" lowercasing) never mangles an expansion.
public struct DictationPipeline: Sendable {
    public var settings: AppSettings
    public var snippets: [Snippet]
    public var dictionary: [DictionaryEntry]

    public init(settings: AppSettings, snippets: [Snippet], dictionary: [DictionaryEntry]) {
        self.settings = settings
        self.snippets = snippets
        self.dictionary = dictionary
    }

    public func prepare(_ raw: String) -> String {
        let bounded = String(raw.prefix(Limits.maxTranscriptLength))
        let corrected = DictionaryApplier(entries: dictionary).apply(bounded)
        return TextCleaner().clean(corrected, level: settings.cleanupLevel)
    }

    public func finish(_ text: String, context: StyleContext) -> String {
        guard settings.cleanupLevel > .none else {
            return SnippetExpander(snippets: snippets).expand(text)
        }
        let styled = StyleFormatter().apply(text, style: settings.style(for: context))
        return SnippetExpander(snippets: snippets).expand(styled)
    }

    /// Convenience for the synchronous path (no AI polish).
    public func process(_ raw: String, context: StyleContext) -> String {
        finish(prepare(raw), context: context)
    }
}
