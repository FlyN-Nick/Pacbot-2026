'''
Startup check that the curc-pacbot-rl submodule matches what Pacbot-2026
records, without getting in the way of someone working on RL code.

The bot always uses whatever is checked out in curc-pacbot-rl/ (the model
package is installed from that folder and checkpoints are read from it).
This only tells a deliberate RL branch apart from a stale checkout left
behind by a `git pull` that didn't update submodules.
'''

import subprocess
from pathlib import Path

SUBMODULE = 'curc-pacbot-rl'


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
	return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True, timeout=5)


def check_rl_checkout(root: Path) -> tuple[str, str] | None:
	'''
	Compare the RL checkout under `root` with the commit `root` records.

	Returns None when there is nothing to say, or (level, message) where
	level is 'info' (deliberate RL work, which is used) or 'warning'
	(stale or missing checkout).
	'''
	try:
		listed = _git(root, 'ls-files', '-s', '--', SUBMODULE)
		if listed.returncode != 0 or not listed.stdout.startswith('160000 '):
			return None  # not a Pacbot-2026 git checkout (e.g. a source download)
		recorded = listed.stdout.split()[1]

		sub = root / SUBMODULE
		if not (sub / '.git').exists():
			return ('warning', f'{SUBMODULE} is not checked out. Run: git submodule update --init')

		current = _git(sub, 'rev-parse', 'HEAD').stdout.strip()
		if current == recorded:
			return None

		edited = _git(sub, 'status', '--porcelain', '--untracked-files=no').stdout.strip()
		branch = _git(sub, 'symbolic-ref', '-q', '--short', 'HEAD').stdout.strip()
		tracked = _git(root, 'config', '-f', '.gitmodules', '--get',
		               f'submodule.{SUBMODULE}.branch').stdout.strip() or 'main'
		# Commits that aren't on any remote branch are someone's RL work.
		unpushed = not _git(sub, 'branch', '-r', '--contains', 'HEAD').stdout.strip()
		ahead = _git(sub, 'merge-base', '--is-ancestor', recorded, 'HEAD').returncode == 0
	except (OSError, subprocess.SubprocessError):
		return None  # git missing or hung; never block the bot over this

	where = f'{current[:7]}, Pacbot-2026 records {recorded[:7]}'
	if edited:
		return ('info', f'Using uncommitted RL edits ({where})')
	if branch and branch != tracked:
		return ('info', f'Using RL branch {branch!r} ({where})')
	if unpushed:
		return ('info', f'Using unpushed RL commits ({where})')
	if branch and ahead:
		return ('info', f'Using RL {branch}, which is ahead ({where})')
	if branch:
		return ('warning', f'{SUBMODULE} {branch} is behind ({where}). '
		                   f'Run: git -C {SUBMODULE} pull')
	return ('warning', f'{SUBMODULE} is out of date ({where}). Run: git submodule update')
