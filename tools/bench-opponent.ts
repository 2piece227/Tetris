/**
 * How the versus opponent's levels play on their own (no attacks): layers
 * cleared and pieces survived over 10 games, capped at 150 pieces. Run after
 * changing the engine, so the levels still mean easy, normal and hard.
 *
 *   npx esbuild tools/bench-opponent.ts --bundle --platform=node --format=esm --outfile=tools/out/bench-opponent.mjs && node tools/out/bench-opponent.mjs
 */
import { AutoPlayer } from "../src/game/autoPlay";
import { Game } from "../src/game/game";
import { VERSUS_RULES } from "../src/game/rules";

// The player paces itself off performance.now(); a fake clock lets it run flat out.
let clock = 0;
(globalThis as unknown as { performance: { now: () => number } }).performance = { now: () => (clock += 1000) };

for (const [name, mistakes] of [["어려움", 0], ["보통", 0.18], ["쉬움", 0.45]] as const) {
  let layers = 0, pieces = 0;
  for (let k = 0; k < 10; k++) {
    const g = new Game(VERSUS_RULES, undefined, 1000 + k);
    const ai = new AutoPlayer({ beatMs: 0, settleMs: 0, mistakes });
    let n = 0;
    g.onLock = () => n++;
    for (let steps = 0; !g.gameOver && n < 150 && steps < 50000; steps++) ai.update(g);
    layers += g.layers;
    pieces += n;
  }
  console.log(`${name}: ${(layers / 10).toFixed(1)}층 / ${(pieces / 10).toFixed(0)}조각`);
}
