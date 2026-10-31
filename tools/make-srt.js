#!/usr/bin/env node
/*
 * Command-line version of Smart Captions (no Premiere needed).
 *
 *   node tools/make-srt.js transcript.json [options] > captions.srt
 *
 * Options:
 *   --script FILE      corrected plain-text script (words from here, timings from the transcript)
 *   --min N            minimum words per caption        (default 3)
 *   --max N            maximum words per caption        (default 8)
 *   --chars N          maximum characters per line      (default 42)
 *   --lines 1|2        lines per caption                (default 2)
 *   --lang en|tr|other language rules                   (default en)
 *   --phrases FILE     keep-together phrases, one per line (replaces the language defaults)
 *   --offset SECONDS   shift all captions
 *   --out FILE         write to a file instead of stdout
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'caption-engine.js'));

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*/, '').replace(/^ \* ?/gm, ''));
  process.exit(args.length ? 0 : 1);
}
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const input = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));

const options = {
  minWords: opt('min'), maxWords: opt('max'), maxCharsPerLine: opt('chars'), maxLines: opt('lines'),
  language: opt('lang'), offset: opt('offset'),
};
if (opt('phrases')) options.phrases = fs.readFileSync(opt('phrases'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

try {
  const res = E.generate({
    timedText: fs.readFileSync(input, 'utf8'),
    scriptText: opt('script') ? fs.readFileSync(opt('script'), 'utf8') : '',
    options,
  });
  const srt = E.toSRT(res.captions);
  if (opt('out')) fs.writeFileSync(opt('out'), '﻿' + srt); else process.stdout.write(srt);
  let msg = `${res.format}: ${res.stats.captions} captions, avg ${res.stats.avgWords.toFixed(1)} words`;
  if (res.alignment) msg += `, script matched ${Math.round(res.alignment.ratio * 100)}%`;
  if (res.stats.flagged) msg += `, ${res.stats.flagged} flagged`;
  console.error(msg);
  res.captions.filter((c) => c.flags.length).forEach((c) => console.error(`  #${c.index} [${c.flags.join(', ')}] ${c.text}`));
} catch (e) {
  console.error('Error: ' + e.message);
  process.exit(1);
}
