import { beforeAll, describe, expect, it } from "vitest";
import { NO_INPUT, type InputState, type ShipBlueprint } from "../types.js";
import { Arena, arenaBotInput, FightRecorder, initPhysics, replayFight, SIM, TICK_HZ } from "./index.js";
import { SANDBOX_SHIPS, parseShip } from "./testShips.js";

beforeAll(async () => {
  await initPhysics();
  // These tests drive the sim from tick 1 (the start-of-fight countdown has its own test), and
  // their geometry assumes two ships spawn 14 units from the centre.
  SIM.countdownSeconds = 0;
  SIM.spawnMinRadius = 14;
  SIM.spawnRadiusPerShip = 4.5;
  // An empty arena: asteroids get their own test below.
  SIM.rocksPerArea = 0;
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
    run(a, 70, { a: { ...NO_INPUT, up: true } });
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

  it("the centre power-up gives its taker a laser-reflecting skin", () => {
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["#", "C"])], seed: 1 });
    expect(a.powerupActive).toBe(true);
    // Fly a through the centre.
    for (let i = 0; i < TICK_HZ * 4 && a.powerupActive; i++) a.step({ a: { ...NO_INPUT, up: true } });
    expect(a.powerupActive).toBe(false);
    expect(a.ship("a")!.mirroredUntil).toBeGreaterThan(a.tickCount);
    a.dispose();
  });

  /** Squeezes two ships nose to nose with a fast-closing ring; returns each ship's first crush tick. */
  function squeeze(rowsA: string[], rowsB: string[]) {
    const saved = { ...SIM };
    // The damping these scenarios were staged with, so the ships meet the same way whatever
    // the flight tuning is.
    Object.assign(SIM, { ringDelaySeconds: 0, ringShrinkSeconds: 12, linearDamping: 0.4, angularDamping: 1.2 });
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

  it("a spinning saw keeps cutting what it touches and isn't hurt by it", () => {
    const a = new Arena({ ships: [bp("a", ["R", "C", "^"]), bp("b", ["###", "###", "###", "#C#"])], seed: 1 });
    run(a, TICK_HZ * 5, { a: { ...NO_INPUT, up: true } });
    const saw = a.ship("a")!.body.cells.find((c) => c.type === "saw");
    expect(saw?.alive).toBe(true);
    expect(a.ship("b")!.cellsLost).toBeGreaterThanOrEqual(3);
    a.dispose();
  });

  it("the saw blade is wide enough to cut the tiles diagonally in front of it", () => {
    // b's nose has a gap straight in front of a's saw, with hull either side of it.
    const a = new Arena({ ships: [bp("a", ["R", "C", "^"]), bp("b", ["#.#", "###", "#C#"])], seed: 1 });
    const cuts: string[] = [];
    a.onLog = (l) => {
      if (l.includes("to saw")) cuts.push(l);
    };
    for (let i = 0; i < TICK_HZ * 5 && cuts.length === 0; i++) a.step({ a: { ...NO_INPUT, up: true } });
    expect(cuts.length).toBeGreaterThan(0);
    // The first thing the blade bites is one of the two flanking nose cells.
    expect(cuts[0]).toMatch(/b lost hull \((-1|1),-2\)/);
    a.dispose();
  });

  it("the mirror skin bounces lasers off any outer surface", () => {
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["###", "#C#"])], seed: 1 });
    a.ship("b")!.mirroredUntil = Infinity;
    run(a, 40, { a: { ...NO_INPUT, up: true } });
    run(a, TICK_HZ * 3, {});
    expect(a.ship("b")!.cellsLost).toBe(0);
    a.dispose();
  });

  it("ships stuck together too long blow up at every point of contact, on both sides", () => {
    // Start b resting against a's nose (a spawns at y=-14 facing +y), then a keeps pushing it:
    // a slow shove, so no impact damage, just a long contact.
    const a = new Arena({ ships: [bp("a", ["###", "#C#", "^^^"]), bp("b", ["###", "###", "#C#"])], seed: 1 });
    a.ship("b")!.body.rb!.setTranslation({ x: 0, y: -10.02 }, true);
    const stuck: string[] = [];
    a.onLog = (l) => {
      if (l.includes("stuck to")) stuck.push(l);
    };
    for (let i = 0; i < TICK_HZ * 12 && stuck.length === 0; i++) a.step({ a: { ...NO_INPUT, up: true } });
    expect(stuck.some((l) => l.includes("] a lost"))).toBe(true);
    expect(stuck.some((l) => l.includes("] b lost"))).toBe(true);
    // The blast knocks them apart: b (ahead, at larger y) now moves away from a.
    const va = a.ship("a")!.body.rb!.linvel();
    const vb = a.ship("b")!.body.rb!.linvel();
    expect(vb.y - va.y).toBeGreaterThan(SIM.stuckKnockbackSpeed);
    a.dispose();
  });

  it("a mirror edge buried behind hull starts reflecting once the hull is shot away", () => {
    // b's mirror row sits behind a row of hull: the first shot breaks the hull, later ones bounce.
    const a = new Arena({ ships: [bp("a", ["i", "C", "^"]), bp("b", ["###", "MMM", "#C#"])], seed: 1 });
    const lasered: string[] = [];
    a.onLog = (l) => {
      if (l.includes("] b lost") && l.includes("to laser")) lasered.push(l);
    };
    run(a, 40, { a: { ...NO_INPUT, up: true } });
    run(a, TICK_HZ * 8, {});
    expect(lasered).toHaveLength(1);
    expect(a.ship("b")!.body.cells.filter((c) => c.type === "mirror" && c.alive)).toHaveLength(3);
    a.dispose();
  });

  it("holds everything still during the start-of-fight countdown", () => {
    const saved = SIM.countdownSeconds;
    SIM.countdownSeconds = 3;
    try {
      const a = new Arena({ ships: [bp("a", ["#C#", "^#^"]), bp("b", ["C"])], seed: 1 });
      expect(a.init().countdownTicks).toBe(3 * TICK_HZ);
      const rb = a.ship("a")!.body.rb!;
      const start = rb.translation();
      run(a, 3 * TICK_HZ, { a: { ...NO_INPUT, up: true } });
      expect(rb.translation()).toEqual(start);
      run(a, 30, { a: { ...NO_INPUT, up: true } });
      expect(Math.hypot(rb.translation().x - start.x, rb.translation().y - start.y)).toBeGreaterThan(0.05);
      a.dispose();
    } finally {
      SIM.countdownSeconds = saved;
    }
  });

  it("losing any part of the cockpit blows the whole cockpit and kills the ship", () => {
    const a = new Arena({ ships: [bp("a", ["C"]), bp("b", [".k.", "kCk", "###"])], seed: 1 });
    const ship = a.ship("b")!;
    expect(ship.cockpit).toHaveLength(4);
    const left = ship.cockpit.find((c) => c.dir === 3)!;
    const touched = new Set<unknown>();
    (a as any).damageCell(left, left.hp, "a", touched, "test");
    for (const body of touched) (a as any).splitBody(body);
    expect(ship.cockpit.every((c) => !c.alive)).toBe(true);
    expect(ship.alive).toBe(false);
    expect(ship.cellsLost).toBe(4);
    a.dispose();
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
  it("scatters asteroids clear of the spawn points, and lasers chip them", () => {
    const saved = SIM.rocksPerArea;
    SIM.rocksPerArea = 0.0011;
    try {
      const ships = ["a", "b", "c", "d"].map((id) => bp(id, ["#C#", "^#^"]));
      const a = new Arena({ ships, seed: 3 });
      const rocks = a.bodies.filter((b) => b.kind === "rock");
      expect(rocks.length).toBeGreaterThan(3);
      expect(a.init().rocks.length).toBe(rocks.length);
      for (const r of rocks) {
        const p = r.rb!.translation();
        for (const s of a.ships) {
          const q = s.body.rb!.translation();
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(SIM.rockSpawnClearance);
        }
      }
      // Every rock cell is a rock; damage one rock's middle row away and it splits or shrinks.
      const r = rocks[0]!;
      const before = r.cells.length;
      const touched = new Set([r]);
      for (const c of r.cells.filter((c) => c.y === 0)) (a as any).damageCell(c, 1, null, touched, "test");
      (a as any).splitBody(r);
      expect(r.cells.length).toBeLessThan(before);
      a.dispose();
    } finally {
      SIM.rocksPerArea = saved;
    }
  });
  it("a flamethrower cooks what sits in its flame, never its own ship", () => {
    const a = new Arena({ ships: [bp("a", ["F", "C"]), bp("b", ["###", "#C#", "###"])], seed: 1 });
    // Park b just in front of a's nozzle (a faces the centre from straight above it).
    const pa = a.ship("a")!.body.rb!.translation();
    a.ship("b")!.body.rb!.setTranslation({ x: pa.x, y: pa.y + 5 }, true);
    a.ship("b")!.body.rb!.setLinvel({ x: 0, y: 0 }, true);
    run(a, TICK_HZ * 3);
    expect(a.ship("b")!.cellsLost).toBeGreaterThan(0);
    expect(a.ship("a")!.cellsLost).toBe(0);
    expect(a.ship("a")!.cellsDestroyed).toBe(a.ship("b")!.cellsLost);
    a.dispose();
  });

});
