# CFoh! demo video

One product video, about 90 seconds, shown on the homepage behind a play button. It is a real recording of the app being used, not animated screenshots.

## Shape

1. **Intro.** Three short lines on a plain card, then the logo, then the whole app.
2. **Five problems, one at a time.** Each gets a card naming the problem in one sentence, then the app solving it:
   1. Writing things down is a chore. → type "spent 20 on lunch" in the ask bar.
   2. When you get paid, it all looks like spending money. → "got paid 3,000 from Lumen", the split updates.
   3. You never know how much you can pay yourself. → the next-step card says how much; one tap records it.
   4. Small costs grow quietly. → "track food under 300" adds a tracker with a limit.
   5. Too many numbers, so you stop looking. → ask "how much is left for running costs?" and get one answer.
3. **Who it is for.** Freelancers, solo founders, small agency owners, anyone whose money keeps disappearing.
4. **The way in.** First month free, the address.

## Rules for the words

- Short sentences. Plain words. No jargon.
- One idea per line. A line is one audio clip.
- Say what is on screen at the moment it is on screen.
- No promises about results. The video shows the person's own numbers; it does not advise.

The lines are in `scripts/video/script.mjs`.

## How it is made

| Step | Command | What it does |
|---|---|---|
| Voice | `node scripts/make-voiceover.mjs` | Generates each line with an open-source voice model (Chatterbox by default, Kyutai Pocket TTS as an option), transcribes every take to check the words, retries bad takes, and writes `media/vo/`. |
| Site | `npm run export:site` | The video is recorded from the built site. |
| Film | `node scripts/make-demo.mjs` | Opens the sample workspace inside `scripts/video/stage.html`, plays the take, captures it, and writes `public/cfoh-demo.mp4` and `public/cfoh-demo-poster.jpg`. |

How the take works:

- **Camera.** The app runs in a frame on the stage page. Zooming is a CSS transform on that frame, so the browser redraws the text at the new size and it stays sharp.
- **Pointer, clicks, typing.** The script moves a pointer to real elements, clicks them and types at a human pace. The app does the rest; the numbers on screen are the app's own.
- **Timing.** Each narration clip starts at the moment the script reaches its action, so a sentence and its picture cannot drift apart.
- **Sound.** Clicks, key taps and the confirmation chime are placed at the logged time of each click, keystroke and confirmation. One calm music bed sits underneath and dips when the voice speaks. All sound is synthesised or generated, so there is nothing to license.
- **The question in problem 5** is answered by a local stand-in that returns the figure read from the screen, in the wording the live model gave for the same question. This keeps the recording repeatable and off the daily model allowance.

After changing the app's home screen, re-run the last two steps. After changing the words, re-run all three.
