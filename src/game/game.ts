import { PieceFeed } from "./bag";
import { Grid } from "./grid";
import { PieceDef } from "./pieces";
import type { Rules } from "./rules";
import { Axis, IVec3, rotate } from "./vec";

// Wall-kick candidates tried (in order) when a rotation would otherwise
// collide. Sideways nudges first, then drop the piece down — this is what
// lets horizontal-axis rotations succeed right at the top of the well, where
// the rotated cells would otherwise poke through the ceiling.
const KICKS: IVec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: -2, z: 0 },
  { x: 0, y: -3, z: 0 },
];

/**
 * Stored on garbage cells. The versus renderer paints settled blocks by depth,
 * not by what put them there, so this never reaches the screen — it exists so
 * the grid holds a real value rather than a piece colour that would be a lie.
 */
export const GARBAGE_COLOR = 0x6b7280;

export class Game {
  readonly grid: Grid;

  private readonly feed: PieceFeed;
  /** A feed this game made for itself is reset with it; a shared one is not. */
  private readonly ownsFeed: boolean;
  private cursor = 0;

  current!: PieceDef;
  cells!: IVec3[]; // current rotated offsets
  pos!: IVec3; // pivot position in the well
  next!: PieceDef;

  score = 0;
  level = 1;
  layers = 0;
  gameOver = false;
  softDropping = false;

  /**
   * Milliseconds left in the round, or Infinity in a mode without a clock.
   * In VR the clock, not the well, usually ends it.
   */
  timeLeftMs: number;
  /** Why the round ended, for the game-over panel. */
  endedBy: "topout" | "timeout" | null = null;

  private dropTimer = 0;

  /**
   * Attacks waiting to be applied.
   *
   * Garbage cannot rise the instant it is earned: the piece this player is
   * holding is mid-flight, and lifting the stack under it would leave it
   * intersecting blocks it never touched. Everything here is applied at the
   * moment that piece locks, before the next one spawns.
   */
  private pendingGarbage: { lines: number; holeX: number; holeZ: number }[] = [];

  /** Fired whenever the visible state changes (renderer redraws). */
  onChange: (() => void) | null = null;
  /** Fired when n>0 layers clear (for sound/juice). */
  onClear: ((n: number) => void) | null = null;
  /** Fired once when the game ends. */
  onGameOver: (() => void) | null = null;
  /** Fired on a successful sideways move (for sound). */
  onMove: (() => void) | null = null;
  /** Fired on a successful rotation, with the turn that was applied. */
  onRotate: ((axis: Axis, dir: 1 | -1) => void) | null = null;
  /** Fired when a piece settles into the stack (for sound). */
  onLock: (() => void) | null = null;
  /** Fired when garbage is queued against this player, before it rises. */
  onGarbageQueued: ((lines: number) => void) | null = null;
  /** Fired when queued garbage actually lifts the stack. */
  onGarbageRise: ((lines: number) => void) | null = null;

  /**
   * Pass a `feed` to share one piece sequence between several games (versus);
   * leave it out and the game deals from a feed of its own, escalating on its
   * own score.
   */
  constructor(readonly rules: Rules, feed?: PieceFeed) {
    this.grid = new Grid(rules.well);
    this.ownsFeed = !feed;
    this.feed = feed ?? new PieceFeed(rules.tiers, () => this.score);
    this.timeLeftMs = rules.roundTimeMs ?? Infinity;
    this.next = this.feed.at(this.cursor++);
    this.spawn();
  }

  /**
   * The round is nearly out of time.
   *
   * The readout, the room colour and the music tempo all key off this one
   * getter. Deriving the same condition separately in each let them disagree
   * at the boundary — the clock turned red a frame before the room did.
   */
  get timeCritical(): boolean {
    return this.timeLeftMs <= this.rules.timeWarningMs;
  }

  /** 0 the moment the warning starts, 1 when the clock is out. */
  get timePressure(): number {
    const warn = this.rules.timeWarningMs;
    if (warn <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.timeLeftMs / warn));
  }

  private dropInterval(): number {
    const r = this.rules;
    return Math.max(r.minDropMs, r.baseDropMs - (this.level - 1) * r.levelSpeedupMs);
  }

  /** Label of the bag composition currently in play, for the HUD. */
  get tierLabel(): string {
    return this.feed.tierLabel;
  }

  private spawn(): void {
    const { w, d, h } = this.rules.well;
    this.current = this.next;
    this.next = this.feed.at(this.cursor++);
    this.cells = this.current.cells.map((c) => ({ ...c }));

    // Centre the piece's own bounding box in the well rather than parking the
    // pivot at the midpoint. Offsets are not symmetric around the pivot (I runs
    // -1..+2), so a fixed pivot pushes the long pieces through the wall and
    // ends the game on spawn as soon as the well is no wider than the piece.
    const span = (sel: (c: IVec3) => number): [number, number] => {
      const vals = this.cells.map(sel);
      return [Math.min(...vals), Math.max(...vals)];
    };
    const [minX, maxX] = span((c) => c.x);
    const [minZ, maxZ] = span((c) => c.z);
    const maxY = Math.max(...this.cells.map((c) => c.y));

    this.pos = {
      x: Math.floor((w - (maxX - minX + 1)) / 2) - minX,
      y: h - 1 - maxY,
      z: Math.floor((d - (maxZ - minZ + 1)) / 2) - minZ,
    };
    this.dropTimer = 0;
    if (!this.grid.canPlace(this.cells, this.pos)) {
      this.endedBy = "topout";
      this.gameOver = true;
      this.onGameOver?.();
    }
    this.onChange?.();
  }

  tryMove(dx: number, dz: number): boolean {
    if (this.gameOver) return false;
    const np = { x: this.pos.x + dx, y: this.pos.y, z: this.pos.z + dz };
    if (this.grid.canPlace(this.cells, np)) {
      this.pos = np;
      this.onMove?.();
      this.onChange?.();
      return true;
    }
    return false;
  }

  tryRotate(axis: Axis, dir: 1 | -1): boolean {
    if (this.gameOver) return false;
    const rotated = this.cells.map((c) => rotate(c, axis, dir));
    for (const k of KICKS) {
      const np = { x: this.pos.x + k.x, y: this.pos.y + k.y, z: this.pos.z + k.z };
      if (this.grid.canPlace(rotated, np)) {
        this.cells = rotated;
        this.pos = np;
        this.onRotate?.(axis, dir);
        this.onChange?.();
        return true;
      }
    }
    return false;
  }

  // Move down one step without locking. Returns false if it couldn't move.
  private descend(): boolean {
    const np = { x: this.pos.x, y: this.pos.y - 1, z: this.pos.z };
    if (this.grid.canPlace(this.cells, np)) {
      this.pos = np;
      return true;
    }
    return false;
  }

  hardDrop(): void {
    if (this.gameOver) return;
    while (this.descend()) {
      /* keep falling */
    }
    this.lock();
  }

  private lock(): void {
    const r = this.rules;
    this.grid.lock(this.cells, this.pos, this.current.color);
    this.onLock?.();
    const n = this.grid.clearFullLayers();
    if (n > 0) {
      this.score += (r.layerScore[Math.min(n, r.layerScore.length - 1)] ?? 0) * this.level;
      this.layers += n;
      this.level = 1 + Math.floor(this.layers / r.layersPerLevel);
      this.timeLeftMs += n * r.timeBonusPerLayerMs;
      this.onClear?.(n);
    }
    // After the clear so a player is not handed layers they just removed, and
    // before the spawn so the new piece is checked against the raised stack.
    this.applyPendingGarbage();
    this.spawn();
  }

  /** Total layers queued against this player and not yet risen. */
  get incomingGarbage(): number {
    return this.pendingGarbage.reduce((n, g) => n + g.lines, 0);
  }

  /**
   * Take a hit of `lines` layers. The hole column is rolled once here and
   * shared by every layer in this hit, so a four-line attack is a four-deep
   * shaft rather than four unrelated gaps.
   */
  receiveGarbage(lines: number): void {
    if (lines <= 0 || this.gameOver) return;
    const { w, d } = this.rules.well;
    this.pendingGarbage.push({
      lines,
      holeX: Math.floor(Math.random() * w),
      holeZ: Math.floor(Math.random() * d),
    });
    this.onGarbageQueued?.(lines);
  }

  private applyPendingGarbage(): void {
    if (this.pendingGarbage.length === 0) return;
    let total = 0;
    for (const g of this.pendingGarbage) {
      this.grid.riseGarbage(g.lines, g.holeX, g.holeZ, GARBAGE_COLOR);
      total += g.lines;
    }
    this.pendingGarbage.length = 0;
    this.onGarbageRise?.(total);
  }

  // Landing position of the current piece (for the ghost preview).
  ghostPos(): IVec3 {
    const p = { ...this.pos };
    while (this.grid.canPlace(this.cells, { x: p.x, y: p.y - 1, z: p.z })) p.y--;
    return p;
  }

  tick(dtMs: number): void {
    if (this.gameOver) return;

    if (this.rules.roundTimeMs !== null) {
      this.timeLeftMs -= dtMs;
      if (this.timeLeftMs <= 0) {
        this.timeLeftMs = 0;
        this.endedBy = "timeout";
        this.gameOver = true;
        this.onGameOver?.();
        this.onChange?.();
        return;
      }
    }

    this.dropTimer += dtMs;
    const interval = this.softDropping ? this.rules.softDropMs : this.dropInterval();
    if (this.dropTimer >= interval) {
      this.dropTimer = 0;
      if (!this.descend()) this.lock();
      else this.onChange?.();
    }
  }

  reset(): void {
    this.grid.reset();
    this.score = 0;
    this.level = 1;
    this.layers = 0;
    this.gameOver = false;
    this.endedBy = null;
    this.timeLeftMs = this.rules.roundTimeMs ?? Infinity;
    this.softDropping = false;
    this.pendingGarbage.length = 0;
    // A shared feed is reset once per round by whoever owns the round.
    if (this.ownsFeed) this.feed.reset();
    this.cursor = 0;
    this.next = this.feed.at(this.cursor++);
    this.spawn();
  }
}
