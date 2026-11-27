/**
 * Does each evaluation feature earn its place?
 *
 * Re-runs the weight training of tools/train-weights.ts with one feature taken
 * out (its weight held at 0), then plays the 30 held-out sequences. "full"
 * keeps all four and is the control: same code path, same random stream.
 *
 * Every condition starts from the same random seed and draws the same numbers,
 * so the runs differ only in the feature removed. It is still one training run
 * per condition, so read small gaps as noise.
 *
 *   npx esbuild tools/ablate-features.ts --bundle --platform=node --format=esm --outfile=tools/out/ablate.mjs
 *   node tools/out/ablate.mjs <full|no-cleared|no-top|no-holes|no-bumpiness>
 *
 * Writes tools/results/ablate-<condition>.json after every generation.
 * ABLATE_SMOKE=1 runs a tiny version and writes to tools/out instead.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { rankPlacements, WEIGHTS } from "../src/engine/placements";
import { PieceFeed } from "../src/game/bag";
import { Grid } from "../src/game/grid";
import { seeded } from "../src/game/random";
import { VR_RULES, type Rules } from "../src/game/rules";

const KEYS = ["cleared", "top", "holes", "bumpiness"] as const;
type Key = (typeof KEYS)[number];
type W = Record<Key, number>;

const condition = process.argv[2] ?? "";
const removed = KEYS.find((k) => condition === `no-${k}`) ?? null;
if (condition !== "full" && !removed) throw new Error(`unknown condition "${condition}"`);

const SMOKE = process.env.ABLATE_SMOKE === "1";
// The same settings as tools/train-weights.ts, so "full" repeats that run.
const POP = SMOKE ? 4 : 20;
const ELITE = SMOKE ? 2 : 5;
const GENERATIONS = SMOKE ? 2 : 30;
const SEEDS_PER_GEN = SMOKE ? 2 : 10;
const SEEDS_TEST = SMOKE ? 2 : 30;
const CAP = SMOKE ? 40 : 600;
const NOISE = 4;

const HAND: W = { cleared: 30, top: -4, holes: -12, bumpiness: -1 };

/** Hold the removed feature at zero, whatever was drawn for it. */
const strip = (w: W): W => (removed ? { ...w, [removed]: 0 } : w);

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
  }
  return { layers, pieces: i };
}

const fitness = (w: W, seeds: number[]): number =>
  seeds.reduce((s, seed) => s + play(VR_RULES, seed, w).layers, 0) / seeds.length;

/** Scale so a cleared layer is worth 30. Without that feature there is nothing to scale by. */
const normalise = (w: W): W => {
  const k = removed === "cleared" ? 1 : 30 / Math.max(1e-6, w.cleared);
  return Object.fromEntries(KEYS.map((key) => [key, +(w[key] * k).toFixed(3)])) as W;
};

const rand = seeded(20261117);
const gauss = (): number => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

let mean: W = strip({ ...HAND });
let std: W = { cleared: 10, top: 4, holes: 8, bumpiness: 2 };
const log: unknown[] = [];
const started = Date.now();
const dir = SMOKE ? "tools/out" : "tools/results";
mkdirSync(dir, { recursive: true });
const out = `${dir}/ablate-${condition}.json`;
const config = { condition, removed, POP, ELITE, GENERATIONS, SEEDS_PER_GEN, SEEDS_TEST, CAP, NOISE };

for (let gen = 0; gen < GENERATIONS; gen++) {
  const seeds = Array.from({ length: SEEDS_PER_GEN }, (_, i) => 1_000_000 + gen * 1000 + i);
  const pop = Array.from({ length: POP }, () => {
    const w = Object.fromEntries(KEYS.map((k) => [k, mean[k] + std[k] * gauss()])) as W;
    w.cleared = Math.max(1, w.cleared);
    return strip(w);
  });
  const scored = pop.map((w) => ({ w, f: fitness(w, seeds) }));
  const meanF = fitness(mean, seeds);
  scored.sort((a, b) => b.f - a.f);
  const elite = scored.slice(0, ELITE);

  const noise = NOISE * Math.max(0, 1 - gen / (GENERATIONS * 0.8));
  mean = strip(Object.fromEntries(KEYS.map((k) => [k, elite.reduce((s, e) => s + e.w[k], 0) / ELITE])) as W);
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
    meanFitness: +meanF.toFixed(2),
    meanWeights: normalise(mean),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  log.push(row);
  console.log(`${condition} gen ${gen}: best ${row.best} / mean-w ${row.meanFitness} | ${JSON.stringify(row.meanWeights)} | ${row.seconds}s`);
  writeFileSync(out, JSON.stringify({ config, log }, null, 2));
}

// The held-out sequences of tools/train-weights.ts, game by game so that
// conditions can be compared on the same pieces.
const learned = normalise(mean);
const games = Array.from({ length: SEEDS_TEST }, (_, i) => 9_000_000 + i).map((seed) => ({
  seed,
  ...play(VR_RULES, seed, learned),
}));
const test = {
  weights: learned,
  layers: +(games.reduce((s, r) => s + r.layers, 0) / games.length).toFixed(2),
  pieces: +(games.reduce((s, r) => s + r.pieces, 0) / games.length).toFixed(1),
  survivedAll: games.filter((r) => r.pieces === CAP).length,
  games,
};
console.log("TEST", JSON.stringify({ ...test, games: undefined }));
writeFileSync(out, JSON.stringify({ config, log, test }, null, 2));
