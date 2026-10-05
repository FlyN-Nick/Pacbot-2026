# Columbia Pacbot

This is the software used at competition for Columbia University Robotics Club's PacBot.

Clone the repo with `git clone --recurse-submodules https://github.com/FlyN-Nick/Pacbot-2026.git`.

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
- Python 3.10 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 18 or newer and `npm`

### 1. Start the game server

```sh
cd server
go run .
```

### 2. Start the bot in simulation mode

```sh
cd bot_client
uv sync
uv run python pacbotClient.py --force_no_bot
```

To use a DQN, supply your own compatible checkpoint file:

```sh
cd bot_client
uv sync --extra dqn
uv run --extra dqn python pacbotClient.py --strategy dqn --checkpoint /absolute/path/to/checkpoint.pt --force_no_bot
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

## Working on a component

- **Game server:** [server README](server/README.md), [`server/game/`](server/game/), and [`config.json`](config.json).
- **Sample bot:** [bot client README](bot_client/README.md). The client supports A* and DQN strategies; DQN runs require a compatible checkpoint. Use `uv run python pacbotClient.py --help` to see options.
- **Game visualizer:** [web client README](web_client/README.md). `npm run host` exposes Vite on the network; `npm run prod` creates a static build.
- **Robot firmware:** [`low_level/RPiPacBot/`](low_level/RPiPacBot/), including the [UDP protocol](low_level/RPiPacBot/PROTOCOL.md) and [driving behavior](low_level/RPiPacBot/DRIVING.md).
- **Robot dashboard:** [`dashboard/server/`](dashboard/server/) and [`dashboard/webapp/`](dashboard/webapp/).
