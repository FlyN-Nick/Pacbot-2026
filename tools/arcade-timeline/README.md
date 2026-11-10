# Arcade timeline comparison

Measures how closely the web visualizer's timing (READY, death, fright, level complete, siren) matches the original Pac-Man arcade. Both sides record the same events; the report compares the gaps between them against `reference/arcade-timings.json`.

## Setup

```sh
npm install
```

The comparison drives your installed Google Chrome in headless mode. Without Chrome, install Playwright's Chromium instead: `npx playwright install chromium`.

Recording the arcade side also needs MAME (`brew install mame`) and the `pacman` (Midway) ROM set as `pacman.zip` in a folder **outside this repository**. ROM files must never be committed.

## Commands

```sh
npm run compare                                  # our visualizer vs. the committed reference (arcade mode)
npm run compare -- --mode competition            # pauses must be zero; game rules stay informational
npm run compare -- --dump gui-timeline.json      # also save our raw timelines
PACMAN_ROM_DIR=~/roms npm run record             # record the arcade in MAME
PACMAN_ROM_DIR=~/roms npm run record -- --write-reference   # ...and update the reference
npm test                                         # unit tests (no browser or ROM needed)
```

`compare` starts its own game server and visualizer on free ports, so it can run next to a server you already have open. Scenarios (`gui-scenarios.mjs`) start games with a Space key press in the page, the way a person would, and the siren scenario uses the server's debug command `e<n>` to clear `n` pellets.

## Reading the report

Each measurement has a category: **server** (game rules such as fright length, used in competition; shown as `INFO (game rule)`, never a failure), **pause** (holds the game; matches the arcade in arcade mode, must be zero in competition mode), or **presentation** (sound and animation; matches the arcade in both modes).

- `PASS` / `FAIL`: our value is within / outside the tolerance (one arcade frame for animation, 50 ms for audio, one server frame for game-tick timing, 5% for speeds such as the eyes' tiles per second, exact for counts).
- `DID NOT COMPLETE`: the measurement started but its ending event never came.
- `NOT APPLICABLE`: the check doesn't exist in this mode (competition mode has no READY after a death or level clear, no READY movement check, and keeps the quick eyes flight).
- `NO REFERENCE`: the arcade value is missing; see the notes at the top of `mame/memory-map.lua`.

The visualizer's end-of-pause events (`gameStarted`, `freezeEnded`) are recorded when it lets play continue, not observed from the server, so in competition mode those pause rows confirm only that the visualizer adds no hold. The guarantee that competition mode never pauses the server comes from the sequencer's unit tests.

The arcade memory addresses the recorder relies on, and how each was verified, are documented in `mame/memory-map.lua`.

## Visual captures and comparison

```sh
PACMAN_ROM_DIR=~/roms npm run capture -- --source mame --out /tmp/arcade-reference
npm run capture -- --source gui --out /tmp/visualizer-actual
npm run compare:visual -- --reference /tmp/arcade-reference --actual /tmp/visualizer-actual --out /tmp/visual-report
node visual-browser.mjs                         # deterministic fixtures, mode/layout browser checks
```

Capture output is a version-1 manifest plus lossless PNGs. MAME snapshots are native upright 224 × 288: header y=0..23, maze y=24..271, footer y=272..287. `screen:snapshot` is documented at https://docs.mamedev.org/luascript/ref-devices.html. The recorder keeps its existing timing path when visual capture is disabled. GUI capture uses the existing scenario runner with separate server ports and captures only `[data-arcade-screen]`, excluding controls.

Metadata records scenario, anchor, frame offset, state, phase, original dimensions, explicit crop/rotation/integer downscale, regions, and provenance. Normalization rotates clockwise in 90-degree steps and samples integer-scaled pixels without smoothing. Crops must fit the source. Comparisons reject unequal normalized dimensions. Regions use normalized coordinates.

Reports write JSON and numbered reference/actual/difference PNGs. Differences count unequal RGBA pixels once and show changed pixels in magenta. A fixture pair passes only with identical pixels and matching state/phase. Live scenes remain `DIAGNOSTIC`; event timestamps alone cannot prove equal actor positions or animation phases. Missing captures, invalid dimensions, phase mismatches, and diagnostic-only results exit nonzero. No tolerance is chosen to make current output pass.

The browser's `?visual=1` opt-in exposes `window.__arcadeVisual.setFixture(state, phaseMilliseconds)`, `clearFixture()`, and `snapshotMetadata()`. Display fixtures do not send server commands or trigger effects. State accepts parsed actor bytes (`pacman`, `ghosts`), optional exact frame keys for animation audits, `score`, `lives`, `level`, `highScore`, `pellets`, `fruit`, `eyes`, and `ready`. Normal page loads expose no fixture API. High score is session-local; fixtures set it explicitly.

Known limits: maze SVG geometry, pellet presentation, grid-coordinate movement, and live actor phase may differ from MAME. Regional reports expose these; whole-screen identity is not claimed. ROMs remain outside this repository. Missing ROM/MAME/browser prerequisites are errors, never successful comparisons.

For deterministic coverage of all directions, ghost foot frames, frightened variants, eyes, death artwork and level HUDs:

```sh
npm run capture -- --source gui --fixtures --out /tmp/visual-fixtures
node visual-browser.mjs --mame-reference /tmp/arcade-reference --out /tmp/verified-visual
npm run compare:visual -- --reference /tmp/verified-visual/reference --actual /tmp/verified-visual/actual --out /tmp/verified-report
```

The second command explicitly requires the supplied reference recordings and generates isolated reference/actual manifests for Pac-Man, Blinky, spare lives and fruit. It checks native pixels and live mode changes during READY, death, and level clear. Without `--mame-reference`, it performs browser-only checks and does not claim MAME validation. `--out` controls artifact location. The isolated crops have documented, fixed coordinates in the report; they measure artwork independently of engine placement. Whole-screen live reports retain placement discrepancies.

`node death-bot-browser.mjs` checks sprite transparency over colored avoidance cells and reproduces the simulation bot's automatic resume during a death. It verifies that the arcade death artwork advances, the death audio source starts, and the next life resumes on schedule. The bot channel is controlled through Playwright WebSocket routing; the game server and renderer are real isolated processes.

`node sprite-boundary-browser.mjs` checks all Pac-Man movement frames at fractional scales and Retina pixel density. Sprite artwork must stay off the rectangle boundary; transparent atlas gutters keep adjacent sheet artwork out of those samples.
