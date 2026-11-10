-- Pac-Man (Midway, MAME set "pacman") memory used by recorder.lua.
--
-- Every address below was observed in MAME 0.289 with the verified pacman set
-- by logging values frame by frame (coin at frame 300, start at frame 400), not
-- taken on trust from published RAM maps. Frame numbers are from those runs.
--
-- Not measured: the returning-eyes sound length. The recorder forces a ghost to
-- be eaten by moving Blinky onto Pac-Man, and the moved ghost's eyes never
-- finish their trip home (the eyes sound was still on 14 s later), so the
-- sound's end is not trustworthy and ghostEaten.eyesSoundLength has no
-- reference. The siren loop period is derived from sound voice 2's frequency;
-- see recorder.lua.

return {
  -- Game state
  mainState = 0x4E00,   -- 1 attract mode, 2 credit inserted, 3 playing (seen 297, 304, 541)
  subState = 0x4E04,    -- play sub-state: 0-2 setup, 3 actors moving (661), 12 level cleared (670),
                        -- 13 pause, 15..31 maze flashing, 34-36 next level setup
  pelletsEaten = 0x4E0E, -- pellets eaten this level, 244 per level; writing 243 at play start
                         -- makes the next pellet clear the level (verified)
  lives = 0x4E14,       -- set to 3 at start (403), decremented after a death (1594)

  -- Actors (pixel coordinates; a change means the actor moved)
  actorPositions = {
    { name = "blinky", y = 0x4D00, x = 0x4D01 },
    { name = "pinky",  y = 0x4D02, x = 0x4D03 },
    { name = "inky",   y = 0x4D04, x = 0x4D05 },
    { name = "clyde",  y = 0x4D06, x = 0x4D07 },
    { name = "pacman", y = 0x4D08, x = 0x4D09 },
  },
  blinkyTile = { y = 0x4D31, x = 0x4D32 }, -- tile coordinates; copied with pixels to move Blinky onto Pac-Man
  pacmanTile = { y = 0x4D39, x = 0x4D3A },

  -- Death: 0 alive; 3 or 4 when caught (1374); after ~1 s it steps 5..16 every 7-8 frames (1434-1546)
  deathAnimation = 0x4DA5,
  firstDeathFrameValue = 5,

  -- Fright: 1 while a power pellet is in effect (687-1046 = 5.9 s on level 1)
  powerPellet = 0x4DA6,
  -- Sprite color bytes for the 8 hardware sprites. The game reorders sprite slots
  -- (Blinky's red is in slot 1 normally, Pac-Man's yellow during fright), so
  -- check every slot: 0x11 frightened blue (688), 0x12 flashing white (926, 954,
  -- ... every 28 frames), 0x18 score popup (693)
  spriteColors = { 0x4FF1, 0x4FF3, 0x4FF5, 0x4FF7, 0x4FF9, 0x4FFB, 0x4FFD, 0x4FFF },
  colorFrightFlash = 0x12,
  colorScorePopup = 0x18,
  -- Per-ghost state (blinky, pinky, inky, clyde): 0 normal, 1 eyes returning, 2 entering the house.
  -- Blinky eaten 3 s into fright: 0 -> 1 when the freeze ends (923), 1 -> 2 at the house door (1004), then 0 (1018)
  ghostStates = { 0x4DAC, 0x4DAD, 0x4DAE, 0x4DAF },
  ghostStateEyes = 1,
  ghostsEaten = 0x4DD0, -- ghosts eaten this fright (0 -> 1 at 692)
  ghostEatenFreeze = 0x4DD1, -- 1 during the freeze after eating a ghost (692-751, 59 frames)

  -- Screen
  readyTile = 0x4252, -- 0x52 ('R' of READY!) while READY! is shown (406-660)
  readyChar = 0x52,
  pelletTile = 0x10, powerPelletTile = 0x14,
  firstPelletsEaten = { 0x4238, 0x4258, 0x4278 }, -- tiles eaten first when Pac-Man is left idle (669, 678, 687)
  mazeWallColor = 0x4440, -- color RAM of a wall tile: 0x10 blue, 0x1F white during the level-complete flash (787, 811, 835, 859)
  colorMazeWhite = 0x1F,

  -- Sound (RAM flags the game sets for the sound routines)
  musicFlags = 0x4ECC,   -- bit 0: start music (402-658)
  channel2Flags = 0x4EAC, -- bits 0-4: siren step (01 at start, 10 with 1 pellet left), bit 5: fright sound, bit 6: eyes returning (751)
  sirenStepMask = 0x1F,
  eyesSoundBit = 0x40,
  -- Sound chip voice 2 frequency registers (write-only; read through a write tap), 4 nibbles, low first
  voice2Frequency = { first = 0x5056, last = 0x5059 },
}
