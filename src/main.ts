import { Sfx } from "./audio/sfx";
import { Game } from "./game/game";
import { attachKeyboard } from "./input/keyboard";
import { setupXR } from "./input/xr";
import { Renderer } from "./render/renderer";
import { VrUi } from "./render/vrui";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

const renderer = new Renderer(canvas);
const game = new Game();
const sfx = new Sfx();

const restart = (): void => {
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
  ui.showGameOver(game);
};

attachKeyboard(game, sfx, () => renderer.viewRelativeYaw());
void setupXR(game, renderer, sfx);

// Gravity and the round clock, both driven by Babylon's render clock.
renderer.scene.onBeforeRenderObservable.add(() => {
  game.tick(renderer.engine.getDeltaTime());

  // Under a minute the room reddens and the music doubles up. Driven every
  // frame off the current state rather than fired once at the threshold, so it
  // is right after a restart and after a clear buys time back over the line —
  // the room calms down again if you earn your way out of trouble.
  renderer.setUrgency(game.timeCritical, game.timePressure);
  sfx.setBgmRate(game.timeCritical ? 2 : 1);
});

// First paint.
renderer.redraw(game);
ui.update(game);
