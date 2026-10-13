// Saves fight recordings to replays/ (gitignored) so a fight can be re-run with scripts/replay.ts.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FightRecording } from "@ja/shared/sim";

export const REPLAY_DIR = fileURLToPath(new URL("../../replays", import.meta.url));
/** Older recordings beyond this many are deleted. */
const KEEP = 100;

/** Writes the recording and returns its path. Never throws: a failed save must not break the game. */
export async function saveRecording(rec: FightRecording): Promise<string> {
  try {
    await mkdir(REPLAY_DIR, { recursive: true });
    const stamp = rec.recordedAt.replace(/[:.]/g, "-");
    const file = join(REPLAY_DIR, `${stamp}-${rec.room}-r${rec.round}.json`);
    await writeFile(file, JSON.stringify(rec));
    const all = (await readdir(REPLAY_DIR)).filter((f) => f.endsWith(".json")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await rm(join(REPLAY_DIR, old));
    return file;
  } catch (e) {
    console.error("could not save recording", e);
    return "(not saved)";
  }
}
