# Bot Client uv Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `bot_client` to a locked uv environment, make DQN models an installable dependency from a pinned RL submodule, and preserve A* and DQN workflows on developer machines.

**Architecture:** `curc-pacbot-rl` will expose model definitions through a focused `pacbot-rl-models` Python package while retaining `src/models.py` as a compatibility re-export. Pacbot will pin the RL repository as a root submodule; `bot_client` will declare NumPy and websockets as base dependencies and the local model package plus PyTorch as a DQN extra, with DQN imports deferred until selected.

**Tech Stack:** Python 3.10+, uv, universal `uv.lock`, PyTorch, NumPy, websockets, Poetry (retained in `curc-pacbot-rl`).

**Spec:** [2026-10-04-bot-client-uv-and-model-package-design.md](../specs/2026-10-04-bot-client-uv-and-model-package-design.md)

## Global Constraints

- The bot must support developer machines running macOS, Windows, and Linux; Raspberry Pi is not a target runtime.
- Base dependencies must cover the A* client; PyTorch and the focused local model package belong to the optional DQN extra.
- The Pacbot repository must pin `curc-pacbot-rl` as a root-level Git submodule.
- The existing `curc-pacbot-rl` project remains Poetry-managed; only metadata required to install the focused model package may change.
- DQN must require an explicit `--checkpoint` path; no checkpoint is included or assumed.
- The bot must not modify `sys.path` to find the RL model source.
- Preserve the user's existing uncommitted root `README.md` edits; change only the Python setup content needed for this migration.

## Review Focus

- A* import without the DQN extra or model package: prove importing the client does not load `torch` or `pacbot_rl_models`.
- DQN selection without a checkpoint: prove the CLI emits an actionable parser error before model initialization.
- DQN selection with a checkpoint path: prove the path reaches the model loader unchanged and package imports use `pacbot_rl_models.models`.
- Existing RL imports (`from models import QNet` and `import models`): prove the same classes remain available through the compatibility re-export.
- macOS, Windows, and Linux dependency resolution: prove the lock covers those platforms and their supported wheel markers without claiming runtime tests on unavailable platforms.

---

### Task 1: Package and preserve the RL model API

**Files:**
- Create in `curc-pacbot-rl`: `model_package/pyproject.toml`
- Create in `curc-pacbot-rl`: `model_package/pacbot_rl_models/__init__.py`
- Create in `curc-pacbot-rl`: `model_package/pacbot_rl_models/models.py`
- Modify in `curc-pacbot-rl`: `src/models.py`
- Modify in `curc-pacbot-rl`: `pyproject.toml`
- Modify in `curc-pacbot-rl`: `poetry.lock`

**Interfaces:**
- Produces the import `pacbot_rl_models.models` with `QNet`, `QNetV2`, `NetV2`, and `DebugMLPQNet`.
- Preserves existing `models` imports as re-exports of those same classes.
- The focused package declares PyTorch as its runtime dependency and excludes the parent project's training-only dependencies.

- [ ] **Step 1: Record the compatibility smoke check.** From `curc-pacbot-rl/src/`, run `poetry run python -c 'from models import QNet, QNetV2, NetV2, DebugMLPQNet; from pacbot_rl_models.models import QNet as PackageQNet; assert QNet is PackageQNet'`. Initially, it must fail because the focused package does not exist.
- [ ] **Step 2: Create `pacbot-rl-models`** under `model_package/` with a Poetry-compatible package definition, Python 3.10+ metadata, and PyTorch dependency. Move the four existing class definitions into `pacbot_rl_models/models.py`; export them from `__init__.py`.
- [ ] **Step 3: Preserve legacy imports.** Replace the definitions in `src/models.py` with explicit re-exports from `pacbot_rl_models.models`.
- [ ] **Step 4: Add the focused package to the RL Poetry environment.** Declare `model_package` as a path dependency in the existing Poetry project and refresh `poetry.lock` without migrating the project to uv.
- [ ] **Step 5: Run the compatibility smoke check** from `curc-pacbot-rl/src/`; confirm all four legacy names import and `QNet is PackageQNet`.
- [ ] **Step 6: Commit the RL package change** in `curc-pacbot-rl` so Pacbot can pin its exact commit as a submodule.

### Task 2: Add the submodule and migrate bot dependencies to uv

**Files:**
- Create: `.gitmodules` and root submodule entry `curc-pacbot-rl`
- Create: `bot_client/pyproject.toml`
- Create: `bot_client/uv.lock`
- Modify: `bot_client/.gitignore`
- Delete: `bot_client/requirements.txt`
- Modify: `bot_client/README.md`
- Modify: `README.md` (Python setup instructions only)

**Interfaces:**
- Base dependencies are compatible NumPy and websockets releases.
- Optional extra `dqn` installs PyTorch and `pacbot-rl-models` from `../curc-pacbot-rl/model_package`.
- `uv sync` installs A* dependencies; `uv sync --extra dqn` adds DQN support.

- [ ] **Step 1: Add `curc-pacbot-rl` as a root submodule** using the RL repository's remote URL and the commit produced by Task 1. Confirm `.gitmodules` records the root-relative path and the Git index pins that exact commit.
- [ ] **Step 2: Create `bot_client/pyproject.toml`** as a non-published uv project requiring Python 3.10 or newer. Declare NumPy and websockets in base dependencies, and PyTorch plus `pacbot-rl-models` in the `dqn` optional extra. Configure the uv local source path as `../curc-pacbot-rl/model_package`.
- [ ] **Step 3: Resolve current compatible releases** for macOS, Windows, and Linux. Check the current websockets synchronous-client API, NumPy compatibility, PyTorch wheel availability, and model-package constraints. Generate universal `uv.lock` and confirm its supported platform markers cover all three OS families.
- [ ] **Step 4: Ignore local environments** by adding `.venv/` to `bot_client/.gitignore`; remove `requirements.txt` once the project metadata and lockfile replace it.
- [ ] **Step 5: Update setup instructions.** In both READMEs, document installing uv, initializing the submodule (`git submodule update --init --recursive` for an existing clone), `uv sync`, A* execution with `uv run`, and DQN execution with `uv sync --extra dqn` plus an explicit checkpoint path. Preserve all unrelated root README edits.
- [ ] **Step 6: Verify both environments.** From `bot_client/`, run `uv lock --check`, `uv sync`, and `uv sync --extra dqn`; confirm base imports for NumPy/websockets and DQN imports for PyTorch and `pacbot_rl_models.models`.
- [ ] **Step 7: Commit the Pacbot dependency and documentation changes** without including unrelated user README edits.

### Task 3: Make DQN optional and require explicit checkpoints

**Files:**
- Modify: `bot_client/pacbotClient.py`
- Modify: `bot_client/dqn_module.py`
- Create: `bot_client/tests/test_strategy_dependencies.py`
- Create: `bot_client/tests/test_checkpoint_argument.py`

**Interfaces:**
- `parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace` parses options and rejects DQN without `--checkpoint`.
- `make_decision_module(args: argparse.Namespace, state: GameState) -> object` constructs A* without importing `dqn_module` and imports DQN locally only when selected.
- `dqn_module.py` imports `pacbot_rl_models.models` as `_dqn_models` and does not mutate `sys.path`.

- [ ] **Step 1: Write failing import-boundary tests.** `test_client_import_does_not_load_dqn` imports `pacbotClient` and asserts `dqn_module`, `torch`, and `pacbot_rl_models` are absent from `sys.modules`. `test_astar_decision_does_not_load_dqn` calls `make_decision_module` for A* with a mocked `DecisionModule` and confirms no DQN import. `test_dqn_uses_installed_model_package` supplies a fake `dqn_module` and confirms DQN selection passes the parsed checkpoint unchanged.
- [ ] **Step 2: Run `uv run python -m unittest discover -s tests -v`** from `bot_client/` and confirm the import-boundary tests fail against the current eager imports.
- [ ] **Step 3: Refactor CLI initialization.** Add `parse_args(argv=None)`, move argument parsing and `low_level.connect()` under the executable entry point, and use `make_decision_module(args, state)` from `PacbotClient`.
- [ ] **Step 4: Defer DQN imports.** Import `DQNDecisionModule` inside the DQN branch of `make_decision_module`; import `_dqn_models` from `pacbot_rl_models.models` in `dqn_module.py`; remove the `_RL_SRC` path insertion.
- [ ] **Step 5: Write failing checkpoint tests.** `test_dqn_requires_checkpoint` asserts `parse_args(['--strategy', 'dqn'])` raises `SystemExit` with the `--checkpoint` message. `test_astar_does_not_require_checkpoint` asserts A* options parse with `checkpoint is None`.
- [ ] **Step 6: Require explicit DQN checkpoints.** Remove `_DEFAULT_CHECKPOINT`, default the option to `None`, and issue `parser.error` only when strategy is DQN and no path was supplied.
- [ ] **Step 7: Run `uv run python -m unittest discover -s tests -v`** from `bot_client/` and confirm all import and CLI tests pass.
- [ ] **Step 8: Commit the bot runtime changes and tests.**

### Task 4: Verify end-to-end bot workflows

**Files:**
- No new files; verify tasks 1-3.

**Interfaces:**
- A* simulation: `uv run python pacbotClient.py --force_no_bot`.
- DQN simulation: `uv run --extra dqn python pacbotClient.py --force_no_bot --strategy dqn --checkpoint PATH`.

- [ ] **Step 1: Run bot unit tests** from `bot_client/` with `uv run python -m unittest discover -s tests -v`.
- [ ] **Step 2: Smoke-test A*** with `uv run python pacbotClient.py --help` and a local game-server simulation; confirm it runs without importing DQN dependencies.
- [ ] **Step 3: Smoke-test DQN loading** using the DQN extra and a temporary checkpoint fixture created from `QNetV2`; confirm the checkpoint loads and inference returns five action scores.
- [ ] **Step 4: Re-run the RL compatibility smoke check** through the existing Poetry environment after the model package refactor.
- [ ] **Step 5: Review final diffs in both repositories** to confirm the RL project remains Poetry-managed, the user's README edits are preserved, and no checkpoint artifacts are tracked.
