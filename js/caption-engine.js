/*
 * Smart Captions – caption engine
 * --------------------------------
 * Pure JavaScript, no dependencies. Runs inside the Premiere Pro (CEP) panel
 * and in Node (for tests and the command-line tool).
 *
 * Pipeline:
 *   1. parseTimedTranscript()  – read word/segment timings from JSON, SRT, VTT
 *                                or timestamped text.
 *   2. parseScript() +         – (optional) take the words from a corrected
 *      alignScriptToTimings()    script and borrow the timings from step 1.
 *   3. buildBoundaries()       – decide, for every gap between two words,
 *                                whether a caption may end there and how
 *                                "expensive" ending there is.
 *   4. segment()               – dynamic programming: choose the set of breaks
 *                                with the lowest total cost while keeping each
 *                                caption between min and max words.
 *   5. splitLines(), finalizeTiming(), toSRT().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CaptionEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Phrasing rules (js/phrasing.js): a global in the panel, a module in Node. */
  function getPhrasing() {
    if (typeof SmartPhrasing === 'object' && SmartPhrasing) return SmartPhrasing;
    if (typeof module === 'object' && typeof require === 'function') {
      try { return require('./phrasing.js'); } catch (e) { /* not available */ }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Defaults & language data
  // ---------------------------------------------------------------------------

  var DEFAULTS = {
    language: 'auto',      // 'auto' detects English / Turkish from the transcript
    minWords: 3,
    maxWords: 8,
    maxCharsPerLine: 42,
    maxLines: 2,
    minDuration: 0.83,     // seconds a caption stays on screen at minimum (Netflix: 5/6 s)
    maxDuration: 7,        // seconds; longer captions are penalised (Netflix: 7 s)
    maxCps: 0,             // max reading speed in characters/second; 0 = language default (en 20, tr 17)
    continuous: true,      // every caption lasts until the next one starts
    splitSentences: true,  // never put the end of one sentence and the start of another together
    breakAtCommas: true,   // once a caption has minWords, it ends at the next comma (, ; : —)
    avoidWeakEdges: false, // (when phrasing is off) avoid ending on "of", "the"... / starting with "için"...
    phrasing: true,        // subtitle grammar: keep adjective+noun, article+noun, verb groups... together
    splitSpeakers: true,   // a new speaker always starts a new caption
    removeFillers: false,  // drop filler words ("um", "uh") tagged by Premiere or common English fillers
    closeGapsUnder: 0.5,   // (continuous off) gaps shorter than this are closed
    minGap: 0.067,         // seconds between consecutive captions (~2 frames)
    pauseSplit: 0.8,       // a pause longer than this inside a caption is penalised
    offset: 0,             // seconds added to every caption
    frameDuration: 0,      // if > 0, times are snapped to frames
    protectNames: true,    // keep "New York", "Emma Stone" together
    protectNumbers: true,  // keep "10 minutes", "$5 million" together
    phrases: null          // array of strings; null = language defaults
  };

  var LANGS = {
    en: {
      name: 'English',
      // A caption should not END on these (unless followed by punctuation).
      noEnd: ['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'to', 'in', 'on',
        'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'about', 'as', 'than',
        'if', 'because', 'while', 'although', 'though', 'whether', 'my', 'your',
        'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
        'i', 'we', 'they', 'he', 'she', 'is', 'are', 'was', 'were', 'am', 'be',
        'been', 'will', 'would', 'can', 'could', 'should', 'shall', 'may',
        'might', 'must', 'do', 'does', 'did', 'has', 'have', 'had', 'not', 'very',
        'so', 'such', "don't", "doesn't", "didn't", "won't", "can't", "isn't",
        "aren't", "wasn't", "weren't", "i'm", "you're", "we're", "they're",
        "it's", "that's", "there's", "i've", "we've", "i'll", "we'll", "i'd",
        'mr', 'mrs', 'ms', 'dr', 'just', 'some', 'any', 'every', 'each', 'no',
        'how', 'what', 'when', 'where', 'why', 'who', 'which', 'whose', 'too', 'more',
        'most', 'less', 'least', 'many', 'several', 'few', 'both', 'another', 'other'],
      // A caption should not START with these (unless the previous word ends
      // with punctuation).
      noStart: [],
      phrases: ['of course', 'for example', 'for instance', 'as well as',
        'in order to', 'at least', 'at all', 'a lot of', 'a lot', 'a little',
        'a bit', 'a few', 'kind of', 'sort of', 'thank you', 'thank you so much',
        'thank you very much', 'right now', 'each other', 'one another',
        'even though', 'even if', 'as soon as', 'as long as', 'as much as',
        'as if', 'so that', 'such as', 'rather than', 'according to',
        'because of', 'instead of', 'in front of', 'next to', 'out of', 'up to',
        'in fact', 'no one', 'at the same time', 'on the other hand',
        'in the end', 'by the way', 'all right', 'you know', 'I mean',
        'make sure', 'find out', 'figure out', 'pick up', 'give up', 'come on',
        "let's go", 'how much', 'how many', 'what if', 'last year', 'next year',
        'last week', 'next week', 'every day']
    },
    tr: {
      name: 'Türkçe',
      noEnd: ['ve', 'veya', 'ya', 'yahut', 'ile', 'ama', 'fakat', 'ancak', 'lakin',
        'çünkü', 'eğer', 'şayet', 'hem', 'ne', 'bir', 'bu', 'şu', 'her', 'hiç',
        'en', 'daha', 'çok', 'pek', 'gayet', 'sanki', 'benim', 'senin', 'onun',
        'bizim', 'sizin', 'onların'],
      noStart: ['için', 'gibi', 'kadar', 'göre', 'karşı', 'rağmen', 'beri',
        'dolayı', 'doğru', 'dek', 'değin', 'üzere', 'ile', 'de', 'da', 'dahi',
        'bile', 'mi', 'mı', 'mu', 'mü', 'misin', 'mısın', 'musun', 'müsün',
        'miyim', 'mıyım', 'muyum', 'müyüm', 'miyiz', 'mıyız', 'muyuz', 'müyüz',
        'misiniz', 'mısınız', 'musunuz', 'müsünüz', 'midir', 'mıdır', 'mudur',
        'müdür', 'miydi', 'mıydı', 'muydu', 'müydü', 'ki', 'değil', 'değilim',
        'değilsin', 'değiliz', 'değilsiniz', 'değiller', 'değildi', 'değilmiş',
        'sonra', 'önce', 'itibaren', 'boyunca', 'olarak'],
      phrases: ['teşekkür ederim', 'teşekkür ederiz', 'çok teşekkürler',
        'çok teşekkür ederim', 'bir şey', 'her şey', 'hiçbir şey', 'bir şekilde',
        'bir sürü', 'bir kere', 'bir kez', 'bir an önce', 'ne kadar', 'o kadar',
        'bu kadar', 'bu yüzden', 'o yüzden', 'bu arada', 'ya da', 'hem de',
        'ne yazık ki', 'öyle ki', 'değil mi', 'var mı', 'yok mu', 'tamam mı',
        'her zaman', 'her gün', 'hiçbir zaman', 'şu an', 'şu anda', 'bu sefer',
        'geçen yıl', 'gelecek yıl', 'iyi ki', 'hoş geldiniz', 'hoşça kalın',
        'kendi kendine', 'bir de', 'son derece', 'adım adım', 'yavaş yavaş', 'yine de', 'her neyse', 'bir an önce',
        'en azından', 'bir türlü', 'ne var ki', 'bir yandan', 'öte yandan', 'diğer taraftan']
    },
    other: { name: 'Other (no grammar rules)', noEnd: [], noStart: [], phrases: [] }
  };

  // Frequent words used to recognise the language of a transcript.
  var LANG_MARKERS = {
    en: ['the', 'and', 'of', 'to', 'is', 'that', 'you', 'it', 'for', 'this', 'with', 'what', 'are', 'was', 'have', 'they'],
    tr: ['ve', 'bir', 'bu', 'icin', 'cok', 'ama', 'gibi', 'var', 'yok', 'ben', 'sen', 'daha', 'kadar', 'olarak', 'diye', 'degil', 'sonra']
  };

  /** 'en', 'tr' or 'other', from how often each language's common words appear. */
  function detectLanguage(words) {
    var sets = {}, counts = {}, k;
    for (k in LANG_MARKERS) { sets[k] = toSet(LANG_MARKERS[k]); counts[k] = 0; }
    words.forEach(function (w) {
      var n = norm(w.text);
      for (k in sets) if (sets[k][n]) counts[k]++;
    });
    if (/[ğışİĞŞ]/.test(words.map(function (w) { return w.text; }).join(' '))) counts.tr += words.length * 0.05;
    var best = 'other', bestC = words.length * 0.06;   // need at least ~6% marker words
    for (k in counts) if (counts[k] > bestC) { bestC = counts[k]; best = k; }
    return best;
  }

  var TITLES = toSet(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'mt', 'sr', 'jr', 'sgt', 'capt', 'gen']);

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  var NON_WORD_RE = /[^\p{L}\p{N}]+/gu;
  var SENT_END_RE = /[.!?…。！？]["'”’»)\]]*$/;
  var CLAUSE_RE = /[,;:—–]["'”’»)\]]*$/;
  var TRAILING_PUNCT_RE = /[^\p{L}\p{N}]$/u;
  var OPENER_RE = /^[(\[{“‘"'¿¡«]+$/;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Normalised form used for all comparisons (case, accents, punctuation). */
  function norm(s) {
    return String(s)
      .replace(/İ/g, 'i').replace(/I/g, 'i')
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(NON_WORD_RE, '');
  }

  function toSet(list) {
    var s = Object.create(null);
    (list || []).forEach(function (w) { var n = norm(w); if (n) s[n] = true; });
    return s;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function wordWeight(text) { return Math.max(2, norm(text).length + 1); }

  /**
   * Relative speaking time of a word inside a subtitle line: syllables (vowel
   * groups; digits count as spoken numbers) plus a short pause after punctuation.
   */
  /** Estimated syllables (vowel groups; English silent "e" / "-ed" rules; digits as spoken numbers). */
  function countSyllables(text, lang) {
    var n = norm(text);
    var digits = (n.match(/\d/g) || []).length;
    var w = n.replace(/\d/g, '');
    var groups = (w.match(/[aeiouy]+/g) || []).length;
    if (lang === 'en' && groups > 1) {
      if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) groups--;      // time, make, one
      else if (/[^aeiouytd]ed$/.test(w)) groups--;                          // walked, named
    }
    return Math.max(1, groups + Math.round(digits * 1.3));
  }

  function speechWeight(text, isLast, lang) {
    var w = countSyllables(text, lang) + 0.3;
    if (!isLast) {
      if (SENT_END_RE.test(text)) w += 1.6;
      else if (CLAUSE_RE.test(text)) w += 0.9;
    }
    return w;
  }

  function isCap(text) {
    var m = /\p{L}/u.exec(text);
    if (!m) return false;
    var ch = m[0];
    return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
  }

  function isSentenceEnd(text) {
    if (!SENT_END_RE.test(text)) return false;
    if (/[!?…。！？]/.test(text)) return true;
    var n = norm(text);
    if (TITLES[n]) return false;                 // "Dr."
    if (/^\p{Lu}\.$/u.test(text)) return false;  // initial "J."
    return true;
  }

  function hasTrailingPunct(text) { return TRAILING_PUNCT_RE.test(text); }

  var tcFps = 30; // frame rate assumed for HH:MM:SS:FF timecodes (set per file)

  function parseTimestamp(s) {
    s = String(s).trim();
    var m;
    if ((m = /^(\d+):(\d{2}):(\d{2})[:;](\d{2,3})$/.exec(s))) {
      return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / tcFps;
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    if ((m = /^(-?\d+(?:\.\d+)?)s$/.exec(s))) return parseFloat(m[1]); // "1.5s"
    m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/.exec(s);
    if (!m) return null;
    return (m[1] ? +m[1] : 0) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? parseFloat('0.' + m[4]) : 0);
  }

  /**
   * Turn raw file bytes into text: UTF-8, UTF-16 (with or without BOM) and
   * legacy Windows encodings (Turkish 1254 / Western 1252).
   */
  function decodeBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    var n = bytes.length;
    var dec = function (enc, b) { return new TextDecoder(enc).decode(b || bytes); };
    if (n >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return dec('utf-8', bytes.subarray(3));
    if (n >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return dec('utf-16le', bytes.subarray(2));
    if (n >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return dec('utf-16be', bytes.subarray(2));
    // UTF-16 without BOM: lots of zero bytes on one side.
    var zEven = 0, zOdd = 0, sample = Math.min(n, 4000);
    for (var i = 0; i < sample; i++) if (bytes[i] === 0) { if (i % 2) zOdd++; else zEven++; }
    if (zOdd > sample / 8 && zOdd > zEven * 4) return dec('utf-16le');
    if (zEven > sample / 8 && zEven > zOdd * 4) return dec('utf-16be');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      var western = dec('windows-1252');
      // ğ ı ş İ Ş Ğ show up as ð ý þ Ý Þ Ð in 1252 -> the file is Turkish (1254).
      return /[ðýþÝÞÐ]/.test(western) ? dec('windows-1254') : western;
    }
  }

  // ---------------------------------------------------------------------------
  // Tokenising
  // ---------------------------------------------------------------------------

  /**
   * Attach punctuation-only tokens to their neighbours ("word" "," -> "word,")
   * so every token is a real word. Opening quotes/brackets go to the next word.
   */
  function mergePunctTokens(tokens) {
    var out = [];
    var pending = '';
    tokens.forEach(function (t) {
      if (norm(t.text) === '') {
        if (OPENER_RE.test(t.text) || !out.length) {
          pending += t.text;
        } else {
          var prev = out[out.length - 1];
          prev.text += t.text;
          if (t.eos) prev.eos = true;
          if (t.breakAfter && prev.breakAfter !== 'force') prev.breakAfter = t.breakAfter;
        }
        return;
      }
      if (pending) { t.text = pending + t.text; pending = ''; }
      out.push(t);
    });
    if (pending && out.length) out[out.length - 1].text += pending;
    return out;
  }

  function tokenize(text) {
    return mergePunctTokens(String(text).split(/\s+/).filter(Boolean).map(function (t) {
      return { text: t };
    }));
  }

  /**
   * A plain-text script. A line break marks a preferred break point and "|"
   * forces a break.
   */
  function parseScript(text) {
    var tokens = [];
    String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      line.replace(/\|/g, ' \u0001 ').split(/\s+/).filter(Boolean).forEach(function (t) {
        if (t === '\u0001') {
          if (tokens.length) tokens[tokens.length - 1].breakAfter = 'force';
        } else {
          tokens.push({ text: t, start: null, end: null });
        }
      });
      if (tokens.length && !tokens[tokens.length - 1].breakAfter) tokens[tokens.length - 1].breakAfter = 'prefer';
    });
    return mergePunctTokens(tokens);
  }

  // ---------------------------------------------------------------------------
  // Timed transcript parsing
  // ---------------------------------------------------------------------------

  var TEXT_KEYS = ['punctuated_word', 'text', 'word', 'w', 'token', 'value', 'content', 'transcript'];
  var START_KEYS = ['start', 'start_time', 'startTime', 'start_ms', 'startMs', 'startTimeMs',
    'begin', 'from', 'offset', 'ts', 's', 'startSeconds', 'start_seconds', 'startInTicks', 'offsetInTicks'];
  var END_KEYS = ['end', 'end_time', 'endTime', 'end_ms', 'endMs', 'endTimeMs', 'stop', 'to', 'e',
    'endSeconds', 'end_seconds', 'endInTicks'];
  var DUR_KEYS = ['duration', 'dur', 'length', 'duration_ms', 'durationMs', 'durationInTicks'];

  function keyUnit(k) {
    if (/ms$|millis/i.test(k)) return 0.001;
    if (/seconds?$/i.test(k)) return 1;
    return null; // decided from magnitudes
  }

  function getText(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    for (var i = 0; i < TEXT_KEYS.length; i++) {
      if (typeof o[TEXT_KEYS[i]] === 'string') return o[TEXT_KEYS[i]];
    }
    // AWS Transcribe: { alternatives: [{ content: "word" }] }
    if (Array.isArray(o.alternatives) && o.alternatives[0] && typeof o.alternatives[0].content === 'string') {
      return o.alternatives[0].content;
    }
    return null;
  }

  function readTime(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (o[k] === undefined || o[k] === null) continue;
      var v = isNum(o[k]) ? o[k] : (typeof o[k] === 'string' ? parseTimestamp(o[k]) : null);
      if (isNum(v)) return { v: v, unit: keyUnit(k) };
    }
    return null;
  }

  function hasTime(o) { return !!(readTime(o, START_KEYS) || readTime(o, END_KEYS)); }

  function isWordArray(arr) {
    var objs = 0, short = 0, timed = 0;
    arr.forEach(function (o) {
      var t = getText(o);
      if (t === null) return;
      objs++;
      if (t.trim().split(/\s+/).length <= 2) short++;
      if (hasTime(o)) timed++;
    });
    return objs >= arr.length * 0.8 && short >= objs * 0.8 && timed >= objs * 0.5;
  }

  function isCueArray(arr) {
    var ok = 0;
    arr.forEach(function (o) {
      var t = getText(o);
      if (t !== null && readTime(o, START_KEYS) && (readTime(o, END_KEYS) || readTime(o, DUR_KEYS))) ok++;
    });
    return ok >= arr.length * 0.8;
  }

  /** Walk any JSON and collect arrays that match `pred`, grouped by path. */
  var SPEAKER_KEYS = ['speaker', 'speaker_id', 'speakerId', 'spk', 'speaker_label', 'speakerLabel'];
  function speakerOf(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    for (var i = 0; i < SPEAKER_KEYS.length; i++) {
      var v = o[SPEAKER_KEYS[i]];
      if (typeof v === 'string' || typeof v === 'number') return String(v);
    }
    return null;
  }

  function collectArrays(node, path, pred, out, depth, speaker) {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && pred(node)) { out.push({ path: path, items: node, speaker: speaker || null }); return; }
      node.forEach(function (child) { collectArrays(child, path + '[]', pred, out, depth + 1, speaker); });
      return;
    }
    var spk = speakerOf(node) || speaker;   // e.g. Premiere: segments[].speaker → its words
    Object.keys(node).forEach(function (k) { collectArrays(node[k], path + '.' + k, pred, out, depth + 1, spk); });
  }

  function pickLargestGroup(found) {
    var totals = {}, order = [];
    found.forEach(function (f) {
      if (!(f.path in totals)) { totals[f.path] = 0; order.push(f.path); }
      totals[f.path] += f.items.length;
    });
    var best = null;
    order.forEach(function (p) { if (best === null || totals[p] > totals[best]) best = p; });
    var items = [];
    found.forEach(function (f) {
      if (f.path === best) f.items.forEach(function (o) { items.push({ o: o, speaker: f.speaker }); });
    });
    return items;
  }

  function itemsToRaw(items) {
    var raw = [];
    items.forEach(function (it) {
      var o = it.o, text = getText(o);
      if (typeof text !== 'string') return;
      var s = readTime(o, START_KEYS), e = readTime(o, END_KEYS), d = readTime(o, DUR_KEYS);
      raw.push({
        raw: text,
        start: s ? s.v : null,
        end: e ? e.v : (s && d ? s.v + d.v : null),
        unit: (s && s.unit) || (e && e.unit) || (d && d.unit) || null,
        speaker: speakerOf(o) || it.speaker || null,
        eos: o.eos === true,                                                   // Premiere: end of sentence
        filler: Array.isArray(o.tags) && o.tags.indexOf('filler') >= 0        // Premiere: "um", "uh"
      });
    });
    return raw;
  }

  /** Convert ms / 100ns / Premiere ticks to seconds based on hints or magnitude. */
  function scaleTimes(raw, kind) {
    var f = null;
    for (var i = 0; i < raw.length && f === null; i++) if (raw[i].unit) f = raw[i].unit;
    if (f === null) {
      var durs = [];
      raw.forEach(function (r) { if (isNum(r.start) && isNum(r.end) && r.end > r.start) durs.push(r.end - r.start); });
      if (!durs.length) {
        for (var k = 1; k < raw.length; k++) {
          if (isNum(raw[k].start) && isNum(raw[k - 1].start) && raw[k].start > raw[k - 1].start) durs.push(raw[k].start - raw[k - 1].start);
        }
      }
      var med = median(durs);
      var th = kind === 'words' ? [20, 1e5, 1e9] : [200, 1e6, 1e10];
      f = med > th[2] ? 1 / 254016000000 : med > th[1] ? 1e-7 : med > th[0] ? 0.001 : 1;
    }
    if (f !== 1) {
      raw.forEach(function (r) {
        if (isNum(r.start)) r.start *= f;
        if (isNum(r.end)) r.end *= f;
      });
    }
    return raw;
  }

  /** Raw word tokens -> clean words (handles Whisper's leading-space convention). */
  function rawToWords(raw) {
    var wordLike = raw.filter(function (r) { return norm(r.raw) !== ''; });
    var spaced = wordLike.filter(function (r) { return /^\s/.test(r.raw); }).length;
    var whisperStyle = spaced > wordLike.length * 0.6;
    var tokens = [];
    raw.forEach(function (r) {
      var t = r.raw;
      if (whisperStyle && tokens.length && !/^\s/.test(t) && norm(t) !== '') {
        var prev = tokens[tokens.length - 1];   // continuation of previous word
        prev.text += t.trim();
        if (isNum(r.end)) prev.end = r.end;
        if (r.eos) prev.eos = true;
        return;
      }
      var trimmed = t.trim();
      if (!trimmed) return;
      tokens.push({ text: trimmed, start: r.start, end: r.end, speaker: r.speaker, eos: r.eos, filler: r.filler });
    });
    return fillTimes(mergePunctTokens(tokens));
  }

  /** Spread each cue's duration over its words in proportion to their length. */
  function cuesToWords(cues) {
    var words = [];
    cues.forEach(function (c) {
      var text = String(c.text)
        .replace(/<[^>]*>/g, ' ')        // VTT / HTML tags
        .replace(/\{\\[^}]*\}/g, ' ')    // SSA override tags
        .replace(/^\s*(>>|-)\s*/, '');   // speaker change markers
      var toks = tokenize(text);
      if (!toks.length) return;
      var weights = toks.map(function (t, k) { return speechWeight(t.text, k === toks.length - 1); });
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var span = Math.max(0, c.end - c.start), t0 = c.start;
      toks.forEach(function (t, k) {
        var d = span * weights[k] / total;
        // Time after a word's punctuation is a pause, not part of the word.
        var pause = (k < toks.length - 1 && /[^\p{L}\p{N}]$/u.test(t.text)) ? d * 0.35 : 0;
        words.push({ text: t.text, start: t0, end: t0 + d - pause, cueStart: k === 0, cueEnd: k === toks.length - 1, speaker: c.speaker || null });
        t0 += d;
      });
      words[words.length - 1].end = c.end;   // exact cue end
    });
    return words;
  }

  function parseSubtitleCues(text) {
    // "[00:01.000 --> 00:03.000] text" (Whisper) keeps the text on the timing line;
    // in SRT/VTT anything after the times is position/style info and is ignored.
    var TIMING = /^\s*([\[(])?\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d+)?)\s*-+>\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d+)?)\s*[\])]?(.*)$/;
    var lines = text.replace(/\r\n?/g, '\n').split('\n');
    var cues = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^﻿/, '');
      var m = TIMING.exec(line);
      if (m) {
        var s = parseTimestamp(m[2].replace(',', '.')), e = parseTimestamp(m[3].replace(',', '.'));
        cur = (isNum(s) && isNum(e)) ? { start: s, end: e, text: m[1] ? m[4].trim() : '' } : null;
        if (cur) cues.push(cur);
      } else if (!line.trim()) {
        cur = null;                                    // blank line ends a cue
      } else if (/^\s*\d+\s*$/.test(line) && i + 1 < lines.length && TIMING.test(lines[i + 1])) {
        cur = null;                                    // SRT cue number
      } else if (cur) {
        cur.text += (cur.text ? ' ' : '') + line.trim();
      }
    }
    return cues.filter(function (c) { return c.text; });
  }

  function parseTimestampedLines(text) {
    var TS = '((?:\\d+:)?\\d{1,2}:\\d{2}(?:[.,]\\d+)?)';
    var re = new RegExp('^\\s*[\\[(]?' + TS + '(?:\\s*(?:-->|–|-)\\s*' + TS + ')?[\\])]?\\s*[:\\-–]?\\s*(.*)$');
    var cues = [];
    text.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var m = re.exec(line);
      if (m && m[3].trim()) {
        cues.push({ start: parseTimestamp(m[1].replace(',', '.')), end: m[2] ? parseTimestamp(m[2].replace(',', '.')) : null, text: m[3].trim() });
      } else if (cues.length && line.trim()) {
        cues[cues.length - 1].text += ' ' + line.trim(); // continuation line
      }
    });
    cues.forEach(function (c, i) {
      if (!isNum(c.end)) {
        var next = cues[i + 1];
        c.end = next ? next.start : c.start + 0.4 * c.text.split(/\s+/).length;
      }
    });
    return cues;
  }

  /**
   * Parse a transcript that carries timing information.
   * Returns { words: [{text, start, end}], kind: 'words'|'cues', format }.
   */
  function parseTimedTranscript(input) {
    var text = String(input).replace(/^﻿/, '');
    var trimmed = text.trim();
    if (!trimmed) throw new Error('The transcript file is empty.');
    var bad = (trimmed.slice(0, 4000).match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) || []).length;
    if (bad > Math.min(4000, trimmed.length) * 0.02) {
      throw new Error('This is a binary file (for example Premiere\'s .prtranscript), which can\'t be read. ' +
        'In Premiere export the transcript as JSON instead, or use an SRT/VTT file.');
    }
    var tcs = trimmed.match(/\b\d{2}:\d{2}:\d{2}[:;](\d{2})\b/g);
    if (tcs) {
      var maxF = 0;
      tcs.forEach(function (tc) { maxF = Math.max(maxF, +tc.slice(-2)); });
      tcFps = maxF < 24 ? 24 : maxF < 25 ? 25 : maxF < 30 ? 30 : maxF < 50 ? 50 : 60;
    }

    var json = null;
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      try { json = JSON.parse(trimmed); } catch (e) {
        if (trimmed[0] === '{') throw new Error('The file looks like JSON but could not be read: ' + e.message);
      }
    }
    if (json !== null) {
      var found = [];
      collectArrays(json, '$', isWordArray, found, 0);
      if (found.length) {
        var words = rawToWords(scaleTimes(itemsToRaw(pickLargestGroup(found)), 'words'));
        if (words.length) return { words: words, kind: 'words', format: 'JSON with word timings' };
      }
      found = [];
      collectArrays(json, '$', isCueArray, found, 0);
      if (found.length) {
        var cues = scaleTimes(itemsToRaw(pickLargestGroup(found)), 'cues')
          .map(function (r) { return { start: r.start, end: r.end, text: r.raw, speaker: r.speaker }; });
        return { words: cuesToWords(cues), kind: 'cues', format: 'JSON with segment timings' };
      }
      throw new Error('No word or segment timings were found in this JSON file.');
    }

    if (/-->/.test(text)) {
      var subCues = parseSubtitleCues(text);
      if (subCues.length) return { words: cuesToWords(subCues), kind: 'cues', format: /^WEBVTT/.test(trimmed) ? 'WebVTT' : /^\d+\s*\n/.test(trimmed) ? 'SRT' : 'Timestamped text' };
    }

    var lineCues = parseTimestampedLines(text);
    if (lineCues.length) return { words: cuesToWords(lineCues), kind: 'cues', format: 'Timestamped text' };

    throw new Error('No timing information found. Use a transcript with timings (JSON, SRT, VTT or ' +
      'timestamped text). Plain text can be added as the "script".');
  }

  /** Fill in missing start/end times by interpolating between known neighbours. */
  function fillTimes(ws) {
    var n = ws.length, i, j;
    for (i = 0; i < n; i++) {
      var w = ws[i];
      if (!isNum(w.start)) w.start = null;
      if (!isNum(w.end)) w.end = null;
      if (w.start !== null && w.end === null) {
        var nx = ws[i + 1];
        w.end = (nx && isNum(nx.start) && nx.start > w.start) ? Math.min(nx.start, w.start + wordWeight(w.text) * 0.08) : w.start + wordWeight(w.text) * 0.06;
      } else if (w.start === null && w.end !== null) {
        w.start = Math.max(0, w.end - wordWeight(w.text) * 0.06);
      }
    }
    i = 0;
    while (i < n) {
      if (ws[i].start !== null) { i++; continue; }
      j = i;
      while (j < n && ws[j].start === null) j++;
      var totalW = 0;
      for (var k = i; k < j; k++) totalW += wordWeight(ws[k].text);
      var est = totalW * 0.06;
      var prevEnd = i > 0 ? ws[i - 1].end : null;
      var nextStart = j < n ? ws[j].start : null;
      var t0, t1;
      if (prevEnd === null && nextStart === null) { t0 = 0; t1 = est; }
      else if (prevEnd === null) { t1 = nextStart; t0 = Math.max(0, t1 - est); }
      else if (nextStart === null) { t0 = prevEnd; t1 = t0 + est; }
      else { t0 = prevEnd; t1 = Math.max(prevEnd, nextStart); }
      var cur = t0;
      for (k = i; k < j; k++) {
        var d = (t1 - t0) * wordWeight(ws[k].text) / totalW;
        ws[k].start = cur; ws[k].end = cur + d; ws[k].interpolated = true;
        cur += d;
      }
      i = j;
    }
    for (i = 0; i < n; i++) {
      if (i > 0 && ws[i].start < ws[i - 1].start) ws[i].start = ws[i - 1].start;
      if (ws[i].end < ws[i].start) ws[i].end = ws[i].start;
    }
    return ws;
  }

  // ---------------------------------------------------------------------------
  // Script <-> timing alignment
  // ---------------------------------------------------------------------------

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  function similarity(a, b) {
    if (a === b) return 1;
    var L = Math.max(a.length, b.length);
    return L ? 1 - levenshtein(a, b) / L : 0;
  }

  /**
   * Give the words of a (correct) script the timings of a timed transcript
   * (e.g. Whisper or Premiere speech-to-text, which may contain mistakes).
   * Uses a banded global alignment; unmatched script words are interpolated.
   */
  function alignScriptToTimings(scriptWords, timedWords) {
    var a = scriptWords.map(function (w) { return norm(w.text); });
    var b = timedWords.map(function (w) { return norm(w.text); });
    var n = a.length, m = b.length;
    if (!n) throw new Error('The script is empty.');
    if (!m) throw new Error('The timed transcript has no words.');

    var W = Math.min(Math.max(n, m), Math.min(1500, 200 + Math.abs(n - m)));
    var width = 2 * W + 1;
    var INF = Infinity;
    var D = new Float64Array((n + 1) * width).fill(INF);
    var P = new Uint8Array((n + 1) * width); // 0 diag, 1 up (script only), 2 left (timed only)
    function lo(i) { return Math.max(0, Math.round(i * m / n) - W); }
    function hi(i) { return Math.min(m, Math.round(i * m / n) + W); }
    function get(i, j) { var l = lo(i); return (j < l || j > hi(i)) ? INF : D[i * width + (j - l)]; }

    for (var j0 = lo(0); j0 <= hi(0); j0++) { D[j0 - lo(0)] = j0; P[j0 - lo(0)] = 2; }
    for (var i = 1; i <= n; i++) {
      var l = lo(i), h = hi(i), base = i * width;
      for (var j = l; j <= h; j++) {
        var best = get(i - 1, j) + 1, op = 1;
        if (j > 0) {
          var s = similarity(a[i - 1], b[j - 1]);
          var diag = get(i - 1, j - 1) + (s === 1 ? 0 : Math.max(0.3, 2 * (1 - s)));
          if (diag <= best) { best = diag; op = 0; }
          var left = (j - 1 >= l) ? D[base + (j - 1 - l)] + 1 : INF;
          if (left < best) { best = left; op = 2; }
        }
        D[base + (j - l)] = best;
        P[base + (j - l)] = op;
      }
    }

    var out = scriptWords.map(function (w) {
      return { text: w.text, start: null, end: null, breakAfter: w.breakAfter };
    });
    var exact = 0, fuzzy = 0;
    i = n; j = m;
    while (i > 0 || j > 0) {
      var opHere = (i === 0) ? 2 : P[i * width + (j - lo(i))];
      if (opHere === 0) {
        out[i - 1].start = timedWords[j - 1].start;
        out[i - 1].cueStart = timedWords[j - 1].cueStart;
        out[i - 1].cueEnd = timedWords[j - 1].cueEnd;
        out[i - 1].audio = timedWords[j - 1].audio;
        out[i - 1].anchored = timedWords[j - 1].anchored;
        out[i - 1].afterPause = timedWords[j - 1].afterPause;
        out[i - 1].stress = timedWords[j - 1].stress;
        out[i - 1].speaker = timedWords[j - 1].speaker;
        out[i - 1].end = timedWords[j - 1].end;
        var sim = similarity(a[i - 1], b[j - 1]);
        if (sim === 1) exact++; else if (sim >= 0.5) fuzzy++;
        i--; j--;
      } else if (opHere === 1) {
        i--;
      } else {
        j--;
      }
    }
    fillTimes(out);
    // Script words without a match inherit the speaker of the word before them.
    for (var q = 0; q < out.length; q++) if (!out[q].speaker && q > 0) out[q].speaker = out[q - 1].speaker;
    return { words: out, exact: exact, fuzzy: fuzzy, total: n, ratio: (exact + fuzzy) / n };
  }

  // ---------------------------------------------------------------------------
  // Break rules
  // ---------------------------------------------------------------------------

  /**
   * For every boundary b (between words[b-1] and words[b]) compute:
   *   forbidden[b] – a caption may not end here (protected phrase, name...)
   *   forced[b]    – a caption must end here ("|" in the script)
   *   cost[b]      – how bad it is to end a caption here
   *   sentEnd[b]   – words[b-1] ends a sentence
   */
  function buildBoundaries(words, o, lang) {
    var n = words.length;
    var forbidden = new Uint8Array(n + 1), forced = new Uint8Array(n + 1);
    var cost = new Float64Array(n + 1), sentEnd = new Uint8Array(n + 1);
    var reason = new Array(n + 1);
    var normed = words.map(function (w) { return norm(w.text); });
    var noEnd = toSet(lang.noEnd), noStart = toSet(lang.noStart);
    var b, i;
    var hasCues = words.some(function (w) { return w.cueEnd; });
    // Subtitle grammar: how strongly each pair of neighbouring words belongs together.
    var P = o.phrasing ? getPhrasing() : null;
    var phr = P ? P.analyze(words, o.language) : null;
    var useGrammar = !!(phr && phr.tags);

    for (b = 1; b < n; b++) {
      var pw = words[b - 1].text;
      sentEnd[b] = (words[b - 1].eos && !CLAUSE_RE.test(pw)) || isSentenceEnd(pw) && !(/(\.\.\.|…)["'”’»)\]]*$/.test(pw) && /^["'“‘«(]*\p{Ll}/u.test(words[b].text)) ? 1 : 0;
    }

    // 1. Keep-together phrases.
    var index = Object.create(null);
    (o.phrases || []).forEach(function (p) {
      var toks = String(p).trim().split(/\s+/).map(norm).filter(Boolean);
      if (toks.length < 2) return;
      (index[toks[0]] = index[toks[0]] || []).push({ toks: toks, label: String(p).trim() });
    });
    for (i = 0; i < n; i++) {
      var cands = index[normed[i]];
      if (!cands) continue;
      cands.forEach(function (c) {
        var k = c.toks.length;
        if (i + k > n) return;
        for (var q = 1; q < k; q++) {
          if (normed[i + q] !== c.toks[q]) return;
          if (sentEnd[i + q]) return; // never glue across a sentence end
        }
        for (q = 1; q < k; q++) { forbidden[i + q] = 1; reason[i + q] = 'phrase "' + c.label + '"'; }
      });
    }

    // 2. Names: consecutive capitalised words (skipped for Title Case / ALL CAPS text).
    if (o.protectNames) {
      var caps = 0;
      words.forEach(function (w) { if (isCap(w.text)) caps++; });
      if (caps < n * 0.5) {
        for (b = 1; b < n; b++) {
          if (isCap(words[b - 1].text) && isCap(words[b].text) && !hasTrailingPunct(words[b - 1].text) &&
              normed[b] !== 'i' && normed[b - 1] !== 'i') {
            forbidden[b] = 1; reason[b] = reason[b] || 'name';
          }
        }
      }
    }

    // 3. Numbers + units, titles + names.
    for (b = 1; b < n; b++) {
      var pt = words[b - 1].text;
      if (o.protectNumbers && /^[$€£₺¥]?\d[\d.,:]*(%|st|nd|rd|th|k|m|bn)?$/i.test(pt) && /\p{L}/u.test(words[b].text)) {
        forbidden[b] = 1; reason[b] = reason[b] || 'number';
      }
      if (TITLES[normed[b - 1]] && isCap(words[b].text)) { forbidden[b] = 1; reason[b] = reason[b] || 'title'; }
    }

    // 4. Forced breaks win over everything: "|" in the script and, unless
    //    disabled, every sentence end (one sentence per caption).
    for (b = 1; b < n; b++) {
      var newSpeaker = o.splitSpeakers && words[b - 1].speaker && words[b].speaker && words[b - 1].speaker !== words[b].speaker;
      if (words[b - 1].breakAfter === 'force' || (o.splitSentences && sentEnd[b]) || newSpeaker) { forced[b] = 1; forbidden[b] = 0; }
    }

    // "Hard edges": a caption bounded by these on both sides may be shorter than
    // the minimum (a one-word sentence, or a word isolated by long pauses).
    var edge = new Uint8Array(n + 1);
    edge[0] = edge[n] = 1;
    for (b = 1; b < n; b++) {
      if (forced[b] || sentEnd[b] || words[b].start - words[b - 1].end > o.pauseSplit) edge[b] = 1;
    }

    // 5. Cost of ending a caption at each boundary.
    for (b = 1; b < n; b++) {
      var prevW = words[b - 1], nextW = words[b];
      var c;
      if (sentEnd[b] || prevW.breakAfter === 'prefer') c = 0;
      else if (CLAUSE_RE.test(prevW.text)) c = 3;
      else c = 10;
      var gap = nextW.start - prevW.end;
      if (gap > 0) c = Math.max(0, c - gap * 15);       // pauses are natural breaks
      var punct = hasTrailingPunct(prevW.text);
      // Weak words at caption edges: a strong rule when enabled, otherwise only a
      // tie-breaker (captions may end on "of" when commas, stress or limits call for it).
      if (useGrammar) {
        // 1 → never split ("a beautiful | house"), negative → natural break ("…house | and then").
        var coh = phr.cohesion[b];
        // Strong pairs cost more than one missing word, so meaning wins over the minimum.
        c += coh >= 0.9 ? SYNTAX_STRONG : coh >= 0.8 ? SYNTAX_STRONG * 0.75 : coh > 0 ? SYNTAX_KEEP * coh : SYNTAX_BREAK * coh;
      } else {
        var weakCost = o.avoidWeakEdges ? 30 : 5;
        if (!punct && noEnd[normed[b - 1]]) c += weakCost;     // "... the | house"
        if (!punct && noStart[normed[b]]) c += weakCost;       // "ev | için"
      }
      if (hasCues) c += words[b - 1].cueEnd ? -6 : 14;   // exact line times vs estimated
      // With audio, a caption that starts right after a pause has an unambiguous start.
      if (nextW.audio && prevW.audio && !words[b - 1].cueEnd) c += gap >= 0.06 ? -4 : AUDIO_NO_PAUSE;
      // Start captions on stressed syllables, not on unstressed ones ("of", "the").
      if (typeof nextW.stress === 'number') c -= SYNC.STRESS * Math.max(-1, Math.min(1, nextW.stress / 6));
      // Prefer starting captions on words whose start was measured in the audio.
      if (nextW.audio && !nextW.anchored) c += SYNC.UNANCHORED;
      // Inside a subtitle line, only a start right after silence is certain.
      if (hasCues && nextW.audio && !words[b - 1].cueEnd && !nextW.afterPause) c += SYNC.MIDLINE_UNSURE;
      cost[b] = Math.max(0, c);
    }

    return { forbidden: forbidden, forced: forced, cost: cost, sentEnd: sentEnd, edge: edge, reason: reason, tags: phr && phr.tags };
  }

  // ---------------------------------------------------------------------------
  // Segmentation (dynamic programming)
  // ---------------------------------------------------------------------------

  function segment(words, B, o) {
    var n = words.length;
    if (!n) return [];
    var longest = 1, run = 1, b;
    for (b = 1; b < n; b++) {
      run = B.forbidden[b] ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    var maxSpan = o.maxWords + longest;
    var maxChars = o.maxCharsPerLine * o.maxLines;
    var maxCps = readingSpeedLimit(o);
    var target = (o.minWords + o.maxWords) / 2;
    var best = new Float64Array(n + 1).fill(Infinity);
    var prev = new Int32Array(n + 1);
    best[0] = 0;

    for (var j = 1; j <= n; j++) {
      if (j < n && B.forbidden[j]) continue;
      var chars = -1, sentInside = 0, clauseInside = 0, maxGap = 0, lastComma = -1;
      for (var i = j - 1; i >= 0 && j - i <= maxSpan; i--) {
        chars += words[i].text.length + 1;
        if (i < j - 1) {
          if (B.forced[i + 1]) break;               // can't span a forced break
          if (B.sentEnd[i + 1]) sentInside++;
          else if (CLAUSE_RE.test(words[i].text)) {
            clauseInside++;
            if (lastComma < 0) lastComma = i + 1;   // comma boundary closest to the caption end
          }
          var g = words[i + 1].start - words[i].end;
          if (g > maxGap) maxGap = g;
        }
        if (best[i] === Infinity) continue;
        var k = j - i, c = 0;
        if (k < o.minWords && !(B.edge[i] && B.edge[j])) {
          c += 30 * (o.minWords - k);
          if (k === 1) c += 400;                    // no lone words inside running speech
        }
        if (k > o.maxWords) c += 1000 * (k - o.maxWords);
        if (chars > maxChars) c += 15 * (chars - maxChars);
        var dur = words[j - 1].end - words[i].start;
        if (dur > o.maxDuration) c += 30 * (dur - o.maxDuration);
        // Reading speed: characters per second over the time the caption is on screen.
        var shown = shownDuration(words, i, j, o);
        var cps = (chars + 1) / shown;
        if (cps > maxCps) c += 6 * (cps - maxCps);
        c += 25 * sentInside + 6 * clauseInside;
        // The caption already had enough words when it reached a comma: it should have ended there.
        if (o.breakAtCommas && lastComma > 0 && lastComma - i >= o.minWords) c += 500;
        if (maxGap > o.pauseSplit) c += 80 + (maxGap > o.pauseSplit * 3 ? 300 : 0);
        c += 1.5 * Math.abs(k - target);
        var total = best[i] + c + (j < n ? B.cost[j] : 0);
        if (total < best[j]) { best[j] = total; prev[j] = i; }
      }
    }

    var spans = [];
    for (var e = n; e > 0; e = prev[e]) spans.push([prev[e], e]);
    return spans.reverse();
  }

  /** Netflix reading speeds: English adults 20 characters/second, most other languages 17. */
  function readingSpeedLimit(o) {
    var v = parseFloat(o.maxCps);
    if (v > 0) return v;
    return o.language === 'en' ? 20 : 17;
  }

  /** How long a caption made of words[i..j) will be on screen (estimate used while splitting). */
  function shownDuration(words, i, j, o) {
    var lastEnd = words[j - 1].end, start = words[i].start;
    var end = lastEnd;
    if (j < words.length) {
      var nextStart = words[j].start;
      end = o.continuous ? nextStart : Math.min(nextStart, lastEnd + Math.max(o.closeGapsUnder, 0));
    } else {
      end = lastEnd + 0.5;
    }
    return Math.max(end - start, o.minDuration, 0.1);
  }

  function splitLines(ws, i0, B, o) {
    var text = ws.map(function (w) { return w.text; }).join(' ');
    if (o.maxLines < 2 || text.length <= o.maxCharsPerLine || ws.length < 2) return [text];
    var bestM = 1, bestCost = Infinity, left = -1;
    for (var m = 1; m < ws.length; m++) {
      left += ws[m - 1].text.length + 1;
      var l1 = left, l2 = text.length - l1 - 1;
      // Balanced lines, with a slight preference for a shorter top line ("bottom-heavy").
      var c = Math.abs(l1 - l2) * 0.5 + (l1 > l2 ? (l1 - l2) * 0.3 : 0) +
        10 * (Math.max(0, l1 - o.maxCharsPerLine) + Math.max(0, l2 - o.maxCharsPerLine)) +
        (B.forbidden[i0 + m] ? 60 : 0) + B.cost[i0 + m] * 0.8;
      if (c < bestCost) { bestCost = c; bestM = m; }
    }
    var join = function (arr) { return arr.map(function (w) { return w.text; }).join(' '); };
    return [join(ws.slice(0, bestM)), join(ws.slice(bestM))];
  }

  function finalizeTiming(caps, o) {
    var fd = o.frameDuration > 0 ? o.frameDuration : 0;
    var tick = fd || 0.04;
    var snap = function (t) { return fd ? Math.round(t / fd) * fd : t; };
    var k, c, next;
    for (k = 0; k < caps.length; k++) {
      c = caps[k];
      c.start = snap(c.words[0].start + o.offset);
      c.speechEnd = c.words[c.words.length - 1].end + o.offset;
      if (k > 0 && c.start <= caps[k - 1].start) c.start = caps[k - 1].start + tick;
    }
    for (k = 0; k < caps.length; k++) {
      c = caps[k];
      next = caps[k + 1];
      var e = Math.max(c.speechEnd, c.start + o.minDuration);
      if (next && o.continuous) {
        e = next.start;                              // hold until the next caption starts
      } else if (next) {
        if (next.start - c.speechEnd < o.closeGapsUnder) e = next.start - o.minGap;
        e = Math.min(snap(e), next.start - o.minGap);
        if (e <= c.start) e = Math.min(next.start, c.start + tick);
      } else {
        e = snap(e);
        if (e <= c.start) e = c.start + tick;
      }
      c.end = e;
      delete c.speechEnd;
    }
    return caps.filter(function (cap) {
      if (cap.end <= 0) return false;
      if (cap.start < 0) cap.start = 0;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Audio-based sync refinement
  // ---------------------------------------------------------------------------

  var AUDIO_NO_PAUSE = 4;
  var SYNTAX_STRONG = 80;   // cost of splitting a strong pair (adjective+noun, the+noun, to+verb…)
  var SYNTAX_KEEP = 35;     // cost of splitting words that belong together (× cohesion)
  var SYNTAX_BREAK = 20;    // bonus for breaking at a natural phrase boundary (× -cohesion)
  var OFFSET_MIN_WEIGHT = 15;   // extra cost for starting a caption without a pause before it
  var ENV_HOP = 0.0025;   // envelope resolution: 2.5 ms
  var ENV_WIN = 4;        // RMS window = 4 hops = 10 ms

  /*
   * Spectral change ("flux") from a small filter bank: words that run into each
   * other often have no dip in loudness, but the sound changes character
   * (different vowel, consonant, pitch). Six band-pass filters at ~16 kHz are
   * far cheaper than an FFT and enough to see those changes.
   */
  var FLUX_BANDS = [[100, 300], [300, 700], [700, 1500], [1500, 3000], [3000, 5000], [5000, 7000]];

  function makeFluxBank(sampleRate, hop, frames) {
    var D = Math.max(1, Math.round(sampleRate / 16000)), fs = sampleRate / D;
    var filters = [];
    FLUX_BANDS.forEach(function (b) {
      if (b[1] >= fs / 2) return;
      var f0 = Math.sqrt(b[0] * b[1]), Q = f0 / (b[1] - b[0]);
      var w0 = 2 * Math.PI * f0 / fs, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
      filters.push({ b0: alpha / a0, b2: -alpha / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 });
    });
    var nb = filters.length;
    var energy = new Float32Array(frames * nb);
    var bandAcc = new Float64Array(nb);
    var acc = 0, accN = 0, inHop = 0, frame = 0;
    return {
      nb: nb,
      energy: energy,
      push: function (v) {
        acc += v;
        if (++accN === D) {
          var x = acc / D;
          acc = 0; accN = 0;
          for (var k = 0; k < nb; k++) {
            var F = filters[k];
            var y = F.b0 * x + F.b2 * F.x2 - F.a1 * F.y1 - F.a2 * F.y2;
            F.x2 = F.x1; F.x1 = x; F.y2 = F.y1; F.y1 = y;
            bandAcc[k] += y * y;
          }
        }
        if (++inHop === hop) {
          if (frame < frames) for (var k2 = 0; k2 < nb; k2++) { energy[frame * nb + k2] = bandAcc[k2]; bandAcc[k2] = 0; }
          frame++; inHop = 0;
        }
      }
    };
  }

  var FLUX_ENABLED = false, FLUX_MERGE = 0.025, FLUX_Z = 3, FLUX_LAG = 4;
  var SUPPRESS_SILENCE = true;
  var ONSET_MIN_DB = 2, ONSET_FRAC = 0.2;   // where on a gentle rise (no silence before) the word starts
  var SHALLOW_DB = 6;                         // a dip this close to speech level counts as "no silence"

  /** Peaks of the spectral change curve inside speech, as candidate word onsets. */
  function spectralOnsets(bank, frames, sm, thr, hopSec, timeOf) {
    var nb = bank.nb, E = bank.energy, f, k, i;
    var W = ENV_WIN;
    var L = new Float32Array(frames * nb);
    for (f = 0; f < frames; f++) {
      for (k = 0; k < nb; k++) {
        var s2 = 0;
        for (i = 0; i < W && f + i < frames; i++) s2 += E[(f + i) * nb + k];
        L[f * nb + k] = 10 * Math.log10(s2 + 1e-10);
      }
    }
    var flux = new Float32Array(frames);
    for (f = FLUX_LAG; f < frames; f++) {
      var sum = 0;
      for (k = 0; k < nb; k++) { var d = L[f * nb + k] - L[(f - FLUX_LAG) * nb + k]; if (d > 0) sum += d; }
      flux[f] = sum;
    }
    // robust scale from frames inside speech
    var act = [];
    for (f = 0; f < frames; f += 2) if (sm[f] > thr) act.push(flux[f]);
    if (act.length < 50) return [];
    act.sort(function (x, y) { return x - y; });
    var med = act[act.length >> 1];
    var dev = act.map(function (x) { return Math.abs(x - med); }).sort(function (x, y) { return x - y; });
    var mad = dev[dev.length >> 1] * 1.4826 + 1e-6;
    var out = [], R = 8;
    for (f = R; f < frames - R; f++) {
      if (sm[f] <= thr && sm[Math.min(frames - 1, f + 4)] <= thr) continue;   // inside speech only
      var z = (flux[f] - med) / mad;
      if (z < FLUX_Z) continue;
      var isMax = true;
      for (i = f - R; i <= f + R; i++) if (flux[i] > flux[f] || (flux[i] === flux[f] && i < f)) { isMax = false; break; }
      if (!isMax) continue;
      // the change sits between the two compared windows
      out.push({ t: timeOf(f - FLUX_LAG / 2) - (W / 2) * hopSec + (FLUX_LAG / 2) * hopSec, s: Math.min(1.5, 0.4 + (z - FLUX_Z) * 0.15), pause: 0, flux: true });
    }
    return out;
  }

  function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]; }

  /**
   * Analyse audio once: loudness envelope (dB every 2.5 ms), speech activity
   * and candidate word onsets (points where sound rises after a pause or dip).
   * `channels` is a Float32Array or an array of Float32Arrays (one per channel).
   */
  function analyzeAudio(channels, sampleRate) {
    if (!Array.isArray(channels)) channels = [channels];
    var nc = channels.length, n = channels[0].length;
    var hop = Math.max(1, Math.round(sampleRate * ENV_HOP));
    var frames = Math.floor(n / hop);
    var e = new Float64Array(frames), f, i, c;
    var bank = FLUX_ENABLED ? makeFluxBank(sampleRate, hop, frames) : null;
    for (f = 0; f < frames; f++) {
      var sum = 0, base = f * hop;
      for (i = 0; i < hop; i++) {
        var v = 0;
        for (c = 0; c < nc; c++) v += channels[c][base + i];
        v /= nc;
        sum += v * v;
        if (bank) bank.push(v);
      }
      e[f] = sum;
    }
    return buildEnvelope(e, hop, sampleRate, n, bank);
  }

  /**
   * Analyse a WAV file straight from its bytes (no full decode, so long files
   * stay light on memory).
   */
  function analyzeWav(buffer) {
    var info = wavInfo(buffer);
    var dv = info.dv, fmt = info.fmt;
    var bps = fmt.bits / 8, nc = fmt.ch, stride = bps * nc;
    var n = Math.floor(info.dataLen / stride);
    var hop = Math.max(1, Math.round(fmt.rate * ENV_HOP));
    var frames = Math.floor(n / hop);
    var e = new Float64Array(frames);
    var bank = FLUX_ENABLED ? makeFluxBank(fmt.rate, hop, frames) : null;
    var read = sampleReader(dv, fmt);
    var o = info.dataOff;
    for (var f = 0; f < frames; f++) {
      var sum = 0;
      for (var i = 0; i < hop; i++) {
        var v = 0;
        for (var c = 0; c < nc; c++, o += bps) v += read(o);
        v /= nc;
        sum += v * v;
        if (bank) bank.push(v);
      }
      e[f] = sum;
    }
    return buildEnvelope(e, hop, fmt.rate, n, bank);
  }

  function buildEnvelope(e, hop, sampleRate, n, bank) {
    var frames = e.length, f, i;
    var hopSec = hop / sampleRate;
    if (frames < 50) throw new Error('The audio file is too short.');
    var db = new Float32Array(frames);
    for (f = 0; f < frames; f++) {
      var s2 = 0, cnt = 0;
      for (i = 0; i < ENV_WIN && f + i < frames; i++) { s2 += e[f + i]; cnt++; }
      db[f] = 10 * Math.log10(s2 / (cnt * hop) + 1e-12);
    }
    var sm = new Float32Array(frames);
    for (f = 0; f < frames; f++) sm[f] = (db[Math.max(0, f - 1)] + db[f] + db[Math.min(frames - 1, f + 1)]) / 3;

    var sorted = Array.prototype.slice.call(sm).sort(function (a, b) { return a - b; });
    var floor = percentile(sorted, 0.05), peak = percentile(sorted, 0.98);
    var thr = Math.max(floor + 10, floor + 0.25 * (peak - floor));
    var activeSum = new Float64Array(frames + 1);
    for (f = 0; f < frames; f++) activeSum[f + 1] = activeSum[f] + (sm[f] > thr ? 1 : 0);

    // Frame f covers [f, f + ENV_WIN) hops; its time is the window centre.
    var timeOf = function (fr) { return (fr + ENV_WIN / 2) * hopSec; };

    // Candidate onsets: after every valley (local minimum) at least 3 dB deep.
    var R = 4, CTX = 40, onsets = [];
    for (f = R; f < frames - R; f++) {
      var isMin = true;
      for (i = f - R; i <= f + R; i++) if (sm[i] < sm[f] || (sm[i] === sm[f] && i < f)) { isMin = false; break; }
      if (!isMin) continue;
      var lm = -Infinity, rm = -Infinity;
      for (i = Math.max(0, f - CTX); i < f; i++) if (sm[i] > lm) lm = sm[i];
      for (i = f + 1; i <= Math.min(frames - 1, f + CTX); i++) if (sm[i] > rm) rm = sm[i];
      // How much the sound rises after the valley (after a silence, the left side is only noise).
      var depth = rm - sm[f];
      if (depth < 3 || rm < thr) continue;
      // After silence the rise starts from the noise floor: +6 dB marks the start well.
      // A shallow dip between two words rises gently: use a fraction of the rise instead.
      var shallow = sm[f] > thr - SHALLOW_DB;
      var level = Math.min(sm[f] + (shallow ? Math.max(ONSET_MIN_DB, ONSET_FRAC * depth) : Math.max(6, 0.3 * depth)), rm - 1);
      var o = f;
      while (o < frames - 1 && sm[o] < level) o++;
      var frac = o > f && sm[o] !== sm[o - 1] ? (level - sm[o - 1]) / (sm[o] - sm[o - 1]) : 0;
      var t = timeOf(o - 1 + frac);
      var strength = Math.min(depth, 30) / 10;
      var quiet = 0;                                   // silence right before the onset
      for (var qf = o - 1; qf >= 0 && sm[qf] <= thr && quiet < 400; qf--) quiet++;
      var pause = quiet * hopSec;
      var last = onsets[onsets.length - 1];
      if (last && t - last.t < 0.012) { if (strength > last.s) { last.t = t; last.s = strength; last.pause = Math.max(last.pause, pause); } }
      else onsets.push({ t: t, s: strength, pause: pause });
    }

    // Spectral onsets: where the sound changes character without a dip in loudness.
    var fluxOnsets = bank && bank.nb ? spectralOnsets(bank, frames, sm, thr, hopSec, timeOf) : [];
    if (FLUX_ENABLED && fluxOnsets.length) {
      var merged = [], a = 0, bIdx = 0;
      fluxOnsets.forEach(function (fo) {
        // keep only where no loudness onset is close by
        while (a < onsets.length && onsets[a].t < fo.t - FLUX_MERGE) a++;
        if (a < onsets.length && Math.abs(onsets[a].t - fo.t) <= FLUX_MERGE) return;
        if (a > 0 && Math.abs(onsets[a - 1].t - fo.t) <= FLUX_MERGE) return;
        merged.push(fo);
      });
      onsets = onsets.concat(merged).sort(function (x, y) { return x.t - y.t; });
    }

    return {
      hopSec: hopSec, duration: n / sampleRate, onsets: onsets, floor: floor, peak: peak, fluxCount: fluxOnsets.length,
      // seconds of speech between two times
      voiced: function (a, b) {
        var fa = Math.max(0, Math.min(frames, Math.round(a / hopSec - ENV_WIN / 2)));
        var fb = Math.max(0, Math.min(frames, Math.round(b / hopSec - ENV_WIN / 2)));
        return fb > fa ? (activeSum[fb] - activeSum[fa]) * hopSec : 0;
      },
      // loudest moment between two times (dB)
      peakDb: function (a, b) {
        var fa = Math.max(0, Math.round(a / hopSec - ENV_WIN / 2));
        var fb = Math.min(frames - 1, Math.round(b / hopSec - ENV_WIN / 2));
        var mx = -Infinity;
        for (var q = fa; q <= fb; q++) if (sm[q] > mx) mx = sm[q];
        return mx;
      },
      // last moment of speech before time b (but not before a)
      speechEndBefore: function (a, b) {
        var fa = Math.max(0, Math.round(a / hopSec - ENV_WIN / 2));
        var fb = Math.min(frames - 1, Math.round(b / hopSec - ENV_WIN / 2));
        for (var q = fb; q > fa; q--) if (sm[q] > thr) return timeOf(q) + hopSec * ENV_WIN / 2;
        return a;
      }
    };
  }

  function onsetsBetween(env, a, b) {
    var out = [], list = env.onsets;
    var lo = 0, hi = list.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].t < a) lo = mid + 1; else hi = mid; }
    for (var k = lo; k < list.length && list[k].t < b; k++) out.push(list[k]);
    return out;
  }

  /**
   * Re-time the words of one subtitle line from the audio: choose a start for
   * every word among the detected onsets (or a 20 ms grid where speech flows
   * without a dip), so that word lengths match their syllable counts and word
   * starts fall on real rises in the sound. Dynamic programming, optimal.
   */
  var SYNC = { ALPHA: 6.0, BETA: 0.6, GAMMA: 0.7, SIGMA0: 0.12, SIGMA_LINE: 0.1, SIGMA_WORD: 0.1, UNANCHORED: 15, PAUSE_BONUS: 2, MIDLINE_UNSURE: 12, STRESS: 10 };

  /**
   * `priors[k]` is where word k is expected to start (transcript time or the
   * estimate inside a subtitle line) and `sigmas[k]` how much to trust it. The
   * audio pulls each word to a real onset when one is close; where speech flows
   * without a dip, the word stays near its prior.
   */
  function alignLineToAudio(ws, env, S, E, lang, priors, sigmas) {
    var m = ws.length;
    var GRID = 0.02, ALPHA = SYNC.ALPHA, BETA = SYNC.BETA, GAMMA = SYNC.GAMMA;
    var lo = Math.max(0, S - 0.3), hi = E;
    var real = onsetsBetween(env, lo, hi);
    var pts = real.map(function (o) { return { t: o.t, s: o.s, pause: o.pause }; });
    var ri = 0;
    for (var g = lo; g < hi; g += GRID) {
      while (ri < real.length && real[ri].t < g - 0.01) ri++;
      if (ri < real.length && Math.abs(real[ri].t - g) < 0.01) continue;
      // stable-ts style: a word can't start in silence (only real onsets may follow a pause)
      if (SUPPRESS_SILENCE && env.voiced(g, g + 0.03) === 0) continue;
      pts.push({ t: g, s: 0, pause: 0 });
    }
    pts.sort(function (a, b) { return a.t - b.t; });
    var P = pts.length;
    if (P < m) return false;

    var sw = ws.map(function (w) { return speechWeight(w.text, true, lang); });
    var syl = ws.map(function (w) { return countSyllables(w.text, lang); });
    // A word of n syllables should contain about n - 1 rises in loudness.
    var pref = new Float64Array(P + 1);
    for (var q = 0; q < P; q++) pref[q + 1] = pref[q] + Math.min(1, pts[q].s / 1.5);
    var inner = function (i0, j0) { return j0 > i0 + 1 ? pref[j0] - pref[i0 + 1] : 0; };
    var SW = sw.reduce(function (a, b) { return a + b; }, 0);
    var Vtot = Math.max(env.voiced(S, E), 0.06 * m);
    var D = sw.map(function (x) { return Vtot * x / SW; });
    var durCost = function (a, b, k) {
      var r = Math.log((env.voiced(a, b) + 0.04) / (D[k] + 0.04));
      return ALPHA * r * r;
    };
    var wordCost = function (i0, j0, k) {
      var d = inner(i0, j0) - (syl[k] - 1);
      return durCost(pts[i0].t, pts[j0].t, k) + GAMMA * d * d;
    };

    var priorCost = function (j0, k0) {
      var z = (pts[j0].t - priors[k0]) / sigmas[k0];
      return z * z;
    };
    var cost = [], back = [], j, i, k;
    cost[0] = new Float64Array(P);
    // The first word of a line/phrase starts where sound resumes after silence.
    var hasPauseOnset = pts.some(function (pt) { return pt.pause >= 0.08 && Math.abs(pt.t - priors[0]) < 3 * sigmas[0]; });
    for (j = 0; j < P; j++) {
      cost[0][j] = priorCost(j, 0) - BETA * pts[j].s;
      if (hasPauseOnset) cost[0][j] += pts[j].pause >= 0.08 ? -SYNC.PAUSE_BONUS : SYNC.PAUSE_BONUS;
    }
    for (k = 1; k < m; k++) {
      cost[k] = new Float64Array(P).fill(Infinity);
      back[k] = new Int32Array(P).fill(-1);
      for (j = 0; j < P; j++) {
        if (Math.abs(pts[j].t - priors[k]) > 4 * sigmas[k] + 0.05) continue;
        var bestC = Infinity, bestI = -1;
        for (i = j - 1; i >= 0; i--) {
          if (pts[j].t - pts[i].t < 0.05) continue;
          if (cost[k - 1][i] === Infinity) continue;
          var cc = cost[k - 1][i] + wordCost(i, j, k - 1);
          if (cc < bestC) { bestC = cc; bestI = i; }
        }
        if (bestI >= 0) { cost[k][j] = bestC + priorCost(j, k) - BETA * pts[j].s; back[k][j] = bestI; }
      }
    }
    var endBest = Infinity, endJ = -1;
    for (j = 0; j < P; j++) {
      if (cost[m - 1][j] === Infinity || pts[j].t > E - 0.03) continue;
      var lastInner = pref[P] - pref[j + 1];
      for (var q2 = P - 1; q2 > j && pts[q2].t >= E; q2--) lastInner -= Math.min(1, pts[q2].s / 1.5);
      var dl = lastInner - (syl[m - 1] - 1);
      var tc = cost[m - 1][j] + durCost(pts[j].t, E, m - 1) + GAMMA * dl * dl;
      if (tc < endBest) { endBest = tc; endJ = j; }
    }
    if (endJ < 0) return false;
    var idx = new Array(m);
    idx[m - 1] = endJ;
    for (k = m - 1; k > 0; k--) idx[k - 1] = back[k][idx[k]];
    for (k = 0; k < m; k++) {
      ws[k].start = pts[idx[k]].t;
      ws[k].audio = true;
      ws[k].anchored = pts[idx[k]].s > 0;   // start sits on a measured rise in the sound
      ws[k].afterPause = pts[idx[k]].pause >= 0.08;   // ... right after silence: unambiguous
    }
    for (k = 0; k < m; k++) {
      var nextStart = k < m - 1 ? ws[k + 1].start : E;
      ws[k].end = Math.max(ws[k].start + 0.02, Math.min(nextStart, env.speechEndBefore(ws[k].start, nextStart)));
    }
    return true;
  }

  /**
   * Stress of each word's first syllable: how much louder it is (dB) than the
   * words around it (±2 s). Stressed syllables are where captions read best.
   */
  function measureStress(words, env) {
    var peaks = words.map(function (w) {
      var end = Math.min(w.end, w.start + 0.25);
      return end > w.start ? env.peakDb(w.start, end) : -Infinity;
    });
    var lo = 0, hi = 0;
    words.forEach(function (w, i) {
      while (words[lo].start < w.start - 2) lo++;
      while (hi < words.length && words[hi].start <= w.start + 2) hi++;
      var around = peaks.slice(lo, hi).filter(isFinite);
      if (!isFinite(peaks[i]) || around.length < 3) return;
      w.stress = peaks[i] - median(around);
    });
  }

  /**
   * Median distance from word starts to the nearest clear onset: a transcript
   * that is consistently a bit late or early (common for speech recognition).
   */
  function estimateBias(words, env) {
    var d = [];
    words.forEach(function (w, i) {
      if (i > 0 && w.start - words[i - 1].end < 0.15) return;   // phrase starts only
      var best = null;
      onsetsBetween(env, w.start - 0.35, w.start + 0.35).forEach(function (o) {
        if (o.pause >= 0.08 && (best === null || Math.abs(o.t - w.start) < Math.abs(best))) best = o.t - w.start;
      });
      if (best !== null) d.push(best);
    });
    if (d.length < 4) return 0;
    var b = median(d);
    return Math.abs(b) >= 0.005 ? b : 0;
  }

  /**
   * Improve word timings with the audio. SRT/VTT lines and phrases of a
   * word-level transcript are re-timed word by word (see alignLineToAudio).
   * Returns the number of words that were timed from the audio.
   */
  function refineWithAudio(words, env, lang) {
    var changed = 0, i = 0, j, n = words.length, k;
    var hasCues = words.some(function (w) { return w.cueStart; });
    var groups = [];
    if (hasCues) {
      while (i < n) {
        j = i + 1;
        while (j < n && !words[j].cueStart) j++;
        groups.push([i, j]);
        i = j;
      }
    } else {
      var bias = estimateBias(words, env);
      if (bias) words.forEach(function (w) { w.start += bias; w.end += bias; });
      // Phrases: split at pauses in the transcript (and keep them reasonably short).
      while (i < n) {
        j = i + 1;
        while (j < n && j - i < 25 && words[j].start - words[j - 1].end < 0.25) j++;
        groups.push([i, j]);
        i = j;
      }
    }
    groups.forEach(function (g) {
      var line = words.slice(g[0], g[1]);
      var S = line[0].start, E = Math.min(line[line.length - 1].end, env.duration);
      // Audio exports often stop right at the last sound: clamp instead of skipping.
      if (S >= env.duration - 0.05 || E <= S) return;
      var priors = line.map(function (w) { return w.start; });
      var sigmas = line.map(function (w, q) {
        if (!hasCues) return q === 0 ? Math.max(SYNC.SIGMA_WORD, 0.15) : SYNC.SIGMA_WORD;
        return q === 0 ? SYNC.SIGMA0 : SYNC.SIGMA_LINE;
      });
      var saved = line.map(function (w) { return [w.start, w.end]; });
      if (alignLineToAudio(line, env, S, E, lang, priors, sigmas)) changed += line.length;
      else line.forEach(function (w, q) { w.start = saved[q][0]; w.end = saved[q][1]; });
    });
    for (k = 1; k < n; k++) if (words[k].start <= words[k - 1].start) words[k].start = words[k - 1].start + 0.01;
    return changed;
  }

  function wavInfo(buffer) {
    var ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    var dv = new DataView(ab, buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset, buffer.byteLength);
    var str = function (o, l) { var r = ''; for (var q = 0; q < l; q++) r += String.fromCharCode(dv.getUint8(o + q)); return r; };
    if (dv.byteLength < 44 || (str(0, 4) !== 'RIFF' && str(0, 4) !== 'RF64') || str(8, 4) !== 'WAVE') {
      throw new Error('Not a WAV file.');
    }
    var pos = 12, fmt = null, dataOff = -1, dataLen = 0;
    while (pos + 8 <= dv.byteLength) {
      var id = str(pos, 4), len = dv.getUint32(pos + 4, true);
      if (id === 'fmt ') {
        fmt = { tag: dv.getUint16(pos + 8, true), ch: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
        if (fmt.tag === 0xFFFE && len >= 26) fmt.tag = dv.getUint16(pos + 32, true); // WAVE_FORMAT_EXTENSIBLE
      } else if (id === 'data') {
        dataOff = pos + 8;
        dataLen = (len === 0xFFFFFFFF || dataOff + len > dv.byteLength) ? dv.byteLength - dataOff : len;
        break;
      }
      pos += 8 + len + (len & 1);
    }
    if (!fmt || dataOff < 0) throw new Error('The WAV file has no audio data.');
    if ([1, 3].indexOf(fmt.tag) < 0 || [8, 16, 24, 32, 64].indexOf(fmt.bits) < 0) {
      throw new Error('Unsupported WAV encoding. Export the audio as 16- or 24-bit PCM WAV.');
    }
    return { dv: dv, fmt: fmt, dataOff: dataOff, dataLen: dataLen };
  }

  function sampleReader(dv, fmt) {
    var bps = fmt.bits / 8;
    if (fmt.tag === 3) return bps === 4 ? function (o) { return dv.getFloat32(o, true); } : function (o) { return dv.getFloat64(o, true); };
    if (bps === 2) return function (o) { return dv.getInt16(o, true) / 32768; };
    if (bps === 3) return function (o) { return (dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16)) / 8388608; };
    if (bps === 4) return function (o) { return dv.getInt32(o, true) / 2147483648; };
    return function (o) { return (dv.getUint8(o) - 128) / 128; };
  }

  /** Read a WAV file into channels of Float32 samples (used by tests/tools). */
  function decodeWav(buffer) {
    var info = wavInfo(buffer), fmt = info.fmt, read = sampleReader(info.dv, fmt);
    var bps = fmt.bits / 8, frames = Math.floor(info.dataLen / (bps * fmt.ch));
    var ch = [];
    for (var c = 0; c < fmt.ch; c++) ch.push(new Float32Array(frames));
    for (var f = 0, o = info.dataOff; f < frames; f++) {
      for (c = 0; c < fmt.ch; c++, o += bps) ch[c][f] = read(o);
    }
    return { channels: ch, sampleRate: fmt.rate };
  }

  /**
   * Find a constant shift between the transcript and the audio (e.g. the audio
   * was exported from a slightly different start). Anchors are line starts
   * (SRT) or word starts; returns seconds to ADD to the transcript, or 0.
   */
  var DRIFT_ENABLED = true;

  /**
   * Transcript and audio running at slightly different speeds (e.g. 24 vs
   * 23.976 fps) drift apart over time. Estimate the shift in 40 s windows,
   * fit a straight line through them (Theil–Sen, robust to bad windows) and
   * return { slope, intercept } so that audioTime = t + intercept + slope * t.
   */
  function detectDrift(words, env) {
    if (words.length < 60) return null;
    var span = words[words.length - 1].start - words[0].start;
    if (span < 120) return null;                       // too short for drift to matter
    var list = env.onsets.filter(function (o) { return o.pause >= 0.08; }).map(function (o) { return o.t; });
    if (list.length < 20) return null;
    var nearest = function (t) {
      var lo = 0, hi = list.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid] < t) lo = mid + 1; else hi = mid; }
      var d = Infinity;
      if (lo < list.length) d = list[lo] - t;
      if (lo > 0 && t - list[lo - 1] < Math.abs(d)) d = list[lo - 1] - t;
      return d;
    };
    var starts = words.filter(function (w, i) { return i === 0 || w.start - words[i - 1].end > 0.12; }).map(function (w) { return w.start; });
    var pts = [], WIN = 40;
    for (var w0 = starts[0]; w0 < starts[starts.length - 1]; w0 += WIN / 2) {
      var inWin = starts.filter(function (t) { return t >= w0 && t < w0 + WIN; });
      if (inWin.length < 6) continue;
      var best = 0, bestScore = -1, second = -1;
      var scores = [];
      for (var off = -1.5; off <= 1.5001; off += 0.01) {
        var sc = 0;
        for (var k = 0; k < inWin.length; k++) { var d = nearest(inWin[k] + off) / 0.03; sc += Math.exp(-d * d); }
        scores.push([off, sc]);
        if (sc > bestScore) { bestScore = sc; best = off; }
      }
      scores.forEach(function (x) { if (Math.abs(x[0] - best) > 0.1 && x[1] > second) second = x[1]; });
      if (bestScore / inWin.length < 0.45 || bestScore < second * 1.3) continue;   // unclear window
      pts.push([w0 + WIN / 2, best]);
    }
    if (pts.length < 4) return null;
    var slopes = [];
    for (var a = 0; a < pts.length; a++) for (var b = a + 1; b < pts.length; b++) {
      if (pts[b][0] - pts[a][0] > 30) slopes.push((pts[b][1] - pts[a][1]) / (pts[b][0] - pts[a][0]));
    }
    if (!slopes.length) return null;
    var slope = median(slopes);
    var intercept = median(pts.map(function (p) { return p[1] - slope * p[0]; }));
    var resid = median(pts.map(function (p) { return Math.abs(p[1] - (intercept + slope * p[0])); }));
    // Only correct a clear, consistent drift (> 0.02 %, i.e. > 0.12 s over 10 minutes).
    if (Math.abs(slope) < 0.0002 || resid > 0.05 || Math.abs(slope * span) < 0.08) return null;
    return { slope: slope, intercept: intercept, windows: pts.length };
  }

  function detectAudioOffset(words, env) {
    var hasCues = words.some(function (w) { return w.cueStart; });
    var anchors = words.map(function (w) { return { t: w.start, w: (!hasCues || w.cueStart) ? 1 : 0.25 }; });
    var W = anchors.reduce(function (a, x) { return a + x.w; }, 0);
    if (anchors.length < 8) return { offset: 0, confidence: 0 };
    var list = env.onsets.map(function (o) { return o.t; });
    var nearestDist = function (t) {
      var lo = 0, hi = list.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid] < t) lo = mid + 1; else hi = mid; }
      var d = Infinity;
      if (lo < list.length) d = list[lo] - t;
      if (lo > 0) d = Math.min(d, t - list[lo - 1]);
      return d;
    };
    var score = function (off) {
      var sc = 0;
      for (var k = 0; k < anchors.length; k++) {
        var d = nearestDist(anchors[k].t + off) / 0.03;
        sc += anchors[k].w * Math.exp(-d * d);
      }
      return sc / W;
    };
    var best = 0, bestScore = score(0), off, curve = [];
    for (off = -3; off <= 3.0001; off += 0.01) {
      var sc = score(off);
      curve.push([off, sc]);
      if (sc > bestScore) { bestScore = sc; best = off; }
    }
    // Rhythmic speech can make a wrong shift look good: the winner must clearly
    // beat the best alternative that is more than 100 ms away from it.
    var second = 0;
    curve.forEach(function (c) { if (Math.abs(c[0] - best) > 0.1 && c[1] > second) second = c[1]; });
    var coarse = best;
    for (off = coarse - 0.01; off <= coarse + 0.0101; off += 0.002) {
      var sc2 = score(off);
      if (sc2 > bestScore) { bestScore = sc2; best = off; }
    }
    var zero = score(0);
    // Small differences are fixed word by word later; only correct a clear, real shift.
    var result = { offset: 0, confidence: zero, best: best, bestScore: bestScore, weight: W };
    // Small differences are fixed word by word later; only correct a clear, real
    // shift, and only with enough material to be sure.
    if (Math.abs(best) < 0.1 || W < OFFSET_MIN_WEIGHT || bestScore < zero * 1.4 + 0.08 || bestScore < second * 1.35) return result;
    result.offset = Math.round(best * 1000) / 1000;
    result.confidence = bestScore;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function normalizeOptions(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') o[k] = opts[k];
    ['minWords', 'maxWords', 'maxCharsPerLine', 'maxLines', 'minDuration', 'maxDuration', 'maxCps',
      'closeGapsUnder', 'minGap', 'pauseSplit', 'offset', 'frameDuration'].forEach(function (key) {
      var v = parseFloat(o[key]);
      o[key] = isFinite(v) ? v : DEFAULTS[key];
    });
    o.minWords = Math.max(1, Math.round(o.minWords));
    o.maxWords = Math.max(o.minWords, Math.round(o.maxWords));
    o.maxLines = o.maxLines >= 2 ? 2 : 1;
    o.maxCharsPerLine = Math.max(10, o.maxCharsPerLine);
    o.protectNames = !!o.protectNames;
    o.protectNumbers = !!o.protectNumbers;
    o.continuous = !!o.continuous;
    o.splitSentences = !!o.splitSentences;
    o.breakAtCommas = !!o.breakAtCommas;
    o.avoidWeakEdges = !!o.avoidWeakEdges;
    o.phrasing = !!o.phrasing;
    o.splitSpeakers = !!o.splitSpeakers;
    o.removeFillers = !!o.removeFillers;
    if (o.language !== 'auto' && !LANGS[o.language]) o.language = 'other';
    if (!Array.isArray(o.phrases)) o.phrases = o.language === 'auto' ? null : LANGS[o.language].phrases.slice();
    return o;
  }

  /** Parse inputs into timed words (the slow part; cache the result). */
  function prepareWords(timedText, scriptText, audioEnv, language) {
    var timed = parseTimedTranscript(timedText);
    var result = { words: timed.words, format: timed.format, kind: timed.kind, alignment: null, audioWords: 0 };
    if (audioEnv) {
      if (!language || language === 'auto') language = detectLanguage(timed.words);
      var off = detectAudioOffset(timed.words, audioEnv);
      if (off.offset) timed.words.forEach(function (w) { w.start += off.offset; w.end += off.offset; });
      result.audioOffset = off.offset;
      var drift = DRIFT_ENABLED ? detectDrift(timed.words, audioEnv) : null;
      if (drift) {
        timed.words.forEach(function (w) {
          w.start += drift.intercept + drift.slope * w.start;
          w.end += drift.intercept + drift.slope * w.end;
        });
      }
      result.audioDrift = drift;
      result.audioWords = refineWithAudio(timed.words, audioEnv, language || 'other');
      result.audioAnchored = timed.words.filter(function (w) { return w.anchored; }).length;
      measureStress(timed.words, audioEnv);
      result.wordsAfterAudio = timed.words.filter(function (w) { return w.start > audioEnv.duration; }).length;
      var last = timed.words[timed.words.length - 1];
      result.audioTooShort = last.end > audioEnv.duration + 1;
    }
    if (scriptText && String(scriptText).trim()) {
      var al = alignScriptToTimings(parseScript(scriptText), timed.words);
      result.words = al.words;
      result.alignment = { exact: al.exact, fuzzy: al.fuzzy, total: al.total, ratio: al.ratio };
    }
    if (!result.words.length) throw new Error('No words were found in the transcript.');
    return result;
  }

  /** Build captions from timed words. */
  function buildCaptions(words, options) {
    var o = normalizeOptions(options);
    var detected = null;
    if (o.language === 'auto') {
      detected = detectLanguage(words);
      o.language = detected;
      // Your own phrases plus the detected language's defaults.
      var merged = (o.phrases || []).slice();
      LANGS[detected].phrases.forEach(function (ph) { if (merged.indexOf(ph) < 0) merged.push(ph); });
      o.phrases = merged;
    }
    var lang = LANGS[o.language];
    // Work on copies so cached words are never mutated.
    var ws = words.map(function (w) {
      return { text: w.text, start: w.start, end: w.end, breakAfter: w.breakAfter, cueStart: w.cueStart, cueEnd: w.cueEnd, audio: w.audio, anchored: w.anchored, afterPause: w.afterPause, stress: w.stress,
        speaker: w.speaker, eos: w.eos, filler: w.filler };
    });
    if (o.removeFillers) {
      ws = ws.filter(function (w, i) {
        var filler = w.filler || /^[("']*(um+|uh+|uhm+|erm+|er|hmm+|mm+|ıı+|ee+h?)[,.!?…)"']*$/i.test(w.text);
        if (filler && i > 0 && SENT_END_RE.test(w.text) && !hasTrailingPunct(ws[i - 1].text)) {
          ws[i - 1].text += w.text.replace(/^[^.!?…]*/, '');   // keep the sentence end: "so um." → "so."
        }
        return !filler;
      });
      if (!ws.length) throw new Error('Only filler words were found.');
    }
    var hasCues = ws.some(function (w) { return w.cueEnd; });
    var B = buildBoundaries(ws, o, lang);
    var caps = segment(ws, B, o).map(function (sp) {
      var cw = ws.slice(sp[0], sp[1]);
      var lines = splitLines(cw, sp[0], B, o);
      var flags = [];
      if (cw.length < o.minWords && !(B.edge[sp[0]] && B.edge[sp[1]])) flags.push('short');
      if (cw.length > o.maxWords) {
        var why = [];
        for (var b = sp[0] + 1; b < sp[1]; b++) if (B.reason[b] && why.indexOf(B.reason[b]) < 0) why.push(B.reason[b]);
        flags.push('long' + (why.length ? ' (kept together: ' + why.join(', ') + ')' : ''));
      }
      lines.forEach(function (l) { if (l.length > o.maxCharsPerLine && flags.indexOf('chars') < 0) flags.push('chars'); });
      var cpsNow = lines.join(' ').length / shownDuration(ws, sp[0], sp[1], o);
      if (cpsNow > readingSpeedLimit(o) + 0.5) flags.push('fast ' + cpsNow.toFixed(0) + ' cps');
      return {
        words: cw, wordCount: cw.length, lines: lines, text: lines.join(' '), flags: flags,
        estimatedStart: hasCues && !cw[0].cueStart && !cw[0].audio,
        audioSynced: !!cw[0].audio,
        audioAnchored: !!cw[0].anchored
      };
    });
    caps = finalizeTiming(caps, o);
    caps.forEach(function (c, i) { c.index = i + 1; });
    var total = 0;
    caps.forEach(function (c) { total += c.wordCount; });
    return {
      captions: caps,
      options: o,
      language: o.language,
      languageDetected: detected !== null,
      stats: {
        captions: caps.length,
        words: total,
        avgWords: caps.length ? total / caps.length : 0,
        flagged: caps.filter(function (c) { return c.flags.length; }).length,
        estimated: caps.filter(function (c) { return c.estimatedStart; }).length,
        audioSynced: caps.filter(function (c) { return c.audioSynced; }).length,
        audioAnchored: caps.filter(function (c) { return c.audioAnchored; }).length
      }
    };
  }

  function generate(p) {
    var prep = prepareWords(p.timedText, p.scriptText, p.audio || null, (p.options && p.options.language) || DEFAULTS.language);
    var res = buildCaptions(prep.words, p.options);
    res.format = prep.format;
    res.alignment = prep.alignment;
    return res;
  }

  function formatSrtTime(t) {
    var ms = Math.max(0, Math.round(t * 1000));
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    function pad(x, w) { x = String(x); while (x.length < w) x = '0' + x; return x; }
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
  }

  function toSRT(captions, eol) {
    eol = eol || '\r\n';
    return captions.map(function (c, i) {
      return (i + 1) + eol + formatSrtTime(c.start) + ' --> ' + formatSrtTime(c.end) + eol + c.lines.join(eol) + eol;
    }).join(eol);
  }

  return {
    DEFAULTS: DEFAULTS,
    LANGS: LANGS,
    norm: norm,
    parseTimestamp: parseTimestamp,
    decodeBytes: decodeBytes,
    analyzeAudio: analyzeAudio,
    analyzeWav: analyzeWav,
    detectAudioOffset: detectAudioOffset,
    refineWithAudio: refineWithAudio,
    decodeWav: decodeWav,
    countSyllables: countSyllables,
    _flux: function (cfg) { if (cfg) { if ('enabled' in cfg) FLUX_ENABLED = cfg.enabled; if (cfg.z) FLUX_Z = cfg.z; if (cfg.lag) FLUX_LAG = cfg.lag; if (cfg.merge) FLUX_MERGE = cfg.merge; if (cfg.minDb !== undefined) ONSET_MIN_DB = cfg.minDb; if (cfg.frac !== undefined) ONSET_FRAC = cfg.frac; if (cfg.shallow !== undefined) SHALLOW_DB = cfg.shallow; if (cfg.suppress !== undefined) SUPPRESS_SILENCE = cfg.suppress; if (cfg.drift !== undefined) DRIFT_ENABLED = cfg.drift; } return { enabled: FLUX_ENABLED, z: FLUX_Z, lag: FLUX_LAG, merge: FLUX_MERGE }; },
    detectLanguage: detectLanguage,
    SYNC: SYNC,
    parseTimedTranscript: parseTimedTranscript,
    parseScript: parseScript,
    alignScriptToTimings: alignScriptToTimings,
    buildBoundaries: buildBoundaries,
    segment: segment,
    normalizeOptions: normalizeOptions,
    prepareWords: prepareWords,
    buildCaptions: buildCaptions,
    generate: generate,
    formatSrtTime: formatSrtTime,
    toSRT: toSRT
  };
}));
