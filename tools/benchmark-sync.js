#!/usr/bin/env node
/*
 * Measures caption start accuracy (ms) on synthetic speech with known word
 * times, for SRT input without and with audio.
 *
 *   node tools/benchmark-sync.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../js/caption-engine.js');
const S = require('../tests/synth.js');

const texts = [
  fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-script.txt'), 'utf8'),
  'Merhaba arkadaşlar, bugün sizinle çok önemli bir konuyu konuşacağız. Bu videoda altyazıların nasıl ' +
  'senkronize edileceğini adım adım göstereceğim. Önce transkripti hazırlıyoruz, sonra cümleleri ayırıyoruz ' +
  've en sonunda her kelimenin zamanını sesle eşleştiriyoruz. Hadi başlayalım!',
];
const fps = 25;
const rows = [];
const all = {};
for (const jitter of [0, 0.08]) {
  for (const [ti, raw] of texts.entries()) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const text = raw.replace(/\s+/g, ' ').trim();
      const truth = S.makeTruth(text, seed * 13 + ti, ti === 1 ? 'tr' : 'en');
      const { samples, sampleRate } = S.renderSpeech(truth, seed * 7 + ti);
      const srt = E.toSRT(S.makeLines(truth, { jitter, seed }), '\n');
      const env = E.analyzeAudio(samples, sampleRate);
      const options = { minWords: 3, maxWords: 6, language: ti === 1 ? 'tr' : 'en' };
      const cases = {
        'SRT only': E.generate({ timedText: srt, options }),
        'SRT + audio': E.generate({ timedText: srt, audio: env, options }),
        'SRT + audio, 25 fps': E.generate({ timedText: srt, audio: env, options: Object.assign({ frameDuration: 1 / fps }, options) }),
      };
      if (!jitter) {
        // Word-level transcript (like Premiere's JSON export) whose word times are
        // off by up to ±60 ms, as speech recognition typically is.
        const rnd = ((x) => () => (x = (x * 16807) % 2147483647) / 2147483647)(seed * 31 + ti);
        const noisy = truth.map((w) => ({ text: w.text, start: +(w.start + (rnd() * 2 - 1) * 0.06).toFixed(3), end: +(w.end + (rnd() * 2 - 1) * 0.06).toFixed(3) }));
        for (let k = 1; k < noisy.length; k++) if (noisy[k].start <= noisy[k - 1].start) noisy[k].start = noisy[k - 1].start + 0.01;
        const json = JSON.stringify({ words: noisy });
        cases['Word-level JSON (±60 ms)'] = E.generate({ timedText: json, options });
        cases['Word-level JSON (±60 ms) + audio'] = E.generate({ timedText: json, audio: env, options });
        cases['Word-level JSON (±60 ms) + audio, 25 fps'] = E.generate({ timedText: json, audio: env, options: Object.assign({ frameDuration: 1 / fps }, options) });
      }
      for (const [name, res] of Object.entries(cases)) {
        const key = name.startsWith('Word') ? name : `${name} | SRT line times ${jitter ? '±' + jitter * 1000 + ' ms off' : 'exact'}`;
        (all[key] = all[key] || []).push(...S.captionErrors(res.captions, truth));
      }
    }
  }
}
console.log('Caption start error vs. true word start (synthetic speech, 10 voices, 2 languages)\n');
console.log('case'.padEnd(58) + 'avg   median  p90   worst  (ms)');
for (const [key, errs] of Object.entries(all)) {
  const s = S.summary(errs);
  console.log(key.padEnd(58) + [s.avg, s.median, s.p90, s.worst].map((x) => x.toFixed(0).padStart(5)).join(' ') + `   n=${s.n}`);
}
