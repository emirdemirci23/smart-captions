# Smart Captions – notes for Claude

Premiere Pro CEP panel that turns a transcript into synchronized captions.
See README.md for features and layout.

## Releasing a change (required for every change to the panel)

Installed panels update themselves from this repo's `main` branch, but **only
when `version.json` has a higher version**. So for every change to a runtime file
(`index.html`, `css/`, `js/`, `jsx/`, `CSXS/manifest.xml`):

1. `npm test` – must pass.
2. `node tools/release.js "short description of the change"` (add `minor` for features).
   This bumps the version and refreshes the file list in `version.json`.
3. Commit and push to `main`.

Changes to tests, tools, samples, README or installers don't need a version bump.
Changing `CSXS/manifest.xml` forces users to restart Premiere – avoid it unless necessary.

## Constraints

- `jsx/host.jsx` is ExtendScript (ES3): no let/const, arrow functions, template strings or JSON.
- `js/caption-engine.js` must keep working in both the panel and Node (tests, CLI).
