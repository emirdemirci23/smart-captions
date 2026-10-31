#!/usr/bin/env node
/*
 * Prepare a new version for the auto-updater: bumps version.json and lists the
 * files the panel should download. Run before committing/pushing a change.
 *
 *   node tools/release.js "what changed"          # bump patch (1.1.0 -> 1.1.1)
 *   node tools/release.js "what changed" minor    # bump minor (1.1.0 -> 1.2.0)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// Everything the panel needs at runtime (no tests, tools, samples, installers).
const INCLUDE = ['index.html', 'css', 'js', 'jsx', 'CSXS/manifest.xml'];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).sort().flatMap((n) => walk(path.posix.join(rel, n)));
}

const vfile = path.join(ROOT, 'version.json');
const current = fs.existsSync(vfile) ? JSON.parse(fs.readFileSync(vfile, 'utf8')) : { version: '1.0.0' };
const [notes = '', level = 'patch'] = process.argv.slice(2);
const v = current.version.split('.').map(Number);
if (level === 'major') { v[0]++; v[1] = 0; v[2] = 0; } else if (level === 'minor') { v[1]++; v[2] = 0; } else v[2]++;

const next = {
  version: v.join('.'),
  date: new Date().toISOString().slice(0, 10),
  notes,
  files: INCLUDE.flatMap(walk),
};
fs.writeFileSync(vfile, JSON.stringify(next, null, 2) + '\n');
console.log(`version ${current.version} -> ${next.version} (${next.files.length} files)`);
