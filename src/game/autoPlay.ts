import { rankTwoDeep } from "../engine/lookahead";
import type { Game } from "./game";
import { key, orientations, type Step } from "./orientations";
import type { IVec3 } from "./vec";

/** How fast — and how well — the machine plays. */
export interface Pace {
  /** Milliseconds between one action and the next. */
  beatMs: number;
  /** Longer pause after a piece lands, so play has a beat to it. */
  settleMs: number;
  /**
   * Chance, per piece, of settling for a lesser spot than the engine's best:
   * one picked at random from the better third of the options. 0 plays the
   * engine's choice every time.
   */
  mistakes?: number;
}

/** The attract reel: slow enough for the queue to follow. */
export const DEMO_PACE: Pace = { beatMs: 240, settleMs: 750 };

/**
 * Plays the game on its own — the attract screen in VR, and the opponent in
 * versus.
 *
 * Where to put each piece is the evaluation engine's call (two moves deep, see
 * src/engine/lookahead.ts); this class only turns that into the turns and
 * slides a player would make, one beat at a time, so it reads as somebody
 * playing rather than as pieces appearing in place.
 */
export class AutoPlayer {
  /** Turns still to make, then the column to slide to and drop in. */
  private turns: Step[] = [];
  private target: { x: number; z: number } | null = null;
  private planningFor: IVec3[] | null = null;
  private nextStepAt = 0;

  constructor(private readonly pace: Pace = DEMO_PACE) {}

  reset(): void {
    this.turns = [];
    this.target = null;
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

    // A new piece needs a plan.
    if (this.planningFor !== game.cells) this.buildPlan(game);

    const now = performance.now();
    if (now < this.nextStepAt) return;
    this.nextStepAt = now + this.pace.beatMs;

    const turn = this.turns.shift();
    if (turn && turn.kind === "rotate") {
      game.tryRotate(turn.axis, turn.dir);
      // Rotation replaces game.cells, so re-anchor without re-planning.
      this.planningFor = game.cells;
      return;
    }

    // Slides are worked out from where the piece is now, not where it was when
    // the plan was made: a turn about the piece's centre, or a wall kick, moves
    // the pivot, and a slide counted up front would then overshoot.
    const t = this.target;
    const dx = t ? Math.sign(t.x - game.pos.x) : 0;
    const dz = t ? Math.sign(t.z - game.pos.z) : 0;
    // Slide one cell a beat so the piece is seen travelling. A slide that will
    // not go (something in the way) gives up and drops rather than stalling.
    if ((dx !== 0 || dz !== 0) && game.tryMove(dx, dx !== 0 ? 0 : dz)) return;

    game.hardDrop();
    // Hold on the landing before starting the next piece. Without it the
    // pieces run into one another and the whole thing reads as a machine
    // dumping blocks rather than as somebody playing.
    this.nextStepAt = now + this.pace.settleMs;
  }

  /** Choose a landing spot: the turns that reach its shape, and its column. */
  private buildPlan(game: Game): void {
    this.planningFor = game.cells;
    // The engine ranks every resting place, looking one piece ahead; the
    // orientation search knows the turns that reach each shape. Shapes are
    // matched by their normalised key.
    const ranked = rankTwoDeep(game.grid, game.cells, game.next.cells);
    const paths = orientations(game.cells);

    let choice = ranked[0];
    const slip = this.pace.mistakes ?? 0;
    if (choice && slip > 0 && Math.random() < slip) {
      const pool = Math.max(2, Math.ceil(ranked.length / 3));
      choice = ranked[1 + Math.floor(Math.random() * Math.min(pool, ranked.length - 1))] ?? choice;
    }

    const path = choice ? paths.get(key(choice.cells))?.path : undefined;
    this.turns = path ? [...path] : [];
    this.target = choice && path ? { x: choice.pos.x, z: choice.pos.z } : null;
  }
}
