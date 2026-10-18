import type { WellSize } from "./rules";
import { IVec3, add } from "./vec";

const EMPTY = -1;

// Flat store of the settled blocks. Value is a colour hex, or EMPTY.
export class Grid {
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly cells: Int32Array;

  constructor(size: WellSize) {
    this.w = size.w;
    this.d = size.d;
    this.h = size.h;
    this.cells = new Int32Array(this.w * this.d * this.h).fill(EMPTY);
  }

  /** An independent copy, for trying a placement without touching this grid. */
  clone(): Grid {
    const g = new Grid(this);
    g.cells.set(this.cells);
    return g;
  }

  /** Cells in one layer, for turning layerFill into a fraction. */
  get layerCells(): number {
    return this.w * this.d;
  }

  private idx(x: number, y: number, z: number): number {
    return x + this.w * (z + this.d * y);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.w && z >= 0 && z < this.d && y >= 0 && y < this.h;
  }

  get(x: number, y: number, z: number): number {
    return this.cells[this.idx(x, y, z)];
  }

  isFilled(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== EMPTY;
  }

  /** How many of a layer's w*d cells are occupied. Drives the depth gauge. */
  layerFill(y: number): number {
    let n = 0;
    for (let z = 0; z < this.d; z++)
      for (let x = 0; x < this.w; x++) if (this.isFilled(x, y, z)) n++;
    return n;
  }

  // Can these piece cells (offsets) sit at world position `pos`?
  canPlace(cells: IVec3[], pos: IVec3): boolean {
    for (const cell of cells) {
      const p = add(pos, cell);
      if (!this.inBounds(p.x, p.y, p.z)) return false;
      if (this.isFilled(p.x, p.y, p.z)) return false;
    }
    return true;
  }

  lock(cells: IVec3[], pos: IVec3, color: number): void {
    for (const cell of cells) {
      const p = add(pos, cell);
      if (this.inBounds(p.x, p.y, p.z)) this.cells[this.idx(p.x, p.y, p.z)] = color;
    }
  }

  // Remove every completely-filled horizontal layer and let the blocks above
  // fall down by the number of layers removed. Returns how many were cleared.
  clearFullLayers(): number {
    let cleared = 0;
    for (let y = 0; y < this.h; y++) {
      if (this.isLayerFull(y)) {
        this.removeLayer(y);
        cleared++;
        y--; // re-check the same y, everything above just dropped into it
      }
    }
    return cleared;
  }

  private isLayerFull(y: number): boolean {
    return this.layerFill(y) === this.layerCells;
  }

  // Delete layer `y`, shift every layer above it down by one, clear the top.
  private removeLayer(y: number): void {
    const { w, d, h } = this;
    for (let yy = y; yy < h - 1; yy++)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++)
          this.cells[this.idx(x, yy, z)] = this.get(x, yy + 1, z);
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) this.cells[this.idx(x, h - 1, z)] = EMPTY;
  }

  /**
   * Push `n` garbage layers in at the floor, lifting the stack by n.
   *
   * Every inserted layer is left open at the same (holeX, holeZ). Rolling a
   * fresh hole per layer turns a multi-line hit into a staircase that has to be
   * unpicked one layer at a time; one shared column keeps a big attack punishing
   * without being unfair to dig out of.
   *
   * Returns true if the lift pushed occupied cells past the ceiling, which the
   * caller can treat as a loss — though the spawn check right after will catch
   * it anyway once the well is full.
   */
  riseGarbage(n: number, holeX: number, holeZ: number, color: number): boolean {
    if (n <= 0) return false;
    const { w, d, h } = this;
    const lift = Math.min(n, h);

    // Anything currently sitting in the top `lift` layers is about to be pushed
    // out, so test before the shift overwrites it.
    let overflow = false;
    for (let y = h - lift; y < h && !overflow; y++)
      if (this.layerFill(y) > 0) overflow = true;

    // Top down, so a source cell is never clobbered before it is read.
    for (let y = h - 1; y >= lift; y--)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++)
          this.cells[this.idx(x, y, z)] = this.get(x, y - lift, z);

    for (let y = 0; y < lift; y++)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++)
          this.cells[this.idx(x, y, z)] =
            x === holeX && z === holeZ ? EMPTY : color;

    return overflow;
  }

  reset(): void {
    this.cells.fill(EMPTY);
  }

  // Iterate all filled cells — used by the renderer.
  forEachFilled(fn: (x: number, y: number, z: number, color: number) => void): void {
    for (let y = 0; y < this.h; y++)
      for (let z = 0; z < this.d; z++)
        for (let x = 0; x < this.w; x++) {
          const col = this.get(x, y, z);
          if (col !== EMPTY) fn(x, y, z, col);
        }
  }
}
