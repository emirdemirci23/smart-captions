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

  // ---------------------------------------------------------------------------
  // Defaults & language data
  // ---------------------------------------------------------------------------

  var DEFAULTS = {
    language: 'en',
    minWords: 3,
    maxWords: 8,
    maxCharsPerLine: 42,
    maxLines: 2,
    minDuration: 0.8,      // seconds a caption stays on screen at minimum
    maxDuration: 6,        // seconds; longer captions are penalised
    closeGapsUnder: 0.5,   // gaps shorter than this are closed (caption held)
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
        'most', 'less', 'least'],
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
        'kendi kendine', 'bir de']
    },
    other: { name: 'Other (no grammar rules)', noEnd: [], noStart: [], phrases: [] }
  };

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

  function parseTimestamp(s) {
    s = String(s).trim();
    var m;
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
  function collectArrays(node, path, pred, out, depth) {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && pred(node)) { out.push({ path: path, items: node }); return; }
      node.forEach(function (child) { collectArrays(child, path + '[]', pred, out, depth + 1); });
      return;
    }
    Object.keys(node).forEach(function (k) { collectArrays(node[k], path + '.' + k, pred, out, depth + 1); });
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
    found.forEach(function (f) { if (f.path === best) items = items.concat(f.items); });
    return items;
  }

  function itemsToRaw(items) {
    var raw = [];
    items.forEach(function (o) {
      var text = getText(o);
      if (typeof text !== 'string') return;
      var s = readTime(o, START_KEYS), e = readTime(o, END_KEYS), d = readTime(o, DUR_KEYS);
      raw.push({
        raw: text,
        start: s ? s.v : null,
        end: e ? e.v : (s && d ? s.v + d.v : null),
        unit: (s && s.unit) || (e && e.unit) || (d && d.unit) || null
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
        return;
      }
      var trimmed = t.trim();
      if (!trimmed) return;
      tokens.push({ text: trimmed, start: r.start, end: r.end });
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
      var total = 0;
      toks.forEach(function (t) { total += wordWeight(t.text); });
      var span = Math.max(0, c.end - c.start), t0 = c.start;
      toks.forEach(function (t) {
        var d = span * wordWeight(t.text) / total;
        words.push({ text: t.text, start: t0, end: t0 + d });
        t0 += d;
      });
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
          .map(function (r) { return { start: r.start, end: r.end, text: r.raw }; });
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

    for (b = 1; b < n; b++) sentEnd[b] = isSentenceEnd(words[b - 1].text) ? 1 : 0;

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

    // 4. Forced breaks from the script win over everything.
    for (i = 0; i < n - 1; i++) {
      if (words[i].breakAfter === 'force') { forced[i + 1] = 1; forbidden[i + 1] = 0; }
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
      if (!punct && noEnd[normed[b - 1]]) c += 30;       // "... the | house"
      if (!punct && noStart[normed[b]]) c += 30;         // "ev | için"
      cost[b] = c;
    }

    return { forbidden: forbidden, forced: forced, cost: cost, sentEnd: sentEnd, reason: reason };
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
    var target = (o.minWords + o.maxWords) / 2;
    var best = new Float64Array(n + 1).fill(Infinity);
    var prev = new Int32Array(n + 1);
    best[0] = 0;

    for (var j = 1; j <= n; j++) {
      if (j < n && B.forbidden[j]) continue;
      var chars = -1, sentInside = 0, clauseInside = 0, maxGap = 0;
      for (var i = j - 1; i >= 0 && j - i <= maxSpan; i--) {
        chars += words[i].text.length + 1;
        if (i < j - 1) {
          if (B.forced[i + 1]) break;               // can't span a forced break
          if (B.sentEnd[i + 1]) sentInside++;
          else if (CLAUSE_RE.test(words[i].text)) clauseInside++;
          var g = words[i + 1].start - words[i].end;
          if (g > maxGap) maxGap = g;
        }
        if (best[i] === Infinity) continue;
        var k = j - i, c = 0;
        if (k < o.minWords) c += 30 * (o.minWords - k);
        if (k > o.maxWords) c += 1000 * (k - o.maxWords);
        if (chars > maxChars) c += 15 * (chars - maxChars);
        var dur = words[j - 1].end - words[i].start;
        if (dur > o.maxDuration) c += 30 * (dur - o.maxDuration);
        c += 25 * sentInside + 6 * clauseInside;
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

  function splitLines(ws, i0, B, o) {
    var text = ws.map(function (w) { return w.text; }).join(' ');
    if (o.maxLines < 2 || text.length <= o.maxCharsPerLine || ws.length < 2) return [text];
    var bestM = 1, bestCost = Infinity, left = -1;
    for (var m = 1; m < ws.length; m++) {
      left += ws[m - 1].text.length + 1;
      var l1 = left, l2 = text.length - l1 - 1;
      var c = Math.abs(l1 - l2) * 0.5 +
        10 * (Math.max(0, l1 - o.maxCharsPerLine) + Math.max(0, l2 - o.maxCharsPerLine)) +
        (B.forbidden[i0 + m] ? 60 : 0) + B.cost[i0 + m] * 0.8;
      if (c < bestCost) { bestCost = c; bestM = m; }
    }
    var join = function (arr) { return arr.map(function (w) { return w.text; }).join(' '); };
    return [join(ws.slice(0, bestM)), join(ws.slice(bestM))];
  }

  function finalizeTiming(caps, o) {
    var k, c;
    for (k = 0; k < caps.length; k++) {
      c = caps[k];
      c.start = c.words[0].start;
      c.end = Math.max(c.words[c.words.length - 1].end, c.start + o.minDuration);
      var next = caps[k + 1];
      if (next) {
        var ns = next.words[0].start;
        if (ns - c.words[c.words.length - 1].end < o.closeGapsUnder) c.end = ns - o.minGap;
        if (c.end > ns - o.minGap) c.end = ns - o.minGap;
        if (c.end <= c.start) c.end = c.start + 0.04;
      }
    }
    var fd = o.frameDuration > 0 ? o.frameDuration : 0;
    var prevEnd = -Infinity;
    caps.forEach(function (cap) {
      cap.start += o.offset;
      cap.end += o.offset;
      if (fd) {
        cap.start = Math.round(cap.start / fd) * fd;
        cap.end = Math.round(cap.end / fd) * fd;
      }
      if (cap.start < prevEnd) cap.start = prevEnd;
      if (cap.end <= cap.start) cap.end = cap.start + (fd || 0.04);
      prevEnd = cap.end;
    });
    return caps.filter(function (cap) {
      if (cap.end <= 0) return false;
      if (cap.start < 0) cap.start = 0;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function normalizeOptions(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') o[k] = opts[k];
    ['minWords', 'maxWords', 'maxCharsPerLine', 'maxLines', 'minDuration', 'maxDuration',
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
    if (!LANGS[o.language]) o.language = 'other';
    if (!Array.isArray(o.phrases)) o.phrases = LANGS[o.language].phrases.slice();
    return o;
  }

  /** Parse inputs into timed words (the slow part; cache the result). */
  function prepareWords(timedText, scriptText) {
    var timed = parseTimedTranscript(timedText);
    var result = { words: timed.words, format: timed.format, kind: timed.kind, alignment: null };
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
    var lang = LANGS[o.language];
    // Work on copies so cached words are never mutated.
    var ws = words.map(function (w) { return { text: w.text, start: w.start, end: w.end, breakAfter: w.breakAfter }; });
    var B = buildBoundaries(ws, o, lang);
    var caps = segment(ws, B, o).map(function (sp) {
      var cw = ws.slice(sp[0], sp[1]);
      var lines = splitLines(cw, sp[0], B, o);
      var flags = [];
      if (cw.length < o.minWords) flags.push('short');
      if (cw.length > o.maxWords) {
        var why = [];
        for (var b = sp[0] + 1; b < sp[1]; b++) if (B.reason[b] && why.indexOf(B.reason[b]) < 0) why.push(B.reason[b]);
        flags.push('long' + (why.length ? ' (kept together: ' + why.join(', ') + ')' : ''));
      }
      lines.forEach(function (l) { if (l.length > o.maxCharsPerLine && flags.indexOf('chars') < 0) flags.push('chars'); });
      return { words: cw, wordCount: cw.length, lines: lines, text: lines.join(' '), flags: flags };
    });
    caps = finalizeTiming(caps, o);
    caps.forEach(function (c, i) { c.index = i + 1; });
    var total = 0;
    caps.forEach(function (c) { total += c.wordCount; });
    return {
      captions: caps,
      options: o,
      stats: {
        captions: caps.length,
        words: total,
        avgWords: caps.length ? total / caps.length : 0,
        flagged: caps.filter(function (c) { return c.flags.length; }).length
      }
    };
  }

  function generate(p) {
    var prep = prepareWords(p.timedText, p.scriptText);
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
