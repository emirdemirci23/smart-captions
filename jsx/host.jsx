/*
 * Smart Captions – ExtendScript side (runs inside Premiere Pro).
 * ExtendScript is ES3: no let/const, no arrow functions, no JSON object.
 */

var SC_TICKS_PER_SECOND = 254016000000;

function sc_quote(str) {
    return '"' + String(str)
        .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

/** Minimal JSON serializer for flat objects (strings, numbers, booleans, null). */
function sc_json(obj) {
    var parts = [];
    for (var k in obj) {
        if (!obj.hasOwnProperty(k)) continue;
        var v = obj[k], out;
        if (v === null || v === undefined) out = 'null';
        else if (typeof v === 'number') out = isFinite(v) ? String(v) : 'null';
        else if (typeof v === 'boolean') out = v ? 'true' : 'false';
        else out = sc_quote(v);
        parts.push(sc_quote(k) + ':' + out);
    }
    return '{' + parts.join(',') + '}';
}

function sc_error(msg) { return sc_json({ ok: false, error: String(msg) }); }

/** Information the panel needs to place captions on the active sequence. */
function sc_getSequenceInfo() {
    try {
        if (!app.project) return sc_error('No project is open.');
        var seq = app.project.activeSequence;
        if (!seq) return sc_error('No active sequence. Open a sequence in the Timeline first.');

        var frameDuration = parseFloat(seq.timebase) / SC_TICKS_PER_SECOND;
        var playhead = seq.getPlayerPosition().seconds;

        // Selected clip: transcript time 0 = start of that clip's source media.
        var clipOffset = null, clipName = '';
        var sel = seq.getSelection();
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) {
                var c = sel[i];
                if (c && c.start && c.inPoint) {
                    clipOffset = c.start.seconds - c.inPoint.seconds;
                    clipName = c.name;
                    break;
                }
            }
        }
        return sc_json({
            ok: true,
            name: seq.name,
            frameDuration: frameDuration,
            playhead: playhead,
            clipOffset: clipOffset,
            clipName: clipName
        });
    } catch (e) {
        return sc_error(e);
    }
}

function sc_captionFolder() {
    var base = null;
    try {
        if (app.project.path) base = new File(app.project.path).parent;
    } catch (e) { base = null; }
    if (!base || !base.exists) base = Folder.myDocuments;
    var folder = new Folder(base.fsName + '/Smart Captions');
    if (!folder.exists) folder.create();
    return folder;
}

function sc_writeText(file, content) {
    file.encoding = 'UTF-8';
    file.lineFeed = 'Windows';
    if (!file.open('w')) return false;
    file.write('﻿' + content);
    file.close();
    return true;
}

function sc_normPath(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }

function sc_findItemByPath(parent, wanted) {
    if (!parent || !parent.children) return null;
    for (var i = 0; i < parent.children.numItems; i++) {
        var child = parent.children[i];
        if (!child) continue;
        if (child.type === 2) { // ProjectItemType.BIN
            var found = sc_findItemByPath(child, wanted);
            if (found) return found;
        } else {
            try {
                if (sc_normPath(child.getMediaPath()) === wanted) return child;
            } catch (e) { /* items without media */ }
        }
    }
    return null;
}

/**
 * Write the SRT next to the project, import it and create a caption track on
 * the active sequence. `encodedSrt` is encodeURIComponent()-encoded.
 */
function sc_createCaptionTrack(encodedSrt, fileName) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return sc_error('No active sequence. Open a sequence in the Timeline first.');
        if (typeof seq.createCaptionTrack !== 'function') {
            return sc_error('This Premiere Pro version cannot create caption tracks from scripts. Use "Save SRT" and import it manually.');
        }

        var file = new File(sc_captionFolder().fsName + '/' + fileName);
        if (!sc_writeText(file, decodeURIComponent(encodedSrt))) return sc_error('Could not write ' + file.fsName);

        var bin = app.project.getInsertionBin ? app.project.getInsertionBin() : app.project.rootItem;
        app.project.importFiles([file.fsName], true, bin, false);

        var wanted = sc_normPath(file.fsName);
        var item = sc_findItemByPath(bin, wanted) || sc_findItemByPath(app.project.rootItem, wanted);
        if (!item) return sc_error('The SRT was saved to ' + file.fsName + ' but could not be found in the project after import.');

        var format = (typeof Sequence !== 'undefined' && Sequence.CAPTION_FORMAT_SUBTITLE !== undefined)
            ? Sequence.CAPTION_FORMAT_SUBTITLE : 'Subtitle';
        var ok = seq.createCaptionTrack(item, 0, format);
        if (ok === false) return sc_error('Premiere refused to create the caption track. The SRT is at ' + file.fsName);

        return sc_json({ ok: true, path: file.fsName, sequence: seq.name });
    } catch (e) {
        return sc_error(e);
    }
}

/** Ask the user where to save the SRT and write it there. */
function sc_saveSRT(encodedSrt, defaultName) {
    try {
        var start = new File(sc_captionFolder().fsName + '/' + defaultName);
        var target = start.saveDlg('Save captions as SRT', $.os.indexOf('Windows') >= 0 ? 'SubRip captions:*.srt' : undefined);
        if (!target) return sc_json({ ok: false, cancelled: true });
        if (!/\.srt$/i.test(target.name)) target = new File(target.fsName + '.srt');
        if (!sc_writeText(target, decodeURIComponent(encodedSrt))) return sc_error('Could not write ' + target.fsName);
        return sc_json({ ok: true, path: target.fsName });
    } catch (e) {
        return sc_error(e);
    }
}

/** Move the playhead to a time (seconds from the sequence start). */
function sc_setPlayhead(seconds) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return sc_error('No active sequence.');
        var ticks = Math.round(Math.max(0, seconds) * SC_TICKS_PER_SECOND);
        seq.setPlayerPosition(String(ticks));
        return sc_json({ ok: true });
    } catch (e) {
        return sc_error(e);
    }
}
