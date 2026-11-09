// Child processes for the comparison runs, with cleanup that always runs.
import net from 'node:net';
import { spawn } from 'node:child_process';

/** A TCP port that is free right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Cleanup steps, run once in reverse order of registration. */
export function createCleanup() {
  const steps = [];
  let ran = false;

  async function run() {
    if (ran) return;
    ran = true;
    for (const step of steps.reverse()) {
      try { await step(); } catch { /* Keep cleaning up after a failed step. */ }
    }
  }

  return {
    add(step) { steps.push(step); },
    run,
    installSignalHandlers() {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, async () => {
          await run();
          process.exit(130);
        });
      }
    },
  };
}

// Stop a process group: SIGTERM, then SIGKILL after 2 s.
function stopGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
    }, 2000);
    child.once('exit', () => { clearTimeout(forceKill); resolve(); });
    try { process.kill(-child.pid, 'SIGTERM'); } catch { clearTimeout(forceKill); resolve(); }
  });
}

/**
 * Start a process in its own process group (so its children stop with it) and
 * resolve once its output matches readyPattern.
 */
export function startProcess(cmd, args, { cwd, env, readyPattern, timeoutMs = 60000 }, cleanup) {
  const child = spawn(cmd, args, { cwd, env: env ?? process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  cleanup.add(() => stopGroup(child));
  const output = [];

  return new Promise((resolve, reject) => {
    const lastLines = () => output.join('').split('\n').slice(-20).join('\n');
    const fail = (message) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} ${message}\n${lastLines()}`));
    };
    const timer = setTimeout(() => fail(`timed out after ${timeoutMs} ms waiting for ${readyPattern}`), timeoutMs);

    const onData = (chunk) => {
      output.push(chunk.toString());
      if (readyPattern.test(output.join(''))) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => fail(`failed to start: ${error.message}`));
    child.once('exit', (code) => fail(`exited early with code ${code}`));
  });
}
