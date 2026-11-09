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

- `PASS` / `FAIL`: our value is within / outside the tolerance (one arcade frame for animation, 50 ms for audio, one server frame for game-tick timing, exact for counts).
- `DID NOT COMPLETE`: the measurement started but its ending event never came.
- `NOT IMPLEMENTED`: the visualizer has no such event yet (for example the maze flash).
- `NOT APPLICABLE`: the check doesn't exist in this mode (competition mode has no READY after a death and no READY movement check).
- `NO REFERENCE`: the arcade value is missing; see the notes at the top of `mame/memory-map.lua`.

The arcade memory addresses the recorder relies on, and how each was verified, are documented in `mame/memory-map.lua`.
