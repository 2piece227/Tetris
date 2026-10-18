import { Vector2 } from "@babylonjs/core";
import { isHeadset } from "../device";
import { AutoPlayer } from "../game/autoPlay";
import { Game } from "../game/game";
import { VR_RULES } from "../game/rules";
import { Renderer } from "../vr/renderer";
import "./page.css";

const headset = isHeadset();
if (headset) document.body.classList.add("headset");

// ─── Background reel ────────────────────────────────────────────────────────
// The VR tank, with the machine playing it, under a camera that drifts round
// it — so the menu sits over something moving rather than a flat colour. It is
// the real game, not a recording: nothing to ship, and it always matches what
// the player is about to get.

const renderer = new Renderer(document.getElementById("bg") as HTMLCanvasElement);
const game = new Game(VR_RULES);
const auto = new AutoPlayer({ beatMs: 170, settleMs: 420 });

const cam = renderer.camera;
cam.detachControl();
cam.beta = 1.02;

/** Radians per millisecond: one lap of the tank in about a minute and a half. */
const ORBIT_SPEED = (Math.PI * 2) / 90_000;
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Push the tank to the right of the screen, clear of the menu on the left.
 * Shifting the picture rather than the camera's target keeps the orbit centred
 * on the tank, so it turns in place instead of swinging across the frame.
 */
const frame = (): void => {
  const wide = window.innerWidth > 760;
  cam.targetScreenOffset = new Vector2(wide ? 0.62 : 0, 0);
  // On a phone-width screen the menu covers the middle, so the tank stands
  // further back and reads as scenery rather than crowding the rows.
  cam.radius = wide ? 2.05 : 2.6;
};
frame();
window.addEventListener("resize", frame);

game.onChange = () => renderer.redraw(game);
// The reel loops forever: whatever ends a round, start another.
game.onGameOver = () => {
  auto.reset();
  game.reset();
};

renderer.scene.onBeforeRenderObservable.add(() => {
  const dt = renderer.engine.getDeltaTime();
  auto.update(game);
  game.tick(dt);
  if (!still) cam.alpha += ORBIT_SPEED * dt;
});
renderer.redraw(game);

// ─── Menu ───────────────────────────────────────────────────────────────────
// One row is always selected. Mouse hover and the arrow keys both move the
// selection, so a booth PC works with whichever is to hand.

const rows = [...document.querySelectorAll<HTMLElement>(".row")];
const visible = (): HTMLElement[] => rows.filter((r) => r.offsetParent !== null);
let selected = visible()[0];

const select = (row: HTMLElement): void => {
  selected = row;
  for (const r of rows) r.classList.toggle("on", r === row);
  row.focus({ preventScroll: true });
};
select(selected);

for (const row of rows) row.addEventListener("mouseenter", () => select(row));

// ─── How-to sheet ───────────────────────────────────────────────────────────
const sheet = document.getElementById("howto") as HTMLElement;
const openSheet = (): void => sheet.classList.add("show");
const closeSheet = (): void => {
  sheet.classList.remove("show");
  select(selected);
};
document.querySelector("[data-sheet='howto']")!.addEventListener("click", openSheet);
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) closeSheet();
});

window.addEventListener("keydown", (e) => {
  if (sheet.classList.contains("show")) {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      closeSheet();
    }
    return;
  }

  const list = visible();
  const at = list.indexOf(selected);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    select(list[(at + step + list.length) % list.length]);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selected.click();
  } else if (/^[1-9]$/.test(e.key)) {
    // Number keys follow the numbers printed on the rows.
    const row = list.find((r) => r.querySelector(".num")?.textContent === `0${e.key}`);
    if (row) {
      select(row);
      row.click();
    }
  }
});
