import { Grid } from "../game/grid";
import { orientations } from "../game/orientations";
import type { IVec3 } from "../game/vec";
import {
  featuresAfter,
  rankPlacements,
  score,
  WEIGHTS,
  type Placement,
  type Scored,
} from "./placements";

/** What topping out on the next piece is worth: as bad as it gets. */
const TOP_OUT = -1e6;

/**
 * Scores boards for the look-ahead's inner loop without allocating.
 *
 * That loop scores every place the next piece could go, for every place the
 * piece in hand could go — tens of thousands of boards a move. Building a new
 * grid and fresh height arrays for each was most of the cost; this keeps one
 * scratch grid and one height table and reuses them. Same features, same
 * weights as score() in placements.ts.
 */
class BoardScorer {
  private scratch: Grid | null = null;
  private heights = new Int32Array(0);

  scoreAfter(board: Grid, cells: IVec3[], pos: IVec3): number {
    if (!this.scratch || this.scratch.cells.length !== board.cells.length) {
      this.scratch = new Grid(board);
      this.heights = new Int32Array(board.w * board.d);
    }
    const g = this.scratch;
    g.cells.set(board.cells);
    g.lock(cells, pos, 1);
    const cleared = g.clearFullLayers();

    const { w, d, h } = g;
    const hs = this.heights;
    let top = 0;
    let holes = 0;
    for (let x = 0; x < w; x++)
      for (let z = 0; z < d; z++) {
        let y = h - 1;
        while (y >= 0 && !g.isFilled(x, y, z)) y--;
        const colH = y + 1;
        hs[x * d + z] = colH;
        if (colH > top) top = colH;
        for (let yy = 0; yy < colH; yy++) if (!g.isFilled(x, yy, z)) holes++;
      }
    let bumpiness = 0;
    for (let x = 0; x < w; x++)
      for (let z = 0; z < d; z++) {
        const here = hs[x * d + z];
        if (x + 1 < w) bumpiness += Math.abs(here - hs[(x + 1) * d + z]);
        if (z + 1 < d) bumpiness += Math.abs(here - hs[x * d + z + 1]);
      }
    return score({ cleared, top, holes, bumpiness });
  }

  /**
   * The best score any placement of a piece reaches on `board`, given the
   * piece's orientations. Each is lowered straight down from spawn height in
   * every column, as enumeratePlacements does; duplicates do not matter here,
   * only the maximum.
   */
  bestOn(board: Grid, shapes: IVec3[][]): number {
    let best = TOP_OUT;
    for (const cells of shapes) {
      let maxY = -Infinity;
      for (const c of cells) if (c.y > maxY) maxY = c.y;
      const spawnY = board.h - 1 - maxY;
      for (let x = -3; x < board.w + 3; x++)
        for (let z = -3; z < board.d + 3; z++) {
          const pos = { x, y: spawnY, z };
          if (!board.canPlace(cells, pos)) continue;
          while (pos.y > -4 && board.canPlace(cells, { x, y: pos.y - 1, z })) pos.y--;
          const s = this.scoreAfter(board, cells, pos);
          if (s > best) best = s;
        }
    }
    return best;
  }
}

const scorer = new BoardScorer();

/** Every orientation of a piece, once — the look-ahead reuses them for every board. */
const shapesOf = (cells: IVec3[]): IVec3[][] => [...orientations(cells).values()].map((o) => o.cells);

/**
 * A placement's value two moves deep: the layers it clears now, plus the best
 * score the next piece can reach on the board it leaves.
 *
 * A one-move search sees only the board right after this piece, so it happily
 * fills the one gap the next piece would have fitted, or builds a ledge
 * nothing can follow. This asks what comes after.
 */
export function twoDeepValue(
  grid: Grid,
  p: Placement,
  next: IVec3[],
  nextShapes: IVec3[][] = shapesOf(next)
): number {
  const { features, after } = featuresAfter(grid, p);
  return features.cleared * WEIGHTS.cleared + scorer.bestOn(after, nextShapes);
}

/**
 * Rank the piece in hand two moves deep (see twoDeepValue). Measured against
 * one move deep on the same piece sequences, this kept the stack about half as
 * high once five-cell pieces were in the bag, and survived every run that one
 * move deep lost.
 *
 * `beam` limits how many placements get the full look ahead — the best few by
 * the one-move score. Twelve chose the same moves as looking ahead from all of
 * them, at a seventh of the cost, which is what the opponent uses. The review
 * passes Infinity: it has to put a fair two-move value on whatever the player
 * did, however far down the one-move ranking that was. Placements outside the
 * beam keep their one-move order, below everything inside it.
 */
export function rankTwoDeep(grid: Grid, piece: IVec3[], next: IVec3[], beam = 12): Scored[] {
  const first = rankPlacements(grid, piece);
  const nextShapes = shapesOf(next);
  const deep = first
    .slice(0, beam)
    .map((p) => ({ ...p, score: twoDeepValue(grid, p, next, nextShapes) }))
    .sort((a, b) => b.score - a.score);
  if (deep.length === first.length) return deep;
  const floor = Math.min(...deep.map((p) => p.score)) - 1;
  return [...deep, ...first.slice(beam).map((p, i) => ({ ...p, score: floor - i }))];
}
