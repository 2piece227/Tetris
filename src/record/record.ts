import type { Rules } from "../game/rules";
import type { Axis, IVec3 } from "../game/vec";

/**
 * One input, as the player made it, timed from the start of the round.
 *
 * Turns and moves record whether they took effect: a turn that would not fit
 * is still a turn the player tried, and that is what the rotation indicator
 * needs to see.
 */
export type InputRecord =
  | { t: number; k: "move"; dx: number; dz: number; ok: boolean }
  | { t: number; k: "turn"; axis: Axis; dir: 1 | -1; ok: boolean }
  | { t: number; k: "drop" };

/** One piece, from the moment it appeared to the moment it locked. */
export interface MoveRecord {
  /** Piece name, as a check on the replay: the seed decides which piece came. */
  piece: string;
  spawnMs: number;
  lockMs: number;
  /** Where it came to rest: its cells as offsets, and the pivot position. */
  cells: IVec3[];
  pos: IVec3;
  /** Locked by a hard drop, rather than by gravity running it into the stack. */
  hardDrop: boolean;
  inputs: InputRecord[];
}

/**
 * A whole round, compact enough to send to the booth's record server and
 * enough to rebuild every board of it: the seed fixes the pieces, the moves
 * fix where each one went.
 */
export interface GameRecord {
  v: 1;
  rules: Rules["id"];
  seed: number;
  /** Wall-clock start, for the server to sort and expire by. */
  startedAt: number;
  durationMs: number;
  endedBy: "topout" | "timeout" | null;
  score: number;
  layers: number;
  moves: MoveRecord[];
}
