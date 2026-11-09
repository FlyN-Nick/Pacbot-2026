#!/bin/sh
# One-time setup for a Pacbot-2026 clone. Run from anywhere in the repo:
#   sh scripts/setup.sh
# (On Windows, run it from Git Bash.)
set -e

cd "$(git rev-parse --show-toplevel)"

# Hooks in .githooks/ keep curc-pacbot-rl in sync after pulls and checkouts,
# leaving it alone while you work on RL code (see .githooks/sync-rl-submodule).
hooks=$(git rev-parse --git-path hooks)
custom=$(find "$hooks" -type f ! -name '*.sample' 2>/dev/null | head -n 1)
if [ -n "$custom" ]; then
	echo "Note: your hooks in $hooks are replaced by .githooks/ for this repo."
fi
git config core.hooksPath .githooks

# The hooks handle submodule updates. A global submodule.recurse=true would
# switch the submodule off your RL branch before they run, so turn it off here.
git config submodule.recurse false

# Refuse to push a pointer to an RL commit that isn't on GitHub yet.
git config push.recurseSubmodules check

# git bump-rl: move the pointer to the latest RL main and commit it.
git config alias.bump-rl '!git submodule update --remote --merge curc-pacbot-rl && git add curc-pacbot-rl && git commit -m "chore: update rl submodule pointer"'

# Check out curc-pacbot-rl if needed, without moving it off an RL branch.
sh .githooks/sync-rl-submodule

echo "Setup done: curc-pacbot-rl now stays in sync when you pull or switch branches."
