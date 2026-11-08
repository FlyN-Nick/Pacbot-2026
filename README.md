# Columbia Pacbot

This is the software used at competition for Columbia University Robotics Club's PacBot.

Clone the repo with `git clone --recurse-submodules https://github.com/FlyN-Nick/Pacbot-2026.git`.

Then run the one-time setup from the repository root (on Windows, use Git Bash):

```sh
sh scripts/setup.sh
```

This turns on the hooks in `.githooks/`, which keep the `curc-pacbot-rl/` submodule at the commit this repo expects every time you pull or switch branches. They leave it alone while you're working on RL code: on your own branch, with unpushed commits, or with uncommitted edits. The setup also adds a `git bump-rl` command (see [RL models](#working-on-a-component)). If you skip the setup, run `git submodule update` after each pull. Either way, the bot client warns at startup when `curc-pacbot-rl/` doesn't match the expected commit.

## What's in the repository

| Directory | Purpose | Main technologies |
| --- | --- | --- |
| [`server/`](server/) | Competition game server, game engine, and WebSocket/TCP communication | Go |
| [`bot_client/`](bot_client/) | Pacbot client and high-level decision algorithms | Python |
| [`web_client/`](web_client/) | Browser visualizer and console for the competition game | Svelte, Vite |
| [`low_level/`](low_level/) | Microcontroller firmware and robot communication/driving documentation | Arduino/C++ |
| [`dashboard/`](dashboard/) | Physical robot telemetry and control dashboard, with its own server and web app | Go, React, Vite |

## Run the game locally

The following setup runs the game server, bot simulation without a physical robot, and browser visualizer. Open a separate terminal for each process.

### Requirements

- Go 1.22 or newer
- Python 3.11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 18 or newer and `npm`

### 1. Start the game server

```sh
cd server
go run .
```

### 2. Start the bot in simulation mode

```sh
uv python install 3.11
cd bot_client
uv sync
uv run python pacbotClient.py --force_no_bot
```

To use a DQN with one of the tracked best checkpoints:

```sh
uv python install 3.11
cd bot_client
uv sync --extra dqn
uv run --extra dqn python pacbotClient.py --strategy dqn --checkpoint ../curc-pacbot-rl/src/best_checkpoints/urlriljg/q_net-iter0619000.ckpt.pt --force_no_bot
```

### 3. Start the game visualizer

```sh
cd web_client
npm install
npm run dev
```

Open the local URL printed by Vite.

## Physical robot dashboard

The dashboard's backend listens for robot UDP packets on port `9000` and serves the web app plus a WebSocket on port `8765` by default.

Build the frontend:

```sh
cd dashboard/webapp
npm install
npm run build
```

Then run the dashboard backend, which serves the built frontend from `../webapp/dist` by default:

```sh
cd dashboard/server
go run .
```

Open <http://localhost:8765>. For frontend development with Vite’s hot reload, run `npm run dev` in `dashboard/webapp`; its `/ws` proxy expects the backend at `localhost:8765`.

The dashboard can also use a Unix domain socket for local direction-command IPC. See the backend flags (`go run . -h`) and [`dashboard/`](dashboard/) for implementation details. Hardware Wi-Fi and UDP settings are configured in the firmware; see the [robot protocol](low_level/RPiPacBot/PROTOCOL.md).

To drive from the dashboard, hold the arrow keys or WASD. Hold two keys at once to move diagonally, use Q/E to spin, and press Space to stop. Press M to switch between manual and cardinal (heading-locked) mode.

## Flash the robot firmware

The robot is a Raspberry Pi Pico 2 W running an Arduino sketch. Install [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/) (`brew install arduino-cli` on macOS), then the board package and libraries:

```sh
arduino-cli config add board_manager.additional_urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
arduino-cli core update-index
arduino-cli core install rp2040:rp2040
arduino-cli lib install VL6180X "Adafruit BNO055" "Adafruit Unified Sensor"
```

Wi-Fi credentials are kept out of git. Copy the template and fill in a 2.4 GHz network. The template's default is the club's `MdrcPacbot` router:

```sh
cd low_level/RPiPacBot
cp wifi_secrets.example.h wifi_secrets.h
```

Compile and flash over USB (find the port with `arduino-cli board list`):

```sh
arduino-cli compile --fqbn rp2040:rp2040:rpipico2w --output-dir build .
arduino-cli upload --fqbn rp2040:rp2040:rpipico2w -p <port> --input-dir build .
```

If the upload can't find the board, hold BOOTSEL while plugging in USB and copy `build/RPiPacBot.ino.uf2` to the `RP2350` drive. On recent macOS, allow the USB accessory when prompted. The robot finds the dashboard on the network automatically; see the [robot protocol](low_level/RPiPacBot/PROTOCOL.md#server-discovery).

## Working on a component

- **Game server:** [server README](server/README.md), [`server/game/`](server/game/), and [`config.json`](config.json).
- **Sample bot:** [bot client README](bot_client/README.md). The client supports A* and DQN strategies; DQN runs require a compatible checkpoint. Use `uv run python pacbotClient.py --help` to see options.
- **Game visualizer:** [web client README](web_client/README.md). `npm run host` exposes Vite on the network; `npm run prod` creates a static build.
- **Robot firmware:** [`low_level/RPiPacBot/`](low_level/RPiPacBot/), including the [UDP protocol](low_level/RPiPacBot/PROTOCOL.md) and [driving behavior](low_level/RPiPacBot/DRIVING.md).
- **Robot dashboard:** [`dashboard/server/`](dashboard/server/) and [`dashboard/webapp/`](dashboard/webapp/).
- **RL models:** [`curc-pacbot-rl/`](curc-pacbot-rl/) is a submodule that tracks its `main` branch. You can work on RL code in place: `cd curc-pacbot-rl`, switch to your branch, and commit and push there as usual. The bot imports the model package straight from that folder (an editable install) and reads checkpoints from it, so it uses whatever you have checked out, including uncommitted edits. Run `uv sync` again only if the model package's dependencies change. To update the pointer to the latest RL `main`, push your RL changes first, then run `git bump-rl` from the repository root. Without the setup, run the same steps by hand:

  ```sh
  git submodule update --remote --merge curc-pacbot-rl
  git add curc-pacbot-rl
  git commit -m "chore: update rl submodule pointer"
  ```
