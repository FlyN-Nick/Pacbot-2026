-- Opt-in painted recorder for MAME 0.289. No ROM memory is read/exported.
-- Logical actor RAM and hardware sprite registers have different latency.
-- Keep both opaque; decoding into browser inputs belongs to the replay adapter.
return function(map, mem, encode, getFrame)
  local dir = os.getenv('ARCADE_SEQUENCE_DIR')
  if not dir then return nil end
  local screen = manager.machine.screens[':screen']
  local addresses = map.visual
  local coordinates, flip = {}, -1
  local function bytes(first, last)
    local result = {}
    for address = first, last do result[#result + 1] = mem:read_u8(address) end
    return result
  end
  local result = { events = {} }
  -- 0x5060..0x506f are WRITE ONLY (reads return input ports, not positions).
  result.coordinatesTap = mem:install_write_tap(addresses.coordinates.first, addresses.coordinates.last, 'sequence-coordinates', function(address, data)
    coordinates[address - addresses.coordinates.first + 1] = data
  end)
  result.flipTap = mem:install_write_tap(addresses.flip, addresses.flip, 'sequence-flip', function(_, data) flip = data & 1 end)
  local function state()
    local ports = {}
    for i = 1, 16 do ports[i] = coordinates[i] or -1 end
    return {
      schema = 'mame-pacman-raw-v1',
      videoRam = bytes(addresses.video.first, addresses.video.last), colorRam = bytes(addresses.color.first, addresses.color.last),
      spriteAttributes = bytes(addresses.attributes.first, addresses.attributes.last), spriteCoordinates = ports, flipScreen = flip,
      actorRam = bytes(0x4d00, 0x4d09),
      mainState = mem:read_u8(map.mainState), subState = mem:read_u8(map.subState),
      deathAnimation = mem:read_u8(map.deathAnimation), lives = mem:read_u8(map.lives),
      readyTile = mem:read_u8(map.readyTile), pelletsEaten = mem:read_u8(map.pelletsEaten),
      scoreBytes = bytes(addresses.score.first, addresses.score.last), highScoreBytes = bytes(addresses.highScore.first, addresses.highScore.last),
      levelByte = mem:read_u8(addresses.level),
      unavailable = {
        levelProgression = 'Only level one observed; levelByte interpretation beyond zero unverified',
        fruitProgression = 'Only initial cherry history observed; retained in videoRam and colorRam',
        facing = 'Raw sprite code and flip bits retained; semantic mapping only probed for initial left movement',
        visibility = 'Hardware clipping and painted pixels retained; no inferred logical visibility flag',
      },
    }
  end
  local machineState, machineScreenFrame
  local direction = os.getenv('ARCADE_SEQUENCE_DIRECTION')
  if direction and direction ~= 'Left' and direction ~= 'Right' and direction ~= 'Up' and direction ~= 'Down' then error('Unknown sequence input direction') end
  function result.machineFrame()
    if direction and getFrame() == 700 then
      manager.machine.ioport.ports[':IN0'].fields['P1 ' .. direction]:set_value(1)
      result.event('sequenceInput', {direction=direction, value=1})
    end
    if getFrame() >= 400 then machineState, machineScreenFrame = state(), screen:frame_number() end
  end
  function result.event(kind, data)
    result.events[#result.events + 1] = {frame=getFrame(), type=kind, data=data or {}}
  end
  function result.close()
    local file = assert(io.open(dir .. '/events.json', 'w'))
    file:write(encode(result.events)); file:close()
  end
  emu.register_frame_done(function()
    local frame = getFrame()
    if frame < 400 then return end
    local name = string.format('f%06d', frame)
    local painted = state()
    local err = screen:snapshot(dir .. '/' .. name .. '.png')
    if err then error('Sequence snapshot failed: ' .. tostring(err)) end
    local file = assert(io.open(dir .. '/' .. name .. '.json', 'w'))
    file:write(encode({frame=frame, screenFrame=screen:frame_number(), machineScreenFrame=machineScreenFrame,
      machineState=machineState, paintedState=painted, image=name .. '.png'}))
    file:close()
  end, 'frame')
  return result
end
