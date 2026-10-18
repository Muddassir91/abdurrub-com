import Testing
@testable import KalaamKit

struct TextCleanerTests {
    let cleaner = TextCleaner()

    @Test func noneLevelOnlyNormalizesWhitespace() {
        #expect(cleaner.clean("  um  hello   there ", level: .none) == "um hello there")
    }

    @Test func removesFillers() {
        #expect(cleaner.clean("um, so I think, uh, we should go", level: .light) == "So I think we should go")
        #expect(cleaner.clean("I think so um.", level: .light) == "I think so.")
        #expect(cleaner.clean("Hmm let me check", level: .light) == "Let me check")
    }

    @Test func keepsWordsThatContainFillers() {
        #expect(cleaner.clean("the umbrella and the album", level: .light) == "The umbrella and the album")
        #expect(cleaner.clean("summer is here", level: .light) == "Summer is here")
    }

    @Test func capitalizesSentencesAndI() {
        #expect(cleaner.clean("hello. i'm here! are you? yes", level: .light) == "Hello. I'm here! Are you? Yes")
    }

    @Test func leavesEmailsUrlsAndDecimalsAlone() {
        let input = "send it to me@example.com and see example.com, version 3.5 works"
        #expect(cleaner.clean(input, level: .light) == "Send it to me@example.com and see example.com, version 3.5 works")
    }

    @Test func fixesPunctuationSpacing() {
        #expect(cleaner.clean("hello , world .", level: .light) == "Hello, world.")
    }

    @Test func handlesNoWaitCorrection() {
        #expect(cleaner.clean("Let's meet at 3, no wait, 4.", level: .medium) == "Let's meet at 4.")
        #expect(cleaner.clean("Send it to John, no wait, to Sarah.", level: .medium) == "Send it to Sarah.")
        #expect(cleaner.clean("We should meet Tuesday, no wait, Wednesday afternoon.", level: .medium) == "We should meet Wednesday afternoon.")
    }

    @Test func ignoresUnpunctuatedCuePhrases() {
        #expect(cleaner.clean("there's no wait time today", level: .medium) == "There's no wait time today")
    }

    @Test func handlesScratchThat() {
        #expect(cleaner.clean("Hello there. I'll call him tomorrow, scratch that", level: .medium) == "Hello there.")
        #expect(cleaner.clean("Send the report today. Scratch that. Send it Friday.", level: .medium) == "Send it Friday.")
        #expect(cleaner.clean("Send the report today. Actually scratch that. Send it Friday.", level: .medium) == "Send it Friday.")
    }

    @Test func spokenNewLineCommands() {
        #expect(cleaner.clean("Hi Sam, new line thanks for this new paragraph best", level: .medium) == "Hi Sam\nThanks for this\n\nBest")
    }

    @Test func lightLevelDoesNotApplyCorrections() {
        #expect(cleaner.clean("At 3, no wait, 4.", level: .light) == "At 3, no wait, 4.")
    }

    @Test func boundsVeryLongInput() {
        let huge = String(repeating: "word ", count: Limits.maxTranscriptLength)
        #expect(cleaner.clean(huge, level: .medium).count <= Limits.maxTranscriptLength)
    }
}
