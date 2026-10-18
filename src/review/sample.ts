import { rankPlacements, countHoles, type Scored } from "../engine/placements";
import { PieceFeed } from "../game/bag";
import { Grid } from "../game/grid";
import type { PieceDef } from "../game/pieces";
import { seeded } from "../game/random";
import { VR_RULES } from "../game/rules";
import { classify, moveAccuracy, type Label, type Judged } from "./labels";

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
}

export interface Review {
  turns: Turn[];
  score: number;
  layers: number;
  accuracy: number;
  /** Values the engine cannot compute yet are flagged `sample`. */
  indicators: { name: string; value: number; note: string; sample: boolean }[];
}

/** "As good as the best" means within this fraction of the position's spread. */
const NEAR_BEST = 0.2;

/** Non-planar tetracubes — the ones that cannot lie flat in any orientation. */
const SOLID = new Set(["B", "D", "F"]);

/**
 * A made-up round, for laying out the review before there is a real record.
 *
 * The board, the options and the verdicts are genuine — every move is ranked by
 * the engine against every alternative — but the moves themselves are chosen
 * by a scripted player who mostly plays well and sometimes does not, so every
 * verdict shows up. Seeded, so the sample is the same every time.
 */
export function sampleReview(seed = 81, pieces = 40): Review {
  const rand = seeded(seed);
  const rules = VR_RULES;
  let score = 0;
  let layers = 0;
  let level = 1;
  const feed = new PieceFeed(rules.tiers, () => score, rand);
  let grid = new Grid(rules.well);
  const turns: Turn[] = [];

  for (let i = 0; i < pieces; i++) {
    const piece = feed.at(i);
    const ranked = rankPlacements(grid, piece.cells);
    if (ranked.length === 0) break; // topped out

    const pick = (): number => {
      const r = rand();
      const n = ranked.length;
      if (r < 0.42) return 0;
      if (r < 0.66) return 1 + Math.floor(rand() * 3);
      if (r < 0.86) return Math.floor(rand() * n * 0.3);
      if (r < 0.95) return Math.floor(n * 0.4 + rand() * n * 0.2);
      return Math.floor(n * 0.75 + rand() * n * 0.25);
    };
    const idx = Math.min(ranked.length - 1, pick());
    const played = ranked[idx];
    const best = ranked[0];
    const median = ranked[Math.floor(ranked.length / 2)].score;
    const spread = best.score - median;

    const judged: Judged = {
      loss: best.score - played.score,
      spread,
      nearBest: ranked.filter((p) => p.score >= best.score - Math.max(1, NEAR_BEST * spread)).length,
      cleared: played.features.cleared,
      holesCreated: Math.max(0, played.features.holes - countHoles(grid)),
      top: played.features.top,
      wellH: rules.well.h,
    };

    // Locked in the piece's own colour, so the replayed stack looks like the
    // one the player built. (featuresAfter only needs filled-or-not.)
    const placed = grid.clone();
    placed.lock(played.cells, played.pos, piece.color);
    const fullLayers: number[] = [];
    for (let y = 0; y < placed.h; y++)
      if (placed.layerFill(y) === placed.layerCells) fullLayers.push(y);
    const after = placed.clone();
    after.clearFullLayers();

    turns.push({
      n: i + 1,
      piece,
      before: grid,
      after,
      fullLayers,
      played,
      best,
      rank: idx + 1,
      options: ranked.length,
      judged,
      label: classify(judged),
      accuracy: moveAccuracy(judged),
    });

    const n = played.features.cleared;
    if (n > 0) {
      score += (rules.layerScore[Math.min(n, rules.layerScore.length - 1)] ?? 0) * level;
      layers += n;
      level = 1 + Math.floor(layers / rules.layersPerLevel);
    }
    grid = after;
  }

  const mean = (xs: number[]): number =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  const accuracy = mean(turns.map((t) => t.accuracy));
  const solid = mean(turns.filter((t) => SOLID.has(t.piece.name)).map((t) => t.accuracy));
  const flat = mean(turns.filter((t) => !SOLID.has(t.piece.name)).map((t) => t.accuracy));

  return {
    turns,
    score,
    layers,
    accuracy,
    indicators: [
      { name: "배치 정확도", value: accuracy, note: "놓을 수 있는 자리 중 얼마나 좋은 곳을 골랐는지", sample: false },
      { name: "회전 효율", value: 82, note: "필요한 최소 회전에 얼마나 가깝게 돌렸는지", sample: true },
      {
        name: "입체 조각 처리",
        value: solid || flat,
        note: `평면 조각 ${flat}% 대비, 가지·나사 조각을 얼마나 잘 놓았는지`,
        sample: false,
      },
      { name: "판단 속도", value: 64, note: "조각이 나타나서 놓기까지 걸린 시간", sample: true },
    ],
  };
}
