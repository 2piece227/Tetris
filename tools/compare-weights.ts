/**
 * The hand-set weights against the learned ones, game by game, on the 30
 * held-out sequences of tools/train-weights.ts. Neither set of weights was
 * trained on these. Same rules and same 600-piece cap as the training.
 *
 *   npx esbuild tools/compare-weights.ts --bundle --platform=node --format=esm --outfile=tools/out/compare.mjs
 *   node tools/out/compare.mjs      (writes tools/results/compare-hand-learned.json)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { countHoles, HAND_WEIGHTS, rankPlacements, WEIGHTS } from "../src/engine/placements";
import { PieceFeed } from "../src/game/bag";
import { Grid } from "../src/game/grid";
import { VR_RULES } from "../src/game/rules";

const CAP = 600;
const SEEDS = Array.from({ length: 30 }, (_, i) => 9_000_000 + i);
const LEARNED = { ...WEIGHTS };

function play(seed: number, w: typeof WEIGHTS) {
  Object.assign(WEIGHTS, w);
  const rules = VR_RULES;
  let score = 0, layers = 0, level = 1, holeSum = 0, peak = 0;
  const feed = new PieceFeed(rules.tiers, () => score);
  feed.reset(seed);
  let g = new Grid(rules.well);
  let i = 0;
  for (; i < CAP; i++) {
    const ranked = rankPlacements(g, feed.at(i).cells);
    feed.at(i + 1);
    if (!ranked.length) break;
    const b = ranked[0];
    const a = g.clone();
    a.lock(b.cells, b.pos, 1);
    const n = a.clearFullLayers();
    layers += n;
    score += (rules.layerScore[Math.min(n, rules.layerScore.length - 1)] ?? 0) * level;
    level = 1 + Math.floor(layers / rules.layersPerLevel);
    g = a;
    holeSum += countHoles(g);
    peak = Math.max(peak, b.features.top);
  }
  return { seed, layers, pieces: i, survived: i === CAP, meanHoles: +(holeSum / Math.max(1, i)).toFixed(3), peak };
}

const hand = SEEDS.map((s) => play(s, HAND_WEIGHTS));
const learned = SEEDS.map((s) => play(s, LEARNED));
Object.assign(WEIGHTS, LEARNED);

const avg = (xs: number[]): number => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
const sum = (r: typeof hand) => ({
  layers: avg(r.map((g) => g.layers)),
  pieces: avg(r.map((g) => g.pieces)),
  survived: r.filter((g) => g.survived).length,
  meanHoles: avg(r.map((g) => g.meanHoles)),
  peak: avg(r.map((g) => g.peak)),
});
const result = { cap: CAP, hand: { weights: HAND_WEIGHTS, ...sum(hand), games: hand }, learned: { weights: LEARNED, ...sum(learned), games: learned } };
mkdirSync("tools/results", { recursive: true });
writeFileSync("tools/results/compare-hand-learned.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ hand: { ...result.hand, games: undefined }, learned: { ...result.learned, games: undefined } }));
console.log("learned better/tied/worse by layers:",
  learned.filter((g, i) => g.layers > hand[i].layers).length,
  learned.filter((g, i) => g.layers === hand[i].layers).length,
  learned.filter((g, i) => g.layers < hand[i].layers).length);
