/**
 * Learn the evaluation weights by self-play, with the noisy cross-entropy
 * method (Szita & Lőrincz, 2006 — the method that made it known on Tetris).
 *
 *   1. Draw a population of weight vectors from a Gaussian.
 *   2. Let the engine play the same piece sequences with each one.
 *   3. Refit the Gaussian to the best few, with a little extra noise so the
 *      search does not collapse early, and repeat.
 *
 * Fitness is layers cleared before topping out, under the VR rules (18 deep,
 * five-cell pieces once the score passes 1000), capped at CAP pieces — the
 * hardest setting the game has. Every candidate in a generation plays the same
 * seeds, so they are compared on equal luck; the seeds change each generation,
 * so the weights cannot fit one set of sequences. At the end the learned
 * weights and the hand-set ones play SEEDS_TEST sequences neither has seen.
 *
 * Weights are rescaled so the clear weight stays at its hand-set 30: ranking
 * does not depend on scale, and keeping the scale keeps the review's verdict
 * thresholds meaning what they meant.
 *
 *   npm run train            (writes tools/results/train-<time>.json)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { rankPlacements, WEIGHTS } from "../src/engine/placements";
import { PieceFeed } from "../src/game/bag";
import { Grid } from "../src/game/grid";
import { seeded } from "../src/game/random";
import { VR_RULES, type Rules } from "../src/game/rules";

const POP = 20;
const ELITE = 5;
const GENERATIONS = 30;
const SEEDS_PER_GEN = 10;
const SEEDS_TEST = 30;
const CAP = 600;
/** Extra variance added on each refit (decays), the "noisy" in noisy CEM. */
const NOISE = 4;

const KEYS = ["cleared", "top", "holes", "bumpiness"] as const;
type W = Record<(typeof KEYS)[number], number>;
const HAND: W = { cleared: 30, top: -4, holes: -12, bumpiness: -1 };

function play(rules: Rules, seed: number, w: W): { layers: number; pieces: number } {
  Object.assign(WEIGHTS, w);
  let score = 0, layers = 0, level = 1;
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
    // Topped out: the next spawn would not fit. rankPlacements returning
    // nothing on the next turn ends the loop.
  }
  return { layers, pieces: i };
}

const fitness = (w: W, seeds: number[]): number =>
  seeds.reduce((s, seed) => s + play(VR_RULES, seed, w).layers, 0) / seeds.length;

const normalise = (w: W): W => {
  const k = 30 / Math.max(1e-6, w.cleared);
  return Object.fromEntries(KEYS.map((key) => [key, +(w[key] * k).toFixed(3)])) as W;
};

const rand = seeded(20261117);
const gauss = (): number => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

let mean: W = { ...HAND };
let std: W = { cleared: 10, top: 4, holes: 8, bumpiness: 2 };
const log: unknown[] = [];
const started = Date.now();
mkdirSync("tools/results", { recursive: true });
const out = `tools/results/train-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

for (let gen = 0; gen < GENERATIONS; gen++) {
  const seeds = Array.from({ length: SEEDS_PER_GEN }, (_, i) => 1_000_000 + gen * 1000 + i);
  const pop = Array.from({ length: POP }, () => {
    const w = Object.fromEntries(KEYS.map((k) => [k, mean[k] + std[k] * gauss()])) as W;
    // A clear has to be worth something, or the scale goes meaningless.
    w.cleared = Math.max(1, w.cleared);
    return w;
  });
  // The current mean and the hand-set weights play too, as reference lines.
  const scored = pop.map((w) => ({ w, f: fitness(w, seeds) }));
  const meanF = fitness(mean, seeds);
  const handF = fitness(HAND, seeds);
  scored.sort((a, b) => b.f - a.f);
  const elite = scored.slice(0, ELITE);

  const noise = NOISE * Math.max(0, 1 - gen / (GENERATIONS * 0.8));
  mean = Object.fromEntries(KEYS.map((k) => [k, elite.reduce((s, e) => s + e.w[k], 0) / ELITE])) as W;
  std = Object.fromEntries(
    KEYS.map((k) => {
      const v = elite.reduce((s, e) => s + (e.w[k] - mean[k]) ** 2, 0) / ELITE;
      return [k, Math.sqrt(v + noise)];
    })
  ) as W;

  const row = {
    gen,
    best: +scored[0].f.toFixed(2),
    eliteMean: +(elite.reduce((s, e) => s + e.f, 0) / ELITE).toFixed(2),
    popMean: +(scored.reduce((s, e) => s + e.f, 0) / POP).toFixed(2),
    meanWeights: normalise(mean),
    meanFitness: +meanF.toFixed(2),
    handFitness: +handF.toFixed(2),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  log.push(row);
  console.log(
    `gen ${gen}: best ${row.best} / elite ${row.eliteMean} / mean-w ${row.meanFitness} / hand ${row.handFitness} | ` +
      KEYS.map((k) => `${k} ${row.meanWeights[k]}`).join(", ") + ` | ${row.seconds}s`
  );
  writeFileSync(out, JSON.stringify({ config: { POP, ELITE, GENERATIONS, SEEDS_PER_GEN, CAP, NOISE }, log }, null, 2));
}

// Held-out comparison on sequences neither set of weights has played.
const test = Array.from({ length: SEEDS_TEST }, (_, i) => 9_000_000 + i);
const learned = normalise(mean);
const summarise = (w: W) => {
  const rs = test.map((s) => play(VR_RULES, s, w));
  return {
    layers: +(rs.reduce((s, r) => s + r.layers, 0) / rs.length).toFixed(2),
    survivedAll: rs.filter((r) => r.pieces === CAP).length,
    pieces: +(rs.reduce((s, r) => s + r.pieces, 0) / rs.length).toFixed(1),
  };
};
const result = { hand: { weights: HAND, ...summarise(HAND) }, learned: { weights: learned, ...summarise(learned) } };
console.log("TEST", JSON.stringify(result));
writeFileSync(out, JSON.stringify({ config: { POP, ELITE, GENERATIONS, SEEDS_PER_GEN, CAP, NOISE }, log, test: result }, null, 2));
Object.assign(WEIGHTS, HAND);
