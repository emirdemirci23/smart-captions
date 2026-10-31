'use strict';
/*
 * Synthetic speech for measuring sync accuracy. Every word's true start time is
 * known, so caption times can be compared with the truth to the millisecond.
 *
 * Deliberately includes hard cases: words that run into each other with no
 * pause, quiet consonants at word starts, syllable dips inside words and
 * background noise.
 */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const { countSyllables } = require('../js/caption-engine.js');

/** "Real" syllables: the engine's estimate is wrong by one for ~12% of words. */
function syllables(word, rnd, lang) {
  const est = countSyllables(word, lang);
  const r = rnd();
  if (r < 0.06) return est + 1;
  if (r < 0.12) return Math.max(1, est - 1);
  return est;
}

/** True word timings for a text, with natural variation. */
function makeTruth(text, seed = 7, lang = 'en') {
  const rnd = rng(seed);
  let t = 0.6;
  return text.split(/\s+/).filter(Boolean).map((w, i, arr) => {
    const lead = rnd() < 0.25 ? 0.03 + rnd() * 0.03 : 0;        // quiet consonant before the vowel
    const syl = syllables(w, rnd, lang);
    const dur = lead + syl * (0.12 + rnd() * 0.09) + 0.04;
    const word = { text: w, start: +t.toFixed(4), end: +(t + dur).toFixed(4), lead, syl };
    let gap;
    if (/[.!?]$/.test(w)) gap = 0.35 + rnd() * 0.6;
    else if (/[,:;]$/.test(w)) gap = 0.12 + rnd() * 0.3;
    else gap = rnd() < 0.4 ? -0.01 : rnd() * 0.05;              // 40%: words run together
    t += dur + gap;
    return word;
  });
}

/** Render the truth as audio (mono Float32, 16 kHz). */
function renderSpeech(truth, seed = 11, sampleRate = 16000) {
  const rnd = rng(seed);
  const total = Math.ceil((truth[truth.length - 1].end + 0.8) * sampleRate);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] += (rnd() * 2 - 1) * 0.004;     // room noise (~ -50 dB)
  const addTone = (t0, t1, amp, f0, attack, decay) => {
    const a = Math.floor(t0 * sampleRate), b = Math.floor(t1 * sampleRate);
    for (let i = a; i < b && i < total; i++) {
      const t = (i - a) / sampleRate, left = (b - i) / sampleRate;
      const env = Math.min(1, t / attack, left / decay);
      const ph = 2 * Math.PI * f0 * (i / sampleRate);
      out[i] += amp * env * (0.6 * Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph) + 0.15 * (rnd() * 2 - 1));
    }
  };
  const addNoise = (t0, t1, amp) => {
    const a = Math.floor(t0 * sampleRate), b = Math.floor(t1 * sampleRate);
    for (let i = a; i < b && i < total; i++) {
      const env = Math.min(1, (i - a) / (0.008 * sampleRate), (b - i) / (0.008 * sampleRate));
      out[i] += amp * env * (rnd() * 2 - 1);
    }
  };
  for (const w of truth) {
    let t = w.start;
    if (w.lead) { addNoise(t, t + w.lead + 0.01, 0.05 + rnd() * 0.05); t += w.lead; }
    const sylDur = (w.end - t) / w.syl;
    for (let k = 0; k < w.syl; k++) {
      const amp = 0.25 + rnd() * 0.6;
      addTone(t, t + sylDur * (0.85 + rnd() * 0.1), amp, 110 + rnd() * 90, 0.012, 0.03);
      t += sylDur;
    }
  }
  return { samples: out, sampleRate };
}

/** An SRT-like list of lines from the truth (up to ~maxChars per line). */
function makeLines(truth, { maxChars = 60, jitter = 0, seed = 5 } = {}) {
  const rnd = rng(seed);
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };
  for (const w of truth) {
    cur.push(w);
    const len = cur.map((x) => x.text).join(' ').length;
    if (/[.!?]$/.test(w.text) || len > maxChars || (len > maxChars * 0.6 && /[,:;]$/.test(w.text))) flush();
  }
  flush();
  return lines.map((l) => ({
    start: Math.max(0, l[0].start + (rnd() * 2 - 1) * jitter),
    end: l[l.length - 1].end + (rnd() * 2 - 1) * jitter,
    lines: [l.map((x) => x.text).join(' ')],
  }));
}

/** Compare caption starts with the true start of their first word (ms). */
function captionErrors(captions, truth) {
  let idx = 0;
  return captions.map((c) => {
    const err = Math.abs(c.start - truth[idx].start) * 1000;
    idx += c.wordCount;
    return err;
  });
}

function summary(errs) {
  const s = errs.slice().sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return { avg, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], worst: s[s.length - 1], n: s.length };
}

/** Encode mono Float32 samples as a 16-bit PCM WAV file (Buffer). */
function toWav(samples, sampleRate, channels = 1) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2 * channels);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2 * channels, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2 * channels, 28);
  buf.writeUInt16LE(2 * channels, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2 * channels, 40);
  for (let i = 0, o = 44; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    for (let c = 0; c < channels; c++, o += 2) buf.writeInt16LE(Math.round(v * 32767), o);
  }
  return buf;
}

module.exports = { makeTruth, renderSpeech, makeLines, captionErrors, summary, toWav };
