import type { HullId } from "../types.js";

export interface HullDef {
  id: HullId;
  name: string;
  /** '#' = buildable, 'C' = core (pre-placed), '.' = outside the hull. Nose points up. */
  rows: string[];
}

export const HULLS: Record<HullId, HullDef> = {
  small: {
    id: "small",
    name: "Skiff",
    rows: [
      "...#...",
      "..###..",
      ".#####.",
      ".##C##.",
      "#######",
      "###.###",
      "##...##",
    ],
  },
  medium: {
    id: "medium",
    name: "Hauler",
    rows: [
      "....#....",
      "...###...",
      "..#####..",
      "..#####..",
      ".###C###.",
      "#########",
      "#########",
      "###.#.###",
      "##.....##",
    ],
  },
  large: {
    id: "large",
    name: "Barge",
    rows: [
      ".....#.....",
      "....###....",
      "...#####...",
      "...#####...",
      "..#######..",
      ".####C####.",
      "###########",
      "###########",
      "####.#.####",
      "###.....###",
      "##.......##",
    ],
  },
};

/** Every buildable square of the hull, including the core square. */
export function hullBuildable(hull: HullId): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  HULLS[hull].rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== ".") out.push({ x, y });
    });
  });
  return out;
}

export function hullCore(hull: HullId): { x: number; y: number } {
  const rows = HULLS[hull].rows;
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y]!.indexOf("C");
    if (x >= 0) return { x, y };
  }
  throw new Error(`hull ${hull} has no core`);
}

export function hullSize(hull: HullId): { width: number; height: number } {
  const rows = HULLS[hull].rows;
  return { width: rows[0]!.length, height: rows.length };
}
