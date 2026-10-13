import { beforeAll, describe, expect, it } from "vitest";
import { NO_INPUT, type InputState, type ShipBlueprint } from "../types.js";
import { Arena, arenaBotInput, FightRecorder, initPhysics, replayFight, SIM, TICK_HZ } from "./index.js";
import { SANDBOX_SHIPS, parseShip } from "./testShips.js";

beforeAll(async () => {
  await initPhysics();
});

function bp(id: string, rows: string[]): ShipBlueprint {
  return { playerId: id, name: id, color: "#fff", cells: parseShip(rows) };
}

function run(arena: Arena, ticks: number, inputs: Record<string, InputState> = {}) {
  for (let i = 0; i < ticks; i++) arena.step(inputs);
}

describe("arena", () => {
  it("thrust moves a symmetric ship without spinning it", () => {
    const a = new Arena({ ships: [bp("a", ["#C#", "^#^"]), bp("b", ["C"])], seed: 1 });
    const rb = a.ship("a")!.body.rb!;
    const start = rb.translation();
    run(a, 60, { a: { ...NO_INPUT, up: true } });
    const end = rb.translation();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(0.5);
    expect(Math.abs(rb.angvel())).toBeLessThan(0.01);
    a.dispose();
  });

  it("a lopsided engine layout spins the ship", () => {
    const a = new Arena({ ships: [bp("a", ["#C#", "^##"]), bp("b", ["C"])], seed: 1 });
    run(a, 60, { a: { ...NO_INPUT, up: true } });
    expect(Math.abs(a.ship("a")!.body.rb!.angvel())).toBeGreaterThan(0.1);
    a.dispose();
  });

  it("lasers destroy cells and kill the target", () => {
    // Two ships spawn facing each other across the origin, out of laser range. Close in, then fire.
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["#", "C"])], seed: 1 });
    run(a, 40, { a: { ...NO_INPUT, up: true } });
    run(a, TICK_HZ * 8, { a: { ...NO_INPUT, laser: true } });
    const b = a.ship("b")!;
    expect(b.cellsLost).toBeGreaterThan(0);
    expect(a.ship("a")!.cellsDestroyed).toBeGreaterThan(0);
    expect(b.alive).toBe(false);
    expect(a.ship("a")!.kills).toBe(1);
    expect(a.over).toBe(true);
    expect(a.results()[0]!.playerId).toBe("a");
    a.dispose();
  });

  it("destroying a bridge cell splits off debris", () => {
    // b faces a. The beam hits the hull cell above b's core, which is the only link to the armor.
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["A#", ".C"])], seed: 1 });
    run(a, 40, { a: { ...NO_INPUT, up: true } });
    let split = false;
    for (let i = 0; i < TICK_HZ * 10 && !split; i++) {
      a.step({ a: { ...NO_INPUT, laser: true } });
      split = a.bodies.some((b) => b.kind === "debris");
    }
    expect(split).toBe(true);
    expect(a.ship("b")!.alive).toBe(true);
    expect(a.ship("b")!.body.cells.filter((c) => c.alive).map((c) => c.type)).toEqual(["core"]);
    a.dispose();
  });

  it("mirrors reflect lasers without taking damage", () => {
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["MMM", "MCM"])], seed: 1 });
    run(a, 40, { a: { ...NO_INPUT, up: true } });
    run(a, TICK_HZ * 3, { a: { ...NO_INPUT, laser: true } });
    expect(a.ship("b")!.cellsLost).toBe(0);
    a.dispose();
  });

  it("armor deflects collisions on its edge", () => {
    // a rams head-first into b's front row; returns the damage b took.
    const damageTaken = (front: string) => {
      const a = new Arena({ ships: [bp("a", ["###", "#C#", "^^^"]), bp("b", [front.repeat(3), "#C#"])], seed: 1 });
      const taken = (id: string) => a.ship(id)!.body.cells.reduce((s, c) => s + (c.maxHp - c.hp), 0);
      // Thrust until the ships touch, then measure right away (before the bounce carries anyone into the ring).
      const gap = () => {
        const p = a.ship("a")!.body.rb!.translation();
        const q = a.ship("b")!.body.rb!.translation();
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      for (let i = 0; i < TICK_HZ * 6 && gap() > 3.2; i++) a.step({ a: { ...NO_INPUT, up: true } });
      run(a, 15, {});
      // Destroyed cells leave the body, so count them via cellsLost.
      const dmg = taken("b") + a.ship("b")!.cellsLost * 100;
      a.dispose();
      return dmg;
    };
    expect(damageTaken("#")).toBeGreaterThan(0);
    expect(damageTaken("A")).toBe(0);
  });

  it("covered parts stay off until their line clears", () => {
    // The engine's exhaust points down into the hull below it, so it can't push.
    const covered = new Arena({ ships: [bp("a", ["C", "^", "#"]), bp("b", ["C"])], seed: 1 });
    const open = new Arena({ ships: [bp("a", ["#", "C", "^"]), bp("b", ["C"])], seed: 1 });
    const moved = (arena: Arena) => {
      const rb = arena.ship("a")!.body.rb!;
      const p0 = rb.translation();
      run(arena, 60, { a: { ...NO_INPUT, up: true } });
      const p1 = rb.translation();
      arena.dispose();
      return Math.hypot(p1.x - p0.x, p1.y - p0.y);
    };
    expect(moved(covered)).toBeLessThan(0.01);
    expect(moved(open)).toBeGreaterThan(0.5);
  });

  it("the rubber ring bounces ships back without damage", () => {
    // Backward engines (exhaust out the nose) drive the ship away from the centre, into the ring.
    const a = new Arena({ ships: [bp("a", ["v#v", "#C#"]), bp("b", ["C"])], seed: 1 });
    const rb = a.ship("a")!.body.rb!;
    let bounced = false;
    for (let i = 0; i < TICK_HZ * 6; i++) {
      a.step({ a: { ...NO_INPUT, down: i < TICK_HZ * 2 } });
      const p = rb.translation();
      const v = rb.linvel();
      if (p.x * v.x + p.y * v.y < -1) bounced = true;
      expect(Math.hypot(p.x, p.y)).toBeLessThan(a.ringRadius);
    }
    expect(bounced).toBe(true);
    expect(a.ship("a")!.cellsLost).toBe(0);
    a.dispose();
  });

  it("the centre power-up makes its taker invulnerable", () => {
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["#", "C"])], seed: 1 });
    expect(a.powerupActive).toBe(true);
    // Fly a through the centre.
    for (let i = 0; i < TICK_HZ * 4 && a.powerupActive; i++) a.step({ a: { ...NO_INPUT, up: true } });
    expect(a.powerupActive).toBe(false);
    expect(a.ship("a")!.invulnerableUntil).toBeGreaterThan(a.tickCount);
    a.dispose();
  });

  /** Squeezes two ships nose to nose with a fast-closing ring; returns each ship's first crush tick. */
  function squeeze(rowsA: string[], rowsB: string[]) {
    const saved = { ...SIM };
    Object.assign(SIM, { ringDelaySeconds: 0, ringShrinkSeconds: 12 });
    try {
      const a = new Arena({ ships: [bp("a", rowsA), bp("b", rowsB)], seed: 1 });
      const first: Record<string, number> = {};
      const crush = (a as any).crush.bind(a);
      (a as any).crush = (c: any, t: any) => {
        const owner = c.body?.owner;
        if (owner && first[owner] === undefined) first[owner] = a.tickCount;
        crush(c, t);
      };
      for (let i = 0; i < TICK_HZ * 14 && (first.a === undefined || first.b === undefined); i++) a.step({});
      a.dispose();
      return { first };
    } finally {
      Object.assign(SIM, saved);
    }
  }

  it("the closing ring crushes touching cells on both ships at once", () => {
    const { first } = squeeze(["###", "#C#", "###"], ["###", "#C#", "###"]);
    expect(first.a).toBeDefined();
    expect(first.a).toBe(first.b);
  });

  it("armor facing the squeeze holds out while the other side gives", () => {
    const { first } = squeeze(["AAA", "#C#", "###"], ["###", "#C#", "###"]);
    expect(first.b).toBeDefined();
    expect(first.a === undefined || first.a > first.b!).toBe(true);
  });

  it("a recorded fight replays to the same result", () => {
    const setup = { ships: SANDBOX_SHIPS.map((s, i) => bp(`p${i}`, s.rows)), seed: 7 };
    const a = new Arena(setup);
    const rec = new FightRecorder();
    while (!a.over) {
      const inputs: Record<string, InputState> = {};
      for (const s of a.ships) inputs[s.playerId] = arenaBotInput(a, s.playerId);
      rec.record(inputs);
      a.step(inputs);
    }
    const recording = rec.finish("TEST", 1, setup, { ...SIM }, a.results());
    a.dispose();
    const lines: string[] = [];
    const b = replayFight(JSON.parse(JSON.stringify(recording)), (l) => lines.push(l));
    expect(b.results()).toEqual(recording.results);
    expect(lines.some((l) => l.includes("DIED"))).toBe(true);
    b.dispose();
  });

  it("is deterministic", () => {
    const mk = () =>
      new Arena({ ships: SANDBOX_SHIPS.map((s, i) => bp(`p${i}`, s.rows)), seed: 42 });
    const x = mk();
    const y = mk();
    for (let t = 0; t < 600; t++) {
      const ix: Record<string, InputState> = {};
      const iy: Record<string, InputState> = {};
      for (const s of x.ships) ix[s.playerId] = arenaBotInput(x, s.playerId);
      for (const s of y.ships) iy[s.playerId] = arenaBotInput(y, s.playerId);
      x.step(ix);
      y.step(iy);
    }
    expect(JSON.stringify(x.snapshot())).toBe(JSON.stringify(y.snapshot()));
    x.dispose();
    y.dispose();
  });

  it("a bot-only fight ends", () => {
    const a = new Arena({ ships: SANDBOX_SHIPS.map((s, i) => bp(`p${i}`, s.rows)), seed: 7 });
    let ticks = 0;
    while (!a.over) {
      const inputs: Record<string, InputState> = {};
      for (const s of a.ships) inputs[s.playerId] = arenaBotInput(a, s.playerId);
      a.step(inputs);
      ticks++;
    }
    const res = a.results();
    expect(res).toHaveLength(4);
    expect(res.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(ticks).toBeLessThan(TICK_HZ * 151);
    a.dispose();
  });
});
