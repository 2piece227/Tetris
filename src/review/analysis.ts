import {
  countHoles,
  featuresAfter,
  rankPlacements,
  score as scoreOf,
  type Placement,
  type Scored,
} from "../engine/placements";
import type { Grid } from "../game/grid";
import { key, orientations } from "../game/orientations";
import type { PieceDef } from "../game/pieces";
import type { Rules } from "../game/rules";
import type { GameRecord, MoveRecord } from "../record/record";
import { replay } from "../record/replay";
import { classify, moveAccuracy, type Judged, type Label } from "./labels";

export interface Turn {
  /** 1-based, as shown to the player. */
  n: number;
  piece: PieceDef;
  /** The board as it was when this piece arrived. */
  before: Grid;
  /** The board once the piece is down and any full layers are gone. */
  after: Grid;
  /** Layers this move filled, before they clear. Empty when nothing clears. */
  fullLayers: number[];
  played: Scored;
  best: Scored;
  /** 1 = the best option. */
  rank: number;
  options: number;
  judged: Judged;
  label: Label;
  accuracy: number;
  /** The recorded move, when this turn came from a real round. */
  move?: MoveRecord;
}

export interface Indicator {
  name: string;
  /** 0–100, for the bar. */
  value: number;
  /** What is printed beside the bar. */
  display: string;
  note: string;
  /** Not measured: a placeholder until the data exists. */
  sample: boolean;
}

export interface Review {
  turns: Turn[];
  score: number;
  layers: number;
  accuracy: number;
  indicators: Indicator[];
  /** A made-up round rather than a real one. */
  sample: boolean;
}

/** "As good as the best" means within this fraction of the position's spread. */
const NEAR_BEST = 0.2;

/** Non-planar tetracubes — the ones that cannot lie flat in any orientation. */
const SOLID = new Set(["B", "D", "F"]);

const cellsKey = (p: Placement): string =>
  p.cells
    .map((c) => `${c.x + p.pos.x},${c.y + p.pos.y},${c.z + p.pos.z}`)
    .sort()
    .join("|");

/**
 * Every place the piece could go, valued the way the review judges them: one
 * move deep, on the board the player was looking at.
 *
 * The opponent looks a piece further ahead, and the review did too for a
 * while. It was dropped: two moves deep, a sensible move on the board as it
 * stood could be marked 의문 because a different spot would have suited the
 * next piece better — which asks a first-time player to have planned two
 * pieces out, and is hard to explain from what is on screen. The review judges
 * the decision the player could see.
 */
export function rankForReview(before: Grid, piece: PieceDef): Scored[] {
  return rankPlacements(before, piece.cells);
}

/**
 * Judge one move against every other place the piece could have gone.
 *
 * A placement the engine does not list — a piece slid in under an overhang
 * while it fell, which the engine's straight-down search never tries — is
 * valued on its own and ranked among the rest by that value.
 */
export function judgeTurn(
  n: number,
  rules: Rules,
  before: Grid,
  piece: PieceDef,
  placement: Placement,
  ranked: Scored[] = rankForReview(before, piece)
): Turn {
  const want = cellsKey(placement);
  let played = ranked.find((p) => cellsKey(p) === want);
  if (!played) {
    const { features } = featuresAfter(before, placement);
    played = { ...placement, features, score: scoreOf(features) };
  }
  const best = ranked[0] ?? played;
  const median = ranked.length ? ranked[Math.floor(ranked.length / 2)].score : played.score;
  const spread = best.score - median;
  const rank = 1 + ranked.filter((p) => p.score > played!.score + 1e-9).length;
  const listed = ranked.includes(played);

  const judged: Judged = {
    loss: Math.max(0, best.score - played.score),
    spread,
    nearBest: ranked.filter((p) => p.score >= best.score - Math.max(1, NEAR_BEST * spread)).length,
    cleared: played.features.cleared,
    holesCreated: Math.max(0, played.features.holes - countHoles(before)),
    top: played.features.top,
    wellH: rules.well.h,
  };

  // Locked in the piece's own colour, so the replayed stack looks like the one
  // the player built. (featuresAfter only needs filled-or-not.)
  const placed = before.clone();
  placed.lock(played.cells, played.pos, piece.color);
  const fullLayers = placed.fullLayers();
  const after = placed.clone();
  after.clearFullLayers();

  return {
    n,
    piece,
    before,
    after,
    fullLayers,
    played,
    best,
    rank,
    options: ranked.length + (listed ? 0 : 1),
    judged,
    label: classify(judged),
    accuracy: moveAccuracy(judged),
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** The two indicators every review can compute from the turns alone. */
function placementIndicators(turns: Turn[]): Indicator[] {
  const accuracy = Math.round(mean(turns.map((t) => t.accuracy)));
  const solidTurns = turns.filter((t) => SOLID.has(t.piece.name));
  const solid = Math.round(mean(solidTurns.map((t) => t.accuracy)));
  const flat = Math.round(mean(turns.filter((t) => !SOLID.has(t.piece.name)).map((t) => t.accuracy)));
  return [
    {
      name: "배치 정확도",
      value: accuracy,
      display: `${accuracy}%`,
      note: "놓을 수 있는 자리 중 얼마나 좋은 곳을 골랐는지",
      sample: false,
    },
    {
      name: "입체 조각 처리",
      value: solidTurns.length ? solid : flat,
      display: solidTurns.length ? `${solid}%` : "—",
      note: solidTurns.length
        ? `평면 조각 ${flat}% 대비, 가지·나사 조각을 얼마나 잘 놓았는지`
        : "이번 판에는 가지·나사 조각이 나오지 않았어요",
      sample: false,
    },
  ];
}

/**
 * Turning efficiency: the fewest quarter turns that reach each final
 * orientation, over the turns actually made. A turn that would not fit is
 * counted separately — it was an attempt, but the board, not the player's
 * picture of the piece, is what stopped it.
 */
function rotationIndicator(turns: Turn[]): Indicator {
  let needed = 0;
  let made = 0;
  let blocked = 0;
  for (const t of turns) {
    if (!t.move) continue;
    needed += orientations(t.piece.cells).get(key(t.move.cells))?.path.length ?? 0;
    for (const i of t.move.inputs) {
      if (i.k !== "turn") continue;
      if (i.ok) made++;
      else blocked++;
    }
  }
  const value = made === 0 ? 100 : clamp((100 * needed) / made);
  return {
    name: "회전 효율",
    value,
    display: `${value}%`,
    note: `최소 ${needed}번이면 되는 회전을 ${made}번 돌렸어요` + (blocked ? ` (막힌 회전 ${blocked}번)` : ""),
    sample: false,
  };
}

/** How long a piece was in hand, on average. Shown in seconds; the bar is fuller when quicker. */
function speedIndicator(turns: Turn[]): Indicator {
  const secs = mean(turns.filter((t) => t.move).map((t) => (t.move!.lockMs - t.move!.spawnMs) / 1000));
  // 2 s or under fills the bar; 16 s and over empties it.
  const value = clamp(100 * (1 - (secs - 2) / 14));
  return {
    name: "판단 속도",
    value,
    display: `${secs.toFixed(1)}초`,
    note: "조각이 나타나서 놓기까지 걸린 평균 시간",
    sample: false,
  };
}

/** Reports how far an analysis has got: turns done, of how many. */
export type Progress = (done: number, total: number) => void;

/** Let the page draw between turns, so the progress shown actually moves. */
export const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * The review of a recorded round, or why it could not be built.
 *
 * Two moves deep from every placement is a few tens of milliseconds a turn,
 * a few seconds a round, so it yields between turns and reports progress.
 */
export async function reviewFromRecord(
  record: GameRecord,
  onProgress?: Progress
): Promise<{ review: Review | null; problem: string | null }> {
  const { rules, steps, problem } = replay(record);
  if (problem) return { review: null, problem };
  if (steps.length === 0) return { review: null, problem: "놓은 조각이 하나도 없는 판이에요" };

  const turns: Turn[] = [];
  for (const s of steps) {
    onProgress?.(turns.length, steps.length);
    await breathe();
    turns.push({
      ...judgeTurn(s.n, rules, s.before, s.piece, { cells: s.move.cells, pos: s.move.pos }),
      move: s.move,
    });
  }
  onProgress?.(turns.length, steps.length);
  const [accuracy, solid] = placementIndicators(turns);
  return {
    review: {
      turns,
      score: record.score,
      layers: record.layers,
      accuracy: accuracy.value,
      indicators: [accuracy, rotationIndicator(turns), solid, speedIndicator(turns)],
      sample: false,
    },
    problem: null,
  };
}

export { placementIndicators };
