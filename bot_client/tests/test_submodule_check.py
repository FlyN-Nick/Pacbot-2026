import subprocess
import tempfile
import unittest
from pathlib import Path

from submoduleCheck import check_rl_checkout

GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.com",
       "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main"]


def git(cwd, *args):
    return subprocess.run(GIT + list(args), cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


class SubmoduleCheckTests(unittest.TestCase):
    '''
    Builds a throwaway RL repo and a root repo that records it as the
    curc-pacbot-rl submodule, then checks each checkout state.
    '''

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.upstream = tmp / 'rl'
        self.upstream.mkdir()
        git(self.upstream, 'init', '-q')
        (self.upstream / 'models.py').write_text('v1\n')
        git(self.upstream, 'add', 'models.py')
        git(self.upstream, 'commit', '-q', '-m', 'rl1')

        self.root = tmp / 'root'
        self.root.mkdir()
        git(self.root, 'init', '-q')
        git(self.root, 'submodule', 'add', '-q', '-b', 'main', str(self.upstream), 'curc-pacbot-rl')
        git(self.root, 'commit', '-q', '-m', 'add rl')
        self.sub = self.root / 'curc-pacbot-rl'
        self.recorded = git(self.sub, 'rev-parse', 'HEAD')

    def tearDown(self):
        self._tmp.cleanup()

    def check(self):
        return check_rl_checkout(self.root)

    def bump_root_to_new_upstream_commit(self):
        '''Simulate a teammate's pointer bump that this checkout pulled without updating.'''
        git(self.upstream, 'commit', '-q', '--allow-empty', '-m', 'rl2')
        new = git(self.upstream, 'rev-parse', 'HEAD')
        git(self.sub, 'fetch', '-q', 'origin')
        git(self.root, 'update-index', '--cacheinfo', f'160000,{new},curc-pacbot-rl')
        git(self.root, 'commit', '-q', '-m', 'bump rl')

    def test_matching_commit_is_silent(self):
        self.assertIsNone(self.check())

    def test_own_branch_is_used_with_a_note(self):
        git(self.sub, 'switch', '-q', '-c', 'my-experiment')
        git(self.sub, 'commit', '-q', '--allow-empty', '-m', 'experiment')
        level, message = self.check()
        self.assertEqual(level, 'info')
        self.assertIn('my-experiment', message)

    def test_local_commits_on_main_are_used_with_a_note(self):
        git(self.sub, 'switch', '-q', 'main')
        git(self.sub, 'commit', '-q', '--allow-empty', '-m', 'local work')
        level, _ = self.check()
        self.assertEqual(level, 'info')

    def test_stale_detached_checkout_warns(self):
        git(self.sub, 'switch', '-q', '--detach')  # how a fresh recursive clone leaves it
        self.bump_root_to_new_upstream_commit()
        level, message = self.check()
        self.assertEqual(level, 'warning')
        self.assertIn('git submodule update', message)

    def test_stale_main_branch_warns(self):
        git(self.sub, 'switch', '-q', 'main')
        self.bump_root_to_new_upstream_commit()
        level, message = self.check()
        self.assertEqual(level, 'warning')
        self.assertIn('pull', message)

    def test_uncommitted_edits_are_used_with_a_note(self):
        git(self.sub, 'switch', '-q', '--detach')
        self.bump_root_to_new_upstream_commit()
        (self.sub / 'models.py').write_text('edited\n')
        level, message = self.check()
        self.assertEqual(level, 'info')
        self.assertIn('uncommitted', message)

    def test_newer_pushed_commit_when_root_expects_older_warns(self):
        '''Ahead of the recorded commit but already pushed: not local work.'''
        git(self.upstream, 'commit', '-q', '--allow-empty', '-m', 'rl2')
        git(self.sub, 'fetch', '-q', 'origin')
        git(self.sub, 'switch', '-q', '--detach', 'origin/main')
        level, message = self.check()
        self.assertEqual(level, 'warning')
        self.assertIn('git submodule update', message)

    def test_uninitialized_submodule_warns(self):
        git(self.root, 'submodule', 'deinit', '-q', '-f', 'curc-pacbot-rl')
        level, message = self.check()
        self.assertEqual(level, 'warning')
        self.assertIn('--init', message)

    def test_not_a_git_checkout_is_silent(self):
        with tempfile.TemporaryDirectory() as plain:
            self.assertIsNone(check_rl_checkout(Path(plain)))


if __name__ == '__main__':
    unittest.main()
