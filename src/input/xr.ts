import {
  WebXRDefaultExperience,
  WebXRState,
  type WebXRControllerComponent,
  type WebXRInputSource,
} from "@babylonjs/core";
import { HARD_DROP_COOLDOWN_MS } from "../config";
import type { Sfx } from "../audio/sfx";
import type { Game } from "../game/game";
import { RotateIntent, resolveRotation } from "../game/viewRotation";
import type { Renderer } from "../render/renderer";

// Turns an analog stick value into discrete steps with auto-repeat, so holding
// the stick keeps moving/rotating the piece at a steady rate (DAS-style).
class Stepper {
  private cooldown = 0;
  private readonly FIRST = 220; // ms before first repeat
  private readonly REPEAT = 130; // ms between repeats
  constructor(private readonly onStep: (dir: 1 | -1) => void) {}

  update(value: number, dtMs: number): void {
    if (Math.abs(value) < 0.35) {
      this.cooldown = 0; // released → next push fires immediately
      return;
    }
    this.cooldown -= dtMs;
    if (this.cooldown <= 0) {
      this.onStep(value > 0 ? 1 : -1);
      this.cooldown = this.cooldown < -this.FIRST ? this.REPEAT : this.FIRST;
    }
  }
}

/**
 * Run `action` once per physical press.
 *
 * Babylon notifies onButtonStateChangedObservable whenever value, touched OR
 * pressed changes, and an analog trigger streams value updates for the whole
 * length of a squeeze. A handler that merely tests `c.pressed` therefore fires
 * a dozen-plus times per pull — enough to hard drop a whole stack of pieces on
 * one trigger. Only the false -> true transition counts as a press.
 */
function onPress(component: WebXRControllerComponent | null, action: () => void): void {
  component?.onButtonStateChangedObservable.add((c) => {
    if (c.changes.pressed?.current === true) action();
  });
}

/**
 * One action per stick deflection, with no auto-repeat: the stick has to come
 * back near neutral before it will fire again.
 *
 * Rotation wants this and movement does not. Holding the stick to slide a piece
 * across the well is useful; holding it and having the piece spin four times is
 * just disorienting, which is what testers kept running into.
 *
 * FIRE and REARM differ on purpose. With a single threshold a stick left
 * resting near the edge chatters across it and fires repeatedly — the same
 * defect the hard-drop trigger had.
 */
export class Flick {
  private armed = true;
  private static readonly FIRE = 0.6;
  private static readonly REARM = 0.3;

  constructor(private readonly onFlick: (dir: 1 | -1) => void) {}

  update(value: number): void {
    const mag = Math.abs(value);
    if (mag < Flick.REARM) {
      this.armed = true;
      return;
    }
    if (this.armed && mag >= Flick.FIRE) {
      this.armed = false;
      this.onFlick(value > 0 ? 1 : -1);
    }
  }
}

const THUMBSTICK = "xr-standard-thumbstick";
const TRIGGER = "xr-standard-trigger";
const SQUEEZE = "xr-standard-squeeze";

export async function setupXR(
  game: Game,
  renderer: Renderer,
  sfx: Sfx,
  onRestart: () => void
): Promise<WebXRDefaultExperience | null> {
  let xr: WebXRDefaultExperience;
  try {
    xr = await renderer.scene.createDefaultXRExperienceAsync({
      // This game is thumbstick and buttons only. Every extra default feature
      // is geometry Babylon draws into the room that the player then has to
      // work out the meaning of — near-interaction spheres on the controllers,
      // hand meshes, teleport targets on the floor. Pointer selection stays
      // because the game-over restart button is picked with the controller ray.
      disableTeleportation: true,
      disableNearInteraction: true,
      disableHandTracking: true,
    });
  } catch {
    return null; // e.g. desktop browser without WebXR — keyboard still works
  }
  if (!xr.baseExperience) return null;

  // Drop the tank an arm's length in front of wherever the player is actually
  // standing. Also bound to the left X button, because at a festival the next
  // person in line will be standing somewhere else entirely.
  const recenter = (): void => {
    const cam = xr.baseExperience.camera;
    renderer.placeForXR(cam.position.clone(), cam.getForwardRay().direction.clone());
  };

  xr.baseExperience.onStateChangedObservable.add((state) => {
    if (state === WebXRState.IN_XR) {
      sfx.unlock(); // entering VR is the user gesture WebAudio needs
      // The head pose is not usable on the session's first frame.
      renderer.scene.onAfterRenderObservable.addOnce(() => recenter());
    } else if (state === WebXRState.NOT_IN_XR) {
      renderer.placeForDesktop();
    }
  });

  // Left stick slides the piece and keeps auto-repeat, so you can hold it to
  // cross the well. The right stick rotates and fires once per deflection.
  const moveX = new Stepper((d) => game.tryMove(d, 0));
  const moveZ = new Stepper((d) => game.tryMove(0, d));
  // Asked for in the player's own frame — tip it away, spin it, keel it over —
  // and resolved against where they are standing. Turning on the spot no longer
  // silently changes what a control does.
  const turn = (intent: RotateIntent, d: 1 | -1): void => {
    const r = resolveRotation(intent, d, renderer.viewRelativeYaw());
    game.tryRotate(r.axis, r.dir);
  };
  const yaw = new Flick((d) => turn("spin", d));
  const pitch = new Flick((d) => turn("tip", d));

  const leftStick = { x: 0, y: 0 };
  const rightStick = { x: 0, y: 0 };

  xr.input.onControllerAddedObservable.add((controller: WebXRInputSource) => {
    controller.onMotionControllerInitObservable.add((mc) => {
      const hand = mc.handedness;
      const stick = mc.getComponent(THUMBSTICK);
      const trigger = mc.getComponent(TRIGGER);
      const squeeze = mc.getComponent(SQUEEZE);

      stick?.onAxisValueChangedObservable.add((axes) => {
        const target = hand === "left" ? leftStick : rightStick;
        target.x = axes.x;
        target.y = axes.y;
      });

      if (hand === "right") {
        // trigger → hard drop, once per pull and no faster than the cooldown
        let lastDrop = -Infinity;
        onPress(trigger, () => {
          const now = performance.now();
          if (now - lastDrop < HARD_DROP_COOLDOWN_MS) return;
          lastDrop = now;
          game.hardDrop();
        });
        // A / B → rotate around Z
        onPress(mc.getComponent("a-button"), () => turn("roll", 1));
        onPress(mc.getComponent("b-button"), () => turn("roll", -1));
      } else {
        // left squeeze / trigger → soft drop while either is held. Tracked
        // separately because a single shared flag lets releasing one component
        // cancel a hold still active on the other.
        const held = { squeeze: false, trigger: false };
        const apply = (): void => {
          game.softDropping = held.squeeze || held.trigger;
        };
        squeeze?.onButtonStateChangedObservable.add((c) => {
          held.squeeze = c.pressed;
          apply();
        });
        trigger?.onButtonStateChangedObservable.add((c) => {
          held.trigger = c.pressed;
          apply();
        });
        // left X → re-plant the tank in front of me
        onPress(mc.getComponent("x-button"), recenter);
        // left Y → start again, but only from the game-over panel.
        //
        // Y sits directly above X on the same controller, and X is the button
        // players are told to press when the tank ends up somewhere awkward.
        // Left live, a thumb landing one button high would wipe a round that
        // was still being played. Gated, it does exactly what the on-screen
        // button does — which is the only place a restart is offered anyway.
        onPress(mc.getComponent("y-button"), () => {
          if (game.gameOver) onRestart();
        });
      }
    });
  });

  // Poll stick values every frame for smooth auto-repeat.
  renderer.scene.onBeforeRenderObservable.add(() => {
    const dt = renderer.engine.getDeltaTime();
    moveX.update(leftStick.x, dt);
    moveZ.update(-leftStick.y, dt); // stick up is −y; away from the player is +z

    // Only the dominant axis rotates. Pushed diagonally both axes clear the
    // fire threshold, and yawing and pitching off one flick reads as the game
    // spinning the piece at random.
    const rx = rightStick.x;
    const ry = -rightStick.y;
    yaw.update(Math.abs(rx) >= Math.abs(ry) ? rx : 0);
    pitch.update(Math.abs(ry) > Math.abs(rx) ? ry : 0);
  });

  return xr;
}
