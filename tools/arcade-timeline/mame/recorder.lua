-- MAME autoboot script: play one scenario of the pacman set and write its event
-- timeline as JSON. Run by record.mjs with ARCADE_SCENARIO and ARCADE_OUT set,
-- from this folder (memory-map.lua is loaded relative to it).

local map = dofile("memory-map.lua")
local scenario = os.getenv("ARCADE_SCENARIO")
local outPath = os.getenv("ARCADE_OUT")

local FPS = 60.606
local MAX_FRAMES = 7200 -- about 2 minutes of game time
local COIN_FRAME, START_FRAME = 300, 400
local PELLETS_PER_LEVEL = 244
local ANCHOR = {
  start = "readyShown", death = "pacmanCaught", fright = "frightStarted", ghostEaten = "ghostEaten",
  levelComplete = "levelCleared", siren = "gameStarted",
}

local mem = manager.machine.devices[":maincpu"].spaces["program"]
local read = function(address) return mem:read_u8(address) end

-- The sound chip is write-only: keep the last nibble written to each register.
local soundRegisters = {}
soundTap = mem:install_write_tap(0x5040, 0x505F, "sound", function(offset, data)
  soundRegisters[offset] = data & 0x0F
end)
local function voice2Frequency()
  local value = 0
  for address = map.voice2Frequency.last, map.voice2Frequency.first, -1 do
    value = value * 16 + (soundRegisters[address] or 0)
  end
  return value
end

local frame = 0
local events = {}
local function emit(type, data)
  events[#events + 1] = { frame = frame, type = type, data = data or {} }
end
local function seen(type)
  for _, event in ipairs(events) do if event.type == type then return event.frame end end
  return nil
end
local function lastSeen(type)
  for i = #events, 1, -1 do if events[i].type == type then return events[i].frame end end
  return nil
end

local function press(port, field, on)
  local f = manager.machine.ioport.ports[port].fields[field]
  if on then f:set_value(1) else f:clear_value() end
end

local function anySprite(color)
  for _, address in ipairs(map.spriteColors) do
    if read(address) == color then return true end
  end
  return false
end

-- Siren steps: each records the frame it began, pellets remaining, and voice 2
-- frequency samples, from which the loop period is derived.
local sirenSteps = {}
local function loopPeriodSeconds(samples)
  local peaks = {}
  for i = 2, #samples - 1 do
    if samples[i] > samples[i - 1] and samples[i] >= samples[i + 1] then peaks[#peaks + 1] = i end
  end
  if #peaks < 3 then return nil end
  local gaps = {}
  for i = 2, #peaks do gaps[#gaps + 1] = peaks[i] - peaks[i - 1] end
  table.sort(gaps)
  return gaps[math.ceil(#gaps / 2)] / FPS
end

-- JSON for the flat tables this script produces
local function json(value)
  local kind = type(value)
  if kind == "number" then return (value == math.floor(value)) and string.format("%d", value) or string.format("%.6f", value) end
  if kind == "string" then return '"' .. value .. '"' end
  if kind == "boolean" then return tostring(value) end
  if kind == "table" then
    if #value > 0 or next(value) == nil then
      local parts = {}
      for _, item in ipairs(value) do parts[#parts + 1] = json(item) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for key, item in pairs(value) do parts[#parts + 1] = json(tostring(key)) .. ":" .. json(item) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function finish()
  for _, step in ipairs(sirenSteps) do
    emit("sirenStep", { pelletsRemaining = step.pelletsRemaining, periodSeconds = loopPeriodSeconds(step.samples) })
    events[#events].frame = step.frame
  end
  table.sort(events, function(a, b) return a.frame < b.frame end)
  local anchorFrame = seen(ANCHOR[scenario]) or (events[1] and events[1].frame) or 0
  local out = {}
  for _, event in ipairs(events) do
    local entry = { t = math.floor((event.frame - anchorFrame) / FPS * 10000 + 0.5) / 10000, type = event.type }
    for key, value in pairs(event.data) do entry[key] = value end
    out[#out + 1] = entry
  end
  local file = io.open(outPath, "w")
  file:write(json({ scenario = scenario, source = "arcade", events = out }))
  file:close()
  manager.machine:exit()
end

-- Per-frame state
local prev = {}
local moving = {}
local deathFrames, deathActive = 0, false
-- Returning eyes: which ghost, its last tile, tiles travelled; eyes sound frequency samples
local eyesGhost, eyesTile, eyesTiles = nil, nil, 0
local eyesSamples = {}
local flashes, mazeFlashes = 0, 0
-- fright: watch one full fright. ghostEaten: eat Blinky 3 s into the fright, once
-- it has wandered off, so its eyes have a measurable journey home (eating pauses the fright timer, so the runs are separate and
-- record.mjs merges them).
local plantsPowerPellet = scenario == "fright" or scenario == "ghostEaten"

subscription = emu.add_machine_frame_notifier(function()
  frame = frame + 1
  if frame == COIN_FRAME then press(":IN0", "Coin 1", true) end
  if frame == COIN_FRAME + 6 then press(":IN0", "Coin 1", false) end
  if frame == START_FRAME then press(":IN1", "1 Player Start", true) end
  if frame == START_FRAME + 6 then press(":IN1", "1 Player Start", false) end
  if frame < START_FRAME then return end

  local main, sub = read(map.mainState), read(map.subState)
  local playing = main == 3

  -- READY! and start music
  local ready = read(map.readyTile) == map.readyChar
  if ready and not prev.ready then emit("readyShown") end
  local music = (read(map.musicFlags) & 1) == 1
  if music and not prev.music then emit("musicStarted") end
  if not music and prev.music then emit("musicEnded") end

  -- Start of play
  if playing and sub == 3 and prev.sub ~= 3 then
    emit("gameStarted")
    if scenario == "levelComplete" and not seen("levelCleared") then
      mem:write_u8(map.pelletsEaten, PELLETS_PER_LEVEL - 1)
    end
    if plantsPowerPellet then
      -- Pac-Man, left idle, eats this tile about 0.4 s into play
      local tile = map.firstPelletsEaten[3]
      if read(tile) == map.pelletTile then mem:write_u8(tile, map.powerPelletTile) end
    end
  end

  -- Movement: one event each time an actor starts moving
  if playing then
    for _, actor in ipairs(map.actorPositions) do
      local position = read(actor.y) * 256 + read(actor.x)
      local key = actor.name
      local nowMoving = prev[key] ~= nil and position ~= prev[key]
      if nowMoving and not moving[key] then emit("actorMoved", { actor = actor.name }) end
      local eatenAt = seen("ghostEaten")
      if nowMoving and eatenAt and frame > eatenAt and not seen("freezeEnded") then emit("freezeEnded") end
      moving[key] = nowMoving
      prev[key] = position
    end
  end

  -- Death
  local death = read(map.deathAnimation)
  if playing and (prev.death or 0) == 0 and death ~= 0 then
    emit("pacmanCaught")
    deathFrames, deathActive = 0, true
  end
  if deathActive and death ~= prev.death and death >= map.firstDeathFrameValue then
    deathFrames = deathFrames + 1
    emit("deathFrame", { frame = deathFrames })
  end
  if deathActive and sub ~= 3 and prev.sub == 3 then
    emit("deathEnded")
    deathActive = false
  end

  -- Fright
  local power = read(map.powerPellet) == 1
  if power and not prev.power then
    emit("frightStarted")
    flashes = 0
  end
  if not power and prev.power then emit("frightEnded") end
  local white = power and anySprite(map.colorFrightFlash)
  if white and not prev.white and scenario ~= "ghostEaten" then
    flashes = flashes + 1
    emit("frightFlashStart", { flash = flashes })
  end

  -- Ghost eaten, score popup, returning eyes
  local freeze = read(map.ghostEatenFreeze) == 1
  if freeze and not prev.freeze then emit("ghostEaten") end
  local popup = anySprite(map.colorScorePopup)
  if popup and not prev.popup then emit("scorePopupShown") end
  local eyes = (read(map.channel2Flags) & map.eyesSoundBit) ~= 0
  if eyes and not prev.eyes then
    emit("eyesSoundStarted")
    eyesSamples = {}
  end
  if eyes then eyesSamples[#eyesSamples + 1] = voice2Frequency() end
  if not eyes and prev.eyes then emit("eyesSoundEnded", { periodSeconds = loopPeriodSeconds(eyesSamples) }) end

  -- The eaten ghost's journey home, in tiles (8 pixels each)
  local function ghostTile(i)
    local actor = map.actorPositions[i]
    return (read(actor.y) // 8) * 32 + read(actor.x) // 8
  end
  if not eyesGhost and not seen("eyesStarted") then
    for i, address in ipairs(map.ghostStates) do
      if read(address) == map.ghostStateEyes then
        eyesGhost, eyesTile, eyesTiles = i, ghostTile(i), 0
        emit("eyesStarted")
        break
      end
    end
  elseif eyesGhost then
    if read(map.ghostStates[eyesGhost]) == map.ghostStateEyes then
      local tile = ghostTile(eyesGhost)
      if tile ~= eyesTile then eyesTiles, eyesTile = eyesTiles + 1, tile end
    else
      emit("eyesArrived", { tiles = eyesTiles })
      eyesGhost = nil
    end
  end

  -- Level complete
  if playing and sub == 12 and prev.sub ~= 12 then
    emit("levelCleared")
    mazeFlashes = 0
  end
  local mazeWhite = read(map.mazeWallColor) == map.colorMazeWhite
  if mazeWhite and not prev.mazeWhite then
    mazeFlashes = mazeFlashes + 1
    emit("mazeFlash", { flash = mazeFlashes })
  end

  -- Siren steps
  local step = read(map.channel2Flags) & map.sirenStepMask
  if playing and step ~= 0 and step ~= prev.step then
    sirenSteps[#sirenSteps + 1] = {
      frame = frame, pelletsRemaining = PELLETS_PER_LEVEL - read(map.pelletsEaten), samples = {},
    }
  end
  if step ~= 0 and #sirenSteps > 0 then
    local samples = sirenSteps[#sirenSteps].samples
    samples[#samples + 1] = voice2Frequency()
  end

  -- Scenario setup that continues during play
  local started = seen("gameStarted")
  if scenario == "siren" and started and not seen("pacmanCaught") and (frame - started) % 15 == 0 then
    local eaten = read(map.pelletsEaten)
    if eaten < 236 then mem:write_u8(map.pelletsEaten, math.min(236, eaten + 6)) end
  end
  local fright = scenario == "ghostEaten" and seen("frightStarted")
  if fright and frame >= fright + 180 and frame <= fright + 184 and not seen("ghostEaten") then
    -- Put Pac-Man on Blinky so the frightened ghost is eaten. Moving Blinky
    -- instead left its eyes circling forever, never reaching the house.
    mem:write_u8(map.actorPositions[5].y, read(map.actorPositions[1].y))
    mem:write_u8(map.actorPositions[5].x, read(map.actorPositions[1].x))
    mem:write_u8(map.pacmanTile.y, read(map.blinkyTile.y))
    mem:write_u8(map.pacmanTile.x, read(map.blinkyTile.x))
    -- The teleport isn't movement: keep it out of the actorMoved detection
    prev.pacman = read(map.actorPositions[5].y) * 256 + read(map.actorPositions[5].x)
  end

  prev.ready, prev.music, prev.sub, prev.death = ready, music, sub, death
  prev.power, prev.white, prev.freeze, prev.popup, prev.eyes = power, white, freeze, popup, eyes
  prev.mazeWhite, prev.step = mazeWhite, step

  -- Scenario end
  local done = false
  if scenario == "start" then
    done = seen("musicEnded") and started and frame >= started + 60
  elseif scenario == "death" then
    local ended = seen("deathEnded")
    -- Play resumes (gameStarted) after the READY that follows the death
    local ready = lastSeen("readyShown")
    local resumed = ended and ready and ready > ended and (lastSeen("gameStarted") or 0) > ready
    done = ended and (resumed or frame > ended + 900)
  elseif scenario == "fright" then
    local ended = seen("frightEnded")
    done = (ended and frame > ended + 30) or seen("pacmanCaught")
  elseif scenario == "ghostEaten" then
    local eaten = seen("ghostEaten")
    done = (eaten and (seen("eyesSoundEnded") or frame > eaten + 900)) or seen("pacmanCaught")
  elseif scenario == "levelComplete" then
    -- Play resumes (gameStarted) after the READY that follows the clear
    local cleared = seen("levelCleared")
    local ready = lastSeen("readyShown")
    local resumed = cleared and ready and ready > cleared and (lastSeen("gameStarted") or 0) > ready
    done = cleared and (resumed or frame > cleared + 900)
  elseif scenario == "siren" then
    local caught = seen("pacmanCaught")
    done = caught or (started and read(map.pelletsEaten) >= 236 and frame > started + 900)
  end
  if done or frame >= MAX_FRAMES then finish() end
end)
