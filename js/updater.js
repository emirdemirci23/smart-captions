/*
 * Smart Captions – self-updater.
 *
 * On panel open it asks GitHub for the latest commit of the repository named
 * in update-config.json, compares that commit's version.json with the local
 * one and, if newer, downloads the listed files into the extension folder,
 * re-loads the ExtendScript and reloads the panel.
 *
 * Files are fetched by commit SHA (raw.githubusercontent.com/<repo>/<sha>/...)
 * so a half-cached mix of old and new files is impossible.
 */
(function (root) {
  'use strict';

  var CHECK_EVERY_MS = 30 * 60 * 1000;

  function cepFs() { return root.cep && root.cep.fs ? root.cep.fs : null; }

  function extensionPath() {
    var a = root.__adobe_cep__;
    if (!a || !a.getSystemPath) return null;
    var p = decodeURI(a.getSystemPath('extension'));
    return /^Win/i.test(navigator.platform) ? p.replace(/^file:\/\/\//, '') : p.replace(/^file:\/\//, '');
  }

  function readLocalText(rel) {
    var fs = cepFs(), base = extensionPath();
    if (!fs || !base) return null;
    var r = fs.readFile(base + '/' + rel);
    return r.err ? null : String(r.data).replace(/^﻿/, '');
  }

  function readLocalJSON(rel) {
    try { return JSON.parse(readLocalText(rel)); } catch (e) { return null; }
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('GitHub returned HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function compareVersions(a, b) {
    var x = String(a || '0').split('.'), y = String(b || '0').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function safePath(p) {
    return typeof p === 'string' && p && !/^[\/\\]|^[a-z]:|\.\.|[<>|"?*]/i.test(p);
  }

  function toBase64(buf) {
    var bytes = new Uint8Array(buf), out = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }

  function config() {
    var cfg = readLocalJSON('update-config.json');
    return cfg && cfg.repo ? { repo: cfg.repo, branch: cfg.branch || 'main' } : null;
  }

  function localVersion() {
    var v = readLocalJSON('version.json');
    return v ? v.version : '0.0.0';
  }

  /** Resolves to { available, current, latest, sha, remote } or { disabled: true }. */
  function check() {
    var cfg = config();
    if (!cfg || !extensionPath() || !cepFs()) return Promise.resolve({ disabled: true });
    var current = localVersion();
    return getJSON('https://api.github.com/repos/' + cfg.repo + '/commits/' + encodeURIComponent(cfg.branch))
      .then(function (commit) {
        var sha = commit.sha;
        var raw = 'https://raw.githubusercontent.com/' + cfg.repo + '/' + sha + '/';
        return getJSON(raw + 'version.json').then(function (remote) {
          return {
            available: compareVersions(remote.version, current) > 0,
            current: current,
            latest: remote.version,
            notes: remote.notes || '',
            sha: sha,
            raw: raw,
            remote: remote
          };
        });
      });
  }

  /** Download every file first; only write them once all downloads succeeded. */
  function install(info) {
    var fs = cepFs(), base = extensionPath();
    var files = (info.remote.files || []).filter(safePath);
    if (!files.length) return Promise.reject(new Error('The update lists no files.'));
    return Promise.all(files.map(function (f) {
      return fetch(info.raw + f, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('Could not download ' + f + ' (HTTP ' + r.status + ')');
        return r.arrayBuffer();
      });
    })).then(function (bufs) {
      var oldManifest = (readLocalText('CSXS/manifest.xml') || '').replace(/\s+/g, ' ').trim();
      var newManifest = null;
      files.forEach(function (f, i) {
        if (f === 'CSXS/manifest.xml') newManifest = new TextDecoder().decode(bufs[i]).replace(/^﻿/, '').replace(/\s+/g, ' ').trim();
      });
      files.forEach(function (f, i) {
        var parts = f.split('/'), dir = base;
        for (var k = 0; k < parts.length - 1; k++) { dir += '/' + parts[k]; fs.makedir(dir); }
        var res = fs.writeFile(base + '/' + f, toBase64(bufs[i]), root.cep.encoding.Base64);
        if (res.err) throw new Error('Could not write ' + f + ' (error ' + res.err + ')');
      });
      // version.json last: if anything above failed, the next check retries.
      var vres = fs.writeFile(base + '/version.json', JSON.stringify(info.remote, null, 2), root.cep.encoding.UTF8);
      if (vres.err) throw new Error('Could not write version.json (error ' + vres.err + ')');
      return { restartRequired: newManifest !== null && newManifest !== oldManifest };
    });
  }

  function reloadPanel() {
    var jsx = extensionPath() + '/jsx/host.jsx';
    root.__adobe_cep__.evalScript('$.evalFile(new File(' + JSON.stringify(jsx) + '))', function () {
      root.location.reload();
    });
  }

  /**
   * Wire the updater to a status element.
   *   opts.statusEl   – element showing the version / update state
   *   opts.canReload  – function: true if reloading now won't lose the user's work
   */
  function start(opts) {
    var el = opts.statusEl;
    var busy = false;
    var show = function (text, title, onClick) {
      if (!el) return;
      el.textContent = text;
      el.title = title || '';
      el.onclick = onClick || null;
      el.className = 'update' + (onClick ? ' action' : '');
    };
    show('v' + localVersion(), 'Smart Captions version');
    if (!config()) return;

    var doInstall = function (info) {
      busy = true;
      show('Updating to v' + info.latest + '…');
      install(info).then(function (r) {
        if (r.restartRequired) {
          show('v' + info.latest + ' installed – restart Premiere', 'This update changed the extension manifest; restart Premiere Pro to finish.');
        } else {
          show('Updated to v' + info.latest + ' – reloading…');
          setTimeout(reloadPanel, 600);
        }
      }).catch(function (e) {
        busy = false;
        show('Update failed – retry', e.message, function () { doInstall(info); });
      });
    };

    var run = function (auto) {
      if (busy) return;
      check().then(function (info) {
        if (info.disabled) return;
        if (!info.available) { show('v' + info.current, 'Up to date (checked ' + new Date().toLocaleTimeString() + ')'); return; }
        var tip = 'v' + info.latest + ' is available' + (info.notes ? ': ' + info.notes : '') + '. Click to install.';
        if (auto && (!opts.canReload || opts.canReload())) doInstall(info);
        else show('Update to v' + info.latest, tip, function () { doInstall(info); });
      }).catch(function (e) {
        show('v' + localVersion(), 'Could not check for updates: ' + e.message);
      });
    };

    run(true);
    setInterval(function () { run(false); }, CHECK_EVERY_MS);
  }

  root.Updater = { start: start, check: check, install: install, compareVersions: compareVersions };
}(typeof window !== 'undefined' ? window : this));
