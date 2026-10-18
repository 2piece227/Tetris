import type { Sfx } from "../audio/sfx";
import type { Game } from "../game/game";

/**
 * The human side of versus.
 *
 * Laid out for a panel with a four-way stick plus seven buttons — both
 * directions on each of the three axes, and hard drop — so a player can always
 * turn the short way. A USB arcade encoder presents itself as a keyboard, so
 * these are the codes to map such a panel to.
 *
 * Bindings are keyed off `event.code`, not `event.key`: a physical button
 * should not change meaning if the machine boots with a different keyboard
 * layout, and `code` is layout-independent.
 */
interface Binding {
  moveLeft: string;
  moveRight: string;
  moveAway: string;
  moveToward: string;
  rotX: string;
  rotY: string;
  rotZ: string;
  /** Same axis, opposite way round. */
  rotXBack: string;
  rotYBack: string;
  rotZBack: string;
  hardDrop: string;
}

export const KEYS: Binding = {
  moveLeft: "KeyA",
  moveRight: "KeyD",
  moveAway: "KeyW",
  moveToward: "KeyS",
  rotX: "KeyQ",
  rotY: "KeyE",
  rotZ: "KeyR",
  rotXBack: "KeyZ",
  rotYBack: "KeyC",
  rotZBack: "KeyV",
  hardDrop: "Space",
};

/**
 * `enabled` gates play so the start card and the result card can swallow input
 * without the bindings having to know anything about game phase.
 */
export function attachKeyboard(game: Game, sfx: Sfx, enabled: () => boolean): void {
  window.addEventListener("keydown", (e) => {
    if (e.repeat) {
      // Held keys must not machine-gun. Auto-repeat on hard drop buries the
      // well in one press; on rotation it spins the piece past where you
      // wanted it. Movement is the one place a repeat would be useful, and it
      // is dropped too so that every binding behaves the same way.
      e.preventDefault();
      return;
    }
    sfx.unlock();
    if (!enabled()) return;
    let used = true;
    switch (e.code) {
      case KEYS.moveLeft: game.tryMove(-1, 0); break;
      case KEYS.moveRight: game.tryMove(1, 0); break;
      case KEYS.moveAway: game.tryMove(0, 1); break;
      case KEYS.moveToward: game.tryMove(0, -1); break;
      case KEYS.rotX: game.tryRotate("x", 1); break;
      case KEYS.rotY: game.tryRotate("y", 1); break;
      case KEYS.rotZ: game.tryRotate("z", 1); break;
      case KEYS.rotXBack: game.tryRotate("x", -1); break;
      case KEYS.rotYBack: game.tryRotate("y", -1); break;
      case KEYS.rotZBack: game.tryRotate("z", -1); break;
      case KEYS.hardDrop: game.hardDrop(); break;
      default: used = false;
    }
    if (used) e.preventDefault();
  });
}
