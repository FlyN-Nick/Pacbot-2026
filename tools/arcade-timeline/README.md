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

Capture output is a version-1 manifest plus lossless PNGs. MAME snapshots are native upright 224 × 288: header y=0..23, maze y=24..271, footer y=272..287. `screen:snapshot` is documented at https://docs.mamedev.org/luascript/ref-devices.html. The recorder keeps its existing timing path when visual capture is disabled. GUI capture uses the existing scenario runner with separate server ports and captures only `[data-arcade-screen]`. Interactive controls live in the empty side pockets in both modes; comparison captures temporarily hide only `[data-game-controls]` and record `hiddenControls: true` in provenance, since those buttons have no MAME counterpart.

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

Pause investigation checks:

- `node natural-death-browser.mjs` tests the server's real collision/deferred-pause path, rather than only the debug kill command.
- `node bot-reset-browser.mjs` checks that automatic bot resets resume after the fresh-state acknowledgement, while explicit stops and manual resets stay paused.
- The visualizer exposes a bounded local history at `window.__arcadePauseTrace.events()` and current server/sequence status at `window.__arcadePauseTrace.status()`. It records command origins, bot controls, sequence starts, server mode changes, and the before/after state supporting ghost-eaten detections. No trace is sent to an external service.
- `node reload-pause-browser.mjs` checks that refreshing during an active READY hold releases the abandoned pause, while refreshing a manual pause preserves it. The same cleanup runs when the development app is destroyed by hot reload.

`node hud-controls-browser.mjs` checks the shared arcade HUD and bitmap controls in both modes at narrow and short viewport sizes. Natural-death checks also assert that the death animation stays at the captured pre-respawn position.

## Painted sequence references (v2)

```sh
PACMAN_ROM_DIR=~/roms npm run record:sequences -- --scope initial --out /tmp/sequence-reference
PACMAN_ROM_DIR=~/roms npm run record:sequences -- --scope full --out /tmp/sequence-reference-full
```

The output directory must be empty. The recorder verifies the external `pacman` ROM set and requires the measured MAME 0.289 callback behavior. It records READY → initial movement and a natural, untouched-joystick collision away from spawn → death → next-life READY → movement. There are no gameplay-memory writes in these scenarios. The legacy timeline and v1 capture commands retain their behavior; per-frame recording is opt-in through `ARCADE_SEQUENCE_DIR`.

`index.json` is `{version:2,scope,sequences:[{checkId,status,manifest?,reason?}],context:[]}`. Status is `recorded`, `unavailable`, or `incomplete`, never a comparison result. Initial scope lists all eight inventory definitions: two full-screen recordings and six explicitly unavailable live producers. Full scope lists all 108 definitions; only the two initial full-screen producers are implemented here. Exit 0 means **requested renderer recording complete**, not validation passed. Live/compositing placeholders are outside this recorder's exit denominator; missing full-screen/artwork producers in full scope cause exit 1. Missing dependencies and incomplete captures also exit 1.

All paths in manifests, evidence, and calibration files are relative to the directory containing `index.json`, including paths in a nested `start/manifest.json` or `death/manifest.json`. Each scenario retains:

- `raw/fNNNNNN.png` and `.json`: every frame from recorder frame 400 until completion, with full native 224 × 288 screenshots and both machine-notifier and frame-done state observations.
- `manifest.json`: the selected dense sequence and unchanged opaque `paintedState` snapshots, with IDs `fNNNNNN`. `emulatedFrame` is the recorder's machine-callback count; `paintedFrame` is `screen:frame_number()` at frame-done. `event` is the scenario name; `offsetFrames` is relative to the selected READY or death-catch anchor.
- `provenance.checkpoints`: inventory checkpoint ID → `{sampleIds,firstFrame,lastFrame}`. IDs may overlap between checkpoint groups. An `all-observed` checkpoint lists **every** frame in its inclusive interval; it is not one representative image. Consumers must verify this mapping in addition to matching samples. `validateCheckpointCoverage` checks dense intervals plus complete initial mouth/death transitions.
- `evidence/fNNNNNN.json`: hashes binding the PNG/raw observation, pixel-derived yellow bounds, and the retained callback calibration. `paint-calibration.json` references at least four moving closed-pose PNG/raw pairs whose pixel bounds agree with frame-done registers and reject the preceding machine-notifier registers. `validateRecordedSequence(root, manifest, definition)` recomputes those observations and hashes, validates provenance artifacts and checks complete checkpoint mapping. This is empirical callback association, not an independent emulator of every pixel or a renderer comparison.
- `command.json`, `mame.log`, `raw/events.json`, and `raw/timeline.json`: invocation, explicit coin/start inputs, emulator diagnostics, raw-frame events, and the unchanged timing format. Root `environment.json` retains version and ROM verification. `contact-sheet.png` plus its ordered JSON frame index show checkpoint boundaries and art transitions with neighbors; screenshots themselves have no annotation or excluded regions.

Initial mapping observed with the recorded command (future recordings derive anchors from state rather than fixed frame numbers):

| Check | Checkpoint | Inclusive recorder frames |
|---|---|---|
| ready-movement | ready-visible / before-release / first-movement | 544 / 661 / 662 |
| ready-movement | mouth-cycle, all-observed | 661–694 (34 samples) |
| death-respawn | death-catch / initial-hold | 1373 / 1374–1433 |
| death-respawn | death-art-transitions, all-observed | 1433–1548 (116 samples, preceding hold through two blank frames) |
| death-respawn | blank / next-life-ready / first-movement | 1547–1548 / 1603 / 1719 |

Selected manifests include all frames 542–694 and 1370–1735, respectively, including surrounding frames outside checkpoint groups. Initial movement completion retains multiple mouth cycles. Death recording retains the whole hold, every art change, blank interval, intervening board redraw, next READY and movement. The natural catch's logical actor position is `(196,188)` versus spawn `(196,128)`; its hardware top-left is `(45,204)` versus spawn `(105,204)`.

The opaque state schema `mame-pacman-raw-v1` contains `videoRam[1024]` (0x4000–43ff), `colorRam[1024]` (0x4400–47ff), `spriteAttributes[16]` (0x4ff0–4fff), write-tapped `spriteCoordinates[16]` (0x5060–506f), write-tapped `flipScreen`, `actorRam[10]` (0x4d00–4d09), `mainState`, `subState`, `deathAnimation`, `lives`, `readyTile`, `pelletsEaten`, `scoreBytes[4]` (0x4e80–83), `highScoreBytes[4]` (0x4e88–8b), `levelByte` (0x4e13), and explicit `unavailable` reasons. All arrays are address-ascending, zero-based when accessed in JavaScript. Raw observation files additionally retain `{frame,screenFrame,machineScreenFrame,machineState,paintedState,image}`. These are RAM/ports only; no ROM bytes are exported.

Measured geometry and field limits:

- `screen:snapshot` is already upright/native. For sprite slot `s`, top-left is `x = 240 - coordinates[2*s] - (s <= 2 ? 1 : 0)`, `y = 272 - coordinates[2*s+1]`. Slots 1..5 in these initial runs are red/pink/cyan/orange/yellow with color bytes 1/3/5/7/9. Slots can reorder elsewhere. Sprite code is `attribute >> 2`; low bits are pre-rotation flips. At frame 550 the first five positions are `(105,108)`, `(105,132)`, `(89,132)`, `(121,132)`, `(105,204)`.
- The machine notifier precedes paint. At recorder frame 662 it sees the previous hardware position; frame-done sees port pair `(136,68)` and PNG yellow bounds `(105,205)..(117,217)`, 137 pixels. Logical actor RAM already reads `(196,130)` and must not substitute for painted coordinates. No universal logical-to-painted per-actor shift is inferred.
- Initial left movement uses attributes 194/186/178/186/194 (codes 48/46/44/46/48). Closed code 48 is observed through READY. Death uses attributes 208 through 248 in increments of four (codes 52..62), then attribute 252/code 63, which paints blank. These initial scenarios do not verify every direction, frightened/eyes pose, or general sprite visibility; raw flips, clipping coordinates and PNGs are preserved instead of invented semantic flags.
- Score/high-score first bytes were observed as hex 00,10,20,…,70 with painted 00,10,20,…,70, changing at frames 668,677,…,722. Higher-score digits and the fourth raw byte remain unclassified. Lives changes 3→2 at frame 1593, while the footer updates later; use retained video/color RAM to describe displayed icons. `levelByte=0` and the cherry icon were observed on the first board only. Later-level and fruit-history progression remain unavailable. READY, pellet removal, HUD glyphs and all screen tiles remain in the full video/color arrays.

These observations combine actual adjacent captures with the official [MAME 0.289 video implementation](https://github.com/mamedev/mame/blob/mame0289/src/mame/pacman/pacman_v.cpp), [memory/port declarations](https://github.com/mamedev/mame/blob/mame0289/src/mame/pacman/pacman.cpp), and [screen API documentation](https://docs.mamedev.org/luascript/ref-devices.html). ROM verification alone does not establish paint alignment. Raw state remains unchanged for later sample matching; canonical browser adapter inputs belong in separate provenance.
