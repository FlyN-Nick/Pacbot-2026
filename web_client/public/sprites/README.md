# Arcade artwork

Lossless copies of user-supplied sprite sheets from Downloads/sprites:
- general.png: Arcade - Pac-Man - Miscellaneous - General Sprites.png (680 × 248)
- text.png: Arcade - Pac-Man - Miscellaneous - Text.png (128 × 224)

The companion All Assets_Palettes.png sheet credits Lemon (ripped and sorted) and Namco (original assets). No license is inferred. The user confirmed permission for subproject 5.

Reproduce with `cd tools/arcade-timeline && node extract-sprites.mjs /path/to/sprites`.
Frame extraction uses CSS source rectangles listed in src/lib/sprites/catalog.js, preserving exact source pixels and black backgrounds. No recoloring, interpolation, or background conversion. Sprites are 16 × 16, tile units are 8 × 8, glyphs are 8 × 8. Native anchors center sprites on tile centers. Ghost directions occur as pairs right, left, up, down. Death artwork follows the top row after the three left-facing mouth frames, followed by a blank frame.

MAME 0.289 screen:snapshot produces upright 224 × 288 PNGs. The maze begins at y=24 and occupies 224 × 248; footer y=272. Initial reference recordings live in /tmp/pacbot-mame-visual, not in the repository. The local source ROM was verified with `mame -rompath ~/roms -verifyroms pacman` and remains outside the repository.

life.png is the dedicated HUD icon, cropped at (928,176,16,16) from Attract Mode & HUD Assets.png. Its green sheet background is converted to black; foreground pixels are unchanged. This icon differs from the gameplay Pac-Man sprite and matches the MAME spare-life pixels exactly.

Death timing evidence: MAME death captures phases 1..12 occurred at emulated frames 1434,1464,1471,1479,1486,1494,1501,1509,1516,1524,1531,1546. Artwork transitions relative to the first event are 495,610.5,742.5,858,990,1105.5,1237.5,1353,1485,1600.5,1848 ms; the initial pose is held before those transitions. The final spark holds before blanking at 2112 ms; the existing sequence completes at 2640 ms. Sprite frame selection and timeline offsets share this measured schedule. Sprite captures use fixed known crop anchors; the four-pixel horizontal difference between engine tile centers and the arcade's initial half-tile spawn is preserved and reported, rather than hidden by automatic image alignment.

punctuation.png contains the yellow exclamation glyph at (509,205,8,8) from All Assets_Palettes.png, preserving every pixel. It matches the MAME READY! glyph. Fruit history places the oldest visible icon on the right, as shown in the supplied HUD sheet.
