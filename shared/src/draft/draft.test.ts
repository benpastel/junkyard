import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { openChecker } from "../cells.js";
import {
  Draft,
  draftBotAction,
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
  it("makes 5-cell pieces with at most one special", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 300; i++) {
      const p = generatePiece(rng, `p${i}`);
      expect(p.cells).toHaveLength(5);
      expect(p.cells.filter((c) => c.type !== "hull").length).toBeLessThanOrEqual(1);
      for (const c of p.cells) expect(c.type).not.toBe("core");
    }
  });
});

describe("Draft", () => {
  const core = hullCore("medium");

  it("deals three offers and seeds the ship with a core", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "medium", seed: 1 });
    const v = d.view("a");
    expect(v.offers).toHaveLength(3);
    expect(v.cells).toEqual([{ ...core, type: "core", dir: 0 }]);
    expect(v.rivals.map((r) => r.playerId)).toEqual(["b"]);
  });

  it("taking an offer sends the rest to the pool; placing refills offers", () => {
    const d = new Draft({ playerIds: ["a", "b"], hull: "medium", seed: 2 });
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
    const d = new Draft({ playerIds: ["a", "b"], hull: "medium", seed: 3 });
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
    const d = new Draft({ playerIds: ["a"], hull: "medium", seed: 4 });
    d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
    expect(d.apply("a", { type: "place", x: -3, y: -3, rot: 0, flip: false })).toBe("Off the hull");
    expect(d.apply("a", { type: "place", x: core.x, y: core.y, rot: 0, flip: false })).toMatch(/Overlaps|Off the hull/);
    // Bottom-left corner of the hull: on the hull but nowhere near the core.
    const far = findSpot(d, "a", (cells) => cells.every((c) => Math.abs(c.x - core.x) + Math.abs(c.y - core.y) > 2));
    if (far) expect(d.apply("a", { type: "place", ...far })).toBe("Not attached");
  });

  it("caps the pool", () => {
    const d = new Draft({ playerIds: ["a"], hull: "large", seed: 5 });
    for (let i = 0; i < 20; i++) {
      d.apply("a", { type: "takeOffer", pieceId: d.view("a").offers[0]!.id });
      d.apply("a", { type: "discard" });
    }
    expect(d.view("a").pool).toHaveLength(POOL_CAP);
  });

  it("bots fill their ships without errors", () => {
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
        // Pentominoes can leave gaps nothing fits in, which strands the cramped small hull early.
        expect(cells.length).toBeGreaterThan(hullBuildable(hull).length * (hull === "small" ? 0.45 : 0.6));
        expect(cells.filter((c) => c.type === "core")).toHaveLength(1);
        // The small hull fills up fast, so an engine-less skiff is possible there.
        if (hull !== "small") expect(cells.some((c) => c.type === "engine")).toBe(true);
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
