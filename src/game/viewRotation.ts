import { Axis } from "./vec";

/**
 * What the player is asking for, described by what they see rather than by a
 * coordinate axis.
 *
 * `tip`  — the piece falls forwards or backwards, away from or toward you
 * `spin` — the piece turns on the spot, like a plate on a table
 * `roll` — the piece keels over to the left or right
 */
export type RotateIntent = "tip" | "spin" | "roll";

/** Which quarter turn the player is standing at, relative to the well. */
export function viewQuadrant(relativeYaw: number): 0 | 1 | 2 | 3 {
  const q = Math.round(relativeYaw / (Math.PI / 2)) % 4;
  return (((q % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Turn a request expressed in the player's own frame into a grid axis.
 *
 * The grid axes are fixed to the well, but the player is not: they can turn on
 * the spot or walk round, and the moment they do, "rotate about X" stops
 * meaning anything they can see. Resolving the intent against where they are
 * actually standing keeps `tip` tipping away from *them* no matter which side
 * of the well they are on.
 *
 * Only the quadrant matters, because the well is square — a player standing at
 * 80 degrees is treated as standing at 90.
 */
export function resolveRotation(
  intent: RotateIntent,
  dir: 1 | -1,
  relativeYaw: number
): { axis: Axis; dir: 1 | -1 } {
  // Spinning is about the vertical axis whichever way the player faces.
  if (intent === "spin") return { axis: "y", dir };

  const q = viewQuadrant(relativeYaw);
  const flip = (d: 1 | -1): 1 | -1 => (d === 1 ? -1 : 1);

  // The player's right-hand axis, and the axis running away from them, each
  // land on a different grid axis depending on which quarter they stand at.
  // tip turns about the first, roll about the second.
  const RIGHT: { axis: Axis; flip: boolean }[] = [
    { axis: "x", flip: false },
    { axis: "z", flip: true },
    { axis: "x", flip: true },
    { axis: "z", flip: false },
  ];
  const FORWARD: { axis: Axis; flip: boolean }[] = [
    { axis: "z", flip: false },
    { axis: "x", flip: false },
    { axis: "z", flip: true },
    { axis: "x", flip: true },
  ];

  const m = intent === "tip" ? RIGHT[q] : FORWARD[q];
  return { axis: m.axis, dir: m.flip ? flip(dir) : dir };
}
