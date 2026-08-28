import { WELL } from "../config";
import type { Game } from "./game";
import { Axis, IVec3, rotate } from "./vec";

const { w, d, h } = WELL;

/** One thing the demo player does this beat. */
type Step =
  | { kind: "rotate"; axis: Axis; dir: 1 | -1 }
  | { kind: "move"; dx: number; dz: number }
  | { kind: "drop" };

const key = (cells: IVec3[]): string => {
  const mx = Math.min(...cells.map((c) => c.x));
  const my = Math.min(...cells.map((c) => c.y));
  const mz = Math.min(...cells.map((c) => c.z));
  return cells
    .map((c) => `${c.x - mx},${c.y - my},${c.z - mz}`)
    .sort()
    .join("|");
};

/**
 * Every orientation the piece can be turned into, with the shortest sequence of
 * quarter turns that gets there.
 *
 * Breadth-first so the demo takes the short way round rather than spinning the
 * piece four times to arrive where two turns would have done — which is what it
 * looks like when a plan is executed without one.
 */
function orientations(from: IVec3[]): Map<string, { cells: IVec3[]; path: Step[] }> {
  const seen = new Map<string, { cells: IVec3[]; path: Step[] }>();
  const start = from.map((c) => ({ ...c }));
  seen.set(key(start), { cells: start, path: [] });

  const queue = [key(start)];
  const axes: Axis[] = ["x", "y", "z"];
  const dirs: (1 | -1)[] = [1, -1];

  while (queue.length) {
    const at = seen.get(queue.shift()!)!;
    for (const axis of axes)
      for (const dir of dirs) {
        const next = at.cells.map((c) => rotate(c, axis, dir));
        const k = key(next);
        if (seen.has(k)) continue;
        seen.set(k, { cells: next, path: [...at.path, { kind: "rotate", axis, dir }] });
        queue.push(k);
      }
  }
  return seen;
}

/**
 * Plays the game on its own, for the attract screen.
 *
 * Scored the same way the balance simulations were: land low, and do not roof
 * over empty cells. It is not trying to be a strong player — it is trying to
 * look like someone who knows what they are doing, which mostly means never
 * dropping a piece somewhere obviously silly while a queue is watching.
 */
export class AutoPlayer {
  private plan: Step[] = [];
  private planningFor: IVec3[] | null = null;
  private nextStepAt = 0;

  /** Milliseconds between one action and the next. */
  private readonly BEAT_MS = 240;
  /** Longer pause after a piece lands, so the reel has a beat to it. */
  private readonly SETTLE_MS = 750;

  reset(): void {
    this.plan = [];
    this.planningFor = null;
    this.nextStepAt = 0;
  }

  /**
   * Paced by the wall clock rather than the engine delta, which reports zero
   * whenever the render loop is not genuinely running and would leave the demo
   * frozen mid-piece on the mirrored screen.
   */
  update(game: Game): void {
    if (game.gameOver) return;

    // A new piece (or one moved by gravity into a different shape) needs a plan.
    if (this.planningFor !== game.cells) {
      this.plan = this.buildPlan(game);
      this.planningFor = game.cells;
    }

    const now = performance.now();
    if (now < this.nextStepAt) return;
    this.nextStepAt = now + this.BEAT_MS;

    const step = this.plan.shift();
    if (!step) return;

    if (step.kind === "rotate") {
      game.tryRotate(step.axis, step.dir);
      // Rotation replaces game.cells, so re-anchor without re-planning.
      this.planningFor = game.cells;
    } else if (step.kind === "move") {
      game.tryMove(step.dx, step.dz);
    } else {
      game.hardDrop();
      // Hold on the landing before starting the next piece. Without it the
      // pieces run into one another and the whole thing reads as a machine
      // dumping blocks rather than as somebody playing.
      this.nextStepAt = now + this.SETTLE_MS;
    }
  }

  /** Choose a landing spot, then the turns and slides that reach it. */
  private buildPlan(game: Game): Step[] {
    const options = orientations(game.cells);
    let best: { score: number; path: Step[]; x: number; z: number } | null = null;

    for (const { cells, path } of options.values())
      for (let x = -3; x < w + 3; x++)
        for (let z = -3; z < d + 3; z++) {
          let y = h - 1;
          while (y >= 0 && !game.grid.canPlace(cells, { x, y, z })) y--;
          if (y < 0) continue;
          while (y > 0 && game.grid.canPlace(cells, { x, y: y - 1, z })) y--;

          const top = Math.max(...cells.map((c) => y + c.y));
          let holes = 0;
          for (const c of cells)
            for (let yy = y + c.y - 1; yy >= 0; yy--) {
              if (game.grid.isFilled(x + c.x, yy, z + c.z)) break;
              holes++;
            }

          const score = -top * 4 - holes * 12;
          if (!best || score > best.score) best = { score, path, x, z };
        }

    if (!best) return [{ kind: "drop" }];

    const steps: Step[] = [...best.path];
    // Slide one cell at a time so the piece is seen travelling rather than
    // teleporting to its column.
    for (let i = 0; i < Math.abs(best.x - game.pos.x); i++)
      steps.push({ kind: "move", dx: Math.sign(best.x - game.pos.x), dz: 0 });
    for (let i = 0; i < Math.abs(best.z - game.pos.z); i++)
      steps.push({ kind: "move", dx: 0, dz: Math.sign(best.z - game.pos.z) });
    steps.push({ kind: "drop" });
    return steps;
  }
}
