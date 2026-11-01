/* Smart Captions – panel UI */
(function () {
  'use strict';

  var E = window.CaptionEngine;
  var cep = window.__adobe_cep__ || null;   // present only inside Premiere Pro
  var STORAGE_KEY = 'smartCaptions.settings.v1';

  var $ = function (id) { return document.getElementById(id); };
  var NUM_FIELDS = ['minWords', 'maxWords', 'maxCharsPerLine', 'minDuration', 'maxDuration', 'maxCps',
    'pauseSplit', 'closeGapsUnder', 'gapFrames', 'offset'];

  var state = {
    timedText: null,
    timedName: '',
    prepared: null,       // cached result of E.prepareWords
    audioEnv: null,       // analysed audio (E.analyzeWav / E.analyzeAudio)
    audioName: '',
    preparedKey: '',
    result: null,
    frameDuration: 1 / 30
  };

  // ---------------------------------------------------------------------------
  // Premiere bridge
  // ---------------------------------------------------------------------------

  function evalJSX(script) {
    return new Promise(function (resolve) {
      if (!cep) { resolve(JSON.stringify({ ok: false, error: 'Not running inside Premiere Pro.' })); return; }
      cep.evalScript(script, resolve);
    }).then(function (raw) {
      try { return JSON.parse(raw); } catch (e) { return { ok: false, error: 'Unexpected reply from Premiere: ' + raw }; }
    });
  }

  function jsxString(s) { return '"' + encodeURIComponent(s) + '"'; }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function defaultSettings() {
    var d = E.DEFAULTS;
    return {
      minWords: d.minWords, maxWords: d.maxWords, maxCharsPerLine: d.maxCharsPerLine, maxLines: d.maxLines,
      minDuration: d.minDuration, maxDuration: d.maxDuration, pauseSplit: d.pauseSplit,
      closeGapsUnder: d.closeGapsUnder, gapFrames: 2, offset: 0, language: d.language,
      protectNames: d.protectNames, protectNumbers: d.protectNumbers,
      continuous: d.continuous, splitSentences: d.splitSentences,
      breakAtCommas: d.breakAtCommas, phrasing: d.phrasing, maxCps: d.maxCps,
      splitSpeakers: d.splitSpeakers, removeFillers: d.removeFillers,
      phrases: '', alignMode: 'sequence', scriptText: ''
    };
  }

  function loadSettings() {
    var s = defaultSettings();
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      Object.keys(saved).forEach(function (k) { if (k in s) s[k] = saved[k]; });
      // v1.4: language is detected automatically; switch older saved settings to Auto once.
      if (!saved.autoLanguage) s.language = 'auto';
    } catch (e) { /* ignore */ }
    return s;
  }

  function readSettings() {
    var s = {};
    NUM_FIELDS.forEach(function (k) { s[k] = $(k).value; });
    s.maxLines = $('maxLines').value;
    s.language = $('language').value;
    s.protectNames = $('protectNames').checked;
    s.protectNumbers = $('protectNumbers').checked;
    s.continuous = $('continuous').checked;
    s.splitSentences = $('splitSentences').checked;
    s.breakAtCommas = $('breakAtCommas').checked;
    s.phrasing = $('phrasing').checked;
    s.splitSpeakers = $('splitSpeakers').checked;
    s.removeFillers = $('removeFillers').checked;
    s.phrases = $('phrases').value;
    s.alignMode = $('alignMode').value;
    s.scriptText = $('scriptText').value;
    return s;
  }

  function saveSettings() {
    try {
      var data = readSettings();
      data.autoLanguage = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function applySettings(s) {
    NUM_FIELDS.forEach(function (k) { $(k).value = s[k]; });
    $('maxLines').value = String(s.maxLines);
    $('language').value = s.language;
    $('protectNames').checked = !!s.protectNames;
    $('protectNumbers').checked = !!s.protectNumbers;
    $('continuous').checked = !!s.continuous;
    $('splitSentences').checked = !!s.splitSentences;
    $('breakAtCommas').checked = !!s.breakAtCommas;
    $('phrasing').checked = !!s.phrasing;
    $('splitSpeakers').checked = !!s.splitSpeakers;
    $('removeFillers').checked = !!s.removeFillers;
    updateDisabled();
    $('phrases').value = s.phrases;
    $('alignMode').value = s.alignMode;
    $('scriptText').value = s.scriptText || '';
  }

  /** Gap settings don't apply when captions are continuous. */
  function updateDisabled() {
    var on = $('continuous').checked;
    ['gapFrames', 'closeGapsUnder'].forEach(function (id) {
      $(id).disabled = on;
      ($(id).closest('.setting') || $(id).parentNode).classList.toggle('disabled', on);
    });
  }

  function engineOptions(extraOffset, frameDuration) {
    var s = readSettings();
    var fd = frameDuration || state.frameDuration;
    return {
      language: s.language,
      minWords: s.minWords,
      maxWords: s.maxWords,
      maxCharsPerLine: s.maxCharsPerLine,
      maxLines: s.maxLines,
      minDuration: s.minDuration,
      maxDuration: s.maxDuration,
      pauseSplit: s.pauseSplit,
      closeGapsUnder: s.closeGapsUnder,
      minGap: (parseFloat(s.gapFrames) || 0) * fd,
      offset: (parseFloat(s.offset) || 0) + (extraOffset || 0),
      frameDuration: frameDuration || 0,
      protectNames: s.protectNames,
      protectNumbers: s.protectNumbers,
      continuous: s.continuous,
      splitSentences: s.splitSentences,
      breakAtCommas: s.breakAtCommas,
      phrasing: s.phrasing,
      maxCps: s.maxCps,
      splitSpeakers: s.splitSpeakers,
      removeFillers: s.removeFillers,
      phrases: s.phrases.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
    };
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setInfo(msg, kind) {
    var el = $('sourceInfo');
    el.textContent = msg || '';
    el.className = 'info' + (kind ? ' ' + kind : '');
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function fmtClock(t) {
    t = Math.max(0, Math.round(t));
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function svgIcon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Header colour follows the state: grey → blue (transcript) → green (synced to audio). */
  function updateChrome() {
    var hero = !state.timedText ? '#404040' : state.audioEnv ? '#1e6b3e' : '#2d4a8a';
    document.documentElement.style.setProperty('--hero', hero);
    $('timedBtn').classList.toggle('loaded', !!state.timedText);
    $('audioBtn').classList.toggle('loaded', !!state.audioEnv);
    var script = $('scriptText').value.trim();
    $('scriptTile').classList.toggle('loaded', !!script);
    $('scriptStatus').textContent = script ? script.split(/\s+/).length + ' words · click to edit' : 'Optional · corrected text';
    $('npTitle').textContent = state.timedName || 'No transcript';
    $('npSub').textContent = state.audioName ? '♪ ' + state.audioName : (state.timedText ? 'No audio · add a WAV for exact sync' : 'Drop a file anywhere');
  }

  /** Read a browser File object (file input / drag and drop) with encoding detection. */
  function readFile(file, binary) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(binary ? { name: file.name, bytes: r.result } : { name: file.name, text: E.decodeBytes(new Uint8Array(r.result)) });
      };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  var nativeFs = window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx ? window.cep.fs : null;

  /**
   * Open a file. Inside Premiere this uses Premiere's own dialog with no type
   * filter (the HTML file picker can grey out .srt files on macOS).
   * Resolves to {name, text}, or null if cancelled.
   */
  function pickFile(inputId, title, binary) {
    if (!nativeFs) {
      return new Promise(function (resolve) {
        var input = $(inputId);
        input.onchange = function () {
          var f = input.files[0];
          input.value = '';
          resolve(f ? readFile(f, binary) : null);
        };
        input.click();
      });
    }
    var res = nativeFs.showOpenDialogEx(false, false, title, '', []);
    if (res.err || !res.data || !res.data.length) return Promise.resolve(null);
    var path = res.data[0];
    var name = path.split(/[\\/]/).pop();
    return readPathBytes(path).then(function (buf) {
      return binary ? { name: name, bytes: buf } : { name: name, text: E.decodeBytes(new Uint8Array(buf)) };
    });
  }

  /** Read a local file as an ArrayBuffer (fast path via file:// URL, fallback via CEP). */
  function readPathBytes(path) {
    var url = 'file://' + (path.charAt(0) === '/' ? '' : '/') + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
    return fetch(url).then(function (r) {
      if (!r.ok && r.status !== 0) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (!buf.byteLength) throw new Error('empty');
      return buf;
    }).catch(function () {
      var read = nativeFs.readFile(path, window.cep.encoding.Base64);
      if (read.err) throw new Error('Could not read ' + path + ' (error ' + read.err + ')');
      var bin = atob(read.data), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    });
  }

  /** Analyse an audio file: WAV is read directly; other formats via the browser's decoder. */
  function analyzeAudioFile(file) {
    try {
      return Promise.resolve(E.analyzeWav(file.bytes));
    } catch (wavErr) {
      if (!/Not a WAV/.test(wavErr.message)) return Promise.reject(wavErr);
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return Promise.reject(new Error('This file type can\'t be read here. Export the audio as WAV.'));
      var ctx = new Ctx();
      return new Promise(function (resolve, reject) {
        ctx.decodeAudioData(file.bytes.slice(0), resolve, reject);
      }).then(function (ab) {
        var ch = [];
        for (var c = 0; c < ab.numberOfChannels; c++) ch.push(ab.getChannelData(c));
        if (ctx.close) ctx.close();
        return E.analyzeAudio(ch, ab.sampleRate);
      }, function () {
        if (ctx.close) ctx.close();
        throw new Error('This audio format can\'t be read in Premiere\'s panel. Export the audio as WAV ' +
          '(File → Export → Media → Format: Waveform Audio).');
      });
    }
  }

  function loadAudio(file) {
    if (!file) return;
    $('audioName').textContent = 'Analysing ' + file.name + '…';
    setStatus('Analysing audio…');
    // Let the label repaint before the (synchronous) analysis.
    setTimeout(function () {
      analyzeAudioFile(file).then(function (env) {
        state.audioEnv = env;
        state.audioName = file.name;
        state.prepared = null;
        var mins = Math.floor(env.duration / 60), secs = Math.round(env.duration % 60);
        $('audioName').textContent = file.name + ' · ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
        setStatus('');
        refresh();
      }).catch(function (e) {
        $('audioName').textContent = 'Optional · WAV for exact sync';
        setStatus('');
        fileError(e);
      });
    }, 30);
  }

  function loadTimed(file) {
    if (!file) return;
    state.playing = null;
    state.timedText = file.text;
    state.timedName = file.name;
    state.prepared = null;
    $('timedName').textContent = file.name;
    setInfo('');
    refresh();
  }

  function loadScript(file) {
    if (!file) return;
    $('scriptText').value = file.text;
    refresh();
  }

  function fileError(err) { setInfo('Could not open the file: ' + (err && err.message || err), 'error'); }

  var FLAG_TEXT = {
    short: 'fewer words than the minimum',
    chars: 'a line is longer than the character limit'
  };

  function renderPreview(res) {
    var list = $('captionList');
    list.innerHTML = '';
    updateChrome();
    if (!res) {
      $('stats').textContent = '';
      $('heroSub').textContent = state.timedText ? 'Could not build captions' : 'Load a transcript to get started';
      $('syncBar').style.width = '0';
      $('npLeft').textContent = '0:00';
      $('npRight').textContent = '0:00';
      var empty = el('li', 'empty');
      empty.appendChild(svgIcon('i-captions'));
      empty.appendChild(el('h3', '', 'Your captions will appear here'));
      empty.appendChild(el('p', '', 'Choose a transcript (Premiere JSON, SRT or VTT) or drop it anywhere on the panel.'));
      var cta = el('button', 'cta', 'Choose transcript');
      cta.type = 'button';
      cta.addEventListener('click', function () { $('timedBtn').click(); });
      empty.appendChild(cta);
      list.appendChild(empty);
      return;
    }
    var st = res.stats, caps = res.captions;
    var total = caps.length ? caps[caps.length - 1].end : 0;
    $('heroSub').textContent = state.timedName;
    $('stats').textContent = st.captions + ' captions, ' + fmtClock(total) + ' · avg ' + st.avgWords.toFixed(1) + ' words' +
      (st.flagged ? ' · ' + st.flagged + ' flagged' : '') +
      (st.estimated ? ' · ' + st.estimated + ' estimated' : '') +
      (res.languageDetected ? ' · ' + E.LANGS[res.language].name : '');
    // Bottom bar: share of caption starts that sit on a clear sound.
    var ratio = st.audioSynced ? st.audioAnchored / Math.max(1, st.captions) : 0;
    $('syncBar').style.width = (ratio * 100).toFixed(1) + '%';
    $('npLeft').textContent = caps.length ? fmtClock(caps[0].start) : '0:00';
    $('npRight').textContent = fmtClock(total);
    $('syncBar').parentNode.parentNode.title = st.audioSynced
      ? st.audioAnchored + ' of ' + st.captions + ' caption starts sit on a clear sound in the audio'
      : 'Add the audio (WAV) to sync captions to the sound';

    var frag = document.createDocumentFragment();
    caps.forEach(function (c, i) {
      var li = el('li', 'track' + (cep ? ' jumpable' : '') + (state.playing === i ? ' playing' : ''));
      li.dataset.index = i;

      var num = el('div', 'idx');
      num.appendChild(el('span', '', String(i + 1)));
      num.appendChild(svgIcon('i-play'));
      li.appendChild(num);

      var title = el('div', 'title');
      title.appendChild(el('div', 'text', c.lines.join('\n')));
      var meta = el('div', 'meta');
      if (c.audioAnchored) { var b = el('span', 'badge synced', '♪'); b.title = 'Starts exactly where the word begins in the audio'; meta.appendChild(b); }
      else if (c.estimatedStart) { var be = el('span', 'badge est', '≈'); be.title = 'Estimated: starts in the middle of a line of the source file'; meta.appendChild(be); }
      else if (c.audioSynced) { var ba = el('span', 'badge', '♪'); ba.title = 'Timed from the audio; words run together here'; meta.appendChild(ba); }
      meta.appendChild(el('span', '', c.wordCount + (c.wordCount === 1 ? ' word' : ' words')));
      if (c.flags.length) {
        meta.appendChild(el('span', 'badge flag', '!'));
        meta.appendChild(el('span', 'flagtext', c.flags.map(function (f) {
          if (FLAG_TEXT[f]) return FLAG_TEXT[f];
          if (f.indexOf('long') === 0) return 'more words than the maximum' + f.slice(4);
          if (f.indexOf('fast') === 0) return 'reading speed too fast (' + f.slice(5) + ')';
          return f;
        }).join(' · ')));
      }
      title.appendChild(meta);
      li.appendChild(title);

      li.appendChild(el('div', 'start', fmtTime(c.start)));
      li.appendChild(el('div', 'dur', (c.end - c.start).toFixed(2) + 's'));
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  /** Click a caption: move Premiere's playhead to it. */
  function jumpTo(index) {
    if (!state.result || !state.result.captions[index]) return;
    var prev = $('captionList').querySelector('.track.playing');
    if (prev) prev.classList.remove('playing');
    var row = $('captionList').querySelector('.track[data-index="' + index + '"]');
    if (row) row.classList.add('playing');
    state.playing = index;
    if (!cep) return;
    var c = state.result.captions[index];
    evalJSX('sc_getSequenceInfo()').then(function (info) {
      if (!info.ok) throw new Error(info.error);
      var mode = $('alignMode').value, extra = 0;
      if (mode === 'clip' && info.clipOffset !== null && info.clipOffset !== undefined) extra = info.clipOffset;
      if (mode === 'playhead') extra = state.placedAtPlayhead || 0;
      return evalJSX('sc_setPlayhead(' + (c.start + extra) + ')');
    }).then(function (r) {
      if (r && !r.ok) throw new Error(r.error);
      setStatus('▶ ' + c.text.slice(0, 60));
    }).catch(function (e) { setStatus(e.message, 'error'); });
  }

  // ---------------------------------------------------------------------------
  // Core actions
  // ---------------------------------------------------------------------------

  function prepare() {
    var script = $('scriptText').value;
    var language = $('language').value;
    var key = [state.timedName, state.timedText ? state.timedText.length : 0, script, state.audioName, language].join('\u0000');
    if (state.prepared && state.preparedKey === key) return state.prepared;
    state.prepared = E.prepareWords(state.timedText, script, state.audioEnv, language);
    state.preparedKey = key;
    var p = state.prepared;
    var msg = p.format + ' · ' + p.words.length + ' words';
    var kind = '';
    if (state.audioEnv) {
      msg += '\nAudio sync: ' + p.audioWords + ' of ' + p.words.length + ' words timed from the audio, ' +
        p.audioAnchored + ' start on a clear sound';
      if (p.wordsAfterAudio) { kind = 'warn'; msg += '\n' + p.wordsAfterAudio + ' words are after the end of the audio file.'; }
      if (p.kind === 'cues') msg += ' (for the most exact result use a word-level JSON transcript)';
      if (p.audioOffset) msg += ' · transcript was shifted ' + (p.audioOffset > 0 ? '+' : '') + p.audioOffset.toFixed(3) + ' s to match the audio';
      if (p.audioTooShort) { kind = 'warn'; msg += '\nThe audio is shorter than the transcript – is it the right file?'; }
      if (p.audioWords < p.words.length * 0.5) {
        kind = 'warn';
        msg += '\nFew words matched the audio. The audio must start at the same point as the transcript ' +
          '(export the audio of the same sequence or clip you transcribed).';
      }
    } else if (p.kind === 'cues') {
      kind = 'warn';
      msg += '\nThis file only has a time per line, not per word. Captions that start in the middle of a line ' +
        'have estimated times (marked ≈). For exact sync, load a transcript with word timings: in Premiere, ' +
        'Text panel → Transcript → … menu → Export → JSON, then choose that file here. Adding the audio (WAV) ' +
        'below also makes the timing much more accurate.';
    }
    if (p.alignment) {
      var pct = Math.round(p.alignment.ratio * 100);
      msg += ' · script matched ' + pct + '%';
      if (pct < 60) { kind = 'warn'; msg += ' – the script may not belong to this transcript'; }
    }
    setInfo(msg, kind);
    return p;
  }

  function refresh() {
    updateDisabled();
    saveSettings();
    if (!state.timedText) { renderPreview(null); toggleButtons(false); return; }
    try {
      var p = prepare();
      state.result = E.buildCaptions(p.words, engineOptions(0));
      renderPreview(state.result);
      toggleButtons(true);
      setStatus('');
    } catch (e) {
      state.result = null;
      state.prepared = null;
      renderPreview(null);
      toggleButtons(false);
      setInfo('Could not read "' + state.timedName + '": ' + e.message, 'error');
    }
  }

  var refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  }

  function toggleButtons(on) {
    $('createBtn').disabled = !on;
    $('saveBtn').disabled = !on;
  }

  function timestampName() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var base = (state.timedName || 'captions').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40);
    return base + '_captions_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.srt';
  }

  /** Build the final captions, placed according to the "Placement" settings. */
  function buildForSequence(info) {
    var mode = $('alignMode').value, extra = 0;
    if (mode === 'clip') {
      if (!info || info.clipOffset === null || info.clipOffset === undefined) {
        throw new Error('Select the clip the transcript belongs to in the Timeline (or change "Transcript time 0 is at").');
      }
      extra = info.clipOffset;
    } else if (mode === 'playhead') {
      extra = info ? info.playhead : 0;
      state.placedAtPlayhead = extra;
    }
    var fd = info && info.frameDuration > 0 ? info.frameDuration : 0;
    if (fd) state.frameDuration = fd;
    var res = E.buildCaptions(prepare().words, engineOptions(extra, fd));
    if (!res.captions.length) throw new Error('All captions fall before the start of the sequence. Check the placement/offset.');
    return res;
  }

  function createTrack() {
    setStatus('Creating caption track…');
    toggleButtons(false);
    $('createBtn').classList.add('busy');
    evalJSX('sc_getSequenceInfo()').then(function (info) {
      if (!info.ok) throw new Error(info.error);
      var res = buildForSequence(info);
      var srt = E.toSRT(res.captions, '\n');
      return evalJSX('sc_createCaptionTrack(' + jsxString(srt) + ',' + '"' + timestampName() + '"' + ')')
        .then(function (r) {
          if (!r.ok) throw new Error(r.error);
          setStatus('Created ' + res.captions.length + ' captions on "' + r.sequence + '". SRT saved to ' + r.path, 'ok');
        });
    }).catch(function (e) {
      setStatus(e.message, 'error');
    }).then(function () { toggleButtons(!!state.result); $('createBtn').classList.remove('busy'); });
  }

  function saveSrt() {
    var finish = function (res) {
      var srt = E.toSRT(res.captions, cep ? '\n' : '\r\n');
      if (!cep) {   // browser preview: download the file
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + srt], { type: 'application/x-subrip' }));
        a.download = timestampName();
        a.click();
        setStatus('SRT downloaded.', 'ok');
        return null;
      }
      return evalJSX('sc_saveSRT(' + jsxString(srt) + ',"' + timestampName() + '")').then(function (r) {
        if (r.cancelled) { setStatus(''); return; }
        if (!r.ok) throw new Error(r.error);
        setStatus('Saved ' + r.path, 'ok');
      });
    };
    var p = cep
      ? evalJSX('sc_getSequenceInfo()').then(function (info) { return finish(buildForSequence(info.ok ? info : null)); })
      : Promise.resolve().then(function () { return finish(buildForSequence(null)); });
    p.catch(function (e) { setStatus(e.message, 'error'); });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function init() {
    var langSel = $('language');
    var autoOpt = document.createElement('option');
    autoOpt.value = 'auto'; autoOpt.textContent = 'Auto-detect';
    langSel.appendChild(autoOpt);
    Object.keys(E.LANGS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = E.LANGS[k].name;
      langSel.appendChild(o);
    });
    applySettings(loadSettings());
    renderPreview(null);

    $('timedBtn').addEventListener('click', function () {
      pickFile('timedFile', 'Choose the timed transcript (SRT, VTT, JSON, TXT)').then(loadTimed, fileError);
    });
    $('scriptBtn').addEventListener('click', function () {
      pickFile('scriptFile', 'Choose the script (plain text)').then(loadScript, fileError);
    });

    // Drag and drop: onto the script box = script, anywhere else = timed transcript.
    document.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      document.body.classList.add('dragging');
    });
    document.addEventListener('dragleave', function (ev) {
      if (!ev.relatedTarget) document.body.classList.remove('dragging');
    });
    document.addEventListener('drop', function (ev) {
      ev.preventDefault();
      document.body.classList.remove('dragging');
      var f = ev.dataTransfer && ev.dataTransfer.files[0];
      if (!f) return;
      if (/\.(wav|wave|mp3|m4a|aac|aif|aiff)$/i.test(f.name)) { readFile(f, true).then(loadAudio, fileError); return; }
      var toScript = ev.target === $('scriptText');
      readFile(f).then(toScript ? loadScript : loadTimed, fileError);
    });

    $('clearScript').addEventListener('click', function () { $('scriptText').value = ''; refresh(); });

    $('scriptTile').addEventListener('click', function () {
      var panel = $('scriptPanel');
      panel.hidden = !panel.hidden;
      $('scriptTile').classList.toggle('active', !panel.hidden);
      if (!panel.hidden) $('scriptText').focus();
    });
    // Tiles behave like buttons for the keyboard too.
    ['timedBtn', 'scriptTile', 'audioBtn'].forEach(function (id) {
      $(id).addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $(id).click(); }
      });
    });
    $('captionList').addEventListener('click', function (ev) {
      var row = ev.target.closest('.track');
      if (row) jumpTo(+row.dataset.index);
    });

    $('audioBtn').addEventListener('click', function () {
      pickFile('audioFile', 'Choose the audio (WAV) of the same sequence or clip', true).then(loadAudio, fileError);
    });
    $('clearAudio').addEventListener('click', function (ev) {
      ev.stopPropagation();
      state.audioEnv = null; state.audioName = ''; state.prepared = null;
      $('audioName').textContent = 'Optional · WAV for exact sync';
      refresh();
    });

    $('resetPhrases').addEventListener('click', function () {
      var l = E.LANGS[$('language').value];
      $('phrases').value = l ? l.phrases.join('\n') : '';
      refresh();
    });

    $('language').addEventListener('change', function () {
      // Swap the phrase list if it is still the previous language's default.
      var current = $('phrases').value.trim();
      var isDefault = Object.keys(E.LANGS).some(function (k) { return E.LANGS[k].phrases.join('\n') === current; });
      var lang = E.LANGS[$('language').value];
      if (isDefault || !current) $('phrases').value = lang ? lang.phrases.join('\n') : '';
      refresh();
    });

    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'file' || el.id === 'language') return;
      el.addEventListener('input', scheduleRefresh);
      el.addEventListener('change', scheduleRefresh);
    });

    $('createBtn').addEventListener('click', createTrack);
    $('saveBtn').addEventListener('click', saveSrt);

    if (cep && window.Updater) {
      // Install updates automatically on open, but never reload away a loaded transcript.
      window.Updater.start({ statusEl: $('updateStatus'), canReload: function () { return !state.timedText; } });
    }

    if (cep) {
      evalJSX('sc_getSequenceInfo()').then(function (info) {
        if (info.ok) {
          $('seqName').textContent = info.name;
          $('createBtn').title = 'Create caption track on "' + info.name + '"';
          state.frameDuration = info.frameDuration || state.frameDuration;
        }
      });
    } else {
      $('createBtn').title = 'Available inside Premiere Pro';
      setStatus('Preview mode – creating the caption track works inside Premiere Pro');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
}());
