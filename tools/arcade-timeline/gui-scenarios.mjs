// Scenario scripts that drive our game server while the visualizer records its timeline.
// ctx: { send(cmd), moveTo(row, col), frame(), waitForEvent(type, timeoutMs), sleep(ms) }

const POWER_PELLETS = [[23, 1], [23, 26]];

// The ghost house interior, where Pac-Man can't follow
const inGhostHouse = ({ row, col }) => row >= 12 && row <= 16 && col >= 10 && col <= 17;

async function startGame(ctx) {
  ctx.send('P');
  await ctx.waitForEvent('gameStarted', 15000);
}

// The first remaining pellet in row-major order
function remainingPellet(pellets) {
  for (let row = 0; row < pellets.length; row++) {
    for (let col = 0; col < 28; col++) {
      if ((pellets[row] >>> col) & 1) return [row, col];
    }
  }
  return null;
}

export const SCENARIOS = [
  {
    name: 'start',
    async run(ctx) {
      await startGame(ctx);
      await ctx.waitForEvent('musicEnded', 10000);
    },
  },
  {
    name: 'death',
    async run(ctx) {
      await startGame(ctx);
      ctx.send('k');
      await ctx.waitForEvent('deathEnded', 10000);
      await ctx.sleep(2000); // room for a READY after death, if the GUI shows one
    },
  },
  {
    name: 'ghostEaten',
    async run(ctx) {
      await startGame(ctx);
      // Phase 1: a full fright without chasing. Frightened ghosts can't catch
      // Pac-Man, so the fright runs its course and its flashes are recorded.
      ctx.moveTo(...POWER_PELLETS[0]);
      await ctx.waitForEvent('frightStarted', 5000);
      await ctx.waitForEvent('frightEnded', 40000);
      // Phase 2: a second power pellet, then chase a ghost that has left the house
      ctx.moveTo(...POWER_PELLETS[1]);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !(await ctx.hasEvent('ghostEaten'))) {
        const target = (await ctx.frame())?.ghosts.find((ghost) => !inGhostHouse(ghost));
        if (target) ctx.moveTo(target.row, target.col);
        await ctx.sleep(100);
      }
      await ctx.waitForEvent('ghostEaten', 1000);
      await ctx.sleep(1500); // room for the freeze and score popup
    },
  },
  {
    name: 'levelComplete',
    async run(ctx) {
      await startGame(ctx);
      ctx.send('c');
      await ctx.sleep(300);
      const pellet = remainingPellet((await ctx.frame()).pellets);
      if (pellet) ctx.moveTo(...pellet);
      await ctx.waitForEvent('levelCleared', 5000);
      await ctx.sleep(5000); // room for flashes and READY, if the GUI shows them
    },
  },
  {
    name: 'siren',
    async run(ctx) {
      ctx.send('P');
      await ctx.sleep(10000); // the GUI has no siren yet; reported as not implemented
    },
  },
];
