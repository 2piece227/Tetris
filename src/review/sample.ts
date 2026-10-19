import { rankPlacements } from "../engine/placements";
import { PieceFeed } from "../game/bag";
import { Grid } from "../game/grid";
import { seeded } from "../game/random";
import { VR_RULES } from "../game/rules";
import { judgeTurn, placementIndicators, type Review, type Turn } from "./analysis";

/**
 * A made-up round, for showing the review without a real record.
 *
 * The board, the options and the verdicts are genuine — every move is ranked by
 * the engine against every alternative — but the moves themselves are chosen
 * by a scripted player who mostly plays well and sometimes does not, so every
 * verdict shows up. Seeded, so the sample is the same every time. There are no
 * inputs behind it, so the turning and speed indicators are placeholders.
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
    const played = ranked[Math.min(ranked.length - 1, pick())];
    const turn = judgeTurn(i + 1, rules, grid, piece, played, ranked);
    turns.push(turn);

    const n = turn.played.features.cleared;
    if (n > 0) {
      score += (rules.layerScore[Math.min(n, rules.layerScore.length - 1)] ?? 0) * level;
      layers += n;
      level = 1 + Math.floor(layers / rules.layersPerLevel);
    }
    grid = turn.after;
  }

  const [accuracy, solid] = placementIndicators(turns);
  return {
    turns,
    score,
    layers,
    accuracy: accuracy.value,
    indicators: [
      accuracy,
      { name: "회전 효율", value: 82, display: "82%", note: "필요한 최소 회전에 얼마나 가깝게 돌렸는지", sample: true },
      solid,
      { name: "판단 속도", value: 64, display: "6.2초", note: "조각이 나타나서 놓기까지 걸린 평균 시간", sample: true },
    ],
    sample: true,
  };
}
