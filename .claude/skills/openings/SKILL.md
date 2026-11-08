---
name: openings
description: Generate openings for Muddassir Abdur Rub: headlines, subheadlines, email subject lines, preview text, first lines, static and video ad hooks, drama story ad openings, VSL hooks, script first lines, blog and LinkedIn leads. Use whenever the user asks for any of these, or for "hooks", "openers", "leads", "subject lines", "headlines" or "first lines", even if they do not say /openings. Always includes Ben Settle-style openings and openings mined from live drama tabloid headlines.
---

# Openings

Run this skill every time Muddassir asks for openings of any kind. It applies the master doc at `_reference/openings-master.md`. Read that file in full before writing anything. The arguments after `/openings`, if any, describe the offer and format.

## Steps

1. **Pin the brief.** From the request, note the offer, audience, awareness level, the format (see the table in the master doc) and the one emotion to trigger. If the format is missing, infer it from context. If the offer is missing, ask one question and stop.

2. **Pull live tabloid headlines.** Fetch the current headlines from the outlets listed in section 4 of the master doc (Take a Break, That's Life!, Chat, The Sun Fabulous, Daily Mirror real life, Daily Mail Femail, New York Post relationships, National Enquirer, TMZ, E! News). Use WebFetch or WebSearch, several outlets in parallel. Keep the 20 to 30 strongest headlines. If fetching fails, say so in the reply and use the fallback patterns in the master doc.

3. **Extract structures.** Break each headline into trigger, specificity device and tension device. Turn them into fill-in-the-blank patterns.

4. **Generate in three lanes.** Every batch must include all three, 10 to 15 options total unless asked otherwise:
   - Settle lane: built from Ben Settle's 24-point cheat sheet (Email Players Issue #1) in section 3 of the master doc. Name the cheat sheet number and title beside each one, for example (Settle #6: Why I Don't Do X).
   - Tabloid lane: built from the live headlines, each shown with its source headline or pattern.
   - Direct lane: a straight promise, proof or curiosity opening as the control.

5. **Fit the format.** Apply the format rules in section 5 of the master doc (length limits, no restating, hook before the "see more" cut, and so on).

6. **Check voice.** No em or en dashes. Active voice. Short sentences. None of: leverage, dive deep, game-changer, revolutionary. Never position Muddassir as a copywriter.

7. **Present.** Use the output format in section 6 of the master doc: grouped by lane, every option labelled (Settle: pattern), (Tabloid: outlet, source headline) or (Direct: type). End with one line naming the two or three to test first and why.

## Do not

- Skip the tabloid fetch because it seems unnecessary for the format. It applies to every format.
- Leave out the Settle lane.
- Present unlabelled options.
- Pad with explanation. The openings are the deliverable.
