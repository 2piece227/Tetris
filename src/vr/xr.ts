import {
  WebXRDefaultExperience,
  WebXRState,
  type WebXRControllerComponent,
  type WebXRInputSource,
} from "@babylonjs/core";
import { HARD_DROP_COOLDOWN_MS } from "./config";
import type { Sfx } from "../audio/sfx";
import type { Game } from "../game/game";
import { RotateIntent, resolveRotation } from "../game/viewRotation";
import type { Renderer } from "./renderer";

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

/**
 * Standard gamepad indices for the face buttons, per the xr-standard mapping.
 * Left: X is 4, Y is 5. Right: A is 4, B is 5.
 */
const FACE_BUTTON_INDEX: Record<string, number> = {
  "x-button": 4,
  "a-button": 4,
  "y-button": 5,
  "b-button": 5,
};

const THUMBSTICK = "xr-standard-thumbstick";
const TRIGGER = "xr-standard-trigger";
const SQUEEZE = "xr-standard-squeeze";

export async function setupXR(
  game: Game,
  renderer: Renderer,
  sfx: Sfx,
  onRestart: () => void,
  onInput: () => void
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
      onInput(); // someone has put the headset on
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
  // Every turn comes from the right hand (stick and A/B), so that is the hand
  // that buzzes when one cannot fit. The red ghost and the thud say what
  // happened; the buzz says it happened to you, without looking anywhere.
  let rightHand: { pulse: (value: number, duration: number) => Promise<boolean> } | null = null;
  const turn = (intent: RotateIntent, d: 1 | -1): void => {
    const r = resolveRotation(intent, d, renderer.viewRelativeYaw());
    if (!game.tryRotate(r.axis, r.dir)) void rightHand?.pulse(0.6, 70).catch(() => false);
  };
  const yaw = new Flick((d) => turn("spin", d));
  const pitch = new Flick((d) => turn("tip", d));

  const leftStick = { x: 0, y: 0 };
  const rightStick = { x: 0, y: 0 };

  /** Raw-gamepad watchers, ticked with the sticks below. */
  const buttonPollers: (() => void)[] = [];

  /**
   * Fire `action` once per press of a face button.
   *
   * Prefers the named component, but Babylon only knows those names if it
   * fetched the controller profile from an external CDN at runtime. When that
   * fetch fails it falls back to a generic controller carrying nothing but a
   * trigger, and every face button silently stops responding — no error, the
   * binding just never fires. Polling the raw gamepad index covers that, and
   * only runs when the named component is genuinely missing, so a single press
   * can never register twice.
   */
  const onFacePress = (
    mc: { getComponent: (id: string) => WebXRControllerComponent | null; gamepadObject?: unknown },
    id: string,
    rawAction: () => void
  ): void => {
    const action = (): void => {
      onInput();
      rawAction();
    };
    const named = mc.getComponent(id);
    if (named) {
      onPress(named, action);
      return;
    }
    const index = FACE_BUTTON_INDEX[id];
    const pad = mc.gamepadObject as { buttons?: { pressed: boolean }[] } | undefined;
    if (index === undefined || !pad?.buttons) return;
    let wasDown = false;
    buttonPollers.push(() => {
      const down = pad.buttons?.[index]?.pressed === true;
      if (down && !wasDown) action();
      wasDown = down;
    });
  };

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
        rightHand = mc;
        // trigger → hard drop, once per pull and no faster than the cooldown
        let lastDrop = -Infinity;
        onPress(trigger, () => {
          onInput();
          const now = performance.now();
          if (now - lastDrop < HARD_DROP_COOLDOWN_MS) return;
          lastDrop = now;
          game.hardDrop();
        });
        // A / B → rotate around Z
        onFacePress(mc, "a-button", () => turn("roll", 1));
        onFacePress(mc, "b-button", () => turn("roll", -1));
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
        onFacePress(mc, "x-button", recenter);
        // left Y → start a fresh round, at any point. Pointing the ray at the
        // panel button is fiddly with a queue behind you, and abandoning a
        // round that is going badly is worth a button of its own.
        onFacePress(mc, "y-button", onRestart);
      }
    });
  });

  // Poll stick values every frame for smooth auto-repeat.
  renderer.scene.onBeforeRenderObservable.add(() => {
    for (const poll of buttonPollers) poll();

    // A deflected stick means a hand on the controller. Thresholded rather than
    // taken from the axis event, so a controller resting on a table and
    // drifting a little does not read as somebody playing.
    if (Math.hypot(leftStick.x, leftStick.y) > 0.35 ||
        Math.hypot(rightStick.x, rightStick.y) > 0.35) onInput();

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
