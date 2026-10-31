# Smart Captions for Premiere Pro

A Premiere Pro panel that turns your transcript into **synchronized captions**. It:

- keeps every caption between a **minimum and maximum number of words**
- **never splits phrases that belong together**: your own list (e.g. "thank you so much", "as well as"), names ("New York City"), numbers with units ("10 minutes"), titles ("Dr. Smith")
- avoids weak breaks, such as ending a caption on "the / and / of" or starting one with "için / gibi / mı" (English and Turkish rules built in)
- prefers breaking at sentence ends, commas and pauses
- splits long captions into two balanced lines
- creates a caption track on the active sequence, or saves an `.srt`

## How it works

1. **Timing source.** Load a transcript that has timings:
   - JSON with word timings: Whisper / WhisperX, Premiere's exported transcript, Deepgram, AssemblyAI, AWS Transcribe, Google, Azure… (the format is detected automatically; ms / ticks are converted)
   - SRT / VTT, or text with timestamps (`[00:00:01.000 --> 00:00:03.000] text`). Word times are estimated inside each segment.
2. **Corrected script (optional).** If your transcript has recognition mistakes, paste the correct text. The panel aligns it word-by-word to the timed transcript, so you get **your exact words with the recognised timing**. It reports how much of the script matched.
   - a line break in the script = preferred caption break
   - `|` in the script = forced caption break
3. **Splitting.** Every gap between two words gets a cost (sentence end = cheap, after "the" = expensive, inside a protected phrase = impossible). A dynamic-programming pass picks the cheapest set of breaks while respecting min/max words, characters per line, max duration and pauses. If a protected phrase is longer than the max, it stays whole and the caption is flagged in the preview.

## Install (macOS / Windows)

The panel is a CEP extension. It is unsigned, so Premiere's debug mode must be on; the install scripts do that for you.

- **macOS:** run `./install-mac.sh` in Terminal
- **Windows:** double-click `install-windows.bat`

Restart Premiere Pro → **Window → Extensions → Smart Captions**.

<details><summary>Manual install</summary>

1. Copy this folder to
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/smart-captions`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\smart-captions`
2. Enable unsigned extensions (do it for 11 and 12; newer Premiere versions may use a higher number):
   - macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`
   - Windows: `reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f`
</details>

## Using it

1. Open your sequence.
2. In the panel click **Choose file…** (or drag the file onto the panel) and pick the timed transcript. UTF-8, UTF-16 and Windows (Turkish/Western) encodings are detected automatically. Optionally paste/load the script.
3. Adjust **Min / Max words** and the other rules; the preview updates live. Flagged captions are marked in orange.
4. Add your own **Keep together** phrases (one per line).
5. **Placement**: where transcript time 0 is in your sequence:
   - *Sequence start*: the transcript was made from the whole sequence
   - *Selected clip's media start*: select the clip the transcript came from (trimmed clips are handled)
   - *Playhead*: put the playhead where the audio starts
6. Click **Create caption track**. The SRT is saved in a `Smart Captions` folder next to your project, imported, and added as a Subtitle track. Style it in the Essential Graphics / Properties panel as usual.

**Getting a transcript out of Premiere:** in the Text panel → Transcript → `…` menu → *Export transcript*. You can also use Whisper (`whisper audio.wav --word_timestamps True --output_format json`).

## Without Premiere

```bash
npm test                                   # run the engine tests
node tools/make-srt.js samples/sample-whisper.json --script samples/sample-script.txt --min 3 --max 7 --out captions.srt
```

Opening `index.html` in a browser also works for previewing and downloading the SRT.

## Files

| Path | What |
|---|---|
| `js/caption-engine.js` | parsing, alignment, splitting, SRT (pure JS, tested) |
| `js/main.js`, `index.html`, `css/` | panel UI |
| `jsx/host.jsx` | ExtendScript: writes/imports the SRT, creates the caption track |
| `CSXS/manifest.xml` | extension manifest (Premiere Pro 2020+) |
| `tools/make-srt.js` | command-line version |
| `tests/` | engine tests |

## Tuning the language rules

The word lists live in `LANGS` at the top of `js/caption-engine.js`:
`noEnd` (a caption shouldn't end on these), `noStart` (shouldn't start with these) and `phrases` (default keep-together list). Add a language by adding another entry.
