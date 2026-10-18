# Frequency Oasis — MIDI DNA

A local-first MIDI analysis and playback app. No build step, no dependencies, nothing is uploaded.

**Run it:** serve this folder over http (`python3 -m http.server`) and open `index.html`. Opening via `file://` also works but disables the service worker and runs analysis on the main thread. Installable as a PWA when served over https/localhost.

**Tests:** `node test-parser.js` (MIDI parser, 22 checks).

**Honest limits:** MIDI has no timbre; playback is a built-in synthesiser, not the original sounds. Key, chords, mood, structure and track roles are heuristic estimates with shown evidence. No audio import, no MPE/MIDI 2.0, no MIDI editing beyond the labelled transposed copy.

All files are flat in this one folder.
