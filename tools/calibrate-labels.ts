/**
 * How often each verdict comes up, on the sample rounds the review shows
 * (a scripted player who mostly plays well), and what the 탁월 threshold would
 * have to be for 탁월 to stay near one move in twenty. Run after changing the
 * engine's weights, since the verdicts are measured in its score units.
 *
 *   npx esbuild tools/calibrate-labels.ts --bundle --platform=node --format=esm --outfile=tools/out/calibrate.mjs && node tools/out/calibrate.mjs
 */
import { sampleReview } from "../src/review/sample";

const SEEDS = 20;
const judged: { loss: number; spread: number; nearBest: number; cleared: number }[] = [];
const counts: Record<string, number> = {};
let turns = 0;
for (let s = 1; s <= SEEDS; s++)
  for (const t of (await sampleReview(undefined, s, 40)).turns) {
    judged.push(t.judged);
    counts[t.label] = (counts[t.label] ?? 0) + 1;
    turns++;
  }

const pct = (n: number): string => `${n} (${((100 * n) / turns).toFixed(1)}%)`;
console.log(`verdicts over ${turns} moves:`, Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, pct(v)])));

const spreads = judged.map((j) => j.spread).sort((a, b) => a - b);
const q = (f: number): number => Math.round(spreads[Math.floor(f * (spreads.length - 1))]);
console.log(`spread quartiles: ${q(0.25)} / ${q(0.5)} / ${q(0.75)}, 90th ${q(0.9)}`);

for (const min of [12, 40, 60, 75, 80, 100]) {
  const b = judged.filter((j) => j.loss <= 1 && ((j.nearBest <= 1 && j.spread >= min) || j.cleared >= 2)).length;
  console.log(`MIN_SPREAD_FOR_BRILLIANT ${min}: 탁월 ${pct(b)}`);
}
