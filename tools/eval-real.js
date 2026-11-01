#!/usr/bin/env node
/*
 * Evaluate Smart Captions on a real recording.
 *
 *   node tools/eval-real.js transcript.json audio.wav [--lang en|tr|auto] [--min 3] [--max 8] [--fps 25] [--captions] [--json]
 *
 * Reference: for words that follow a clear pause, the true start is where the
 * sound clearly begins on a 2 ms loudness curve (≥120 ms of quiet before it,
 * +10 dB over the quiet level, followed by sustained sound). That is how a
 * person marks a word start on a waveform, and it is measured independently
 * of the panel's own 2.5 ms analysis. Words that run into each other have no
 * such reference and are not scored.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'caption-engine.js'));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !/^--(lang|min|max|fps)$/.test(args[i - 1])));
if (files.length < 2) {
  console.error('usage: node tools/eval-real.js transcript.json audio.wav [--lang en] [--min 3] [--max 8] [--fps 25] [--captions] [--json]');
  process.exit(1);
}
const [jsonPath, wavPath] = files;
const lang = opt('lang', 'auto');
const options = { minWords: opt('min'), maxWords: opt('max'), language: lang };
const fps = parseFloat(opt('fps', '0')) || 0;

const transcript = fs.readFileSync(jsonPath, 'utf8');
const wavBytes = new Uint8Array(fs.readFileSync(wavPath));

// ---- reference onsets from a 2 ms loudness curve
const wav = E.decodeWav(wavBytes);
const sr = wav.sampleRate, n = wav.channels[0].length, nc = wav.channels.length;
const H = Math.round(sr * 0.002), F = Math.floor(n / H), db = new Float32Array(F);
for (let f = 0; f < F; f++) {
  let s = 0;
  for (let i = f * H; i < (f + 1) * H; i++) { let v = 0; for (let c = 0; c < nc; c++) v += wav.channels[c][i]; v /= nc; s += v * v; }
  db[f] = 10 * Math.log10(s / H + 1e-12);
}
const fr = (t) => Math.max(0, Math.min(F - 1, Math.round(t / 0.002)));
function onsetIn(a, b) {
  for (let f = fr(a); f < fr(b); f++) {
    const qa = f - 60;
    if (qa < 0) continue;
    const quiet = Array.from(db.slice(qa, f)).sort((x, y) => x - y);
    const q50 = quiet[quiet.length >> 1], q95 = quiet[Math.floor(quiet.length * 0.95)];
    if (q95 > -35 || q95 - q50 > 12 || db[f] < q50 + 10) continue;
    for (let k = f; k < f + 20 && k < F; k++) if (db[k] > q50 + 20) return f * 0.002;
  }
  return null;
}

const t0 = Date.now();
const env = E.analyzeWav(wavBytes);
const tAudio = Date.now() - t0;
const original = E.parseTimedTranscript(transcript).words.map((w) => ({ ...w }));
const t1 = Date.now();
const prep = E.prepareWords(transcript, '', env, lang);
const tWords = Date.now() - t1;

// reference set: words after punctuation or a gap whose onset can be measured
const refs = [];
original.forEach((w, i) => {
  const prev = original[i - 1], next = original[i + 1];
  if (!(i === 0 || /[.,!?;:…]["'”’)]*$/.test(prev.text) || w.start - prev.end >= 0.1)) return;
  const r = onsetIn(w.start - 0.1, w.start + 0.35);
  if (r === null || (next && next.start < r - 0.05)) return;
  if (refs.length && Math.abs(refs[refs.length - 1].ref - r) < 0.01) return;
  refs.push({ i, text: w.text, ref: r });
});

function summary(errs) {
  if (!errs.length) return null;
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  return {
    n: a.length,
    avg: a.reduce((x, y) => x + y, 0) / a.length,
    median: a[a.length >> 1],
    p90: a[Math.floor(a.length * 0.9)],
    worst: a[a.length - 1],
    within20: a.filter((x) => x <= 20).length,
    meanSigned: errs.reduce((x, y) => x + y, 0) / errs.length,
  };
}
const transcriptErr = summary(refs.map((r) => (original[r.i].start - r.ref) * 1000));
const panelErr = summary(refs.map((r) => (prep.words[r.i].start - r.ref) * 1000));

const res = E.buildCaptions(prep.words, Object.assign({ frameDuration: fps ? 1 / fps : 0 }, options));
const refAt = new Map(refs.map((r) => [r.i, r.ref]));
let idx = 0;
const capErrs = [];
res.captions.forEach((c) => { if (refAt.has(idx)) capErrs.push((c.start - refAt.get(idx)) * 1000); idx += c.wordCount; });
const captionErr = summary(capErrs);

const report = {
  audio: { seconds: +env.duration.toFixed(2), sampleRate: sr, channels: nc, analyseMs: tAudio },
  transcript: { words: original.length, format: prep.format, language: res.language },
  sync: {
    wordsTimed: prep.audioWords, onClearSound: prep.audioAnchored, offset: prep.audioOffset || 0,
    drift: prep.audioDrift ? +(prep.audioDrift.slope * 100).toFixed(4) + ' %' : null, timeWordsMs: tWords,
  },
  reference: { words: refs.length, transcript: transcriptErr, panel: panelErr, captionStarts: captionErr },
  captions: { count: res.captions.length, avgWords: +res.stats.avgWords.toFixed(2), flagged: res.stats.flagged, onClearSound: res.stats.audioAnchored },
};

if (flag('json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const fmt = (s) => s ? `avg ${s.avg.toFixed(0)} ms | median ${s.median.toFixed(0)} | p90 ${s.p90.toFixed(0)} | worst ${s.worst.toFixed(0)} | within 20 ms ${s.within20}/${s.n} | mean signed ${s.meanSigned.toFixed(0)}` : 'no reference words';
console.log(`Audio      ${report.audio.seconds} s, ${sr} Hz, ${nc} ch (analysed in ${tAudio} ms)`);
console.log(`Transcript ${original.length} words, ${prep.format}, language ${res.language}`);
console.log(`Sync       ${prep.audioWords}/${original.length} words timed, ${prep.audioAnchored} on a clear sound, offset ${report.sync.offset} s, drift ${report.sync.drift || 'none'}`);
console.log(`\nAccuracy against ${refs.length} reference onsets (words after a clear pause):`);
console.log(`  transcript times  ${fmt(transcriptErr)}`);
console.log(`  panel word starts ${fmt(panelErr)}`);
console.log(`  caption starts    ${fmt(captionErr)}${fps ? ` (rounded to ${fps} fps)` : ''}`);
const bad = refs.filter((r) => Math.abs(prep.words[r.i].start - r.ref) > 0.04);
if (bad.length) {
  console.log('\nWords the panel misses by more than 40 ms:');
  bad.forEach((r) => {
    const ctx = original.slice(Math.max(0, r.i - 2), r.i + 3).map((x, k) => (k === Math.min(2, r.i) ? '[' + x.text + ']' : x.text)).join(' ');
    console.log(`  ${ctx.padEnd(46)} panel ${((prep.words[r.i].start - r.ref) * 1000).toFixed(0).padStart(5)} ms   transcript ${((original[r.i].start - r.ref) * 1000).toFixed(0).padStart(5)} ms   at ${r.ref.toFixed(2)} s`);
  });
}
console.log(`\nCaptions   ${res.captions.length}, avg ${res.stats.avgWords.toFixed(1)} words, ${res.stats.flagged} flagged, ${res.stats.audioAnchored} start on a clear sound`);
if (flag('captions')) {
  res.captions.forEach((c) => console.log(`  ${E.formatSrtTime(c.start)} → ${E.formatSrtTime(c.end)}  ${c.lines.join(' / ')}${c.flags.length ? '   ⚑ ' + c.flags.join(', ') : ''}`));
}
