import type { HullId } from "../types.js";

export interface HullDef {
  id: HullId;
  name: string;
  /** '#' = buildable, 'C' = core (pre-placed), '.' = outside the hull. Nose points up. */
  rows: string[];
}

export const HULLS: Record<HullId, HullDef> = {
  hauler: {
    id: "hauler",
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
  barge: {
    id: "barge",
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
  // B-2 style
  wing: {
    id: "wing",
    name: "Flying Wing",
    rows: [
      "........#........",
      ".......###.......",
      "......#####......",
      ".....#######.....",
      "....#########....",
      "..######C######..",
      "#################",
      "###.#########.###",
      "##...###.###...##",
    ],
  },
  // Two big panels on a strut
  panels: {
    id: "panels",
    name: "Panels",
    rows: [
      "###.........###",
      "###.........###",
      "###.........###",
      "###...###...###",
      "###..#####..###",
      "#######C#######",
      "###############",
      "###...###...###",
      "###.........###",
      "###.........###",
      "###.........###",
    ],
  },
  // Long nose, splayed foils
  strike: {
    id: "strike",
    name: "Strike",
    rows: [
      "......#......",
      "......#......",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      "##...###...##",
      "###..###..###",
      ".###.###.###.",
      "..####C####..",
      "...#######...",
      "..#########..",
      ".###.###.###.",
      "###..###..###",
      "##...###...##",
    ],
  },
  // Star-destroyer triangle
  wedge: {
    id: "wedge",
    name: "Wedge",
    rows: [
      "......#......",
      "......#......",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "....#####....",
      "...#######...",
      "...#######...",
      "..####C####..",
      "..#########..",
      ".###########.",
      ".###########.",
      "#############",
      "###.##.##.###",
    ],
  },
  // Saucer, neck and nacelles
  saucer: {
    id: "saucer",
    name: "Saucer",
    rows: [
      "...#######...",
      "..#########..",
      ".###########.",
      ".###########.",
      ".###########.",
      "..#########..",
      "...###C###...",
      ".....###.....",
      "##...###...##",
      "##.#######.##",
      "#############",
      "##..#####..##",
      "##...###...##",
      "##.........##",
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
