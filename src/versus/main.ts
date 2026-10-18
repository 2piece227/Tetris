import { Sfx } from "../audio/sfx";
import { keepOffHeadset } from "../device";
import { AutoPlayer } from "../game/autoPlay";
import { PieceFeed } from "../game/bag";
import { Game } from "../game/game";
import { VERSUS_RULES } from "../game/rules";
import { attachKeyboard } from "./keyboard";
import { Renderer } from "./renderer";

keepOffHeadset();

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const startCard = document.getElementById("start") as HTMLElement;
const banner = document.getElementById("banner") as HTMLElement;
const bannerText = document.getElementById("bannerText") as HTMLElement;

const renderer = new Renderer(canvas, ["나", "AI"]);
const sfx = new Sfx("bgm-versus.mp3");

// One sequence, two cursors: both sides are dealt identical pieces in identical
// order, so nobody can lose to a worse draw. `players` is filled after
// construction on purpose — the feed reads scores through it, and during
// construction it is empty and reports 0, which is what both scores are then.
const players: Game[] = [];
const feed = new PieceFeed(VERSUS_RULES.tiers, () =>
  players.reduce((best, g) => Math.max(best, g.score), 0)
);
const human = new Game(VERSUS_RULES, feed);
const cpu = new Game(VERSUS_RULES, feed);
players.push(human, cpu);

/**
 * Placeholder opponent: the VR attract player, a little quicker. It only looks
 * at the piece in hand and has no notion of attacking — the evaluation engine
 * will replace it, with difficulty settings.
 */
const ai = new AutoPlayer({ beatMs: 200, settleMs: 350 });

/** ready: start card up · playing: live · over: result card up */
type Phase = "ready" | "playing" | "over";
let phase: Phase = "ready";

/**
 * How long the result card ignores the drop button.
 *
 * Players hammer drop, and the press that ends the round is usually one of
 * several already on the way. Without a lockout the card is dismissed in the
 * same burst that caused it and nobody ever reads who won.
 */
const RESULT_CARD_LOCKOUT_MS = 900;
let overSince = 0;

function draw(): void {
  renderer.redraw(human, cpu);
}

/**
 * Clearing `n` layers sends `n` layers at the opponent.
 *
 * The hit does not land immediately — Game holds it until the victim's current
 * piece settles, so the stack never lifts out from under a piece in flight.
 * Every layer in one hit shares a hole column, so a big attack digs a shaft
 * instead of scattering gaps.
 */
function sendAttack(attacker: Game, victim: Game, layers: number): void {
  victim.receiveGarbage(layers);
  renderer.hud.flashAttack(attacker === human ? 0 : 1, layers);
}

function startRound(): void {
  if (phase === "playing") return;
  overSince = 0;
  feed.reset(); // once per round, before the players rewind their cursors
  for (const g of players) g.reset();
  ai.reset();
  renderer.hud.clearFlashes();
  startCard.classList.remove("show");
  banner.classList.remove("show");
  phase = "playing";
  draw();
}

function endRound(loser: Game): void {
  if (phase !== "playing") return;
  phase = "over";
  overSince = performance.now();
  bannerText.textContent = loser === cpu ? "승리!" : "AI 승리";
  banner.classList.add("show");
  sfx.gameOver();
}

function toStartCard(): void {
  phase = "ready";
  banner.classList.remove("show");
  startCard.classList.add("show");
  feed.reset();
  for (const g of players) g.reset();
  ai.reset();
  renderer.hud.clearFlashes();
  draw();
}

for (const me of players) {
  const other = me === human ? cpu : human;
  const side = me === human ? 0 : 1;
  me.onChange = draw;
  // The machine's moves stay silent: two sets of blips at once is noise, and
  // the player should only hear their own hands.
  if (me === human) {
    me.onMove = () => sfx.move();
    me.onRotate = () => sfx.rotate();
    me.onLock = () => sfx.lock();
  }
  me.onClear = (n) => {
    sfx.clear(n);
    sendAttack(me, other, n);
  };
  // Fires when the queued layers actually lift this player's stack.
  me.onGarbageRise = (n) => {
    renderer.hud.flashHit(side, n);
    sfx.lock();
    draw();
  };
  me.onGameOver = () => endRound(me);
}

attachKeyboard(human, sfx, () => phase === "playing");

// Start on keyUP, not keydown: the keydown that dismisses the card would
// otherwise fall straight through to the freshly-enabled bindings and hard drop
// the first piece the instant the round begins.
window.addEventListener("keyup", (e) => {
  if (e.code === "Escape") {
    if (phase === "over") toStartCard();
    else if (phase === "ready") window.location.href = "./";
    return;
  }
  if (e.code !== "Space" && e.code !== "Enter") return;
  if (phase === "ready") startRound();
  else if (phase === "over" && performance.now() - overSince >= RESULT_CARD_LOCKOUT_MS)
    startRound();
});
window.addEventListener("keydown", (e) => {
  // F5 would reload and lose a fullscreen kiosk window.
  if (e.code === "F5") e.preventDefault();
});

document.getElementById("startBtn")!.addEventListener("click", startRound);
document.getElementById("restartBtn")!.addEventListener("click", startRound);

// Gravity for both wells, off one clock.
renderer.scene.onBeforeRenderObservable.add(() => {
  if (phase !== "playing") return;
  const dt = renderer.engine.getDeltaTime();
  ai.update(cpu);
  for (const g of players) g.tick(dt);
});

draw();
