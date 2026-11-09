import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
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
