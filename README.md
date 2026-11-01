# Smart Captions for Premiere Pro

A Premiere Pro panel that turns your transcript into **synchronized captions**. It:

- keeps every caption between a **minimum and maximum number of words**
- **never splits phrases that belong together**: your own list (e.g. "thank you so much", "as well as"), names ("New York City"), numbers with units ("10 minutes"), titles ("Dr. Smith")
- **ends a caption at a comma** (or ; : —) once it has the minimum number of words, instead of spilling into the next phrase
- **natural phrasing** (subtitle grammar, English and Turkish): a built-in part-of-speech tagger keeps adjectives with their nouns ("strong black coffee"), articles and possessives with their words, prepositions with their objects, verbs with their helpers ("have been working", "to read") and phrasal verbs together ("pick up"), and breaks before "and / but / because / which", before prepositional phrases and between clauses
- **detects the language** (English / Turkish) from the transcript automatically, so the right grammar rules are always used
- with audio loaded, **starts new captions on stressed syllables** (words spoken louder than those around them) and avoids starting them on unstressed words; grammar rules still win
- prefers breaking at commas and pauses, and **never puts two sentences in one caption**
- **continuous captions**: each caption stays on screen until the next one starts
- **no lone one-word captions** in running speech; a single word is only allowed when it is a sentence on its own ("Yes.") or isolated by long pauses
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

## Getting exact sync

Load the **audio** too (a WAV of the same sequence or clip you transcribed: *File → Export → Media → Format: Waveform Audio*). The panel finds where each word starts in the sound and moves the caption there. It also detects and fixes a constant shift (up to ±3 s) between the transcript and the audio. Captions timed from the audio show **♪** in the preview.

| What you load | Average caption start error* |
|---|---|
| Word-level JSON (Premiere) **+ audio** | **5–11 ms**, median 3 ms (≈ 12 ms after Premiere rounds to frames at 25 fps) |
| SRT + audio | 37–39 ms (median 3 ms; captions starting mid-line where words run together can slip a syllable) |
| Word-level JSON alone | 30–80 ms (as accurate as the transcription) |
| SRT alone | 50–75 ms (captions starting mid-line are estimated, marked ≈) |

The panel reports how many words start on a clear sound. A word can't be measured when it runs into the previous word without any break in the sound; its time then comes from the transcript. Transcripts that are consistently a bit late or early are corrected automatically.

\*Measured with `node tools/benchmark-sync.js` on synthetic speech with known word times. Real recordings are messier, so expect somewhat larger numbers. Premiere places captions on frames, so the final result can't be finer than half a frame (20 ms at 25 fps, 17 ms at 30 fps).

**Best setup:** Premiere's own transcript as JSON (*Text panel → Transcript → … menu → Export → JSON*) + the audio as WAV. If the transcript has wrong words, paste the corrected script; your words get the measured timings.

- Transcribed the **sequence** → export the sequence audio, Placement *Sequence start*.
- Transcribed a **clip** → use that clip's audio, select the clip in the timeline, Placement *Selected clip's media start*.

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

The panel has a dark, music-app style layout: a header with your caption stats, a big green button to create the caption track, source tiles (transcript, script, audio), the captions as a numbered track list (click one to move Premiere's playhead to it; ♪ = starts exactly on the sound) and a bottom bar with status and how much of the timing is locked to the audio.


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
node tools/make-srt.js transcript.json --audio audio.wav --out captions.srt   # precise sync from the audio
node tools/benchmark-sync.js               # measure sync accuracy
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
