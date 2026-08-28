import type { Sfx } from "../audio/sfx";
import type { Game } from "../game/game";
import { RotateIntent, resolveRotation } from "../game/viewRotation";

// Desktop controls — also the fastest way to test without a headset.
// Keyed off `event.key` (always populated) rather than `event.code`, so it
// works across layouts and with synthetic events.
export function attachKeyboard(
  game: Game,
  sfx: Sfx,
  relativeYaw: () => number,
  onRestart: () => void
): void {
  // Rotations are asked for in the player's own frame and resolved against
  // where they are looking from, so the same key always produces the same
  // visible motion however the view has been moved.
  const turn = (intent: RotateIntent, dir: 1 | -1): void => {
    const r = resolveRotation(intent, dir, relativeYaw());
    game.tryRotate(r.axis, r.dir);
  };

  window.addEventListener("keydown", (e) => {
    sfx.unlock(); // first keypress is the user gesture WebAudio waits for
    const k = e.key.toLowerCase();
    let used = true;
    switch (k) {
      case "arrowleft": game.tryMove(-1, 0); break;
      case "arrowright": game.tryMove(1, 0); break;
      case "arrowup": game.tryMove(0, -1); break;
      case "arrowdown": game.tryMove(0, 1); break;
      case "q": turn("tip", 1); break;
      case "w": turn("tip", -1); break;
      case "a": turn("spin", 1); break;
      case "s": turn("spin", -1); break;
      case "z": turn("roll", 1); break;
      case "x": turn("roll", -1); break;
      case " ": if (!e.repeat) game.hardDrop(); break;
      // Mirrors the headset's Y button, and gated the same way.
      case "y": if (game.gameOver) onRestart(); break;
      case "shift": game.softDropping = true; break;
      default: used = false;
    }
    if (used) e.preventDefault();
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") game.softDropping = false;
  });
}
