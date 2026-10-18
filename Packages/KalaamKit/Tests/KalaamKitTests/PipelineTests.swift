import Foundation
import Testing
@testable import KalaamKit

struct StyleFormatterTests {
    let formatter = StyleFormatter()
    let sample = "Hey, are you free for lunch tomorrow? Let's do 12 if that works for you."

    @Test func formalKeepsPunctuation() {
        #expect(formatter.apply("Sounds good", style: .formal) == "Sounds good.")
        #expect(formatter.apply(sample, style: .formal) == sample)
    }

    @Test func casualDropsFinalPeriod() {
        #expect(formatter.apply(sample, style: .casual) == "Hey, are you free for lunch tomorrow? Let's do 12 if that works for you")
    }

    @Test func veryCasualLowercasesButKeepsAcronyms() {
        #expect(formatter.apply("Send the PDF to NASA today.", style: .veryCasual) == "send the PDF to NASA today")
    }

    @Test func excitedAddsExclamation() {
        #expect(formatter.apply(sample, style: .excited) == "Hey, are you free for lunch tomorrow? Let's do 12 if that works for you!")
        #expect(formatter.apply("Great news", style: .excited) == "Great news!")
    }
}

struct ReplacementTests {
    @Test func dictionaryReplacesWholePhrasesOnly() {
        let d = DictionaryApplier(entries: [DictionaryEntry(heard: "cloud code", replacement: "Claude Code")])
        #expect(d.apply("I love cloud code a lot") == "I love Claude Code a lot")
        #expect(d.apply("I love Cloud Code.") == "I love Claude Code.")
        #expect(d.apply("cloud codes") == "cloud codes")
    }

    @Test func snippetExpandsInsideSentence() {
        let s = SnippetExpander(snippets: [Snippet(trigger: "my email", expansion: "me@example.com")])
        #expect(s.expand("Please write to my email today.") == "Please write to me@example.com today.")
    }

    @Test func snippetAloneReturnsBareExpansion() {
        let s = SnippetExpander(snippets: [Snippet(trigger: "my email", expansion: "me@example.com")])
        #expect(s.expand("My email.") == "me@example.com")
    }

    @Test func regexCharactersInUserInputAreLiteral() {
        let s = SnippetExpander(snippets: [Snippet(trigger: "price (usd)", expansion: "$100 and \\1")])
        #expect(s.expand("The price (usd) is set") == "The $100 and \\1 is set")
        let d = DictionaryApplier(entries: [DictionaryEntry(heard: ".*", replacement: "x")])
        #expect(d.apply("nothing here") == "nothing here")
    }

    @Test func longerTriggersWin() {
        let s = SnippetExpander(snippets: [
            Snippet(trigger: "my address", expansion: "1 Main St"),
            Snippet(trigger: "my address work", expansion: "2 Office Rd"),
        ])
        #expect(s.expand("ship to my address work please") == "ship to 2 Office Rd please")
    }
}

struct PipelineTests {
    @Test func fullPipelineOrder() {
        var settings = AppSettings()
        settings.cleanupLevel = .medium
        settings.styles[.personal] = .veryCasual
        let pipeline = DictationPipeline(
            settings: settings,
            snippets: [Snippet(trigger: "my email", expansion: "Me@Example.com")],
            dictionary: [DictionaryEntry(heard: "cloud code", replacement: "Claude Code")]
        )
        let out = pipeline.process("um, I tried cloud code, send it to my email.", context: .personal)
        // Style lowercases, but the snippet expansion (applied last) keeps its own casing.
        #expect(out == "i tried claude code, send it to Me@Example.com")
    }

    @Test func noneLevelSkipsStyle() {
        var settings = AppSettings()
        settings.cleanupLevel = .none
        let pipeline = DictationPipeline(settings: settings, snippets: [], dictionary: [])
        #expect(pipeline.process("um hello", context: .email) == "um hello")
    }
}

struct ValidationTests {
    @Test func rejectsEmptyAndOversized() {
        #expect(throws: ValidationError.empty) { try EntryValidator.phrase("   ") }
        #expect(throws: ValidationError.tooLong(max: Limits.maxTriggerLength)) {
            try EntryValidator.phrase(String(repeating: "a", count: Limits.maxTriggerLength + 1))
        }
        #expect(throws: ValidationError.tooManyEntries(max: Limits.maxEntries)) { try EntryValidator.canAdd(count: Limits.maxEntries) }
        #expect((try? EntryValidator.phrase("  my email ")) == "my email")
    }

    @Test func settingsDecodeToleratesMissingKeys() throws {
        let data = Data(#"{"languageID":"en-GB"}"#.utf8)
        let s = try JSONDecoder().decode(AppSettings.self, from: data)
        #expect(s.languageID == "en-GB")
        #expect(s.cleanupLevel == .medium)
    }

    @Test func settingsRoundTrip() throws {
        var s = AppSettings()
        s.styles[.email] = .excited
        let decoded = try JSONDecoder().decode(AppSettings.self, from: JSONEncoder().encode(s))
        #expect(decoded == s)
    }
}
