import { Sfx } from "../audio/sfx";
import { keepOffHeadset } from "../device";
import { AutoPlayer, type Pace } from "../game/autoPlay";
import { PieceFeed } from "../game/bag";
import { Game } from "../game/game";
import { VERSUS_RULES } from "../game/rules";
import "../menu/page.css";
import { Hud, type Tally } from "./hud";
import { attachKeyboard } from "./keyboard";
import { Renderer } from "./renderer";

keepOffHeadset();

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const renderer = new Renderer($("renderCanvas") as HTMLCanvasElement);
const hud = new Hud();
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

// ─── Opponent ───────────────────────────────────────────────────────────────
/**
 * A level is how fast the opponent plays and how often it settles for less
 * than the engine's best spot. The engine only looks one piece ahead and never
 * aims an attack yet, so even "hard" is beatable by someone who stacks well.
 */
type Level = "easy" | "normal" | "hard";
const LEVELS: Record<Level, { name: string; pace: Pace }> = {
  easy: { name: "쉬움", pace: { beatMs: 420, settleMs: 800, mistakes: 0.45 } },
  normal: { name: "보통", pace: { beatMs: 240, settleMs: 420, mistakes: 0.18 } },
  hard: { name: "어려움", pace: { beatMs: 130, settleMs: 180, mistakes: 0 } },
};
const LEVEL_ORDER: Level[] = ["easy", "normal", "hard"];

/** Remembered per browser, so the booth PC keeps whatever level it was left on. */
const loadLevel = (): Level => {
  try {
    const v = localStorage.getItem("versus.level");
    if (v && v in LEVELS) return v as Level;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return "normal";
};
let level: Level = loadLevel();
let ai = new AutoPlayer(LEVELS[level].pace);

const levelButtons = [...document.querySelectorAll<HTMLButtonElement>("#levels button")];
function setLevel(l: Level): void {
  level = l;
  ai = new AutoPlayer(LEVELS[l].pace);
  for (const b of levelButtons) b.classList.toggle("on", b.dataset.level === l);
  hud.setNames("나", `AI · ${LEVELS[l].name}`);
  try {
    localStorage.setItem("versus.level", l);
  } catch {
    /* not remembered; nothing else depends on it */
  }
}
for (const b of levelButtons) b.addEventListener("click", () => setLevel(b.dataset.level as Level));
setLevel(level);

// ─── Round state ────────────────────────────────────────────────────────────
/** ready: start card · count: 3-2-1 · playing · over: result card */
type Phase = "ready" | "count" | "playing" | "over";
let phase: Phase = "ready";

const tally: Tally = { sent: [0, 0], received: [0, 0] };
let startedAt = 0;
let endedAt = 0;

/**
 * How long the result card ignores the drop button.
 *
 * Players hammer drop, and the press that ends the round is usually one of
 * several already on the way. Without a lockout the card is dismissed in the
 * same burst that caused it and nobody ever reads who won.
 */
const RESULT_CARD_LOCKOUT_MS = 900;

const show = (id: string, on: boolean): void => {
  $(id).classList.toggle("show", on);
};

function draw(): void {
  renderer.redraw(human, cpu);
  hud.update([human, cpu], tally);
}

function resetBoards(): void {
  feed.reset(); // once per round, before the players rewind their cursors
  for (const g of players) g.reset();
  ai.reset();
  tally.sent = [0, 0];
  tally.received = [0, 0];
  hud.clearFlashes();
  draw();
}

/** 3, 2, 1, then play. Gives a player who just pressed start time to get their hands on the keys. */
function countIn(): void {
  if (phase === "count" || phase === "playing") return;
  phase = "count";
  show("start", false);
  show("result", false);
  resetBoards();
  show("count", true);

  const num = $("countNum");
  const beats = ["3", "2", "1", "시작!"];
  beats.forEach((text, i) => {
    window.setTimeout(() => {
      num.textContent = text;
      num.classList.remove("pop");
      void num.offsetWidth;
      num.classList.add("pop");
      sfx.move();
    }, i * 700);
  });
  window.setTimeout(() => {
    show("count", false);
    phase = "playing";
    startedAt = performance.now();
  }, beats.length * 700 - 200);
}

function endRound(loser: Game): void {
  if (phase !== "playing") return;
  phase = "over";
  endedAt = performance.now();
  const won = loser === cpu;

  const title = $("resultTitle");
  title.textContent = won ? "승리!" : "패배";
  title.className = won ? "win" : "lose";
  $("resultSub").textContent = won
    ? `AI(${LEVELS[level].name})가 먼저 꼭대기에 닿았어요.`
    : "블록이 꼭대기에 닿았어요. 다시 해볼까요?";
  $("rLayers").textContent = String(human.layers);
  $("rSent").textContent = String(tally.sent[0]);
  $("rRecv").textContent = String(tally.received[0]);
  const secs = Math.round((endedAt - startedAt) / 1000);
  $("rTime").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  show("result", true);
  sfx.gameOver();
}

function toStartCard(): void {
  phase = "ready";
  show("result", false);
  show("count", false);
  show("start", true);
  resetBoards();
}

// ─── Game events ────────────────────────────────────────────────────────────
/**
 * Clearing `n` layers sends `n` layers at the opponent.
 *
 * The hit does not land immediately — Game holds it until the victim's current
 * piece settles, so the stack never lifts out from under a piece in flight.
 * Every layer in one hit shares a hole column, so a big attack digs a shaft
 * instead of scattering gaps.
 */
for (const me of players) {
  const side = me === human ? 0 : 1;
  const other = me === human ? cpu : human;
  me.onChange = draw;
  // The machine's moves stay silent: two sets of blips at once is noise, and
  // the player should only hear their own hands.
  if (me === human) {
    me.onMove = () => sfx.move();
    me.onRotate = () => sfx.rotate();
    me.onLock = () => sfx.lock();
    me.onRotateBlocked = (cells, pos) => {
      sfx.blocked();
      renderer.p1.showBlocked(cells, pos);
    };
  }
  me.onClear = (n) => {
    sfx.clear(n);
    other.receiveGarbage(n);
    tally.sent[side] += n;
    hud.flashAttack(side, n);
    draw(); // the victim's attack gauge fills now, before anything rises
  };
  // Fires when the queued layers actually lift this player's stack.
  me.onGarbageRise = (n) => {
    tally.received[side] += n;
    hud.flashHit(side, n);
    sfx.lock();
    draw();
  };
  me.onGameOver = () => endRound(me);
}

attachKeyboard(human, sfx, () => phase === "playing");

// ─── Card keys ──────────────────────────────────────────────────────────────
// Start on keyUP, not keydown: the keydown that dismisses a card would
// otherwise fall straight through to the freshly enabled bindings and hard
// drop the first piece the instant the round begins.
window.addEventListener("keyup", (e) => {
  if (phase === "ready") {
    if (e.code === "Space" || e.code === "Enter") countIn();
    else if (e.code === "Escape") window.location.href = "./";
  } else if (phase === "over") {
    if (performance.now() - endedAt < RESULT_CARD_LOCKOUT_MS) return;
    if (e.code === "Space" || e.code === "Enter") countIn();
    else if (e.code === "Escape") toStartCard();
  }
});
window.addEventListener("keydown", (e) => {
  // F5 would reload and lose a fullscreen kiosk window.
  if (e.code === "F5") e.preventDefault();
  if (phase !== "ready") return;
  // Pick the level from the keyboard: arrows step, digits jump.
  const at = LEVEL_ORDER.indexOf(level);
  if (e.code === "ArrowLeft" || e.code === "KeyA") setLevel(LEVEL_ORDER[Math.max(0, at - 1)]);
  else if (e.code === "ArrowRight" || e.code === "KeyD") setLevel(LEVEL_ORDER[Math.min(2, at + 1)]);
  else if (/^Digit[1-3]$/.test(e.code)) setLevel(LEVEL_ORDER[Number(e.code.slice(5)) - 1]);
});

$("startBtn").addEventListener("click", countIn);
$("restartBtn").addEventListener("click", countIn);
$("levelBtn").addEventListener("click", toStartCard);

// Gravity for both wells, off one clock.
renderer.scene.onBeforeRenderObservable.add(() => {
  if (phase !== "playing") return;
  const dt = renderer.engine.getDeltaTime();
  ai.update(cpu);
  for (const g of players) g.tick(dt);
});

draw();
