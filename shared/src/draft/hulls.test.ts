import { describe, expect, it } from "vitest";
import { HULLS } from "./hulls.js";
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
  }
});
