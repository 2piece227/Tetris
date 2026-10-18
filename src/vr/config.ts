import { VR_RULES } from "../game/rules";

// Gameplay tuning (well depth, gravity, the round clock) lives in VR_RULES in
// src/game/rules.ts. What is left here is how the VR room is staged.

// The well, as the room builds it. Same object the rules use, so the tank can
// never be drawn a different size from the grid inside it.
export const WELL = VR_RULES.well;

// Size of one cell cube in Babylon world units (metres in VR).
// 18 layers have to fit between the pedestal and eye level, so the cell had to
// shrink with the well: 0.075 puts the whole tank in view from a standing
// position (see WELL_ANCHOR) at the cost of smaller blocks.
export const CELL = 0.075;

// ─── VR staging ─────────────────────────────────────────────────────────────
// The tank sits on a pedestal like an aquarium on a table. `y` is the height of
// the tank's BOTTOM off the floor; the pedestal fills the gap down to the floor.
// bottom 0.18 + height 1.35 puts the rim at 1.53m — just under eye level, so
// the whole shaft is in view without craning. A deeper well is mostly read
// through the glass from the side now rather than straight down the top.
export const WELL_ANCHOR = { x: 0, y: 0.18, z: -0.7 } as const;

// How far in front of the player the tank is planted when a VR session starts
// (and on every recenter).
export const XR_DISTANCE = 0.7;

// Minimum gap between two hard drops. Edge detection already reduces a trigger
// pull to a single drop; this is the backstop for a trigger that chatters
// across the press threshold, where one twitch could otherwise bury the well.
export const HARD_DROP_COOLDOWN_MS = 250;
