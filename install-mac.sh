#!/bin/bash
# Installs Smart Captions for Premiere Pro on macOS (unsigned extension, debug mode).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/smart-captions"
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/css" "$SRC/js" "$SRC/jsx" "$SRC/index.html" "$SRC/.debug" "$SRC/version.json" "$SRC/update-config.json" "$DEST/"
echo "Installed to: $DEST"
echo "Restart Premiere Pro, then open Window > Extensions > Smart Captions."
