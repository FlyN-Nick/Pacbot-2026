# Bot Client uv and RL Model Package Design

## Goal

Migrate `bot_client` to a reproducible `uv`-managed Python environment, update its dependencies to current compatible releases, and remove its dependence on a hard-coded sibling source path for DQN models. The bot must support developer machines running macOS, Windows, and Linux. Raspberry Pi is not a target runtime.

The RL model code remains maintained in `curc-pacbot-rl`. The Pacbot repository will pin that repository as a Git submodule so a checkout records the exact model API revision used by the bot.

## Current constraints and findings

- `bot_client/requirements.txt` lists pinned NumPy and `websockets` versions but omits PyTorch, which the DQN module imports.
- `pacbotClient.py` imports `dqn_module` even when A* is selected. `dqn_module.py` mutates `sys.path` to import `models.py` from `../../curc-pacbot-rl/src`.
- The DQN module's default checkpoint path points into `src/checkpoints_all`, which is absent from the current RL checkout. All existing checkpoints were lost; DQN must require a caller-provided checkpoint path until a future default is available.
- `curc-pacbot-rl/src/models.py` currently defines `QNet`, `QNetV2`, `NetV2`, and `DebugMLPQNet`. Existing RL scripts import these through the top-level `models` module.
- The current RL checkout is clean at commit `3f7c2b9` on `main`; its remote is `git@github.com:FlyN-Nick/curc-pacbot-rl.git`.
- The user's root `README.md` has uncommitted edits. Implementation must preserve them and limit README edits to the Python setup instructions required by this migration.

## Selected approach

Create a focused installable model package inside `curc-pacbot-rl`, and add that repository as a root-level submodule in Pacbot. Keep the RL training project and its existing scripts functional through a compatibility module. In `bot_client`, manage base and DQN dependencies separately with `pyproject.toml` and `uv.lock`.

This keeps the bot's dependency boundary narrow. It avoids installing the RL training stack, avoids `sys.path` mutation, and pins the model code through the submodule commit.

## Repository and package layout

The Pacbot repository will contain:

```text
Pacbot-2026/
├── bot_client/
│   ├── pyproject.toml
│   └── uv.lock
└── curc-pacbot-rl/                 # Git submodule pinned by Pacbot
    └── model_package/
        ├── pyproject.toml
        └── pacbot_rl_models/
            ├── __init__.py
            └── models.py
```

The model definitions will have one canonical implementation in `model_package/pacbot_rl_models/models.py`. `curc-pacbot-rl/src/models.py` will remain as a compatibility re-export for existing training and evaluation scripts. The RL project's Poetry environment will include the local model package so these scripts can import it after the normal project environment is installed.

The model package will declare PyTorch as its runtime dependency. It will not include training-only libraries from the parent RL project. The existing RL project will remain Poetry-managed; its Poetry metadata and lockfile may be updated only as needed to install the focused local model package and preserve its current workflows.

## Bot dependency and runtime behavior

`bot_client/pyproject.toml` will declare the bot as a non-published project with Python 3.10 or newer. Base dependencies will include the libraries needed by the A* client (`numpy` and `websockets`). A `dqn` optional dependency group will include PyTorch and the local `pacbot-rl-models` package sourced from the submodule. Dependency constraints will be selected after checking current releases and compatibility; `uv.lock` will pin the resolved environment.

The DQN module will be imported only when `--strategy dqn` is selected. A* startup will not require PyTorch or the model submodule package. DQN startup will import `pacbot_rl_models.models` through the installed package.

The `--checkpoint` argument will have no implicit default. Selecting DQN without a checkpoint will produce a clear command-line error. A future checkpoint can be designated as a default in a separate update.

Expected workflows:

```sh
# A* / simulation
cd bot_client
uv sync
uv run python pacbotClient.py --force_no_bot

# DQN / simulation, after initializing the submodule
cd bot_client
uv sync --extra dqn
uv run python pacbotClient.py --force_no_bot --strategy dqn --checkpoint /path/to/checkpoint.pt
```

The root README and `bot_client/README.md` will document installing `uv`, these workflows, and submodule initialization for an existing checkout. The legacy `requirements.txt` will be removed once the project metadata and lockfile replace it.

## Compatibility and verification

Dependency versions will be chosen from current releases with available wheels for macOS, Windows, and Linux developer machines. Raspberry Pi is excluded. The universal uv lockfile will be checked for those platform markers.

Verification will include:

- Resolving and syncing the base and DQN environments with `uv`.
- Import smoke checks for the A* runtime without the DQN extra and for DQN model definitions with the extra installed.
- Checking that omitting `--checkpoint` in DQN mode reports the intended error, and that A* remains unaffected by the checkpoint requirement.
- Running available bot tests or focused runtime smoke checks after dependency upgrades.
- Confirming the RL project's existing `models` imports resolve through the compatibility re-export.
- Reviewing README commands and Git submodule instructions against the resulting layout.

No model checkpoint will be added to either repository as part of this work.

## Scope boundaries

- Changes in Pacbot are limited to the root submodule metadata, `bot_client` dependency/runtime setup, and relevant README instructions.
- Changes in `curc-pacbot-rl` are limited to packaging the reusable model definitions, preserving compatibility imports, and declaring the local package in its project environment.
- The Poetry-to-uv migration for the broader `curc-pacbot-rl` project is explicitly deferred. Its training dependencies, Rust extension setup, and documented workflows remain managed by Poetry.
- No checkpoint recovery, model retraining, broader RL training-stack migration, server changes, or hardware changes are included.
