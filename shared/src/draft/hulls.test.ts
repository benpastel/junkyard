import { describe, expect, it } from "vitest";
import { COCKPIT_LAYOUT } from "../cells.js";
import { HULLS, hullBuildable, hullCore } from "./hulls.js";
import { PENTOMINOES } from "./pieces.js";
import { buildableSet } from "./rules.js";

const TIER_SQUARES = { small: 60, medium: 80, large: 110 } as const;

describe("hulls", () => {
  for (const hull of Object.values(HULLS)) {
    it(`${hull.id} has the ${hull.tier} square count and is mirror-symmetric`, () => {
      const squares = hull.rows.join("").replace(/\./g, "").length;
      expect(squares).toBe(TIER_SQUARES[hull.tier]);
      expect(buildableSet(hull.rows).size).toBe(squares);
      for (const row of hull.rows) {
        expect(row.length).toBe(hull.rows[0]!.length);
        expect([...row].reverse().join("")).toBe(row);
      }
    });

    it(`${hull.id}: every square outside the cockpit takes a pentomino, and the cockpit cuts off no wasted pocket`, () => {
      const core = hullCore(hull.id);
      const key = (x: number, y: number) => `${x},${y}`;
      const cockpit = new Set(COCKPIT_LAYOUT.map((o) => key(core.x + o.dx, core.y + o.dy)));
      const free = new Set(hullBuildable(hull.id).map((c) => key(c.x, c.y)).filter((k) => !cockpit.has(k)));
      const covered = new Set<string>();
      for (const k of free) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        for (const shape of SHAPES) {
          for (const [ax, ay] of shape) {
            const at = shape.map(([sx, sy]) => key(x + sx - ax, y + sy - ay));
            if (at.every((a) => free.has(a))) at.forEach((a) => covered.add(a));
          }
        }
      }
      expect([...free].filter((k) => !covered.has(k))).toEqual([]);
      // Pockets the cockpit cuts off waste no more squares than the hull as a whole has to.
      expect(pockets(free).reduce((s, n) => s + (n % 5), 0)).toBe(free.size % 5);
    });
  }
});

/** Every rotation and reflection of every pentomino. */
const SHAPES = Object.values(PENTOMINOES).flatMap((cells) => {
  const out: [number, number][][] = [];
  for (const f of [1, -1]) {
    let cs = cells.map(([x, y]) => [f * x, y] as [number, number]);
    for (let r = 0; r < 4; r++) {
      out.push(cs);
      cs = cs.map(([x, y]) => [-y, x]);
    }
  }
  return out;
});

function pockets(free: Set<string>): number[] {
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of free) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let n = 0;
    while (stack.length) {
      const [x, y] = stack.pop()!.split(",").map(Number) as [number, number];
      n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx!},${y + dy!}`;
        if (free.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
    }
    sizes.push(n);
  }
  return sizes;
}
