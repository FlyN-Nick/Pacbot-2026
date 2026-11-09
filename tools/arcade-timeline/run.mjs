// npm run compare: run the visualizer through each scenario in headless Chrome
// against its own game server, then compare with the arcade reference.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { freePort, createCleanup, startProcess, runWithTimeout } from './processes.mjs';
import { compareTimelines, reduceTimeline, formatReport } from './compare.mjs';
import { SCENARIOS } from './gui-scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const SCENARIO_TIMEOUT_MS = 60000;
const BROWSER_OPTIONS = {
  headless: true,
  args: ['--disable-skia-graphite', '--autoplay-policy=no-user-gesture-required'],
  // Our cleanup closes the browser; Playwright's own signal handlers would exit
  // the process before the game and preview servers are stopped.
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Installed Google Chrome first; Playwright's own Chromium if Chrome isn't there.
async function launchBrowser() {
  try {
    return await chromium.launch({ ...BROWSER_OPTIONS, channel: 'chrome' });
  } catch {
    return chromium.launch(BROWSER_OPTIONS);
  }
}

// The game server reads ../config.json, so give it its own folder and config.
async function startGameServer(tmp, cleanup) {
  const wsPort = await freePort();
  const tcpPort = await freePort();
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'config.json'), 'utf8'));
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ ...config, WebSocketPort: wsPort, TcpPort: tcpPort }));
  const serverDir = path.join(tmp, 'server');
  fs.mkdirSync(serverDir);
  const binary = path.join(serverDir, 'pacbot_server');
  execFileSync('go', ['build', '-o', binary, '.'], { cwd: path.join(repo, 'server'), stdio: 'inherit' });
  await startProcess(binary, [], { cwd: serverDir, readyPattern: /Ready/, timeoutMs: 20000 }, cleanup);
  return wsPort;
}

async function startVisualizer(tmp, cleanup) {
  const webClient = path.join(repo, 'web_client');
  const outDir = path.join(tmp, 'web');
  execFileSync('npx', ['vite', 'build', '--outDir', outDir], { cwd: webClient, stdio: 'ignore' });
  const port = await freePort();
  await startProcess('npx', ['vite', 'preview', '--outDir', outDir, '--port', String(port), '--strictPort'],
    { cwd: webClient, readyPattern: /Local:/, timeoutMs: 20000 }, cleanup);
  return port;
}

// A WebSocket to the game server for sending commands, like the visualizer does.
async function connectCommands(wsPort, cleanup) {
  const socket = new WebSocket(`ws://localhost:${wsPort}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the game server')), { once: true });
  });
  cleanup.add(() => socket.close());
  return (cmd) => socket.send(cmd);
}

async function runScenario(scenario, page, send) {
  const events = () => page.evaluate(() => window.__arcadeTimeline.events());

  send('r');
  await sleep(500);
  await page.evaluate(() => window.__arcadeTimeline.reset());
  let problem = null;
  try {
    await runWithTimeout((signal) => {
      // Every action stops once the scenario has timed out, so an abandoned
      // scenario can't keep driving the server during the next one.
      const live = () => { if (signal.aborted) throw new Error('scenario cancelled'); };
      const ctx = {
        send: (cmd) => { live(); send(cmd); },
        moveTo: (row, col) => ctx.send('x' + String.fromCharCode(row) + String.fromCharCode(col)),
        frame: () => { live(); return page.evaluate(() => window.__arcadeTimeline.frame()); },
        hasEvent: async (type) => { live(); return (await events()).some((event) => event.type === type); },
        sleep: async (ms) => { await sleep(ms); live(); },
        async waitForEvent(type, timeoutMs) {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (await ctx.hasEvent(type)) return;
            await ctx.sleep(100);
          }
          throw new Error(`no ${type} within ${timeoutMs} ms`);
        },
      };
      return scenario.run(ctx);
    }, SCENARIO_TIMEOUT_MS);
  } catch (error) {
    problem = error.message;
  }
  return { timeline: { scenario: scenario.name, source: 'gui', events: await events() }, problem };
}

async function main() {
  const cleanup = createCleanup();
  cleanup.installSignalHandlers();
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-timeline-'));
    cleanup.add(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const wsPort = await startGameServer(tmp, cleanup);
    const webPort = await startVisualizer(tmp, cleanup);
    const send = await connectCommands(wsPort, cleanup);

    const browser = await launchBrowser();
    cleanup.add(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://localhost:${webPort}/?timeline=1&ws=${wsPort}&bot=off`);
    await page.getByRole('button', { name: 'Unmute game audio' }).click();
    await sleep(1000);

    const timelines = [];
    for (const scenario of SCENARIOS) {
      console.log(`Running ${scenario.name}...`);
      const { timeline, problem } = await runScenario(scenario, page, send);
      if (problem) console.log(`  ${scenario.name}: ${problem}`);
      timelines.push(timeline);
    }

    const dumpIndex = process.argv.indexOf('--dump');
    if (dumpIndex !== -1 && process.argv[dumpIndex + 1]) {
      fs.writeFileSync(process.argv[dumpIndex + 1], JSON.stringify(timelines, null, 2));
    }

    const config = JSON.parse(fs.readFileSync(path.join(repo, 'config.json'), 'utf8'));
    const referencePath = path.join(here, 'reference', 'arcade-timings.json');
    const reference = fs.existsSync(referencePath) ? JSON.parse(fs.readFileSync(referencePath, 'utf8')) : {};
    if (!fs.existsSync(referencePath)) {
      console.log('\nNo reference yet (run `npm run record`). Measured GUI values:');
      for (const timeline of timelines) {
        for (const [key, { value, unit }] of Object.entries(reduceTimeline(timeline))) {
          console.log(`  ${key.padEnd(34)} ${unit === 'count' ? value : `${value.toFixed(3)}s`}`);
        }
      }
    }
    const modeIndex = process.argv.indexOf('--mode');
    const mode = modeIndex !== -1 ? process.argv[modeIndex + 1] : 'arcade';
    console.log(`\nMode: ${mode}`);
    console.log(formatReport(compareTimelines({ reference, gui: timelines, gameFps: config.GameFPS, mode })));
  } finally {
    await cleanup.run();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
