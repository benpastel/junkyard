import { describe, expect, it } from "vitest";
import { KEY_BITS, engineWrench, planThrust, solveLP, type EngineArm } from "./thrust.js";

/** Net push and spin of a plan. */
function net(engines: EngineArm[], u: number[]) {
  const s = [0, 0, 0];
  engines.forEach((e, i) => engineWrench(e).forEach((v, j) => (s[j]! += v * u[i]!)));
  return { x: s[0]!, y: s[1]!, spin: s[2]! };
}

const { up, right, left, rotLeft, rotRight } = KEY_BITS;

describe("solveLP", () => {
  it("maximises within the box", () => {
    expect(solveLP([1, 2], [], 2)).toEqual([1, 1]);
    expect(solveLP([1, -1], [], 2)).toEqual([1, 0]);
  });
  it("holds a balance row at zero", () => {
    // x0 - 2 x1 = 0 (two rows), maximise x0 + x1: x0 = 1, x1 = 0.5
    const u = solveLP([1, 1], [[1, -2], [-1, 2]], 2);
    expect(u[0]).toBeCloseTo(1);
    expect(u[1]).toBeCloseTo(0.5);
  });
});

describe("planThrust", () => {
  it("throttles back the engine further out so up goes straight", () => {
    // Two engines pushing up (dir 0), one cell left of centre and two right of it.
    const engines: EngineArm[] = [
      { x: -1, y: 1, dir: 0 },
      { x: 2, y: 1, dir: 0 },
    ];
    const u = planThrust(engines, up);
    expect(u[0]).toBeCloseTo(1);
    expect(u[1]).toBeCloseTo(0.5);
    const n = net(engines, u);
    expect(n.spin).toBeCloseTo(0);
    expect(n.y).toBeLessThan(-1.4);
  });

  it("a lone off-centre engine still fires (and spins)", () => {
    const engines: EngineArm[] = [{ x: 2, y: 1, dir: 0 }];
    expect(planThrust(engines, up)[0]).toBeCloseTo(1);
  });

  it("rotates with a couple: no net push when a pair can do it", () => {
    // Up-pushing engines on either side: spinning right fires the left one up and the right one down.
    const engines: EngineArm[] = [
      { x: -2, y: 0, dir: 0 },
      { x: 2, y: 0, dir: 0 },
      { x: -2, y: 0, dir: 2 },
      { x: 2, y: 0, dir: 2 },
    ];
    const u = planThrust(engines, rotRight);
    const n = net(engines, u);
    expect(n.spin).toBeGreaterThan(0);
    expect(Math.abs(n.x) + Math.abs(n.y)).toBeCloseTo(0);
    expect(net(engines, planThrust(engines, rotLeft)).spin).toBeLessThan(0);
  });

  it("rotates on one-way engines, drifting as little as it can", () => {
    // Only rear engines, side by side: no pure turn exists, so it fires the one that turns.
    const engines: EngineArm[] = [
      { x: -2, y: 1, dir: 0 },
      { x: 2, y: 1, dir: 0 },
    ];
    const u = planThrust(engines, rotRight);
    expect(u[0]).toBeCloseTo(1);
    expect(u[1]).toBeCloseTo(0);
  });

  it("opposite keys cancel, and nothing held fires nothing", () => {
    const engines: EngineArm[] = [{ x: 0, y: 1, dir: 1 }, { x: 0, y: 1, dir: 3 }];
    expect(planThrust(engines, left | right)).toEqual([0, 0]);
    expect(planThrust(engines, 0)).toEqual([0, 0]);
  });

  it("a diagonal fires both groups", () => {
    const engines: EngineArm[] = [{ x: 0, y: 1, dir: 0 }, { x: 0, y: 0, dir: 1 }];
    const u = planThrust(engines, up | right);
    expect(u[0]).toBeCloseTo(1);
    expect(u[1]).toBeCloseTo(1);
  });
});
