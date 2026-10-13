// Re-runs a recorded fight and prints what broke, when and why.
// Usage: npx tsx scripts/replay.ts [recording.json | room code]   (default: the newest recording)
//        add --quiet to print only deaths and the result
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initPhysics, replayFight, type FightRecording } from "@ja/shared/sim";

const dir = fileURLToPath(new URL("../replays", import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const quiet = process.argv.includes("--quiet");

let file = args[0];
if (!file || !file.endsWith(".json")) {
  const code = file?.toUpperCase();
  const all = (await readdir(dir)).filter((f) => f.endsWith(".json") && (!code || f.includes(`-${code}-`))).sort();
  if (!all.length) throw new Error(`no recordings${code ? ` for room ${code}` : ""} in ${dir}`);
  file = join(dir, all[all.length - 1]!);
}
const rec = JSON.parse(await readFile(file, "utf8")) as FightRecording;
const names = new Map(rec.setup.ships.map((s) => [s.playerId, s.name]));
const named = (line: string) => line.replace(/\bp\d+\b/g, (id) => (names.has(id) ? `${names.get(id)}(${id})` : id));

console.log(`${file}\nroom ${rec.room} round ${rec.round}, ${rec.setup.ships.length} ships, ${(rec.ticks / 60).toFixed(1)}s`);
await initPhysics();
const arena = replayFight(rec, (line) => {
  if (!quiet || /DIED|power-up/.test(line)) console.log(named(line));
});
const replayed = arena.results();
arena.dispose();
const same = JSON.stringify(replayed) === JSON.stringify(rec.results);
console.log(`\nresult: ${replayed.map((r) => `${r.place}. ${names.get(r.playerId)}`).join(", ")}`);
console.log(same ? "replay matches the recorded result" : `REPLAY DIVERGED from the recorded result: ${JSON.stringify(rec.results)}`);
