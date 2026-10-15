// Headless rounds: bots draft ships, then bots fight to the end. For tuning and catching edge cases.
// Usage: npx tsx scripts/simulate.ts [rounds=10] [players=4] [hull=hauler|random] [idle=0|1|mixed]
// idle=1: nobody steers or shoots, so the ring decides everything. mixed: half the ships idle.
import { HULL_IDS, PLAYER_COLORS, Rng, type HullId } from "@ja/shared";
import { Draft, draftBotAction } from "@ja/shared/draft";
import { Arena, TICK_HZ, arenaBotInput, initPhysics } from "@ja/shared/sim";

const rounds = Number(process.argv[2] ?? 10);
const players = Number(process.argv[3] ?? 4);
const hullArg = process.argv[4] ?? "hauler";
const idleArg = process.argv[5] ?? "0";
/** Bot draft actions per player: a 60s build at one action every ~2.25s. */
const DRAFT_ACTIONS = 27;

await initPhysics();
for (let round = 0; round < rounds; round++) {
  const rng = new Rng(1000 + round);
  const hull = (hullArg === "random" ? rng.pick(HULL_IDS) : hullArg) as HullId;
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  const draft = new Draft({ playerIds: ids, hull, seed: rng.int(2 ** 31) });
  for (let i = 0; i < DRAFT_ACTIONS; i++) {
    for (const id of ids) {
      const a = draftBotAction(draft, id, rng);
      if (a) draft.apply(id, a);
      // The server deals a reroll's new hand a second later; here, straight away.
      if (a?.type === "reroll") draft.finishReroll(id);
    }
  }
  const arena = new Arena({
    seed: rng.int(2 ** 31),
    ships: ids.map((id, i) => ({ playerId: id, name: id, color: PLAYER_COLORS[i]!, cells: draft.blueprintCells(id) })),
  });
  const t0 = performance.now();
  while (!arena.over) {
    const inputs: Record<string, ReturnType<typeof arenaBotInput>> = {};
    ids.forEach((id, i) => {
      const idle = idleArg === "1" || (idleArg === "mixed" && i % 2 === 0);
      inputs[id] = idle ? { up: false, down: false, left: false, right: false, laser: false, grapple: false } : arenaBotInput(arena, id);
    });
    arena.step(inputs);
  }
  const alive = arena.ships.filter((s) => s.alive);
  const where = alive.map((s) => {
    const t = s.body.rb!.translation();
    return `${s.playerId}@r${Math.hypot(t.x, t.y).toFixed(1)}`;
  });
  console.log(
    `round ${round} ${hull}: ${(arena.tickCount / TICK_HZ).toFixed(0)}s ring ${arena.ringRadius.toFixed(1)} alive ${alive.length} ${where.join(" ")}` +
      `  ships ${ids.map((id) => draft.blueprintCells(id).length).join("/")}  sim ${((performance.now() - t0) / arena.tickCount).toFixed(2)}ms/tick`,
  );
  arena.dispose();
}
