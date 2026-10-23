// Bot skills against each other: bots draft, then fight with one skill per ship (seats rotate).
// Usage: npx tsx scripts/skills.ts [rounds=20] [skills=child,easy,medium,hard]   (V=1 prints each fight)
// Prints wins per skill, and how often a laser beam crosses the nearest foe while one is in range.
import { DIR_VECTORS, HULL_IDS, PLAYER_COLORS, Rng, BOT_SKILLS, type HullId } from "@ja/shared";
import { Draft, draftBotAction } from "@ja/shared/draft";
import { Arena, arenaBotInput, initPhysics } from "@ja/shared/sim";
const rounds = Number(process.argv[2] ?? 20);
await initPhysics();
const wins: Record<string, number> = {}, facing: Record<string, number[]> = {};
for (const k of BOT_SKILLS) { wins[k] = 0; facing[k] = [0, 0]; }
for (let round = 0; round < rounds; round++) {
  const rng = new Rng(500 + round);
  const hull = rng.pick(HULL_IDS.filter((h) => !["station"].includes(h))) as HullId;
  const pair = (process.argv[3] ?? "").split(",").filter(Boolean);
  const base = pair.length ? pair : [...BOT_SKILLS];
  const skills = base.map((_, i) => base[(i + round) % base.length]!);
  const ids = skills.map((s, i) => `${s}-${i}`);
  const draft = new Draft({ playerIds: ids, hull, seed: rng.int(2 ** 31) });
  for (let i = 0; i < 30; i++) for (const id of ids) { const a = draftBotAction(draft, id, rng); if (a) draft.apply(id, a); if (a?.type === "reroll") draft.finishReroll(id); }
  const arena = new Arena({ seed: rng.int(2 ** 31), ships: ids.map((id, i) => ({ playerId: id, name: id, color: PLAYER_COLORS[i]!, cells: draft.blueprintCells(id) })) });
  while (!arena.over && arena.tickCount < 60 * 240) {
    const inputs: Record<string, ReturnType<typeof arenaBotInput>> = {};
    ids.forEach((id, i) => (inputs[id] = arenaBotInput(arena, id, skills[i]!)));
    arena.step(inputs);
    if (arena.tickCount % 10) continue;
    ids.forEach((id, i) => {
      const me = arena.ship(id); if (!me?.alive || !me.body.rb) return;
      const lasers = me.body.cells.filter((c) => c.alive && c.type === "laser");
      if (!lasers.length) return;
      const p = me.body.rb.translation(); let best = Infinity, bx = 0, by = 0;
      for (const s of arena.ships) { if (s === me || !s.alive || !s.body.rb) continue; const t = s.body.rb.translation(); const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < best) { best = d; bx = t.x - p.x; by = t.y - p.y; } }
      if (best > 13) return;
      const ok = lasers.some((c) => { const w = arena.cellWorldDir(c); const f = arena.cellWorld(c); if (!f) return false; const tx = p.x + bx - f.x, ty = p.y + by - f.y; const along = tx * w.x + ty * w.y; return along > 0 && Math.abs(tx * -w.y + ty * w.x) < 1.5; });
      facing[skills[i]!]![0]! += ok ? 1 : 0; facing[skills[i]!]![1]! += 1;
    });
  }
  const alive = arena.ships.filter((s) => s.alive);
  if (process.env.V) {
    const bp = ids.map((id) => { const c = draft.blueprintCells(id); const n = (t: string) => c.filter((x) => x.type === t).length; return `${id}: L${n("laser")} S${n("saw")} E${n("engine")} A${n("armor")} M${n("mirror")} ${c.length}c`; });
    console.log(hull, (arena.tickCount / 60).toFixed(0) + "s", "won:", alive.map((s) => s.playerId).join(), "|", bp.join(" | "));
  }
  if (alive.length === 1) wins[alive[0]!.playerId.split("-")[0]!]!++;
  arena.dispose();
}
console.log("wins", wins);
console.log("a beam within 1.5 of the target", Object.fromEntries(Object.entries(facing).map(([k, [a, b]]) => [k, `${((100 * a!) / Math.max(1, b!)).toFixed(0)}% of ${b}`])));
