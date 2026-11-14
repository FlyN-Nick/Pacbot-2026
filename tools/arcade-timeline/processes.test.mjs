import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { freePort, createCleanup, startProcess, runWithTimeout } from './processes.mjs';

const isRunning = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

test('freePort returns a port that can be listened on', async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0);
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
  await new Promise((resolve) => server.close(resolve));
});

test('cleanup runs in reverse order, past errors, only once', async () => {
  const cleanup = createCleanup();
  const calls = [];
  cleanup.add(() => calls.push('first'));
  cleanup.add(() => { throw new Error('boom'); });
  cleanup.add(async () => calls.push('third'));
  await cleanup.run();
  await cleanup.run();
  assert.deepEqual(calls, ['third', 'first']);
});

test('startProcess resolves when ready, and cleanup stops the process', async () => {
  const cleanup = createCleanup();
  const child = await startProcess(process.execPath,
    ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
    { readyPattern: /ready/, timeoutMs: 5000 }, cleanup);
  assert.ok(isRunning(child.pid));
  await cleanup.run();
  assert.equal(isRunning(child.pid), false);
});

test('startProcess rejects with the output of a process that exits early', async () => {
  const cleanup = createCleanup();
  await assert.rejects(
    startProcess(process.execPath, ['-e', "console.log('config missing'); process.exit(1)"],
      { readyPattern: /ready/, timeoutMs: 5000 }, cleanup),
    /config missing/);
  await cleanup.run();
});

test('startProcess rejects on timeout and still cleans up', async () => {
  const cleanup = createCleanup();
  let error;
  try {
    await startProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { readyPattern: /ready/, timeoutMs: 300 }, cleanup);
  } catch (e) { error = e; }
  assert.match(error?.message ?? '', /timed out/);
  await cleanup.run();
});

test('a second cleanup run waits for the one in progress', async () => {
  const cleanup = createCleanup();
  let finished = false;
  cleanup.add(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    finished = true;
  });
  const first = cleanup.run();
  await cleanup.run();
  assert.equal(finished, true);
  await first;
});

test('completed producers remove their signal listeners', async () => {
  const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  for (let i = 0; i < 12; i++) {
    const cleanup = createCleanup();
    cleanup.installSignalHandlers();
    await cleanup.run();
  }
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), before);
});

for (const repeated of [false, true]) {
  test(`SIGINT awaits active producer teardown after a completed producer (repeated=${repeated})`, async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createCleanup } from ${JSON.stringify(new URL('./processes.mjs', import.meta.url).href)};
      const completed = createCleanup();
      completed.installSignalHandlers();
      await completed.run();
      const active = createCleanup();
      active.installSignalHandlers();
      active.add(async () => {
        console.log('cleanup started');
        await new Promise(resolve => setTimeout(resolve, 150));
        console.log('cleanup finished');
      });
      console.log('ready');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', sent = false, resent = false;
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!sent && output.includes('ready')) {
        sent = true;
        child.kill('SIGINT');
      }
      if (repeated && !resent && output.includes('cleanup started')) {
        resent = true;
        child.kill('SIGINT');
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', chunk => errors += chunk);
    const [code, signal] = await new Promise(resolve => child.on('close', (...args) => resolve(args)));
    clearTimeout(watchdog);
    assert.equal(code, 130, `${signal}: ${errors}`);
    assert.equal(output.match(/cleanup finished/g)?.length, 1, output);
    if (repeated) assert.equal(resent, true);
  });
}

test('runWithTimeout returns the result without waiting for the timeout', async () => {
  const started = Date.now();
  assert.equal(await runWithTimeout(async () => 'done', 60000), 'done');
  assert.ok(Date.now() - started < 1000);
});

test('runWithTimeout stops work that runs too long', async () => {
  let stoppedBySignal = false;
  await assert.rejects(runWithTimeout(async (signal) => {
    while (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 10));
    stoppedBySignal = true;
  }, 50), /timed out after 50 ms/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(stoppedBySignal, true);
});
