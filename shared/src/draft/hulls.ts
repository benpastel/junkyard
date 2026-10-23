import type { HullId, HullTier, Pace } from "../types.js";

export interface HullDef {
  id: HullId;
  name: string;
  /** Size class: the lobby shows one row per tier, and build time scales with it. */
  tier: HullTier;
  /** '#' = buildable, 'C' = core (pre-placed), '.' = outside the hull. Nose points up. */
  rows: string[];
}

export const HULLS: Record<HullId, HullDef> = {
  // Small and pointed: the quickest build
  skiff: {
    id: "skiff",
    name: "Skiff",
    tier: "small",
    rows: [
      ".....#.....",
      "....###....",
      "...##.##...",
      "...#####...",
      "..#######..",
      ".####C####.",
      "##.#####.##",
      "###.###.###",
      "####.#.####",
      "##.......##",
    ],
  },
  // Hammerhead shark: a wide bar across the nose
  hammerhead: {
    id: "hammerhead",
    name: "Hammerhead",
    tier: "small",
    rows: [
      "###########",
      "###########",
      "....###....",
      "...#####...",
      "...##C##...",
      "...#####...",
      "...#####...",
      "...#####...",
      "..###.###..",
      "..##...##..",
    ],
  },
  // Four-armed cross
  starfish: {
    id: "starfish",
    name: "Starfish",
    tier: "small",
    rows: [
      ".....#.#.....",
      ".....###.....",
      "....##.##....",
      "#############",
      "##.###C###.##",
      "#############",
      "...##.#.##...",
      ".....###.....",
      ".....#.#.....",
      "....##.##....",
    ],
  },
  // Twin hulls joined by a bridge
  catamaran: {
    id: "catamaran",
    name: "Catamaran",
    tier: "small",
    rows: [
      "##.......##",
      "###.....###",
      "##.#####.##",
      "###########",
      "#####C#####",
      "##.#####.##",
      "###.....###",
      "##.......##",
    ],
  },
  // A V of swept-back wings with nothing behind the cockpit
  chevron: {
    id: "chevron",
    name: "Chevron",
    tier: "small",
    rows: [
      "......#......",
      "....#####....",
      "...#######...",
      "..####C####..",
      ".#####.#####.",
      "#####...#####",
      "####.....####",
      "###.......###",
      "##.........##",
    ],
  },
  // Wide body with two forward pincers
  crab: {
    id: "crab",
    name: "Crab",
    tier: "medium",
    rows: [
      "##.......##",
      "###.....###",
      "###.....###",
      ".###...###.",
      "..#######..",
      ".#.#####.#.",
      "#####C#####",
      "###########",
      ".#########.",
      "..#######..",
      "..###.###..",
    ],
  },
  // Three forward prongs
  trident: {
    id: "trident",
    name: "Trident",
    tier: "medium",
    rows: [
      "##...#...##",
      "##..###..##",
      "##..###..##",
      "##.#####.##",
      "###########",
      "#####C#####",
      ".#########.",
      "..#######..",
      "...#####...",
      "...#####...",
      "..##...##..",
    ],
  },
  // B-2 style
  wing: {
    id: "wing",
    name: "Flying Wing",
    tier: "medium",
    rows: [
      "........#........",
      ".......###.......",
      "......#####......",
      ".....#######.....",
      "....#########....",
      ".###.###C###.###.",
      "#################",
      "##.#.#######.#.##",
      "##.###.#.#.###.##",
    ],
  },
  // Long nose, splayed foils
  strike: {
    id: "strike",
    name: "Strike",
    tier: "medium",
    rows: [
      ".....###.....",
      ".....###.....",
      ".....###.....",
      "##...###...##",
      "###..###..###",
      ".###########.",
      "..#########..",
      "...###C###...",
      "..#########..",
      ".###.###.###.",
      "###..###..###",
      "......#......",
    ],
  },
  // Two big panels on a strut
  panels: {
    id: "panels",
    name: "Panels",
    tier: "medium",
    rows: [
      "###.........###",
      "###.........###",
      "###..#####..###",
      "###..#####..###",
      "#######C#######",
      "###############",
      "###.........###",
      "###.........###",
      ".##.........##.",
    ],
  },
  // Star-destroyer triangle
  wedge: {
    id: "wedge",
    name: "Wedge",
    tier: "large",
    rows: [
      "......#......",
      "......#......",
      ".....###.....",
      ".....#.#.....",
      "....#####....",
      "....##.##....",
      "...#######...",
      "...#######...",
      "..####C####..",
      "..#.#####.#..",
      ".###########.",
      ".##.#####.##.",
      "#############",
      "##.##.#.##.##",
      "#############",
      "###.#.#.#.###",
    ],
  },
  // Manta ray: wide flat wings and a tail
  manta: {
    id: "manta",
    name: "Manta",
    tier: "large",
    rows: [
      "......###......",
      ".....##.##.....",
      "...#########...",
      ".#############.",
      "#######C#######",
      "##.#.#####.#.##",
      "#.#.#######.#.#",
      ".#############.",
      "...#########...",
      "..###.###.###..",
      ".....#####.....",
      "......#.#......",
      "......###......",
      "......###......",
    ],
  },
  // A ring round a central hub
  station: {
    id: "station",
    name: "Station",
    tier: "large",
    rows: [
      "...#######...",
      "..#########..",
      ".###.###.###.",
      ".##..###..##.",
      "##..#####..##",
      "##..##C##..##",
      "#############",
      "##..#####..##",
      "##..#####..##",
      ".##..###..##.",
      ".###.....###.",
      "..#########..",
      "...#######...",
    ],
  },
  // Saucer, neck and nacelles
  saucer: {
    id: "saucer",
    name: "Saucer",
    tier: "large",
    rows: [
      "...#######...",
      "..#########..",
      ".####...####.",
      ".####...####.",
      "..#########..",
      "...###C###...",
      "....#####....",
      "##...###...##",
      "##.#######.##",
      "#############",
      "##.#######.##",
      "##...###...##",
      "##.........##",
      "##.........##",
    ],
  },
  // A huge battleship
  dreadnought: {
    id: "dreadnought",
    name: "Dreadnought",
    tier: "large",
    rows: [
      ".....#.#.....",
      ".....###.....",
      ".....###.....",
      "...#######...",
      "..##.###.##..",
      "#############",
      "#.#.#####.#.#",
      "..####C####..",
      "..#########..",
      "###.#####.###",
      "#############",
      ".##.#####.##.",
      "..##.###.##..",
      "..###...###..",
      "...#.....#...",
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

/** Build time for a pace on a hull (bigger hulls get longer), or null for no limit. */
export function buildSeconds(pace: Pace, hull: HullId): number | null {
  return pace === "unlimited" ? null : BUILD_SECONDS[HULLS[hull].tier][pace];
}

const BUILD_SECONDS: Record<HullTier, Record<Exclude<Pace, "unlimited">, number>> = {
  small: { frantic: 25, fast: 40, strategic: 60 },
  medium: { frantic: 35, fast: 60, strategic: 90 },
  large: { frantic: 50, fast: 80, strategic: 120 },
};
