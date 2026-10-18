import type { Grid } from "../game/grid";
import { orientations } from "../game/autoPlay";
import type { IVec3 } from "../game/vec";

/** One way the piece in hand can come to rest. */
export interface Placement {
  /** The piece's cells in this orientation, as offsets from its pivot. */
  cells: IVec3[];
  /** Where the pivot ends up. */
  pos: IVec3;
}

/** What the board looks like after a placement — the inputs to its score. */
export interface Features {
  /** Layers this placement completes. */
  cleared: number;
  /** Height of the tallest column afterwards, in layers. */
  top: number;
  /** Empty cells with something above them, afterwards. */
  holes: number;
  /** Summed height difference between neighbouring columns, afterwards. */
  bumpiness: number;
}

export interface Scored extends Placement {
  features: Features;
  score: number;
}

/**
 * Every distinct resting place for `pieceCells` on `grid`.
 *
 * Each orientation is lowered straight down from spawn height in every column.
 * Pieces slid in under an overhang mid-fall are not considered; neither are
 * placements that need a wall kick to reach. Two routes that leave the same
 * cells filled count once.
 */
export function enumeratePlacements(grid: Grid, pieceCells: IVec3[]): Placement[] {
  const out: Placement[] = [];
  const seen = new Set<string>();

  for (const { cells } of orientations(pieceCells).values()) {
    const maxY = Math.max(...cells.map((c) => c.y));
    const spawnY = grid.h - 1 - maxY;
    for (let x = -3; x < grid.w + 3; x++)
      for (let z = -3; z < grid.d + 3; z++) {
        let y = spawnY;
        if (!grid.canPlace(cells, { x, y, z })) continue;
        while (grid.canPlace(cells, { x, y: y - 1, z })) y--;

        const pos = { x, y, z };
        // Absolute cells, sorted: autoPlay's key() normalises position away,
        // which would fold every column of one orientation into a single entry.
        const k = cells
          .map((c) => `${c.x + x},${c.y + y},${c.z + z}`)
          .sort()
          .join("|");
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ cells, pos });
      }
  }
  return out;
}

/** Column heights as a w×d array, for holes and bumpiness. */
function columnHeights(grid: Grid): number[][] {
  const hs: number[][] = [];
  for (let x = 0; x < grid.w; x++) {
    hs.push([]);
    for (let z = 0; z < grid.d; z++) {
      let y = grid.h - 1;
      while (y >= 0 && !grid.isFilled(x, y, z)) y--;
      hs[x].push(y + 1);
    }
  }
  return hs;
}

export function countHoles(grid: Grid): number {
  const hs = columnHeights(grid);
  let holes = 0;
  for (let x = 0; x < grid.w; x++)
    for (let z = 0; z < grid.d; z++)
      for (let y = 0; y < hs[x][z]; y++) if (!grid.isFilled(x, y, z)) holes++;
  return holes;
}

/** Lock the placement into a copy of the grid and read off the result. */
export function featuresAfter(grid: Grid, p: Placement): { features: Features; after: Grid } {
  const after = grid.clone();
  after.lock(p.cells, p.pos, 1);
  const cleared = after.clearFullLayers();

  const hs = columnHeights(after);
  let top = 0;
  let bumpiness = 0;
  for (let x = 0; x < after.w; x++)
    for (let z = 0; z < after.d; z++) {
      top = Math.max(top, hs[x][z]);
      if (x + 1 < after.w) bumpiness += Math.abs(hs[x][z] - hs[x + 1][z]);
      if (z + 1 < after.d) bumpiness += Math.abs(hs[x][z] - hs[x][z + 1]);
    }

  return { features: { cleared, top, holes: countHoles(after), bumpiness }, after };
}

/**
 * Hand-set weights. A first pass, to be replaced by weights found in
 * self-play once games can be replayed from a seed.
 */
export const WEIGHTS = {
  cleared: 30,
  top: -4,
  holes: -12,
  bumpiness: -1,
};

export function score(f: Features): number {
  return (
    f.cleared * WEIGHTS.cleared +
    f.top * WEIGHTS.top +
    f.holes * WEIGHTS.holes +
    f.bumpiness * WEIGHTS.bumpiness
  );
}

/** Every placement with its score, best first. One move deep. */
export function rankPlacements(grid: Grid, pieceCells: IVec3[]): Scored[] {
  return enumeratePlacements(grid, pieceCells)
    .map((p) => {
      const { features } = featuresAfter(grid, p);
      return { ...p, features, score: score(features) };
    })
    .sort((a, b) => b.score - a.score);
}
