// ─── Game tuning ────────────────────────────────────────────────────────────
// The well (pit) the pieces fall into. w = x axis, d = z axis, h = y (height).
// 4x4x8 keeps a festival round short and, more importantly, keeps the depth
// judgement tractable for someone who has never worn a headset before.
// A deep well is the cheapest difficulty knob there is: it does not make the
// game easier to understand, it just buys the player far more room to be bad
// before the round ends. That is what a one-at-a-time booth queue needs.
export const WELL = { w: 4, d: 4, h: 18 } as const;

// Size of one cell cube in Babylon world units (metres in VR).
// 18 layers have to fit between the pedestal and eye level, so the cell had to
// shrink with the well: 0.075 puts the whole tank in view from a standing
// position (see WELL_ANCHOR) at the cost of smaller blocks.
export const CELL = 0.075;

// Gravity: how long (ms) between automatic one-step drops, per level.
// 30% slower than the previous pass across the board.
export const BASE_DROP_MS = 2000;
export const MIN_DROP_MS = 460;
export const SOFT_DROP_MS = 100; // while soft-drop is held
export const LEVEL_SPEEDUP_MS = 155; // shaved off BASE_DROP_MS per level

// How many cleared layers to advance a level.
export const LAYERS_PER_LEVEL = 5;

// Score awarded for clearing n layers at once (index = n).
export const LAYER_SCORE = [0, 100, 300, 600, 1000, 1500];

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
