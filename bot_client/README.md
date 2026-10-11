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
uv run --extra dqn python pacbotClient.py --strategy dqn --checkpoint /absolute/path/to/checkpoint.pt --force_no_bot
```

The bot supports Python 3.11 and newer. The current compatibility checks cover Python 3.11–3.14. DQN availability depends on PyTorch wheels for the operating system and architecture; on Intel macOS, the configured PyTorch range supports Python 3.11–3.12.

Other useful files:

- `decisionModule.py`: A* decision module with an asynchronous loop and game state locking
- `dqn_module.py`: DQN decision module
- `gameState.py`: parsed game state and prediction helpers
- `walls.py`: binary maze walls, matching `initWalls` in the server
