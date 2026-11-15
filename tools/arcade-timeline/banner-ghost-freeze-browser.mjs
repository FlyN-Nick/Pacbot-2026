// Production App regression: real binary packets and DOM geometry, no fixture API.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCleanup, freePort, startProcess } from './processes.mjs';
import { launchBrowser } from './run.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = name => process.argv[process.argv.indexOf(name) + 1];
const out = path.resolve(process.argv.includes('--out') ? option('--out') : '.superpowers/sdd/2026-11-13-banner-ghost-freeze/evidence/browser');
fs.mkdirSync(out, { recursive: true });
const cleanup = createCleanup();
cleanup.installSignalHandlers();
const results = [];
const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
let browser, port;
const moving = [[5, 6 | 64, 0, 0], [8, 9 | 192, 0, 0], [13 | 192, 13, 128, 0], [11 | 64, 13, 128, 0]];
const respawn = [[11, 13 | 192, 128, 0], [13 | 192, 13, 128, 0], [14 | 64, 11, 128, 0], [14 | 64, 15, 128, 0]];
const absent = Array.from({ length: 4 }, () => [32, 32, 128, 0]);

function packet(state) {
  const bytes = Buffer.alloc(159);
  bytes.writeUInt16BE(state.tick, 0);
  bytes[2] = state.period;
  bytes[3] = state.mode;
  bytes.writeUInt16BE(state.score, 8);
  bytes[10] = state.level;
  bytes[11] = state.lives;
  state.ghosts.forEach((g, i) => bytes.set(g, 13 + i * 4));
  bytes.set(state.pacman, 29);
  bytes.set([32, 32, 0, 0], 31);
  bytes.writeUInt32BE(1 << 9, 35 + 23 * 4);
  return bytes;
}

async function test(name, mode, run, viewport = { width: 448, height: 640 }) {
  if (process.argv.includes('--only') && !name.includes(option('--only'))) return;
  const page = await browser.newPage({ viewport });
  const commands = [], errors = [], samples = [];
  let wire;
  const state = { tick: 106, period: 12, mode: 1, lives: 3, score: 100, level: 1,
    pacman: [23, 8], ghosts: moving };
  page.on('pageerror', error => errors.push(error.message));
  // Intercept every game/bot socket; never contact user services (including 3003).
  await page.routeWebSocket(/.*/, route => {
    if (route.url().includes(':39999/')) {
      wire = route;
      route.onMessage(command => commands.push(command));
    }
  });
  const send = async changes => {
    Object.assign(state, changes);
    wire.send(packet(state));
    await page.waitForFunction(({ tick, lives, level }) => {
      const frame = window.__arcadeTimeline.state();
      return frame?.tick === tick && frame.lives === lives && frame.level === level;
    }, state);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const sample = async label => {
    const row = await page.evaluate(() => {
      const board = document.querySelector('.maze-space').getBoundingClientRect();
      const grid = board.width / 28;
      return { grid, ghosts: [...document.querySelectorAll('.ghost')].map(el => {
        const r = el.getBoundingClientRect();
        return { color: el.dataset.ghostColor, x: (r.x + r.width / 2 - board.x) / grid * 8,
          y: (r.y + r.height / 2 - board.y) / grid * 8 };
      }), presentation: window.__arcadeLive.latest()?.presentation };
    });
    samples.push({ label, ...row });
    return row.ghosts;
  };
  try {
    await page.goto(`http://localhost:${port}/?timeline=1&observe=1&mode=${mode}&ws=39999`);
    await page.waitForFunction(() => window.__arcadeTimeline);
    await send({});
    assert.equal(await page.evaluate(() => typeof window.__arcadeVisual), 'undefined');
    await run({ page, send, sample, state, commands, samples });
    assert.deepEqual(errors, []);
    results.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'fail', error: error.stack });
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    write(`${name}.json`, { samples, commands, errors,
      provenance: { input: 'representative binary WebSocket transitions', renderer: 'production App/components', fixtureAPI: false } });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.close();
    write('results.json', results);
  }
}

function samePositions(actual, expected, label) {
  assert.deepEqual(actual.map(g => g.color), expected.map(g => g.color), `${label}: same visible ghosts`);
  actual.forEach((g, i) => {
    assert.ok(Math.abs(g.x - expected[i].x) < 0.03 && Math.abs(g.y - expected[i].y) < 0.03,
      `${label}: ${g.color} moved from (${expected[i].x}, ${expected[i].y}) to (${g.x}, ${g.y})`);
  });
}

async function continuity({ page, send, sample, commands }, mode, kind, period) {
  // tick 106/12 = 5/6 of a tile; independently calculated geometry in native pixels.
  const before = await sample('before');
  samePositions(before, [
    { color: 'red', x: 58.6666667, y: 44 },
    { color: 'pink', x: 69.3333333, y: 68 },
    { color: 'cyan', x: 112, y: 102 },
    { color: 'orange', x: 108.6666667, y: 98.6666667 },
  ], 'nonzero fractional tick with all directions and spawn offsets');
  await page.screenshot({ path: path.join(out, `${mode}-${kind}-${period}-before.png`) });
  await send({ tick: 108, period, mode: 1, pacman: [32, 32], ghosts: kind === 'terminal' ? moving.map(([r, c, f, t]) => [r & 31, c & 31, f, t]) : absent,
    ...(kind === 'level' ? { level: 2 } : { lives: kind === 'terminal' ? 0 : 2 }) });
  const at = await sample('at-transition');
  // Capture even on RED, so failure artifacts include both sides of the jump.
  await page.screenshot({ path: path.join(out, `${mode}-${kind}-${period}-at.png`) });
  if (mode === 'competition' && kind === 'ordinary') assert.deepEqual(at, [], 'protocol-hidden ghosts stay hidden');
  else samePositions(at, before, 'transition');
  // Next update acknowledges the server pause; terminal direction bits can clear.
  await send({ tick: 120, period: 9, mode: 0,
    pacman: kind === 'terminal' ? [32, 32] : [23, 13],
    ghosts: kind === 'terminal' ? moving.map(([r, c]) => [r & 31, c & 31, 0, 0]) : respawn });
  const through = await sample('pause-acknowledgement');
  if (mode === 'competition' && kind === 'ordinary') {
    assert.notDeepEqual(through, before, 'genuine competition respawn is immediate');
  } else {
    samePositions(through, before, 'pause acknowledgement with changed period');
    await page.waitForTimeout(200);
    samePositions(await sample('through-hold'), before, 'held display');
  }
  if (kind === 'terminal' && mode === 'competition') {
    await page.waitForTimeout(2750);
    samePositions(await sample('after-death-animation'), before, 'terminal ghosts stay put');
    await send({ tick: 0, lives: 3, pacman: [23, 13], ghosts: respawn });
    assert.notDeepEqual(await sample('reset'), before, 'new game clears terminal snapshot');
  } else if (mode === 'arcade' && kind === 'ordinary') {
    await page.waitForFunction(() => document.querySelectorAll('.ghost').length === 0);
    await page.waitForFunction(() => document.querySelector('.ready-banner'), null, { timeout: 6000 });
    assert.notDeepEqual(await sample('ready-respawn'), before, 'READY shows actual respawn');
  } else if (kind === 'level') {
    // An outside resume must show the current board immediately in either mode.
    await send({ tick: 121, mode: 1, ghosts: respawn });
    assert.notDeepEqual(await sample('resumed-new-board'), before, 'live board replaces clear snapshot');
  }
  if (mode === 'competition') assert.deepEqual(commands, [], 'competition never holds or resumes server');
}

async function banner({ page, send, samples }) {
  await send({ tick: 108, lives: 0, mode: 0, pacman: [32, 32], ghosts: absent });
  const geometry = await page.evaluate(() => {
    const board = document.querySelector('.game-effects').getBoundingClientRect();
    const text = document.querySelector('.game-over-banner .arcade-text').getBoundingClientRect();
    return { board: { x: board.x, width: board.width }, text: { x: text.x, width: text.width },
      centerError: text.x + text.width / 2 - board.x - board.width / 2 };
  });
  samples.push({ label: 'GAME OVER text bounds', ...geometry });
  await page.screenshot({ path: path.join(out, `game-over-${page.viewportSize().width}.png`) });
  assert.ok(Math.abs(geometry.centerError) < 0.05, `GAME OVER center error ${geometry.centerError}px`);
  // Start a fresh paused game, then trigger READY through the real control.
  await send({ tick: 0, lives: 3, pacman: [23, 13], ghosts: respawn });
  await page.getByRole('button', { name: 'Start / pause', exact: true }).click();
  const ready = await page.locator('.ready-banner .arcade-text').evaluate(el => {
    const r = el.getBoundingClientRect(), b = document.querySelector('.game-effects').getBoundingClientRect();
    return { leftTiles: (r.x - b.x) / (b.width / 28), topTiles: (r.y - b.y) / (b.width / 28) };
  });
  samples.push({ label: 'READY native position', ...ready });
  assert.ok(Math.abs(ready.leftTiles - 11) < 0.01 && Math.abs(ready.topTiles - 17) < 0.01);
}

async function terminalRelease({ send, sample, commands }, release) {
  const before = await sample('before');
  const stopped = moving.map(([r, c, f, t]) => [r & 31, c & 31, f, t]);
  await send({ tick: 108, lives: 0, mode: 0, ghosts: stopped });
  samePositions(await sample('terminal'), before, 'terminal capture');
  if (release === 'hidden') {
    await send({ tick: 109, ghosts: absent });
    assert.deepEqual(await sample('hidden'), [], 'terminal snapshot cannot resurrect hidden ghosts');
  } else if (release === 'relocated') {
    await send({ tick: 109, ghosts: respawn });
    assert.notDeepEqual(await sample('relocated'), before, 'a genuine relocation releases terminal snapshot');
  } else {
    await send({ tick: 109, level: 2, ghosts: stopped });
    // Existing level sequence owns its own hold, then an outside resume releases it.
    await send({ tick: 110, mode: 1, ghosts: stopped });
    assert.notDeepEqual(await sample('new-board'), before, 'new board releases terminal snapshot');
  }
  // A later live packet must use its own phase even if it revisits the old tiles.
  await send({ tick: 111, mode: 1, ghosts: moving });
  samePositions(await sample('live-after-release'), [
    { color: 'red', x: 54, y: 44 }, { color: 'pink', x: 74, y: 68 },
    { color: 'cyan', x: 112, y: 109 }, { color: 'orange', x: 111, y: 94 },
  ], 'fresh live phase after release');
  assert.deepEqual(commands, [], 'terminal rendering never controls the server');
}

try {
  port = await freePort();
  await startProcess('npx', ['vite', '--port', String(port), '--strictPort'],
    { cwd: path.join(repo, 'web_client'), readyPattern: /Local:/ }, cleanup);
  browser = await launchBrowser();
  cleanup.add(() => browser.close());
  for (const [label, viewport] of Object.entries({ native: { width: 224, height: 304 }, fractional: { width: 375, height: 653 }, large: { width: 1120, height: 1600 } })) {
    await test(`banner-${label}`, 'arcade', banner, viewport);
  }
  for (const mode of ['arcade', 'competition']) {
    for (const kind of ['ordinary', 'terminal', 'level']) {
      for (const period of [12, 10]) {
        await test(`${mode}-${kind}-${period}`, mode, ctx => continuity(ctx, mode, kind, period));
      }
    }
  }
  for (const release of ['hidden', 'relocated', 'new-board']) {
    await test(`competition-terminal-release-${release}`, 'competition', ctx => terminalRelease(ctx, release));
  }
} finally {
  await cleanup.run();
}
