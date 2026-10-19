import { Tier, VERSUS_TIERS, VR_TIERS } from "./pieces";

export interface WellSize {
  /** x axis */
  w: number;
  /** z axis */
  d: number;
  /** y axis — the number of layers */
  h: number;
}

/**
 * Everything about how a round plays that differs between modes.
 *
 * The two modes share the pieces, the rotation rules and the grid, but were
 * tuned apart on purpose: VR is a practice room where a first-timer should have
 * time to turn the piece where they want it, versus is a short contest. Keeping
 * the numbers in one object per mode is what lets both live in one Game class.
 */
export interface Rules {
  /** Which rule set, so a recorded round can be replayed under the same one. */
  id: "vr" | "versus";
  well: WellSize;

  /** Gravity: ms between automatic one-step drops at level 1. */
  baseDropMs: number;
  minDropMs: number;
  /** Shaved off baseDropMs per level. */
  levelSpeedupMs: number;
  /** Gravity while soft drop is held. */
  softDropMs: number;

  /** How many cleared layers to advance a level. */
  layersPerLevel: number;
  /** Score for clearing n layers at once (index = n), times the level. */
  layerScore: readonly number[];

  /** Length of the round, or null for no clock (the round ends on top-out). */
  roundTimeMs: number | null;
  /** Added back to the clock per cleared layer. */
  timeBonusPerLayerMs: number;
  /** Below this the clock counts as critical. */
  timeWarningMs: number;

  /** Bag compositions, escalating with score. */
  tiers: Tier[];
}

const LAYER_SCORE = [0, 100, 300, 600, 1000, 1500] as const;

export const VR_RULES: Rules = {
  id: "vr",
  // A deep well is the cheapest difficulty knob there is: it does not make the
  // game easier to understand, it just buys the player far more room to be bad
  // before the round ends. That is what a one-at-a-time booth queue needs.
  well: { w: 4, d: 4, h: 18 },

  // 30% slower than the first pass across the board. Turning a piece in a
  // headset is confusing at first, and the time to work it out is the point.
  baseDropMs: 2000,
  minDropMs: 460,
  levelSpeedupMs: 155,
  softDropMs: 100,

  layersPerLevel: 5,
  layerScore: LAYER_SCORE,

  // The well is deep and gravity is gentle, so a player who simply never
  // presses drop was measured taking sixteen minutes. Speeding gravity up to
  // fix that made the game unreadable, so the clock does the bounding instead
  // and the pace stays where it is legible.
  roundTimeMs: 180_000,
  // Uncapped: clears are rare enough here that nobody is going to farm it.
  timeBonusPerLayerMs: 10_000,
  timeWarningMs: 60_000,

  tiers: VR_TIERS,
};

export const VERSUS_RULES: Rules = {
  id: "versus",
  // Twelve layers rather than VR's eighteen. A versus round wants to be decided
  // in a couple of minutes, and a shallow well is what forces that.
  well: { w: 4, d: 4, h: 12 },

  // NOTE: inherited from VR, where it was deliberately slowed for first-timers
  // in a headset. Probably too slow for a contest; not yet tuned.
  baseDropMs: 2000,
  minDropMs: 460,
  levelSpeedupMs: 155,
  softDropMs: 100,

  layersPerLevel: 5,
  layerScore: LAYER_SCORE,

  // Decided by topping out, not by a clock.
  roundTimeMs: null,
  timeBonusPerLayerMs: 0,
  timeWarningMs: 0,

  tiers: VERSUS_TIERS,
};

export const RULES_BY_ID: Record<Rules["id"], Rules> = { vr: VR_RULES, versus: VERSUS_RULES };
