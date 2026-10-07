# A Million Badguys

A voxel lane-defense arcade game in a single HTML file. Red crowd marches
down the lane; your mob slides side-to-side, everything fires straight ahead.
Positioning IS the aiming.

**Play it:** https://pete1450.github.io/a-million-badguys/ (after Pages is enabled)

## Repo layout

- `build/` — the actual sources:
  - `head.html` — HTML shell + CSS + HUD (ends with an open `<script>` tag)
  - `three.min.js` — three.js r147, inlined at build time
  - `logic.js` — pure game simulation (no DOM/three dependencies)
  - `game.js` — three.js renderer + input + UI
  - `build.py` — assembles the single-file `index.html`
  - `test_logic.js`, `test_boot.js`, `test_e2e.js` — node test suites
- `.github/workflows/build.yml` — on push to `game-sources`: syntax-check,
  run tests, build `index.html`, commit it to `main` for GitHub Pages.

## Local build

```bash
cd build
node --check logic.js && node --check game.js
node test_logic.js
node test_boot.js
python3 build.py            # -> ~/workspace/your_files/crowd-control/index.html
python3 build.py ../index.html   # -> custom output path
```

## Deploy

Push to `game-sources`; the workflow builds and pushes `index.html` to `main`.
Enable Pages once: Settings → Pages → Deploy from branch → `main`, `/(root)`.
