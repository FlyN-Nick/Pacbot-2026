// Focused review regressions: real App/components/Web Audio, representative
// binary wire transitions. No fixture API, frame overrides, or game timing edits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCleanup, freePort, startProcess } from './processes.mjs';
import { launchBrowser } from './run.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = name => process.argv[process.argv.indexOf(name) + 1];
const out = path.resolve(process.argv.includes('--out') ? option('--out') : '.superpowers/sdd/2026-11-10-sequence-validation/final-fix-evidence/browser');
fs.mkdirSync(out, { recursive: true });
const cleanup = createCleanup();
cleanup.installSignalHandlers();
const results = [];
const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
let browser, port;

function packet(state) {
  const bytes = Buffer.alloc(159);
  bytes.writeUInt16BE(state.tick, 0);
  bytes[2] = 12;
  bytes[3] = state.mode;
  bytes.writeUInt16BE(state.score, 8);
  bytes[10] = state.level;
  bytes[11] = state.lives;
  bytes[12] = state.combo;
  state.ghosts.forEach((g, i) => bytes.set(g, 13 + i * 4));
  bytes.set(state.pacman, 29);
  bytes.set([32, 32, 0, 0], 31);
  for (let i = 0; i < 31; i++) bytes.writeUInt32BE(0x100, 35 + i * 4);
  return bytes;
}

async function test(name, mode, run) {
  if (process.argv.includes('--only') && !name.startsWith(option('--only'))) return;
  const page = await browser.newPage({ viewport: { width: 448, height: 640 } });
  const commands = [], botCommands = [], errors = [];
  let wire;
  const state = { tick: 100, mode: 1, lives: name.startsWith('R3-') ? (name.endsWith('-cached') ? 2 : 1) : 3, score: 100, level: 1, combo: 0,
    pacman: [23, 8], ghosts: [[11, 13, 0, 0], [13, 13, 0, 0], [14, 11, 0, 0], [14, 15, 0, 0]] };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__actualBufferStarts = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const result = original.apply(this, args);
      window.__actualBufferStarts.push({ at: performance.now(), duration: this.buffer?.duration });
      return result;
    };
  });
  await page.routeWebSocket(/:39999\//, route => {
    wire = route;
    route.onMessage(message => commands.push({ command: message, at: Date.now() }));
  });
  await page.routeWebSocket(/:3003\//, route => route.onMessage(message => botCommands.push(message)));
  const send = async changes => {
    Object.assign(state, changes);
    state.tick += 12;
    wire.send(packet(state));
    await page.waitForFunction(tick => window.__arcadeTimeline.state()?.tick === tick, state.tick);
    await page.waitForTimeout(40);
  };
  const observed = () => page.evaluate(() => window.__arcadeLive.latest());
  try {
    await page.goto(`http://localhost:${port}/?timeline=1&observe=1&mode=${mode}&ws=39999`);
    await page.waitForFunction(() => window.__arcadeTimeline);
    assert.ok(wire, 'wire connection established');
    await send({});
    assert.equal(await page.evaluate(() => typeof window.__arcadeVisual), 'undefined');
    await run({ page, send, state, observed, commands, botCommands });
    assert.deepEqual(errors, []);
    results.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'fail', error: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    write(`${name}.json`, { commands, botCommands, errors,
      trace: await page.evaluate(() => window.__arcadeLive?.snapshot()).catch(() => null),
      actualAudioStarts: await page.evaluate(() => window.__actualBufferStarts).catch(() => []),
      provenance: { input: 'representative binary WebSocket transitions', renderer: 'production App and components', audio: 'actual browser AudioBufferSourceNode.start', fixtureAPI: false, frameOverrides: false } });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.close();
    write('results.json', results);
  }
}

async function death({ page, send, observed }, lives, position) {
  await send({ pacman: position });
  await send({ lives, pacman: [23, 13], mode: 0 });
  await page.waitForFunction(() => window.__arcadeLive.latest()?.render.frame?.startsWith('death-'), null, { timeout: 5000 });
  const row = await observed();
  assert.equal(row.render.x, position[1] * 8 + 4, 'active death stays at captured column');
  assert.equal(row.render.y, position[0] * 8 + 4, 'active death stays at captured row');
  await page.waitForFunction(() => {
    const row = window.__arcadeLive.latest();
    return row?.presentation.kind === null && !row.presentation.dying && row.render.frame?.startsWith('pacman-');
  }, null, { timeout: 9000 });
}

async function remountCase(ctx, kind) {
  const { page, send, observed } = ctx;
  await death(ctx, 2, [23, 8]);
  await send({ mode: 1, pacman: [5, 6] });
  const oldActor = await page.locator('.pacman-position').elementHandle();
  if (kind === 'ghost') {
    await send({ combo: 1, score: 300, ghosts: [[11, 13, 0, 128], [13, 13, 0, 0], [14, 11, 0, 0], [14, 15, 0, 0]] });
  } else {
    await send({ level: 2, mode: 0, pacman: [23, 13] });
  }
  await page.waitForFunction(() => !document.querySelector('.pacman-position'), null, { timeout: 4000 });
  assert.equal(await oldActor.evaluate(el => el.isConnected), false, 'sequence actually unmounted Pacman');
  const hiddenAt = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => document.querySelector('.pacman-position'), null, { timeout: 5000 });
  await page.waitForTimeout(650);
  const row = await observed();
  assert.equal(row.render.x, kind === 'ghost' ? 52 : 108, 'remount uses live/new-level column, not old collision');
  assert.equal(row.render.y, kind === 'ghost' ? 44 : 188, 'remount uses live/new-level row');
  assert.match(row.render.frame, /^pacman-/, 'remount must not replay old death artwork');
  const remountedRows = await page.evaluate(at => window.__arcadeLive.snapshot().rows.filter(row => row.at > at && row.render.frame), hiddenAt);
  assert.ok(remountedRows.length > 10, 'observe the remounted actor across multiple painted frames');
  assert.ok(remountedRows.every(row => row.render.frame.startsWith('pacman-')), 'no old death frames anywhere after remount');
  await page.waitForFunction(() => !window.__arcadeLive.latest()?.presentation.kind, null, { timeout: 5000 });
  await send({ mode: 1 });
  await death(ctx, 1, [8, 21]);
}

async function finalDeath(ctx, { cache, cancel }) {
  const { page, send, observed, commands } = ctx;
  const enabled = cancel !== 'disabled';
  if (enabled) await page.getByRole('button', { name: 'Unmute game audio', exact: true }).click();
  if (cache) {
    await death(ctx, 1, [23, 8]);
    assert.equal(await page.evaluate(() => window.__actualBufferStarts.length), 1, 'priming death actually played');
  }
  await send({ lives: 1, mode: 1, pacman: [7, 6] });
  let release, requested;
  const requestSeen = new Promise(resolve => requested = resolve);
  if (!cache && enabled) {
    await page.route('**/audio/pacman_death.wav', async route => {
      requested();
      await new Promise(resolve => release = resolve);
      await route.continue();
    });
  }
  const before = await page.evaluate(() => window.__actualBufferStarts.length);
  commands.length = 0;
  await send({ lives: 0, mode: 0, pacman: [32, 32] });
  if (!cache && enabled) {
    await Promise.race([requestSeen, page.waitForTimeout(5000).then(() => { throw Error('death asset never requested'); })]);
    if (cancel === 'reset') {
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await send({ tick: 0, lives: 3, mode: 0, score: 0 });
    }
    if (cancel === 'mute') await page.getByRole('button', { name: 'Mute game audio', exact: true }).click();
    release();
  }
  if (!cancel) {
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__actualBufferStarts.length), before + 1, 'final death must start exactly one actual audio source');
    const audio = await page.evaluate(() => window.__arcadeLive.snapshot().events.filter(e => e.type === 'audio-start' && e.name === 'death'));
    assert.equal(audio.length, cache ? 2 : 1, 'death callback follows the actual source start');
    await page.waitForTimeout(4500);
    assert.equal((await observed()).server.lives, 0);
    assert.equal(commands.some(c => c.command === 'P'), false, 'terminal death never resumes');
    assert.equal(await page.evaluate(() => window.__actualBufferStarts.length), before + 1);
  } else {
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__actualBufferStarts.length), before, `${cancel} prevents pending death playback`);
  }
}

async function gridInput({ page, send, commands, botCommands }) {
  const grid = page.locator('#grid-element-23-8');
  await grid.click();
  assert.equal(await grid.evaluate(el => el === document.activeElement), true);
  assert.deepEqual(botCommands, ['clicked 23 8']);
  for (const [key, command] of [['w', 'w'], ['a', 'a'], ['s', 's'], ['d', 'd'], ['ArrowUp', 'w'], ['ArrowLeft', 'a'], ['ArrowDown', 's'], ['ArrowRight', 'd']]) {
    await send({});
    const before = commands.length;
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
    assert.deepEqual(commands.slice(before).map(c => c.command), [command], `${key} after grid click`);
  }
  await page.keyboard.press('i');
  assert.ok(await page.locator('.grid-element.intersection').count() > 0, 'intersection shortcut reaches game');
  await page.keyboard.press('i');
  assert.equal(await page.locator('.grid-element.intersection').count(), 0);
  await send({});
  const shiftBefore = commands.length;
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(40);
  assert.deepEqual(commands.slice(shiftBefore).map(c => c.command), ['x' + String.fromCharCode(23, 6)], 'shift movement reaches the next intersection');
  const before = commands.length;
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
  assert.deepEqual(commands.slice(before).map(c => c.command), ['p', 'r']);
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Mute game audio', exact: true }).waitFor();
  // HUD buttons retain native activation and isolate unrelated game shortcuts.
  const pause = page.getByRole('button', { name: 'Start / pause', exact: true });
  await pause.focus();
  const hudBefore = commands.length;
  for (const key of ['w', 'ArrowUp', 'p', 'Escape', 'i', 'm']) await page.keyboard.press(key);
  assert.equal(commands.length, hudBefore);
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(40);
  assert.deepEqual(commands.slice(hudBefore).map(c => c.command), ['p', 'p'], 'each HUD activation sends only its own pause');
  // Editable controls can be embedded without leaking keystrokes to the game.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'regression-input';
    document.body.append(input);
    input.focus();
  });
  const formBefore = commands.length;
  await page.keyboard.type('wasd pim');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#regression-input').inputValue(), 'wasd pim');
  assert.equal(commands.length, formBefore);
}

try {
  port = await freePort();
  const args = process.argv.includes('--built')
    ? ['vite', 'preview', '--outDir', path.resolve(option('--built')), '--port', String(port), '--strictPort']
    : ['vite', '--port', String(port), '--strictPort'];
  await startProcess('npx', args, { cwd: path.join(repo, 'web_client'), readyPattern: /Local:/ }, cleanup);
  browser = await launchBrowser();
  cleanup.add(() => browser.close());
  await test('R1-ghost-remount', 'arcade', ctx => remountCase(ctx, 'ghost'));
  await test('R1-level-remount', 'arcade', ctx => remountCase(ctx, 'level'));
  for (const mode of ['competition', 'arcade']) {
    for (const cache of [false, true]) await test(`R3-${mode}-${cache ? 'cached' : 'loading'}`, mode, ctx => finalDeath(ctx, { cache }));
    for (const cancel of ['disabled', 'reset', 'mute']) await test(`R3-${mode}-${cancel}`, mode, ctx => finalDeath(ctx, { cache: false, cancel }));
  }
  await test('R4-grid-and-controls', 'competition', gridInput);
} finally {
  await cleanup.run();
}
