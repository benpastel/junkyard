import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { cockpitCells, openChecker } from "../cells.js";
import {
  Draft,
  buildableSet,
  deadSquares,
  draftBotAction,
  exhaustSquare,
  validPlacements,
  generatePiece,
  hullBuildable,
  hullCore,
  HULLS,
  placedCells,
  OFFER_COUNT,
  POOL_ENABLED,
  transformCells,
  type Piece,
} from "./index.js";
import type { Cell } from "../types.js";
import { HULL_IDS } from "../types.js";

const L: Piece = {
  id: "t",
  shape: "L",
  cells: [
    { x: 0, y: 0, type: "laser", dir: 0 },
    { x: 0, y: 1, type: "hull", dir: 0 },
    { x: 0, y: 2, type: "hull", dir: 0 },
    { x: 0, y: 3, type: "hull", dir: 0 },
    { x: 1, y: 3, type: "engine", dir: 1 },
  ],
};

const sortCells = (cells: Cell[]) => cells.map((c) => `${c.x},${c.y},${c.type},${c.dir}`).sort();

describe("transformCells", () => {
  it("is identity at rot 0 without flip", () => {
    expect(sortCells(transformCells(L.cells, 0, false))).toEqual(sortCells(L.cells));
  });

  it("rotates clockwise and turns dirs with it", () => {
    const r = transformCells(L.cells, 1, false);
    // Vertical bar becomes horizontal; the laser that pointed up now points right, at the right end.
    const laser = r.find((c) => c.type === "laser")!;
    expect(laser.dir).toBe(1);
    expect(laser.x).toBe(3);
    const engine = r.find((c) => c.type === "engine")!;
    expect(engine.dir).toBe(2);
    expect(Math.min(...r.map((c) => c.x))).toBe(0);
    expect(Math.min(...r.map((c) => c.y))).toBe(0);
  });

  it("four rotations return to the start", () => {
    let cells = L.cells;
    for (let i = 0; i < 4; i++) cells = transformCells(cells, 1, false);
    expect(sortCells(cells)).toEqual(sortCells(L.cells));
  });

  it("flip mirrors x and swaps left/right dirs", () => {
    const f = transformCells(L.cells, 0, true);
    const engine = f.find((c) => c.type === "engine")!;
    expect(engine).toMatchObject({ x: 0, y: 3, dir: 3 });
    expect(f.find((c) => c.type === "laser")).toMatchObject({ x: 1, y: 0, dir: 0 });
  });
});

describe("hulls", () => {
  it("each has one core and sensible size", () => {
    for (const id of HULL_IDS) {
      const rows = HULLS[id].rows;
      expect(rows.join("").split("C").length - 1).toBe(1);
      expect(new Set(rows.map((r) => r.length)).size).toBe(1);
      expect(hullBuildable(id).length).toBeGreaterThan(25);
    }
  });
});

describe("generatePiece", () => {
  it("fills pentominoes with 1.5-2 points of parts and tetrominoes with 1 (less per square), all working and never overlapping", () => {
    const cost: Record<string, number> = { engine: 0.5, laser: 1, saw: 1 };
    const rng = new Rng(7);
    const total = { 4: 0, 5: 0 };
    const count = { 4: 0, 5: 0 };
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const p = generatePiece(rng, `p${i}`);
      const size = p.cells.length as 4 | 5;
      expect([4, 5]).toContain(size);
      for (const c of p.cells) expect(c.type).not.toBe("core");
      const coats = ["mirror", "armor"];
      const parts = p.cells.filter((c) => c.type !== "hull" && !coats.includes(c.type));
      const coated = coats.filter((t) => p.cells.some((c) => c.type === t)).length;
      expect(coated).toBeLessThanOrEqual(1);
      const points = parts.reduce((sum, c) => sum + (cost[c.type] ?? 0), 0) + coated;
      expect(points).toBeLessThanOrEqual(size === 5 ? 2 : 1);
      expect(points).toBeGreaterThanOrEqual(size === 5 ? 1 : 0.5);
      total[size] += points;
      count[size]++;
      // Every part works on the piece as it stands.
      const isOpen = openChecker(p.cells);
      for (const c of parts) expect(isOpen(c)).toBe(true);
      // No two engines push in opposite directions; no two exhausts share a square.
      const engines = parts.filter((c) => c.type === "engine");
      for (const a of engines) for (const b of engines) if (a !== b) {
        expect((a.dir - b.dir + 4) % 4).not.toBe(2);
        expect(exhaustSquare(a.x, a.y, a.dir)).not.toBe(exhaustSquare(b.x, b.y, b.dir));
      }
    }
    expect(total[5] / count[5]).toBeGreaterThan(1.6);
    expect(count[4] / n).toBeGreaterThan(0.4);
    expect(count[4] / n).toBeLessThan(0.5);
    expect(total[4] / count[4] / 4).toBeLessThan(total[5] / count[5] / 5);
  });

});

describe("Draft", () => {
  const core = hullCore("skiff");

  it("deals five offers and seeds the ship with a core", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "skiff", seed: 1 });
    const v = d.view("a");
    expect(v.offers).toHaveLength(OFFER_COUNT);
    // The cockpit: four core cells laid out like the arrow keys around the hull's C.
    expect(v.cells).toEqual(cockpitCells(core.x, core.y));
    expect(v.rivals.map((r) => r.playerId)).toEqual(["b"]);
  });

  it("keeps the hand while you hold a piece; placing deals a fresh hand", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "skiff", seed: 2 });
    const hand = d.view("a").offers.map((p) => p.id);
    expect(d.apply("a", { type: "takeOffer", pieceId: hand[0]! })).toBeNull();
    expect(d.view("a").held?.id).toBe(hand[0]);
    expect(d.view("a").offers.map((p) => p.id)).toEqual(hand);
    // Change your mind, and put it back.
    expect(d.apply("a", { type: "takeOffer", pieceId: hand[1]! })).toBeNull();
    expect(d.view("a").held?.id).toBe(hand[1]);
    expect(d.apply("a", { type: "discard" })).toBeNull();
    expect(d.view("a").held).toBeNull();
    expect(d.view("a").offers.map((p) => p.id)).toEqual(hand);

    d.apply("a", { type: "takeOffer", pieceId: hand[0]! });
    const spot = findValidSpot(d, "a");
    expect(d.apply("a", { type: "place", ...spot })).toBeNull();
    const v = d.view("a");
    expect(v.held).toBeNull();
    expect([10, 11]).toContain(v.cells.length);
    expect(v.offers).toHaveLength(OFFER_COUNT);
    expect(v.offers.some((p) => hand.includes(p.id))).toBe(false);
  });

  it("a reroll empties the hand until the new one is dealt", () => {
    const d = new Draft({ playerIds: ["a"], hull: "skiff", seed: 3 });
    const hand = d.view("a").offers.map((p) => p.id);
    d.apply("a", { type: "takeOffer", pieceId: hand[0]! });
    expect(d.apply("a", { type: "reroll" })).toBeNull();
    let v = d.view("a");
    expect(v.dealing).toBe(true);
    expect(v.offers).toHaveLength(0);
    expect(v.held).toBeNull();
    expect(d.apply("a", { type: "reroll" })).not.toBeNull();
    d.finishReroll("a");
    v = d.view("a");
    expect(v.dealing).toBe(false);
    expect(v.offers).toHaveLength(OFFER_COUNT);
    expect(v.offers.some((p) => hand.includes(p.id))).toBe(false);
  });

  it("has no shared pool while it's switched off", () => {
    if (POOL_ENABLED) return;
    const d = new Draft({ playerIds: ["a", "b"], hull: "skiff", seed: 4 });
    d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
    d.apply("a", { type: "place", ...findValidSpot(d, "a") });
    d.apply("a", { type: "reroll" });
    expect(d.view("b").pool).toHaveLength(0);
  });

  it("rejects off-hull, overlapping and detached placements", () => {
    const d = new Draft({ playerIds: ["a"], hull: "skiff", seed: 4 });
    d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
    expect(d.apply("a", { type: "place", x: -3, y: -3, rot: 0, flip: false })).toBe("Off the hull");
    expect(d.apply("a", { type: "place", x: core.x, y: core.y, rot: 0, flip: false })).toMatch(/Overlaps|Off the hull/);
    // On the hull but touching no part of the cockpit.
    const cockpit = cockpitCells(core.x, core.y);
    const far = findSpot(d, "a", (cells) => cells.every((c) => cockpit.every((k) => Math.abs(c.x - k.x) + Math.abs(c.y - k.y) > 1)));
    expect(far).not.toBeNull();
    if (far) expect(d.apply("a", { type: "place", ...far })).toBe("Not attached");
  });

  it("bots fill their ships without errors", { timeout: 30000 }, () => {
    for (const hull of HULL_IDS) {
      const d = new Draft({ playerIds: ["b1", "b2", "b3"], hull, seed: 9 });
      const rng = new Rng(11);
      for (let step = 0; step < 120; step++) {
        for (const id of ["b1", "b2", "b3"]) {
          const a = draftBotAction(d, id, rng);
          if (a) expect(d.apply(id, a)).toBeNull();
          // The server deals a reroll's new hand a second later; here, straight away.
          if (a?.type === "reroll") d.finishReroll(id);
        }
      }
      for (const id of ["b1", "b2", "b3"]) {
        const cells = d.blueprintCells(id);
        // Pentominoes can leave gaps nothing fits in, especially on the odd-shaped hulls.
        expect(cells.length).toBeGreaterThan(hullBuildable(hull).length * 0.5);
        expect(cells.filter((c) => c.type === "core")).toHaveLength(6);
        expect(cells.some((c) => c.type === "engine")).toBe(true);
        expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length);
      }
    }
  });
});

function findSpot(d: Draft, id: string, ok: (cells: Cell[]) => boolean) {
  const v = d.view(id);
  for (const rot of [0, 1, 2, 3] as const)
    for (let y = -2; y < v.hullRows.length; y++)
      for (let x = -2; x < v.hullRows[0]!.length; x++) {
        const cells = placedCells(v.held!, x, y, rot, false);
        const onHull = cells.every((c) => v.hullRows[c.y]?.[c.x] === "#");
        if (onHull && ok(cells)) return { x, y, rot, flip: false };
      }
  return null;
}

function findValidSpot(d: Draft, id: string) {
  const v = d.view(id);
  const occupied = new Set(v.cells.map((c) => `${c.x},${c.y}`));
  const spot = findSpot(
    d,
    id,
    (cells) =>
      cells.every((c) => !occupied.has(`${c.x},${c.y}`)) &&
      cells.some((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => occupied.has(`${c.x + dx!},${c.y + dy!}`))),
  );
  if (!spot) throw new Error("no spot");
  return spot;
}

describe("dead space and fitting offers", () => {
  it("marks pockets of fewer than 5 empty squares as dead", () => {
    // A 3x3 hull: the cockpit-free ship is one cell in a corner, leaving one pocket of 8.
    const buildable = new Set(["0,0", "1,0", "2,0", "0,1", "1,1", "2,1", "0,2", "1,2", "2,2"]);
    const hull = (x: number, y: number): Cell => ({ x, y, type: "hull", dir: 0 });
    expect(deadSquares(buildable, [hull(0, 0)]).size).toBe(0);
    // Wall off the right column: it becomes a pocket of 3 (dead); the rest is 3 too.
    const wall = [hull(0, 0), hull(1, 0), hull(1, 1), hull(1, 2)];
    expect([...deadSquares(buildable, wall)].sort()).toEqual(["0,1", "0,2", "2,0", "2,1", "2,2"]);
  });

  it("only ever offers pieces that fit, and fills up to just dead space", { timeout: 30000 }, () => {
    for (const hull of ["skiff", "crab", "station"] as const) {
      const d = new Draft({ playerIds: ["b"], hull, seed: 21 });
      const rng = new Rng(4);
      const buildable = buildableSet(d.view("b").hullRows);
      for (let step = 0; step < 400 && !d.isFull("b"); step++) {
        const v = d.view("b");
        const size = { w: v.hullRows[0]!.length, h: v.hullRows.length };
        for (const o of v.offers) expect(validPlacements(buildable, v.cells, o, size.w, size.h).length).toBeGreaterThan(0);
        const a = draftBotAction(d, "b", rng);
        if (a) d.apply("b", a);
        if (a?.type === "reroll") d.finishReroll("b");
      }
      expect(d.isFull("b")).toBe(true);
      const v = d.view("b");
      expect(v.full).toBe(true);
      expect(v.offers).toHaveLength(0);
      const empty = [...buildable].filter((k) => !v.cells.some((c) => `${c.x},${c.y}` === k));
      expect(deadSquares(buildable, v.cells).size).toBe(empty.length);
    }
  });
});

describe("openChecker", () => {
  it("engines and saws only need the square next to them; lasers need the whole line", () => {
    const hull = (x: number, y: number): Cell => ({ x, y, type: "hull", dir: 0 });
    // Something two squares away in the working direction, with a gap in between.
    const engine: Cell = { x: 0, y: 0, type: "engine", dir: 0 }; // exhaust points down
    expect(openChecker([engine, hull(0, 2)])(engine)).toBe(true);
    expect(openChecker([engine, hull(0, 1)])(engine)).toBe(false);
    const saw: Cell = { x: 0, y: 2, type: "saw", dir: 0 };
    expect(openChecker([saw, hull(0, 0)])(saw)).toBe(true);
    expect(openChecker([saw, hull(0, 1)])(saw)).toBe(false);
    const laser: Cell = { x: 0, y: 2, type: "laser", dir: 0 };
    expect(openChecker([laser, hull(0, 0)])(laser)).toBe(false);
  });

  it("needs a saw's front-diagonal squares empty too", () => {
    const saw: Cell = { x: 1, y: 1, type: "saw", dir: 0 };
    const hull = (x: number, y: number): Cell => ({ x, y, type: "hull", dir: 0 });
    expect(openChecker([saw, hull(1, 2)])(saw)).toBe(true);
    expect(openChecker([saw, hull(0, 0)])(saw)).toBe(false);
    expect(openChecker([saw, hull(2, 0)])(saw)).toBe(false);
    // Side neighbours are fine: the blade sits out in front of them.
    expect(openChecker([saw, hull(0, 1), hull(2, 1)])(saw)).toBe(true);
  });

  it("never generates a saw piece that blocks its own blade", () => {
    const rng = new Rng(3);
    let saws = 0;
    for (let i = 0; i < 400; i++) {
      const p = generatePiece(rng, `p${i}`);
      const saw = p.cells.find((c) => c.type === "saw");
      if (!saw) continue;
      saws++;
      expect(openChecker(p.cells)(saw)).toBe(true);
    }
    expect(saws).toBeGreaterThan(0);
  });

  it("needs the whole line clear, not just the neighbour", () => {
    const cells: Cell[] = [
      { x: 0, y: 0, type: "laser", dir: 1 },
      { x: 1, y: 1, type: "hull", dir: 0 },
      { x: 3, y: 0, type: "hull", dir: 0 },
      { x: 0, y: 1, type: "engine", dir: 0 },
    ];
    const isOpen = openChecker(cells);
    expect(isOpen(cells[0]!)).toBe(false); // hull two cells to the right
    expect(isOpen(cells[3]!)).toBe(true); // exhaust points down, nothing below
    expect(isOpen({ x: 1, y: 1, type: "hull", dir: 0 })).toBe(true);
    expect(openChecker(cells.filter((_, i) => i !== 2))(cells[0]!)).toBe(true);
  });
});
