// Fight recordings: the setup plus every input change, enough to re-run a fight exactly
// (the sim is deterministic). The server writes one per fight; scripts/replay.ts plays them back.
import type { InputState, PlayerId, RoundResultRow } from "../types.js";
import { SIM } from "./constants.js";
import { Arena } from "./arena.js";
import type { ArenaSetup } from "./index.js";

const KEYS: (keyof InputState)[] = ["up", "down", "left", "right", "laser", "grapple", "rotLeft", "rotRight"];

export function packInput(i: InputState): number {
  return KEYS.reduce((bits, k, n) => bits | (i[k] ? 1 << n : 0), 0);
}

export function unpackInput(bits: number): InputState {
  const out = {} as InputState;
  KEYS.forEach((k, n) => (out[k] = (bits & (1 << n)) !== 0));
  return out;
}

export interface FightRecording {
  version: 1;
  room: string;
  round: number;
  recordedAt: string;
  /** The tuning constants in force, so old recordings replay under their own rules. */
  sim: typeof SIM;
  setup: ArenaSetup;
  /** [tick, playerId, packed input]: the input a player held from that tick on (step number, starting at 0). */
  inputs: [number, PlayerId, number][];
  ticks: number;
  results: RoundResultRow[];
}

/** Records the inputs fed to an arena, one entry per change. */
export class FightRecorder {
  private readonly last = new Map<PlayerId, number>();
  readonly inputs: [number, PlayerId, number][] = [];
  private tick = 0;

  /** Call with exactly the inputs passed to arena.step, before stepping. */
  record(inputs: Record<PlayerId, InputState>) {
    for (const [id, input] of Object.entries(inputs)) {
      const bits = packInput(input);
      if (this.last.get(id) !== bits) {
        this.last.set(id, bits);
        this.inputs.push([this.tick, id, bits]);
      }
    }
    this.tick++;
  }

  finish(room: string, round: number, setup: ArenaSetup, sim: typeof SIM, results: RoundResultRow[]): FightRecording {
    return { version: 1, room, round, recordedAt: new Date().toISOString(), sim, setup, inputs: this.inputs, ticks: this.tick, results };
  }
}

/** Re-runs a recording, returning the arena at the end (call dispose()). */
export function replayFight(rec: FightRecording, onLog?: (line: string) => void): Arena {
  const saved = { ...SIM };
  Object.assign(SIM, rec.sim);
  try {
    const arena = new Arena(rec.setup);
    if (onLog) arena.onLog = onLog;
    const held: Record<PlayerId, InputState> = {};
    let next = 0;
    for (let tick = 0; tick < rec.ticks; tick++) {
      while (next < rec.inputs.length && rec.inputs[next]![0] === tick) {
        const [, id, bits] = rec.inputs[next++]!;
        held[id] = unpackInput(bits);
      }
      arena.step({ ...held });
    }
    return arena;
  } finally {
    Object.assign(SIM, saved);
  }
}
