import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { freePort, createCleanup, startProcess } from './processes.mjs';

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
