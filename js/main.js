/* Smart Captions – panel UI */
(function () {
  'use strict';

  var E = window.CaptionEngine;
  var cep = window.__adobe_cep__ || null;   // present only inside Premiere Pro
  var STORAGE_KEY = 'smartCaptions.settings.v1';

  var $ = function (id) { return document.getElementById(id); };
  var NUM_FIELDS = ['minWords', 'maxWords', 'maxCharsPerLine', 'minDuration', 'maxDuration',
    'pauseSplit', 'closeGapsUnder', 'gapFrames', 'offset'];

  var state = {
    timedText: null,
    timedName: '',
    prepared: null,       // cached result of E.prepareWords
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
      phrases: E.LANGS[d.language].phrases.join('\n'), alignMode: 'sequence', scriptText: ''
    };
  }

  function loadSettings() {
    var s = defaultSettings();
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      Object.keys(saved).forEach(function (k) { if (k in s) s[k] = saved[k]; });
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
    s.phrases = $('phrases').value;
    s.alignMode = $('alignMode').value;
    s.scriptText = $('scriptText').value;
    return s;
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readSettings())); } catch (e) { /* ignore */ }
  }

  function applySettings(s) {
    NUM_FIELDS.forEach(function (k) { $(k).value = s[k]; });
    $('maxLines').value = String(s.maxLines);
    $('language').value = s.language;
    $('protectNames').checked = !!s.protectNames;
    $('protectNumbers').checked = !!s.protectNumbers;
    $('phrases').value = s.phrases;
    $('alignMode').value = s.alignMode;
    $('scriptText').value = s.scriptText || '';
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

  /** Read a browser File object (file input / drag and drop) with encoding detection. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve({ name: file.name, text: E.decodeBytes(new Uint8Array(r.result)) }); };
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
  function pickFile(inputId, title) {
    if (!nativeFs) {
      return new Promise(function (resolve) {
        var input = $(inputId);
        input.onchange = function () {
          var f = input.files[0];
          input.value = '';
          resolve(f ? readFile(f) : null);
        };
        input.click();
      });
    }
    return new Promise(function (resolve, reject) {
      var res = nativeFs.showOpenDialogEx(false, false, title, '', []);
      if (res.err || !res.data || !res.data.length) { resolve(null); return; }
      var path = res.data[0];
      var read = nativeFs.readFile(path, window.cep.encoding.Base64);
      if (read.err) { reject(new Error('Could not read ' + path + ' (error ' + read.err + ')')); return; }
      var bin = atob(read.data), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve({ name: path.split(/[\\/]/).pop(), text: E.decodeBytes(bytes) });
    });
  }

  function loadTimed(file) {
    if (!file) return;
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

  function renderPreview(res) {
    var list = $('captionList');
    list.innerHTML = '';
    if (!res) {
      $('stats').textContent = '';
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Choose a timed transcript to see the captions here.';
      list.appendChild(empty);
      return;
    }
    var st = res.stats;
    $('stats').textContent = st.captions + ' captions · avg ' + st.avgWords.toFixed(1) + ' words' +
      (st.flagged ? ' · ' + st.flagged + ' flagged' : '');
    var frag = document.createDocumentFragment();
    res.captions.forEach(function (c) {
      var li = document.createElement('li');
      if (c.flags.length) li.className = 'flagged';
      var time = document.createElement('span');
      time.className = 'time';
      time.textContent = fmtTime(c.start) + '\n' + fmtTime(c.end);
      time.style.whiteSpace = 'pre';
      var text = document.createElement('span');
      text.className = 'text';
      text.textContent = c.lines.join('\n');
      var count = document.createElement('span');
      count.className = 'count';
      count.textContent = c.wordCount;
      count.title = c.wordCount + ' words';
      li.appendChild(time); li.appendChild(text); li.appendChild(count);
      if (c.flags.length) {
        var flag = document.createElement('span');
        flag.className = 'flag';
        flag.textContent = c.flags.map(function (f) {
          if (f === 'short') return 'fewer words than the minimum (pause, sentence end or forced break)';
          if (f === 'chars') return 'a line is longer than the character limit';
          if (f.indexOf('long') === 0) return 'more words than the maximum' + f.slice(4);
          return f;
        }).join(' · ');
        li.appendChild(flag);
      }
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // Core actions
  // ---------------------------------------------------------------------------

  function prepare() {
    var script = $('scriptText').value;
    var key = state.timedName + '\u0000' + (state.timedText ? state.timedText.length : 0) + '\u0000' + script;
    if (state.prepared && state.preparedKey === key) return state.prepared;
    state.prepared = E.prepareWords(state.timedText, script);
    state.preparedKey = key;
    var p = state.prepared;
    var msg = p.format + ' · ' + p.words.length + ' words';
    var kind = '';
    if (p.kind === 'cues') msg += ' · word times estimated from segment timings';
    if (p.alignment) {
      var pct = Math.round(p.alignment.ratio * 100);
      msg += ' · script matched ' + pct + '%';
      if (pct < 60) { kind = 'warn'; msg += ' – the script may not belong to this transcript'; }
    }
    setInfo(msg, kind);
    return p;
  }

  function refresh() {
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
    }).then(function () { toggleButtons(!!state.result); });
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
      var toScript = ev.target === $('scriptText');
      readFile(f).then(toScript ? loadScript : loadTimed, fileError);
    });

    $('clearScript').addEventListener('click', function () { $('scriptText').value = ''; refresh(); });

    $('resetPhrases').addEventListener('click', function () {
      $('phrases').value = E.LANGS[$('language').value].phrases.join('\n');
      refresh();
    });

    $('language').addEventListener('change', function () {
      // Swap the phrase list if it is still the previous language's default.
      var current = $('phrases').value.trim();
      var isDefault = Object.keys(E.LANGS).some(function (k) { return E.LANGS[k].phrases.join('\n') === current; });
      if (isDefault || !current) $('phrases').value = E.LANGS[$('language').value].phrases.join('\n');
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
          state.frameDuration = info.frameDuration || state.frameDuration;
        }
      });
    } else {
      $('createBtn').title = 'Available inside Premiere Pro';
      setStatus('Browser preview mode – "Create caption track" works inside Premiere Pro.', '');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
}());
