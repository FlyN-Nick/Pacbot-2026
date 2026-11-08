import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.com",
       "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main"]


def git(cwd, *args):
    return subprocess.run(GIT + list(args), cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


@unittest.skipIf(shutil.which("sh") is None, "scripts/setup.sh needs a POSIX shell")
class GitHooksTests(unittest.TestCase):
    '''
    Builds an RL upstream, a Pacbot-2026 upstream carrying the real
    .githooks/ and scripts/setup.sh, and a teammate clone that ran setup.
    Each test bumps the upstream pointer and pulls in the clone.
    '''

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)

        self.rl = tmp / 'rl'
        self.rl.mkdir()
        git(self.rl, 'init', '-q')
        (self.rl / 'models.py').write_text('v1\n')
        git(self.rl, 'add', '.')
        git(self.rl, 'commit', '-q', '-m', 'rl1')

        self.upstream = tmp / 'root'
        self.upstream.mkdir()
        git(self.upstream, 'init', '-q')
        shutil.copytree(REPO / '.githooks', self.upstream / '.githooks')
        shutil.copytree(REPO / 'scripts', self.upstream / 'scripts')
        git(self.upstream, 'submodule', 'add', '-q', '-b', 'main', str(self.rl), 'curc-pacbot-rl')
        git(self.upstream, 'add', '.')
        git(self.upstream, 'commit', '-q', '-m', 'init')

        self.clone = tmp / 'clone'
        git(tmp, 'clone', '-q', '--recurse-submodules', str(self.upstream), 'clone')
        subprocess.run(['sh', 'scripts/setup.sh'], cwd=self.clone, check=True,
                       capture_output=True, text=True, env=None)
        self.sub = self.clone / 'curc-pacbot-rl'

    def tearDown(self):
        self._tmp.cleanup()

    def bump_upstream(self, content='v2\n'):
        '''Commit new RL code upstream and record it in the Pacbot-2026 upstream.'''
        (self.rl / 'models.py').write_text(content)
        git(self.rl, 'commit', '-q', '-am', f'rl {content.strip()}')
        git(self.upstream, 'submodule', 'update', '-q', '--remote', 'curc-pacbot-rl')
        git(self.upstream, 'commit', '-q', '-am', 'bump rl')
        return git(self.rl, 'rev-parse', 'HEAD')

    def pull(self, *args):
        return subprocess.run(GIT + ['pull', *args], cwd=self.clone, check=True,
                              capture_output=True, text=True)

    def sub_head(self):
        return git(self.sub, 'rev-parse', 'HEAD')

    def sub_branch(self):
        return subprocess.run(['git', 'symbolic-ref', '-q', '--short', 'HEAD'], cwd=self.sub,
                              capture_output=True, text=True).stdout.strip()

    def test_setup_configures_the_clone(self):
        self.assertEqual(git(self.clone, 'config', 'core.hooksPath'), '.githooks')
        self.assertEqual(git(self.clone, 'config', 'submodule.recurse'), 'false')
        self.assertEqual(git(self.clone, 'config', 'push.recurseSubmodules'), 'check')
        self.assertTrue(git(self.clone, 'config', 'alias.bump-rl'))

    def test_setup_initializes_a_missing_checkout(self):
        git(self.clone, 'submodule', 'deinit', '-q', '-f', 'curc-pacbot-rl')
        subprocess.run(['sh', 'scripts/setup.sh'], cwd=self.clone, check=True, capture_output=True)
        self.assertTrue((self.sub / 'models.py').exists())

    def test_setup_keeps_an_rl_branch(self):
        git(self.sub, 'switch', '-q', 'main')
        subprocess.run(['sh', 'scripts/setup.sh'], cwd=self.clone, check=True, capture_output=True)
        self.assertEqual(self.sub_branch(), 'main')

    def test_pull_updates_a_detached_checkout(self):
        new = self.bump_upstream()
        self.pull('--no-rebase')
        self.assertEqual(self.sub_head(), new)

    def test_rebase_pull_updates_a_detached_checkout(self):
        new = self.bump_upstream()
        self.pull('--rebase')
        self.assertEqual(self.sub_head(), new)

    def test_rebase_pull_with_local_commits_updates(self):
        (self.clone / 'notes.txt').write_text('local\n')
        git(self.clone, 'add', 'notes.txt')
        git(self.clone, 'commit', '-q', '-m', 'local root commit')
        new = self.bump_upstream()
        self.pull('--rebase')
        self.assertEqual(self.sub_head(), new)

    def test_pull_keeps_an_rl_branch(self):
        git(self.sub, 'switch', '-q', '-c', 'my-experiment')
        (self.sub / 'models.py').write_text('experiment\n')
        git(self.sub, 'commit', '-q', '-am', 'experiment')
        mine = self.sub_head()
        self.bump_upstream()
        result = self.pull('--no-rebase')
        self.assertEqual(self.sub_branch(), 'my-experiment')
        self.assertEqual(self.sub_head(), mine)
        self.assertIn('my-experiment', result.stderr)

    def test_pull_keeps_uncommitted_rl_edits(self):
        (self.sub / 'models.py').write_text('edited\n')
        self.bump_upstream()
        self.pull('--no-rebase')
        self.assertEqual((self.sub / 'models.py').read_text(), 'edited\n')

    def test_pull_fast_forwards_rl_main(self):
        git(self.sub, 'switch', '-q', 'main')
        new = self.bump_upstream()
        self.pull('--no-rebase')
        self.assertEqual(self.sub_branch(), 'main')
        self.assertEqual(self.sub_head(), new)

    def test_pull_keeps_local_commits_on_rl_main(self):
        git(self.sub, 'switch', '-q', 'main')
        (self.sub / 'local.py').write_text('mine\n')
        git(self.sub, 'add', 'local.py')
        git(self.sub, 'commit', '-q', '-m', 'local rl work')
        mine = self.sub_head()
        self.bump_upstream()
        self.pull('--no-rebase')
        self.assertEqual(self.sub_branch(), 'main')
        self.assertEqual(self.sub_head(), mine)

    def test_switching_root_branches_updates_the_checkout(self):
        old = self.sub_head()
        new = self.bump_upstream()
        self.pull('--no-rebase')
        git(self.clone, 'switch', '-q', '--detach', 'HEAD~1')
        self.assertEqual(self.sub_head(), old)
        git(self.clone, 'switch', '-q', 'main')
        self.assertEqual(self.sub_head(), new)


if __name__ == '__main__':
    unittest.main()
