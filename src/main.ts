import { Sfx } from "./audio/sfx";
import { AutoPlayer } from "./game/autoPlay";
import { Game } from "./game/game";
import { attachKeyboard } from "./input/keyboard";
import { setupXR } from "./input/xr";
import { Renderer } from "./render/renderer";
import { VrUi } from "./render/vrui";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

const renderer = new Renderer(canvas);
const game = new Game();
const sfx = new Sfx();

const auto = new AutoPlayer();

/**
 * How long the machine waits before playing itself.
 *
 * The headset mirrors to a screen for whoever is queuing, and between players
 * that screen was showing a finished board and nothing else. Long enough that
 * it never starts up on someone who is just thinking about their next move.
 */
const IDLE_BEFORE_DEMO_MS = 20_000;
let lastInputAt = performance.now();
let demo = false;

const setDemo = (on: boolean): void => {
  if (demo === on) return;
  demo = on;
  renderer.setDemoLook(on);
  ui.showAttract(on);
  auto.reset();
  game.reset();
  ui.hideGameOver();
  renderer.redraw(game);
  ui.update(game);
};

/** Any input at all counts as somebody being there. */
const noteInput = (): void => {
  lastInputAt = performance.now();
  // Walking in on a demo starts a real round rather than inheriting its board.
  if (demo) setDemo(false);
};

const restart = (): void => {
  noteInput();
  game.reset();
  ui.hideGameOver();
  renderer.redraw(game);
  ui.update(game);
};

// The UI lives in the scene, not the DOM: an immersive WebXR session presents
// the framebuffer and the HTML page disappears, so a DOM HUD is invisible in
// the headset. Panels parented to wellRoot travel with the tank on recenter.
const ui = new VrUi(renderer.scene, renderer.wellRoot, restart);

game.onChange = () => {
  renderer.redraw(game);
  ui.update(game);
};
game.onMove = () => sfx.move();
game.onRotate = (axis, dir) => {
  sfx.rotate();
  renderer.beginRotation(axis, dir);
};
game.onLock = () => sfx.lock();
game.onClear = (n) => sfx.clear(n);
game.onGameOver = () => {
  sfx.gameOver();
  // The demo restarts itself instead of sitting on a game-over panel.
  if (demo) {
    auto.reset();
    game.reset();
    renderer.redraw(game);
    ui.update(game);
    return;
  }
  ui.showGameOver(game);
};

attachKeyboard(game, sfx, () => renderer.viewRelativeYaw(), restart, noteInput);
void setupXR(game, renderer, sfx, restart, noteInput);

// Gravity and the round clock, both driven by Babylon's render clock.
renderer.scene.onBeforeRenderObservable.add(() => {
  game.tick(renderer.engine.getDeltaTime());

  // Under a minute the room reddens and the music doubles up. Driven every
  // frame off the current state rather than fired once at the threshold, so it
  // is right after a restart and after a clear buys time back over the line —
  // the room calms down again if you earn your way out of trouble.
  renderer.setUrgency(game.timeCritical, game.timePressure);
  sfx.setBgmRate(game.timeCritical ? 2 : 1);

  if (demo) auto.update(game);
  else if (performance.now() - lastInputAt > IDLE_BEFORE_DEMO_MS) setDemo(true);
});

// First paint.
renderer.redraw(game);
ui.update(game);
