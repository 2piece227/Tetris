import type { Sfx } from "../audio/sfx";
import type { Game } from "../game/game";

/**
 * The human sides of versus: one player against the machine, or two sharing
 * this keyboard, one at each end of it.
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

/** One player against the machine: the whole keyboard is theirs. */
export const KEYS_SOLO: Binding = {
  moveLeft: "KeyA",
  moveRight: "KeyD",
  moveAway: "KeyW",
  moveToward: "KeyS",
  rotX: "KeyJ",
  rotY: "KeyK",
  rotZ: "KeyL",
  rotXBack: "KeyI",
  rotYBack: "KeyO",
  rotZBack: "KeyP",
  hardDrop: "Space",
};

/**
 * Left player of a two-player round. Rotation stays on the left half of the
 * keyboard (QER / ZCV) so it never shares a key with the right player's
 * UIO / JKL.
 */
export const KEYS_1P: Binding = {
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

export const KEYS_2P: Binding = {
  moveLeft: "ArrowLeft",
  moveRight: "ArrowRight",
  moveAway: "ArrowUp",
  moveToward: "ArrowDown",
  rotX: "KeyU",
  rotY: "KeyI",
  rotZ: "KeyO",
  rotXBack: "KeyJ",
  rotYBack: "KeyK",
  rotZBack: "KeyL",
  hardDrop: "Enter",
};

/**
 * `enabled` gates play so the start card and the result card can swallow input
 * without the bindings having to know anything about game phase.
 */
export function attachKeyboard(game: Game, keys: Binding, sfx: Sfx, enabled: () => boolean): void {
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
      case keys.moveLeft: game.tryMove(-1, 0); break;
      case keys.moveRight: game.tryMove(1, 0); break;
      case keys.moveAway: game.tryMove(0, 1); break;
      case keys.moveToward: game.tryMove(0, -1); break;
      case keys.rotX: game.tryRotate("x", 1); break;
      case keys.rotY: game.tryRotate("y", 1); break;
      case keys.rotZ: game.tryRotate("z", 1); break;
      case keys.rotXBack: game.tryRotate("x", -1); break;
      case keys.rotYBack: game.tryRotate("y", -1); break;
      case keys.rotZBack: game.tryRotate("z", -1); break;
      case keys.hardDrop: game.hardDrop(); break;
      default: used = false;
    }
    if (used) e.preventDefault();
  });
}
