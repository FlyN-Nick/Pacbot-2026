# Sample bot client

This folder contains sample Python code for a high-level Pacbot client. Teams can adapt the navigation algorithm and robot communication to their needs.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and use Python 3.11 or newer. Install a supported interpreter with `uv python install 3.11` (or another supported Python version). From the repository root, initialize the RL model submodule (also needed after pulling into an existing clone):

```sh
git submodule update --init --recursive
cd bot_client
uv sync
```

Run the default A* strategy in simulation mode with the game server running:

```sh
uv run python pacbotClient.py --force_no_bot
```

For DQN, install the optional dependencies and provide a checkpoint file explicitly. Checkpoints are not included in this repository:

```sh
uv sync --extra dqn
uv run --extra dqn python pacbotClient.py --strategy dqn --checkpoint ../curc-pacbot-rl/src/best_checkpoints/urlriljg/q_net-iter0619000.ckpt.pt --force_no_bot
```

The bot supports Python 3.11 and newer. The current compatibility checks cover Python 3.11–3.14. DQN availability depends on PyTorch wheels for the operating system and architecture; on Intel macOS, the configured PyTorch range supports Python 3.11–3.12.

Other useful files:

- `decisionModule.py`: A* decision module with an asynchronous loop and game state locking
- `dqn_module.py`: DQN decision module. It builds the same observations and action masks as the RL training environment, and plays the way the checkpoint was trained: a single-model checkpoint (trained with `--single-model`) plays every move; otherwise the checkpoint plays only in "purgatory" (no frightened ghosts, ghosts not close) under the environment version the checkpoint records, and `curc-pacbot-rl/src/checkpoints_known/superpelletmode.safetensors` plays the rest. `tests/test_obs_parity.py` checks this against the training environment, which it builds from Rust source (needs [Rust](https://www.rust-lang.org/tools/install)): `uv run --extra dqn --group parity python -m unittest tests.test_obs_parity`
- `searchPlanner.py`: plays every move with the Gumbel AlphaZero search the RL evaluations use, through curc-pacbot-rl's Rust game. The server's game state bytes load straight into the Rust game, so the search simulates the state the bot sees. It needs the Rust game, built from source (needs [Rust](https://www.rust-lang.org/tools/install)):

  ```sh
  uv sync --extra search
  uv run --extra search python pacbotClient.py --strategy dqn --checkpoint CHECKPOINT --search auto --force_no_bot
  ```

  `--search auto` scales the simulations per move to the time Pacman takes to move one cell at its (live) speed: half of that time (`--search-budget 0.5`), divided by the time a simulation takes (measured at startup and during the game), up to `--search-max-sims 512`. `--search 128` fixes the number instead. On the fixed-seed evaluation (speeds 4 to 14), the wide DQN (exp7-wide) scored 8,728 on average playing its best move, 10,262 with 128 simulations and 10,660 with 256. It needs a single-model checkpoint: a DQN (it drives the search through its Q values, over `--search-temperature 0.3`) or an AlphaZero checkpoint (`PVNetV2`, `PVNetV2Wide`), which without `--search` plays its policy's most likely move. Lives and level don't change the search: it plays the board as it is, like a training game. With `--debug` it prints each move's simulations and time. `tests/test_search.py` checks that a state loaded from the server's bytes plays out exactly like the original.
- `speedLogger.py`: measures how many game ticks Pacman takes to move one cell, to match the RL training speeds (4 to 14 ticks per move; the bot's simulation mode moves every 8) to the physical robot. Record a game, then summarize one or more recordings:

  ```sh
  uv run python speedLogger.py record --out robot-run.csv   # listens only; Ctrl-C to stop
  uv run python speedLogger.py summarize robot-run.csv
  ```

  `record` never sends anything to the server, so it can run next to any client, including at competition. The bot client can also record its own games with `--log-speed robot-run.csv` (rows are written as they happen, so the file is complete even if the client is killed; it prints the summary when it disconnects). The summary reports the spread of ticks per cell (median and percentiles, straight moves and moves after a turn separately), the game clock rate, and whether any of the robot's moves fall outside the trained range. Waiting in place looks like a slow move, so the middle of the distribution is the robot's speed, and the long tail is mostly waiting.

  The DQN bot also measures the speed live: it tells the network (observation channel 15) the median of Pacman's last 10 clean moves, in game ticks per cell, clamped to the speeds the checkpoint was trained at (4 to its `max_speed`, 14 unless its config says otherwise), and assumes 8 until 3 moves have been measured. `--speed 8` (or any number) fixes the speed instead, as the bot did before. With `--debug` it prints the speed whenever it changes.
- `pacbotAgent.py`: upstream's minimal agent template (not used by this client)
- `gameState.py`: parsed game state and prediction helpers
- `walls.py`: binary maze walls, matching `initWalls` in the server
