'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/caption-engine.js');

// Build a fake Whisper-style word list from text: 0.3s per word, 0.6s pause after sentences.
function fakeWords(text, opts = {}) {
  let t = opts.start || 0;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const word = { word: ' ' + w, start: +t.toFixed(3), end: +(t + 0.28).toFixed(3) };
    t += /[.!?]$/.test(w) ? 0.9 : 0.3;
    return word;
  });
}
const whisperJSON = (text) => JSON.stringify({ segments: [{ text, words: fakeWords(text) }] });
const capTexts = (res) => res.captions.map((c) => c.text);

test('parses Whisper JSON with leading spaces and continuation tokens', () => {
  const json = JSON.stringify({ segments: [{ words: [
    { word: ' Hello', start: 0, end: 0.4 },
    { word: ',', start: 0.4, end: 0.45 },
    { word: ' Ste', start: 0.5, end: 0.7 },
    { word: 'phen', start: 0.7, end: 0.9 },
    { word: '.', start: 0.9, end: 0.95 },
  ] }] });
  const { words, kind } = E.parseTimedTranscript(json);
  assert.equal(kind, 'words');
  assert.deepEqual(words.map((w) => w.text), ['Hello,', 'Stephen.']);
  assert.equal(words[1].start, 0.5);
  assert.equal(words[1].end, 0.9);
});

test('detects millisecond timings (AssemblyAI style)', () => {
  const json = JSON.stringify({ words: [
    { text: 'One', start: 1000, end: 1300 },
    { text: 'two', start: 1400, end: 1700 },
  ] });
  const { words } = E.parseTimedTranscript(json);
  assert.equal(words[0].start, 1);
  assert.equal(words[1].end, 1.7);
});

test('handles Premiere-style start + duration and punctuation tokens', () => {
  const json = JSON.stringify({ language: 'en-us', segments: [{ start: 0, duration: 2, words: [
    { text: 'Good', start: 0.1, duration: 0.3, type: 'word' },
    { text: 'morning', start: 0.45, duration: 0.4, type: 'word' },
    { text: '.', start: 0.85, duration: 0, type: 'punctuation' },
  ] }] });
  const { words } = E.parseTimedTranscript(json);
  assert.deepEqual(words.map((w) => w.text), ['Good', 'morning.']);
  assert.ok(Math.abs(words[1].end - 0.85) < 1e-9);
});

test('handles AWS Transcribe items', () => {
  const json = JSON.stringify({ results: { items: [
    { start_time: '0.1', end_time: '0.4', alternatives: [{ content: 'Hi' }], type: 'pronunciation' },
    { alternatives: [{ content: '!' }], type: 'punctuation' },
  ] } });
  const { words } = E.parseTimedTranscript(json);
  assert.deepEqual(words.map((w) => w.text), ['Hi!']);
  assert.equal(words[0].start, 0.1);
});

test('parses SRT and spreads cue time over words', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello there world\n\n2\n00:00:04,000 --> 00:00:05,000\nBye.\n';
  const { words, kind, format } = E.parseTimedTranscript(srt);
  assert.equal(kind, 'cues');
  assert.equal(format, 'SRT');
  assert.equal(words.length, 4);
  assert.equal(words[0].start, 1);
  assert.ok(Math.abs(words[2].end - 3) < 1e-9);
  assert.equal(words[3].start, 4);
});

test('parses timestamped text lines', () => {
  const txt = '[00:00:01.000 --> 00:00:02.500] First line here\n[00:00:03.000 --> 00:00:04.000] Second.';
  const { words } = E.parseTimedTranscript(txt);
  assert.equal(words.length, 4);
  assert.equal(words[3].start, 3);
});

test('rejects plain text without timings', () => {
  assert.throws(() => E.parseTimedTranscript('just some words'), /No timing information/);
});

test('every caption respects min/max words when possible', () => {
  const text = 'So today I want to talk about something that a lot of people ask me about every single week. ' +
    'It is the question of how to make captions that are easy to read and that never feel rushed or broken. ' +
    'The answer is simpler than you might think, and it starts with the transcript.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 6 } });
  res.captions.forEach((c) => {
    assert.ok(c.wordCount <= 6, `too long: "${c.text}"`);
    assert.ok(c.wordCount >= 3, `too short: "${c.text}"`);
  });
  // All words preserved, in order.
  assert.equal(capTexts(res).join(' '), text);
});

test('keep-together phrases are never split', () => {
  // With max 4 words, the natural split would land inside "as well as".
  const text = 'We need paper as well as pens for the class today.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 4, phrases: ['as well as'] } });
  assert.ok(capTexts(res).some((t) => /as well as/.test(t)), capTexts(res).join(' | '));
});

test('custom phrase longer than max words stays together and is flagged', () => {
  const text = 'This was made by the United States Department of Agriculture in May.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 3, phrases: ['United States Department of Agriculture'] } });
  const cap = res.captions.find((c) => /United States Department of Agriculture/.test(c.text));
  assert.ok(cap, capTexts(res).join(' | '));
  assert.ok(cap.flags.some((f) => f.startsWith('long')));
});

test('names and numbers stay together', () => {
  const text = 'Yesterday I flew to see my friend in New York for about 10 days.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 4, phrases: [] } });
  const t = capTexts(res);
  assert.ok(t.some((x) => /New York/.test(x)), t.join(' | '));
  assert.ok(t.some((x) => /10 days/.test(x)), t.join(' | '));
});

test('with "avoid weak words" on, captions do not end on a weak word like "the"', () => {
  const text = 'I walked into the old house and then I opened the door to the garden very slowly.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 5, avoidWeakEdges: true } });
  res.captions.slice(0, -1).forEach((c) => {
    assert.ok(!/\b(the|to|and|I)$/.test(c.text), `ends weakly: "${c.text}"`);
  });
});

test('Turkish: caption does not start with a postposition', () => {
  const text = 'Bugün sizinle yeni bir proje için çok önemli bir konuyu konuşmak istiyorum.';
  const res = E.generate({ timedText: whisperJSON(text), options: { language: 'tr', minWords: 2, maxWords: 4, avoidWeakEdges: true } });
  res.captions.forEach((c) => assert.ok(!/^(için|gibi|kadar)\b/.test(c.text), capTexts(res).join(' | ')));
  res.captions.slice(0, -1).forEach((c) => assert.ok(!/\b(bir|ve)$/.test(c.text), capTexts(res).join(' | ')));
});

test('script alignment uses correct words with recognised timings', () => {
  const asr = 'so to day we are going too talk about the new camera';
  const script = 'So today, we are going to talk about the new Canon camera.';
  const res = E.generate({ timedText: whisperJSON(asr), scriptText: script, options: { minWords: 2, maxWords: 5 } });
  assert.equal(capTexts(res).join(' '), script);
  assert.ok(res.alignment.ratio > 0.6);
  const words = E.prepareWords(whisperJSON(asr), script).words;
  const talk = words.find((w) => w.text === 'talk');
  assert.equal(talk.start, fakeWords(asr)[7].start);
  // Times must be monotonic.
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start);
});

test('"|" in the script forces a break', () => {
  const asr = 'one two three four five six';
  const res = E.generate({ timedText: whisperJSON(asr), scriptText: 'one two | three four five six', options: { minWords: 3, maxWords: 6 } });
  assert.equal(res.captions[0].text, 'one two');
});

test('two lines are balanced and respect max chars', () => {
  const text = 'This sentence is definitely long enough to need two separate lines on screen.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 12, maxWords: 14, maxCharsPerLine: 42, maxLines: 2 } });
  assert.equal(res.captions.length, 1);
  const lines = res.captions[0].lines;
  assert.equal(lines.length, 2);
  lines.forEach((l) => assert.ok(l.length <= 42, l));
});

test('timing: no overlaps, min gap kept, offset applied', () => {
  const text = 'First caption here now. Second caption right after. Third one comes later.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 4, offset: 10, minGap: 0.1, continuous: false } });
  for (let i = 1; i < res.captions.length; i++) {
    assert.ok(res.captions[i].start >= res.captions[i - 1].end + 0.099, 'gap kept');
  }
  assert.ok(res.captions[0].start >= 10);
});

test('SRT output format', () => {
  const caps = [{ start: 1.5, end: 3.25, lines: ['Hello', 'world'] }, { start: 3661.001, end: 3662, lines: ['Bye'] }];
  assert.equal(E.toSRT(caps, '\n'),
    '1\n00:00:01,500 --> 00:00:03,250\nHello\nworld\n\n2\n01:01:01,001 --> 01:01:02,000\nBye\n');
});

test('large transcript is fast', () => {
  const sentence = 'This is a reasonably normal sentence that people might say on camera, right? ';
  const text = sentence.repeat(600); // ~8,000 words
  const t0 = Date.now();
  const res = E.generate({ timedText: whisperJSON(text), scriptText: text, options: {} });
  assert.ok(res.captions.length > 500);
  assert.ok(Date.now() - t0 < 10000, 'took ' + (Date.now() - t0) + 'ms');
});

test('SRT position tags and VTT cue settings are not treated as text', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500 X1:100 X2:500 Y1:10 Y2:50\nHello there\n';
  assert.equal(E.parseTimedTranscript(srt).words.map((w) => w.text).join(' '), 'Hello there');
  const vtt = 'WEBVTT\n\nintro\n00:01.000 --> 00:03.500 align:start position:10%\nHi\n2024\n';
  assert.equal(E.parseTimedTranscript(vtt).words.map((w) => w.text).join(' '), 'Hi 2024');
});

test('decodes UTF-8, UTF-16 and Turkish Windows-1254 files', () => {
  const text = '1\r\n00:00:01,000 --> 00:00:02,000\r\nArkadaşlar, bugün çekiyoruz. İyi ğ\r\n';
  const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
  const utf16NoBom = Buffer.from(text, 'utf16le');
  const utf16be = Buffer.from(Buffer.from(text, 'utf16le')).swap16();
  const utf8bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text)]);
  const cp1254 = Buffer.from(text.replace(/ş/g, '\xfe').replace(/ü/g, '\xfc').replace(/ç/g, '\xe7')
    .replace(/İ/g, '\xdd').replace(/ğ/g, '\xf0'), 'latin1');
  for (const [name, buf] of Object.entries({ utf16, utf16NoBom, utf8bom, cp1254, utf8: Buffer.from(text) })) {
    assert.equal(E.decodeBytes(new Uint8Array(buf)), text, name);
  }
  const be = E.decodeBytes(new Uint8Array(Buffer.concat([Buffer.from([0xFE, 0xFF]), utf16be])));
  assert.equal(be, text);
  assert.equal(E.parseTimedTranscript(E.decodeBytes(new Uint8Array(utf16))).words.length, 5);
});

test('continuous: every caption lasts until the next one starts', () => {
  const text = 'First caption here now. Second caption right after. Third one comes much later on.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 4, frameDuration: 1 / 25 } });
  for (let i = 0; i < res.captions.length - 1; i++) {
    assert.equal(res.captions[i].end, res.captions[i + 1].start, `caption ${i + 1} must end when ${i + 2} starts`);
    assert.ok(res.captions[i].end > res.captions[i].start);
  }
  const last = res.captions[res.captions.length - 1];
  assert.ok(last.end - last.start >= 0.8);
});

test('two sentences never share a caption, even when short', () => {
  const text = 'Hello. I am here. This is a much longer sentence that keeps going for a while. Ok then. Bye!';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 4, maxWords: 8 } });
  const t = capTexts(res);
  t.forEach((c) => assert.ok(!/[.!?]\s/.test(c), `two sentences in one caption: "${c}"`));
  assert.ok(t.includes('Hello.'), t.join(' | '));
  assert.ok(t.includes('Bye!'), t.join(' | '));
  // One-word sentences are expected, so they are not flagged as problems.
  res.captions.filter((c) => c.wordCount === 1).forEach((c) => assert.deepEqual(c.flags, []));
});

test('"..." followed by lowercase continues the sentence', () => {
  const text = 'I was... thinking about it a lot.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 8 } });
  assert.equal(res.captions.length, 1, capTexts(res).join(' | '));
});

test('no one-word captions inside running speech', () => {
  const texts = [
    'We need paper as well as pens or pencils for the class today and tomorrow too.',
    'So today I want to talk about something that a lot of people ask me about every week.',
    'Bugün sizinle yeni bir proje için çok önemli bir konuyu konuşmak istiyorum.',
  ];
  for (const [i, text] of texts.entries()) {
    for (const [min, max] of [[2, 3], [2, 4], [3, 5], [2, 7]]) {
      const res = E.generate({ timedText: whisperJSON(text), options: { minWords: min, maxWords: max, language: i === 2 ? 'tr' : 'en', phrases: ['as well as'] } });
      res.captions.forEach((c) => assert.ok(c.wordCount > 1, `lone word "${c.text}" (min ${min}, max ${max}): ${capTexts(res).join(' | ')}`));
    }
  }
});

test('a word isolated by long pauses may stand alone', () => {
  const words = [
    { word: ' Okay', start: 0, end: 0.4 },
    { word: ' so', start: 2.5, end: 2.7 },                       // long pause before
    { word: ' today', start: 2.8, end: 3.1 }, { word: ' we', start: 3.2, end: 3.3 },
    { word: ' start', start: 3.4, end: 3.7 },
  ];
  const res = E.generate({ timedText: JSON.stringify({ words }), options: { minWords: 3, maxWords: 6 } });
  assert.deepEqual(capTexts(res), ['Okay', 'so today we start']);
  assert.deepEqual(res.captions[0].flags, []);
});

test('SRT input: captions prefer the exact line boundaries and mark estimated starts', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,600\nThis is the first line.\n\n' +
              '2\n00:00:03,000 --> 00:00:04,200\nAnd this is line two.\n\n' +
              '3\n00:00:04,500 --> 00:00:08,000\nA much longer third line that will have to be split somewhere.\n';
  const res = E.generate({ timedText: srt, options: { minWords: 3, maxWords: 6 } });
  assert.equal(res.captions[0].start, 1);
  assert.equal(res.captions[0].end, 3);          // continuous: ends when line 2 starts
  assert.equal(res.captions[1].start, 3);
  assert.equal(res.captions[2].start, 4.5);
  assert.equal(res.captions[0].estimatedStart, false);
  const split = res.captions.slice(3);
  assert.ok(split.length >= 1 && split.every((c) => c.estimatedStart));
  assert.equal(res.captions[res.captions.length - 1].end, 8);
});

test('word-level JSON gives exact word start times', () => {
  const words = fakeWords('Hello there my friend. This is exact timing for every single word here.');
  const res = E.generate({ timedText: JSON.stringify({ words }), options: { minWords: 2, maxWords: 4 } });
  let idx = 0;
  for (const c of res.captions) {
    assert.equal(c.start, words[idx].start);
    assert.equal(c.estimatedStart, false);
    idx += c.wordCount;
  }
});

test('reads HH:MM:SS:FF timecodes and rejects binary files', () => {
  const json = JSON.stringify({ segments: [{ words: [
    { text: 'One', start: '00:00:01:00', end: '00:00:01:12' },
    { text: 'two', start: '00:00:01:13', end: '00:00:02:00' },
    { text: 'three', start: '00:00:02:05', end: '00:00:02:24' },
  ] }] });
  const { words } = E.parseTimedTranscript(json);
  assert.equal(words[0].start, 1);
  assert.ok(Math.abs(words[0].end - 1.48) < 1e-9);   // 25 fps (frame 24 seen)
  assert.throws(() => E.parseTimedTranscript('\u0000\u0001\u0002PRT\u0000\u0000binary\u0003\u0004'.repeat(20)), /binary file/);
});

// ---------------------------------------------------------------------------
// Audio sync (synthetic speech with known word times, see tests/synth.js)
// ---------------------------------------------------------------------------
const S = require('./synth.js');
const fsMod = require('fs');
const sampleText = fsMod.readFileSync(require('path').join(__dirname, '..', 'samples', 'sample-script.txt'), 'utf8').replace(/\s+/g, ' ').trim();

function audioCase(seed) {
  const truth = S.makeTruth(sampleText, seed, 'en');
  const { samples, sampleRate } = S.renderSpeech(truth, seed + 1);
  return { truth, samples, sampleRate, env: E.analyzeAudio(samples, sampleRate) };
}

test('WAV files are analysed straight from bytes (same result as decoded samples)', () => {
  const { samples, sampleRate } = audioCase(3);
  const wav = S.toWav(samples, sampleRate, 2);
  const a = E.analyzeWav(new Uint8Array(wav));
  const decoded = E.decodeWav(new Uint8Array(wav));
  const b = E.analyzeAudio(decoded.channels, decoded.sampleRate);
  assert.equal(a.onsets.length, b.onsets.length);
  assert.ok(Math.abs(a.duration - samples.length / sampleRate) < 1e-6);
  assert.throws(() => E.analyzeWav(new Uint8Array(100)), /Not a WAV/);
});

test('word-level transcript + audio: caption starts within a few ms', () => {
  const errs = [];
  for (const seed of [21, 22, 23]) {
    const { truth, env } = audioCase(seed);
    let x = seed;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const noisy = truth.map((w) => ({ text: w.text, start: w.start + (rnd() * 2 - 1) * 0.06, end: w.end + (rnd() * 2 - 1) * 0.06 }));
    for (let k = 1; k < noisy.length; k++) if (noisy[k].start <= noisy[k - 1].start) noisy[k].start = noisy[k - 1].start + 0.01;
    const res = E.generate({ timedText: JSON.stringify({ words: noisy }), audio: env, options: { minWords: 3, maxWords: 6 } });
    errs.push(...S.captionErrors(res.captions, truth));
  }
  const s = S.summary(errs);
  assert.ok(s.avg < 10, 'average error ' + s.avg.toFixed(1) + ' ms');
  assert.ok(s.p90 < 25, '90% within ' + s.p90.toFixed(1) + ' ms');
});

test('SRT + audio is more accurate than SRT alone', () => {
  const withA = [], without = [];
  for (const seed of [31, 32, 33]) {
    const { truth, env } = audioCase(seed);
    const srt = E.toSRT(S.makeLines(truth, { seed }), '\n');
    const opts = { minWords: 3, maxWords: 6 };
    without.push(...S.captionErrors(E.generate({ timedText: srt, options: opts }).captions, truth));
    const res = E.generate({ timedText: srt, audio: env, options: opts });
    withA.push(...S.captionErrors(res.captions, truth));
    assert.ok(res.captions.every((c) => !c.estimatedStart));
  }
  const a = S.summary(withA), b = S.summary(without);
  assert.ok(a.median < 10, 'median with audio ' + a.median.toFixed(1));
  assert.ok(a.avg < b.avg, `with audio ${a.avg.toFixed(1)} vs without ${b.avg.toFixed(1)}`);
});

test('a constant shift between transcript and audio is detected and corrected', () => {
  const { truth, env } = audioCase(41);
  const shifted = truth.map((w) => ({ text: w.text, start: w.start + 0.5, end: w.end + 0.5 }));
  const prep = E.prepareWords(JSON.stringify({ words: shifted }), '', env, 'en');
  assert.ok(Math.abs(prep.audioOffset + 0.5) < 0.01, 'offset ' + prep.audioOffset);
  // No false shift when the timing only has small random errors.
  const srt = E.toSRT(S.makeLines(truth, { jitter: 0.08, seed: 2 }), '\n');
  assert.equal(E.prepareWords(srt, '', env, 'en').audioOffset, 0);
});

test('word-level transcript that is consistently late is corrected by the audio', () => {
  const errs = [];
  for (const seed of [51, 52, 53]) {
    const { truth, env } = audioCase(seed);
    let x = seed;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const late = truth.map((w) => ({ text: w.text, start: w.start + 0.08 + (rnd() * 2 - 1) * 0.1, end: w.end + 0.08 + (rnd() * 2 - 1) * 0.1 }));
    for (let k = 1; k < late.length; k++) if (late[k].start <= late[k - 1].start) late[k].start = late[k - 1].start + 0.01;
    const res = E.generate({ timedText: JSON.stringify({ words: late }), audio: env, options: { minWords: 3, maxWords: 6 } });
    errs.push(...S.captionErrors(res.captions, truth));
  }
  const s = S.summary(errs);
  assert.ok(s.median < 6, 'median ' + s.median.toFixed(1) + ' ms');
  assert.ok(s.avg < 20, 'average ' + s.avg.toFixed(1) + ' ms');
});

test('words at the very end are timed even if the audio stops slightly early', () => {
  const truth = S.makeTruth(sampleText, 13, 'en');
  const a = S.renderSpeech(truth, 7);
  const cut = Math.floor((truth[truth.length - 1].start + 0.3) * a.sampleRate);
  const env = E.analyzeAudio(a.samples.subarray(0, cut), a.sampleRate);
  const p = E.prepareWords(JSON.stringify({ words: truth }), '', env, 'en');
  assert.equal(p.audioWords, p.words.length);
});

test('language is detected automatically', () => {
  const toW = (t) => t.split(/\s+/).map((x) => ({ text: x }));
  assert.equal(E.detectLanguage(toW(sampleText)), 'en');
  assert.equal(E.detectLanguage(toW('Ben de bu konuda çok düşündüm ama sonra karar verdim, bence daha iyi olur.')), 'tr');
  assert.equal(E.detectLanguage(toW('Hola a todos, bienvenidos al canal. Hoy vamos a hablar de subtítulos.')), 'other');
});

test('auto language applies English rules to English text (no captions ending on "of", "the"...)', () => {
  const res = E.generate({ timedText: whisperJSON(sampleText), options: { minWords: 3, maxWords: 6, language: 'auto', phrases: ['teşekkür ederim'], avoidWeakEdges: true } });
  assert.equal(res.language, 'en');
  assert.ok(res.languageDetected);
  res.captions.forEach((c) => assert.ok(!/\b(of|the|to|a|an|and|for|with|at)$/i.test(c.text), `ends weakly: "${c.text}"`));
});

test('captions prefer to start on stressed (louder) words', () => {
  const text = 'we are going to look at many different examples today and every single one shows something new';
  const truth = S.makeTruth(text, 5, 'en');
  let hits = 0;
  const targets = [9, 10, 14];   // "today", "and", "shows": positions where grammar allows a split
  for (const target of targets) {
    const a = S.renderSpeech(truth, 9);
    const w = truth[target];
    const i0 = Math.floor(w.start * a.sampleRate), i1 = Math.floor(Math.min(w.end, w.start + 0.3) * a.sampleRate);
    for (let i = i0; i < i1; i++) a.samples[i] *= 3.5;
    const res = E.generate({ timedText: JSON.stringify({ words: truth }), audio: E.analyzeAudio(a.samples, a.sampleRate), options: { minWords: 3, maxWords: 6, phrasing: false } });
    if (res.captions.some((c) => c.text.startsWith(w.text + ' '))) hits++;
  }
  assert.equal(hits, targets.length, `captions started on the stressed word in ${hits} of ${targets.length} cases`);
  // A stressed "many" after "at": by default stress wins (captions may end on "at");
  // with "avoid weak words" on, the grammar rule wins.
  const a = S.renderSpeech(truth, 9);
  const w = truth[6];
  for (let i = Math.floor(w.start * a.sampleRate); i < Math.floor((w.start + 0.3) * a.sampleRate); i++) a.samples[i] *= 3.5;
  const env = E.analyzeAudio(a.samples, a.sampleRate);
  const json = JSON.stringify({ words: truth });
  const relaxed = E.generate({ timedText: json, audio: env, options: { minWords: 3, maxWords: 6, phrasing: false } });
  assert.ok(relaxed.captions.some((c) => c.text.startsWith('many ')), capTexts(relaxed).join(' | '));
  const strict = E.generate({ timedText: json, audio: env, options: { minWords: 3, maxWords: 6, avoidWeakEdges: true, phrasing: false } });
  strict.captions.forEach((c) => assert.ok(!/\b(at|to|and)$/.test(c.text), c.text));
});

test('a caption with enough words ends at the comma instead of spilling over', () => {
  const text = 'If you want good captions, you need a transcript, a little patience and some time.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 8 } });
  const t = capTexts(res);
  assert.ok(t.includes('If you want good captions,'), t.join(' | '));
  assert.ok(t.some((c) => c.startsWith('you need a transcript,')), t.join(' | '));
  // Fewer words than the minimum before the comma: the caption may continue.
  const res2 = E.generate({ timedText: whisperJSON('Well, I think this works really well for us.'), options: { minWords: 3, maxWords: 8 } });
  assert.ok(!capTexts(res2).includes('Well,'), capTexts(res2).join(' | '));
  // Rule can be switched off.
  const res3 = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 8, breakAtCommas: false } });
  assert.ok(res3.captions.length <= res.captions.length);
});

test('captions may end on "of" by default', () => {
  const text = 'This is one of the best examples of good timing that I have ever seen in my life.';
  const strict = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 4, avoidWeakEdges: true } });
  const relaxed = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 4 } });
  assert.equal(relaxed.options.avoidWeakEdges, false);
  strict.captions.slice(0, -1).forEach((c) => assert.ok(!/\b(of|the)$/.test(c.text), c.text));
});

// ---------------------------------------------------------------------------
// Phrasing (subtitle grammar)
// ---------------------------------------------------------------------------
const P = require('../js/phrasing.js');

function splitPairs(res, lang) {
  const flat = res.captions.flatMap((c) => c.words.map((w) => ({ text: w.text })));
  const an = P.analyze(flat, lang);
  const bad = [];
  let idx = 0;
  res.captions.forEach((c, ci) => {
    const cuts = [];
    if (ci < res.captions.length - 1) cuts.push(idx + c.wordCount);
    if (c.lines.length === 2) cuts.push(idx + c.lines[0].split(' ').length);
    cuts.forEach((b) => { if (an.cohesion[b] >= 0.9) bad.push(flat[b - 1].text + ' | ' + flat[b].text); });
    idx += c.wordCount;
  });
  return bad;
}

test('tagger: adjectives, articles, verb groups', () => {
  const tags = (s) => P.tagEN(s.split(' ').map((t) => ({ text: t })));
  assert.deepEqual(tags('a beautiful old wooden house'), ['DET', 'ADJ', 'ADJ', 'ADJ', 'N']);
  assert.deepEqual(tags('She is a really talented young designer'), ['PRON', 'COP', 'DET', 'ADV', 'ADJ', 'ADJ', 'N']);
  assert.deepEqual(tags('they have been working'), ['PRON', 'AUX', 'COP', 'V']);
  assert.deepEqual(tags('you need to pick up the box'), ['PRON', 'V', 'PART', 'V', 'PRT', 'DET', 'N']);
});

test('adjectives stay with their nouns (and other strong pairs are never split)', () => {
  const text = 'Last summer we rented a small wooden cabin near a quiet mountain lake. The old owner was a really friendly man who told us amazing stories about the long cold winters. Every single morning we drank strong black coffee on the tiny front porch and watched the bright orange sun come up over the dark green forest.';
  for (const [mn, mx] of [[3, 6], [2, 8], [2, 5]]) {
    const res = E.generate({ timedText: whisperJSON(text), options: { minWords: mn, maxWords: mx } });
    assert.deepEqual(splitPairs(res, 'en'), [], `min ${mn} max ${mx}: ${capTexts(res).join(' | ')}`);
    assert.ok(res.captions.every((c) => c.wordCount <= mx));
    const t = capTexts(res).join(' | ');
    for (const np of ['strong black coffee', 'tiny front porch', 'dark green forest', 'really friendly man']) assert.ok(t.includes(np), `"${np}" split: ${t}`);
  }
  // Without phrasing the old behaviour split some of them.
  const off = E.generate({ timedText: whisperJSON(text), options: { minWords: 3, maxWords: 6, phrasing: false } });
  assert.ok(splitPairs(off, 'en').length > 0);
});

test('captions break at natural phrase boundaries', () => {
  const res = E.generate({ timedText: whisperJSON('I walked into the old house and then I opened the door to the garden very slowly.'), options: { minWords: 3, maxWords: 5 } });
  const t = capTexts(res);
  assert.ok(t.includes('into the old house'), t.join(' | '));
  assert.ok(t.some((c) => c.startsWith('to the garden')), t.join(' | '));
});

test('Turkish: noun phrases and postpositions stay together', () => {
  const text = 'Geçen yaz küçük bir köyde çok güzel bir ev kiraladık. Evin sahibi yaşlı ve çok nazik bir adamdı. Her sabah eski bahçede sıcak çay içtik ve uzun sohbetler ettik.';
  const res = E.generate({ timedText: whisperJSON(text), options: { minWords: 2, maxWords: 5, language: 'tr' } });
  assert.deepEqual(splitPairs(res, 'tr'), [], capTexts(res).join(' | '));
  assert.ok(capTexts(res).some((c) => c.includes('çok güzel bir ev')), capTexts(res).join(' | '));
});

test('hand-marked phrases stay whole (library + rules, and own tagger as fallback)', () => {
  const gold = require('./phrasing-gold.js');
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9' ]/g, '');
  const count = (engine) => {
    const orig = P.analyze;
    if (engine === 'own') P.analyze = (w, l) => orig(w, l, { engine: 'own' });
    let splits = 0;
    try {
      for (const [mn, mx] of [[3, 6], [2, 8]]) {
        for (const [sent, phrases] of gold) {
          const res = E.generate({ timedText: whisperJSON(sent), options: { minWords: mn, maxWords: mx, language: 'en' } });
          const units = res.captions.flatMap((c) => c.lines).map(norm);
          phrases.forEach((ph) => { if (!units.some((u) => (' ' + u + ' ').includes(' ' + norm(ph) + ' '))) splits++; });
        }
      }
    } finally { P.analyze = orig; }
    return splits;
  };
  assert.ok(P.hasLibrary(), 'bundled grammar library loads in Node');
  assert.equal(count('library'), 0, 'no hand-marked phrase split at min 3/max 6 and min 2/max 8');
  assert.ok(count('own') <= 6, 'fallback tagger still keeps most phrases');
});

// ---------------------------------------------------------------------------
// Premiere transcript format (Adobe transcript_format_spec.json)
// ---------------------------------------------------------------------------
function premiereJSON(segments) {
  const speakers = [...new Set(segments.map((g) => g.speaker))].map((id, i) => ({ id, name: 'Speaker ' + (i + 1) }));
  let t = 0.5;
  return JSON.stringify({
    language: 'en-us',
    speakers,
    segments: segments.map((g) => {
      const words = [];
      const start = t;
      g.text.split(' ').forEach((w) => {
        const m = /^(.*?)([.,!?]?)$/.exec(w);
        words.push({ confidence: 0.98, duration: 0.25, eos: false, start: +t.toFixed(3), tags: g.fillers && g.fillers.includes(m[1]) ? ['filler'] : [], text: m[1], type: 'word' });
        if (m[2]) words.push({ confidence: 1, duration: 0, eos: m[2] !== ',', start: +(t + 0.25).toFixed(3), tags: [], text: m[2], type: 'punctuation' });
        t += 0.3;
      });
      t += 0.6;
      return { duration: +(t - start).toFixed(3), language: 'en-us', speaker: g.speaker, start: +start.toFixed(3), words };
    }),
  });
}

test('Premiere JSON (official spec): words, punctuation tokens, eos and speakers', () => {
  const json = premiereJSON([
    { speaker: '631fbbc0-9c02-47c4-bb8c-732c020fa24f', text: 'So how did you start making videos' },
    { speaker: '7a2c1f00-1111-4b2b-9c3d-000000000002', text: 'Honestly I just bought a cheap camera.' },
  ]);
  const { words } = E.parseTimedTranscript(json);
  assert.equal(words[0].text, 'So');
  assert.equal(words[words.length - 1].text, 'camera.');
  assert.ok(words[words.length - 1].eos);
  // No punctuation between the speakers, but the speaker change still starts a new caption.
  const res = E.generate({ timedText: json, options: { minWords: 2, maxWords: 12 } });
  assert.ok(res.captions.some((c) => c.text.endsWith('making videos')), capTexts(res).join(' | '));
  assert.ok(res.captions.some((c) => c.text.startsWith('Honestly')), capTexts(res).join(' | '));
  const off = E.generate({ timedText: json, options: { minWords: 2, maxWords: 12, splitSpeakers: false } });
  assert.ok(off.captions.some((c) => /videos Honestly/.test(c.text)), capTexts(off).join(' | '));
});

test('filler words can be removed', () => {
  const json = premiereJSON([{ speaker: 'a', text: 'So um I think uh this is really good.', fillers: ['um', 'uh'] }]);
  const keep = E.generate({ timedText: json, options: { minWords: 2, maxWords: 12 } });
  const drop = E.generate({ timedText: json, options: { minWords: 2, maxWords: 12, removeFillers: true } });
  assert.match(capTexts(keep).join(' '), /\bum\b/);
  assert.equal(capTexts(drop).join(' '), 'So I think this is really good.');
});

// ---------------------------------------------------------------------------
// Subtitle rules (Netflix style), drift, Turkish lexicon
// ---------------------------------------------------------------------------
test('reading speed: captions read faster than the limit are flagged', () => {
  // 20 long words in 2 seconds is far too fast to read.
  const fast = Array.from({ length: 20 }, (_, i) => ({ word: ' extraordinary' + i, start: i * 0.1, end: i * 0.1 + 0.09 }));
  const res = E.generate({ timedText: JSON.stringify({ words: fast }), options: { minWords: 2, maxWords: 5, language: 'en' } });
  assert.ok(res.captions.some((c) => c.flags.some((f) => f.startsWith('fast'))));
  const normal = E.generate({ timedText: whisperJSON('This is a calm and normal sentence.'), options: { language: 'en', maxCps: 25 } });
  assert.ok(normal.captions.every((c) => !c.flags.some((f) => f.startsWith('fast'))));
});

test('two-line captions prefer a shorter top line', () => {
  const res = E.generate({ timedText: whisperJSON('We walked all the way home through the old park yesterday.'), options: { minWords: 11, maxWords: 12, maxCharsPerLine: 32, maxLines: 2 } });
  const [l1, l2] = res.captions[0].lines;
  assert.ok(l1.length <= l2.length + 4, `${l1} / ${l2}`);
});

test('drift between transcript and audio (24 vs 23.976 fps) is corrected', () => {
  const base = sampleText;
  const truth = S.makeTruth(Array(5).fill(base).join(' '), 77, 'en');
  const a = S.renderSpeech(truth, 78);
  const env = E.analyzeAudio(a.samples, a.sampleRate);
  const drifted = truth.map((w) => ({ text: w.text, start: w.start * 1.001, end: w.end * 1.001 }));
  const p = E.prepareWords(JSON.stringify({ words: drifted }), '', env, 'en');
  assert.ok(p.audioDrift && Math.abs(p.audioDrift.slope + 0.001) < 0.0003, JSON.stringify(p.audioDrift));
  const res = E.buildCaptions(p.words, { minWords: 3, maxWords: 6 });
  assert.ok(S.summary(S.captionErrors(res.captions, truth)).avg < 10);
  // no false drift
  const p2 = E.prepareWords(JSON.stringify({ words: truth }), '', env, 'en');
  assert.equal(p2.audioDrift, null);
});

test('Turkish: hand-marked phrases (with the Zemberek word lists)', () => {
  const gold = require('./phrasing-gold-tr.js');
  const norm = (x) => x.replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  let splits = 0;
  for (const [mn, mx] of [[3, 6], [2, 8]]) {
    for (const [sent, phrases] of gold) {
      const res = E.generate({ timedText: whisperJSON(sent), options: { minWords: mn, maxWords: mx, language: 'tr' } });
      const units = res.captions.flatMap((c) => c.lines).map(norm);
      phrases.forEach((ph) => { if (ph.split(' ').length <= mx && !units.some((u) => (' ' + u + ' ').includes(' ' + norm(ph) + ' '))) splits++; });
    }
  }
  assert.ok(splits <= 1, splits + ' Turkish phrases split');
  const tags = (s) => P.tagTR(s.split(' ').map((t) => ({ text: t })));
  assert.deepEqual(tags('Elmalı turta yedik.'), ['ADJ', 'N', 'V']);
});
