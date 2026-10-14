import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { openChecker } from "../cells.js";
import {
  Draft,
  draftBotAction,
  exhaustSquare,
  generatePiece,
  hullBuildable,
  hullCore,
  HULLS,
  placedCells,
  POOL_CAP,
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
  it("makes 5-cell pieces with exactly one kind of part; mirrors cover the piece, armor its face", () => {
    const rng = new Rng(7);
    let shields = 0;
    for (let i = 0; i < 300; i++) {
      const p = generatePiece(rng, `p${i}`);
      expect(p.cells).toHaveLength(5);
      const special = p.cells.filter((c) => c.type !== "hull");
      expect(special.length).toBeGreaterThan(0);
      if (special.some((c) => c.type === "mirror")) {
        // Mirror pieces are mirror all over, so their whole outer edge reflects.
        shields++;
        expect(special).toHaveLength(5);
        expect(special.every((c) => c.type === "mirror")).toBe(true);
      } else if (special.some((c) => c.type === "armor")) {
        shields++;
        expect(new Set(special.map((c) => `${c.type}${c.dir}`)).size).toBe(1);
        // Exactly the cells on the piece's face in that direction: one per row or column it spans.
        const d = special[0]!.dir;
        const lines = new Set(p.cells.map((c) => (d === 0 || d === 2 ? c.x : c.y)));
        expect(special).toHaveLength(lines.size);
      } else if (special[0]!.type === "engine") {
        // One or two engines, never pushing in opposite directions.
        expect(special.every((c) => c.type === "engine")).toBe(true);
        expect(special.length).toBeGreaterThanOrEqual(1);
        expect(special.length).toBeLessThanOrEqual(2);
        if (special.length === 2) {
          expect((special[0]!.dir - special[1]!.dir + 4) % 4).not.toBe(2);
          // Their exhausts never empty into the same square (bells and flames would pile up).
          const [e1, e2] = special as [Cell, Cell];
          expect(exhaustSquare(e1.x, e1.y, e1.dir)).not.toBe(exhaustSquare(e2.x, e2.y, e2.dir));
        }
      } else {
        expect(special).toHaveLength(1);
      }
      // No part is blocked by its own piece.
      const isOpen = openChecker(p.cells);
      for (const c of special) if (c.type !== "mirror" && c.type !== "armor") expect(isOpen(c)).toBe(true);
      for (const c of p.cells) expect(c.type).not.toBe("core");
    }
    expect(shields).toBeGreaterThan(0);
  });

  it("gives most engine pieces a second engine, mostly at right angles", () => {
    const rng = new Rng(21);
    let pieces = 0;
    let doubles = 0;
    let rightAngles = 0;
    for (let i = 0; i < 2000; i++) {
      const engines = generatePiece(rng, `p${i}`).cells.filter((c) => c.type === "engine");
      if (!engines.length) continue;
      pieces++;
      if (engines.length === 2) {
        doubles++;
        if ((engines[0]!.dir - engines[1]!.dir + 4) % 2 === 1) rightAngles++;
      }
    }
    expect(doubles / pieces).toBeGreaterThan(0.9);
    expect(rightAngles / doubles).toBeGreaterThan(0.6);
  });
});

describe("Draft", () => {
  const core = hullCore("hauler");

  it("deals three offers and seeds the ship with a core", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "hauler", seed: 1 });
    const v = d.view("a");
    expect(v.offers).toHaveLength(3);
    expect(v.cells).toEqual([{ ...core, type: "core", dir: 0 }]);
    expect(v.rivals.map((r) => r.playerId)).toEqual(["b"]);
  });

  it("taking an offer sends the rest to the pool; placing refills offers", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "hauler", seed: 2 });
    const [first, ...rest] = d.view("a").offers;
    expect(d.apply("a", { type: "takeOffer", pieceId: first!.id })).toBeNull();
    let v = d.view("a");
    expect(v.held?.id).toBe(first!.id);
    expect(v.offers).toHaveLength(0);
    expect(v.pool.map((p) => p.id)).toEqual(rest.map((p) => p.id));
    expect(d.view("b").pool).toHaveLength(2);
    expect(d.apply("a", { type: "takeOffer", pieceId: rest[0]!.id })).not.toBeNull();

    // Place it somewhere valid.
    const spot = findValidSpot(d, "a");
    expect(d.apply("a", { type: "place", ...spot })).toBeNull();
    v = d.view("a");
    expect(v.held).toBeNull();
    expect(v.cells).toHaveLength(6);
    expect(v.offers).toHaveLength(3);
  });

  it("pool pieces are first come, first served", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "hauler", seed: 3 });
    d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
    const poolId = d.view("b").pool[0]!.id;
    expect(d.apply("b", { type: "takePool", pieceId: poolId })).toBeNull();
    expect(d.view("b").held?.id).toBe(poolId);
    // b still has its own offers, since it took from the pool.
    expect(d.view("b").offers).toHaveLength(3);
    expect(d.apply("a", { type: "discard" })).toBeNull();
    expect(d.view("a").offers).toHaveLength(3);
  });

  it("rejects off-hull, overlapping and detached placements", () => {
    const d = new Draft({ playerIds: ["a"], hull: "hauler", seed: 4 });
    d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
    expect(d.apply("a", { type: "place", x: -3, y: -3, rot: 0, flip: false })).toBe("Off the hull");
    expect(d.apply("a", { type: "place", x: core.x, y: core.y, rot: 0, flip: false })).toMatch(/Overlaps|Off the hull/);
    // Bottom-left corner of the hull: on the hull but nowhere near the core.
    const far = findSpot(d, "a", (cells) => cells.every((c) => Math.abs(c.x - core.x) + Math.abs(c.y - core.y) > 2));
    if (far) expect(d.apply("a", { type: "place", ...far })).toBe("Not attached");
  });

  it("caps the pool", () => {
    const d = new Draft({ playerIds: ["a"], hull: "barge", seed: 5 });
    for (let i = 0; i < 20; i++) {
      d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
      d.apply("a", { type: "discard" });
    }
    expect(d.view("a").pool).toHaveLength(POOL_CAP);
  });

  it("bots fill their ships without errors", { timeout: 30000 }, () => {
    for (const hull of HULL_IDS) {
      const d = new Draft({ playerIds: ["b1", "b2", "b3"], hull, seed: 9 });
      const rng = new Rng(11);
      for (let step = 0; step < 120; step++) {
        for (const id of ["b1", "b2", "b3"]) {
          const a = draftBotAction(d, id, rng);
          if (a) expect(d.apply(id, a)).toBeNull();
        }
      }
      for (const id of ["b1", "b2", "b3"]) {
        const cells = d.blueprintCells(id);
        // Pentominoes can leave gaps nothing fits in, especially on the odd-shaped hulls.
        expect(cells.length).toBeGreaterThan(hullBuildable(hull).length * 0.5);
        expect(cells.filter((c) => c.type === "core")).toHaveLength(1);
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
  const spot = findSpot(d, id, (cells) =>
    cells.some((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => occupied.has(`${c.x + dx!},${c.y + dy!}`))),
  );
  if (!spot) throw new Error("no spot");
  return spot;
}

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
