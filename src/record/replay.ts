import { PieceFeed } from "../game/bag";
import { Grid } from "../game/grid";
import type { PieceDef } from "../game/pieces";
import { RULES_BY_ID, type Rules } from "../game/rules";
import type { GameRecord, MoveRecord } from "./record";

/** One piece of a replayed round, with the boards around it. */
export interface ReplayStep {
  /** 1-based, as shown to the player. */
  n: number;
  piece: PieceDef;
  move: MoveRecord;
  /** The board as it was when this piece arrived. */
  before: Grid;
}

export interface Replay {
  rules: Rules;
  steps: ReplayStep[];
  /** Set when the record does not replay cleanly; steps stop where it broke. */
  problem: string | null;
}

/**
 * Rebuild a recorded round, board by board.
 *
 * The seed deals the pieces and the moves say where each one went, so nothing
 * else needs to be stored. Two checks keep a bad record from producing a
 * plausible-looking but wrong review: the dealt piece has to match the one
 * recorded, and each placement has to be one the piece could actually rest in.
 *
 * VR rounds only. A versus round also had garbage rising under it, at moments
 * set by the other player, which a single player's record does not carry.
 */
export function replay(record: GameRecord): Replay {
  const rules = RULES_BY_ID[record.rules];
  const steps: ReplayStep[] = [];
  if (!rules) return { rules: RULES_BY_ID.vr, steps, problem: `알 수 없는 규칙: ${record.rules}` };
  if (rules.id !== "vr") return { rules, steps, problem: "대결 기록은 아직 다시 재생할 수 없어요" };

  let score = 0;
  let layers = 0;
  let level = 1;
  const feed = new PieceFeed(rules.tiers, () => score);
  feed.reset(record.seed);
  let grid = new Grid(rules.well);

  // Deal in the same order the game does. It draws piece 0 before the round
  // starts and, as each piece spawns, the one after it — so position i + 1 is
  // generated against the score as it stood when piece i appeared. The tier,
  // and with it the piece, depends on that score.
  feed.at(0);
  for (let i = 0; i < record.moves.length; i++) {
    const move = record.moves[i];
    const piece = feed.at(i);
    feed.at(i + 1);

    if (piece.name !== move.piece)
      return { rules, steps, problem: `${i + 1}번째 조각이 기록(${move.piece})과 달라요(${piece.name})` };
    const below = { ...move.pos, y: move.pos.y - 1 };
    if (!grid.canPlace(move.cells, move.pos) || grid.canPlace(move.cells, below))
      return { rules, steps, problem: `${i + 1}번째 조각이 놓일 수 없는 자리에 기록돼 있어요` };

    steps.push({ n: i + 1, piece, move, before: grid });

    const after = grid.clone();
    after.lock(move.cells, move.pos, piece.color);
    const n = after.clearFullLayers();
    if (n > 0) {
      score += (rules.layerScore[Math.min(n, rules.layerScore.length - 1)] ?? 0) * level;
      layers += n;
      level = 1 + Math.floor(layers / rules.layersPerLevel);
    }
    grid = after;
  }

  if (score !== record.score)
    return { rules, steps, problem: `점수가 기록(${record.score})과 달라요(${score})` };
  return { rules, steps, problem: null };
}
